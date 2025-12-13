// src/services/proxmoxClient.js
// Pure JS (ESM) Proxmox LXC client for ZeroLagHub
// Cleaned version: execInContainer + updateMinecraftProperties removed

import axios from 'axios';

/* ------------------------------------------------------------------ */
/* Auth & storage (tolerant)                                          */
/* ------------------------------------------------------------------ */

function tokenHeader() {
  const raw =
    process.env.PROXMOX_API_TOKEN ||
    process.env.PVE_API_TOKEN ||
    process.env.PVEAPITOKEN ||
    '';

  if (raw) {
    if (raw.startsWith('PVEAPIToken=')) return raw;
    if (raw.includes('!') && raw.includes('=')) return `PVEAPIToken=${raw}`;
  }

  const u = process.env.PROXMOX_USER;
  const id = process.env.PROXMOX_API_TOKEN_ID;
  const sec = process.env.PROXMOX_API_TOKEN_SECRET;

  if (u && id && sec) return `PVEAPIToken=${u}!${id}=${sec}`;

  throw new Error(
    'Missing Proxmox API token. Set PROXMOX_API_TOKEN (or PVE_API_TOKEN/PVEAPITOKEN), ' +
      'or PROXMOX_USER + PROXMOX_API_TOKEN_ID + PROXMOX_API_TOKEN_SECRET.'
  );
}

export const resolveStorage = () =>
  process.env.PROXMOX_STORAGE ||
  process.env.PROXMOX_DEFAULT_STORAGE ||
  'zlh-thin';

/* ------------------------------------------------------------------ */
/* Base axios client                                                   */
/* ------------------------------------------------------------------ */

async function base(nodeOverride) {
  const node = nodeOverride || process.env.PROXMOX_NODE;
  if (!node) throw new Error('Missing PROXMOX_NODE');

  const baseURL = (process.env.PROXMOX_HOST || '').replace(/\/+$/, '') + '/api2/json';
  if (!process.env.PROXMOX_HOST) throw new Error('Missing PROXMOX_HOST');

  const { default: httpsMod } = await import('https');

  const c = axios.create({
    baseURL,
    httpsAgent: new httpsMod.Agent({
      rejectUnauthorized:
        String(process.env.PROXMOX_VERIFY_TLS ?? 'true').toLowerCase() === 'true',
    }),
    headers: { Authorization: tokenHeader() },
    validateStatus: () => true,
    timeout: 30000,
  });

  const form = (obj) =>
    new URLSearchParams(
      Object.entries(obj)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)])
    );

  function assertOk(resp, label = '') {
    if (!(resp?.status >= 200 && resp.status < 300)) {
      const info = resp?.data
        ? JSON.stringify(resp.data)
        : String(resp?.statusText || resp?.status);
      const err = new Error(`[Proxmox ${label}] HTTP ${resp?.status} ${info}`);
      err.httpCode = resp?.status;
      throw err;
    }
  }

  return { c, node, form, assertOk };
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

function upidNode(upid, fallbackNode) {
  if (typeof upid !== 'string') return fallbackNode;
  const parts = upid.split(':');
  return parts.length > 1 && parts[1] ? parts[1] : fallbackNode;
}

export async function pollTask(upid, { intervalMs = 1000, timeoutMs = 5 * 60_000 } = {}) {
  if (!upid) return true;
  const { c, node } = await base();
  const taskNode = upidNode(upid, node);
  const start = Date.now();

  while (true) {
    const r = await c.get(`/nodes/${taskNode}/tasks/${encodeURIComponent(upid)}/status`);
    if (r.status >= 200 && r.status < 300) {
      const st = r.data?.data;
      if (st?.status === 'stopped') {
        const ok = String(st?.exitstatus || '').toUpperCase().startsWith('OK');
        if (ok) return true;
        throw new Error(`Task ${upid} failed: ${st?.exitstatus || 'unknown'}`);
      }
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Task ${upid} timed out`);
    }
    await new Promise((r2) => setTimeout(r2, intervalMs));
  }
}

async function findRecentTaskUpid(vmid, type, { sinceEpochSec, timeoutMs = 15000 } = {}) {
  const { c, node, assertOk } = await base();
  const deadline = Date.now() + timeoutMs;
  const since = sinceEpochSec ?? Math.floor(Date.now() / 1000) - 2;

  while (Date.now() < deadline) {
    const r = await c.get(`/nodes/${node}/tasks`, { params: { since, vmid } });
    assertOk(r, 'tasks/list');
    const list = Array.isArray(r.data?.data) ? r.data.data : [];
    const hit = list.find(
      (t) =>
        String(t?.id) === String(vmid) &&
        String(t?.type).toLowerCase() === String(type).toLowerCase()
    );
    if (hit?.upid) return hit.upid;
    await new Promise((r2) => setTimeout(r2, 800));
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Status & waits                                                      */
/* ------------------------------------------------------------------ */

export async function getContainerStatus(vmid, nodeOverride) {
  const { c, node, assertOk } = await base(nodeOverride);
  const r = await c.get(`/nodes/${node}/lxc/${vmid}/status/current`);
  assertOk(r, 'lxc/status/current');
  return r.data?.data;
}

export async function getContainerConfig(vmid, nodeOverride) {
  const { c, node, assertOk } = await base(nodeOverride);
  const r = await c.get(`/nodes/${node}/lxc/${vmid}/config`);
  assertOk(r, 'lxc/get-config');
  return r.data?.data || {};
}

export async function waitForStatus(vmid, desired, { timeoutMs = 180000, everyMs = 1200 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const st = await getContainerStatus(vmid);
    if (String(st?.status).toLowerCase() === desired) return true;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`Container ${vmid} did not reach status=${desired} in time`);
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export async function startContainer(vmid, nodeOverride) {
  const { c, node, assertOk } = await base(nodeOverride);
  const since = Math.floor(Date.now() / 1000) - 1;

  const r = await c.post(`/nodes/${node}/lxc/${vmid}/status/start`);
  assertOk(r, 'lxc/start');

  let upid = r.data?.data;
  if (!upid) {
    upid = await findRecentTaskUpid(vmid, 'vzstart', { sinceEpochSec: since });
  }

  return upid || null;
}

export async function startWithRetry(vmid, { retries = 6, delayMs = 1200 } = {}) {
  let attempt = 0;
  await new Promise((r) => setTimeout(r, 400));

  while (true) {
    try {
      const upid = await startContainer(vmid);

      if (upid) {
        await pollTask(upid, { timeoutMs: 120000 });
      } else {
        await waitForStatus(vmid, 'running', { timeoutMs: 180000, everyMs: 1200 });
      }

      return true;
    } catch (err) {
      const msg = String(err?.message || '');
      const isConfigLock =
        msg.includes("can't lock file '/run/lock/lxc/pve-config-") &&
        msg.includes('got timeout');

      if (isConfigLock && attempt < retries) {
        attempt++;
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      throw err;
    }
  }
}

export async function shutdownContainer(vmid, { timeout = 60 } = {}) {
  const { c, node, form, assertOk } = await base();
  const since = Math.floor(Date.now() / 1000) - 1;

  const r = await c.post(
    `/nodes/${node}/lxc/${vmid}/status/shutdown`,
    form({ timeout }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  assertOk(r, 'lxc/shutdown');

  return (
    r.data?.data ||
    (await findRecentTaskUpid(vmid, 'vzshutdown', { sinceEpochSec: since }))
  );
}

export async function stopContainer(vmid, { timeout = 60 } = {}) {
  const { c, node, form, assertOk } = await base();
  const since = Math.floor(Date.now() / 1000) - 1;

  const r = await c.post(
    `/nodes/${node}/lxc/${vmid}/status/stop`,
    form({ timeout }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  assertOk(r, 'lxc/stop');

  return (
    r.data?.data ||
    (await findRecentTaskUpid(vmid, 'vzstop', { sinceEpochSec: since }))
  );
}

export async function deleteContainer(vmid) {
  const { c, node, assertOk } = await base();

  try {
    const up = await stopContainer(vmid, { timeout: 60 });
    await pollTask(up, { timeoutMs: 120000 });
  } catch {}

  const r = await c.delete(`/nodes/${node}/lxc/${vmid}`);
  assertOk(r, 'lxc/delete');
  return r.data?.data;
}

/* ------------------------------------------------------------------ */
/* Create & configure                                                  */
/* ------------------------------------------------------------------ */

export async function cloneContainer({ templateVmid, vmid, name, storage, full = 1, pool }) {
  const { c, node, form, assertOk } = await base();
  const chosenStorage = storage || resolveStorage();

  const body = form({
    newid: vmid,
    hostname: name,
    full,
    storage: chosenStorage,
    pool: pool || process.env.PROXMOX_POOL || undefined,
  });

  const r = await c.post(`/nodes/${node}/lxc/${templateVmid}/clone`, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assertOk(r, 'lxc/clone');

  await pollTask(r.data?.data);
  return true;
}

export async function configureContainer({
  vmid,
  cpu,
  memory,
  bridge,
  description,
  tags,
}) {
  const { c, node, form, assertOk } = await base();

  const net0 = bridge ? `name=eth0,bridge=${bridge},ip=dhcp,type=veth` : undefined;

  const params = {
    ...(cpu != null ? { cores: Number(cpu) } : {}),
    ...(memory != null ? { memory: Number(memory) } : {}),
    ...(net0 ? { net0 } : {}),
    ...(tags ? { tags } : {}),
    ...(description ? { description } : {}),
  };

  if (!Object.keys(params).length) return true;

  const r = await c.put(`/nodes/${node}/lxc/${vmid}/config`, form(params), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assertOk(r, 'lxc/config');

  await pollTask(r.data?.data);
  return true;
}

/* ------------------------------------------------------------------ */
/* Resize & attach disk                                                */
/* ------------------------------------------------------------------ */

export async function resizeContainer(vmid, { disk = 'rootfs', addGiB }) {
  if (process.env.PVE_ALLOW_RESIZE !== '1')
    throw new Error('Resize disabled by server config');

  const { c, node, form, assertOk } = await base();
  const r = await c.put(
    `/nodes/${node}/lxc/${vmid}/resize`,
    form({ disk, size: `+${Number(addGiB)}G` }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  assertOk(r, 'lxc/resize');
  return r.data?.data;
}

/* ------------------------------------------------------------------ */
/* Mount points                                                        */
/* ------------------------------------------------------------------ */

export async function attachMountPoint(
  vmid,
  { storage, sizeGiB, mp, mountPath = '/data', options = {} }
) {
  if (process.env.PVE_ALLOW_OPTIONS !== '1')
    throw new Error('Disk attach disabled by server config');

  const { c, node, form, assertOk } = await base();
  const STORAGE = storage || resolveStorage();

  const cur = String((await getContainerStatus(vmid))?.status || '').toLowerCase();

  if (cur === 'running') {
    const up1 = await shutdownContainer(vmid, {
      timeout: Number(process.env.PVE_SHUTDOWN_TIMEOUT || 60),
    });
    await pollTask(up1, { timeoutMs: 180000 });

    let st = String((await getContainerStatus(vmid))?.status || '').toLowerCase();
    if (st === 'running') {
      const up2 = await stopContainer(vmid, {
        timeout: Number(process.env.PVE_STOP_TIMEOUT || 60),
      });
      await pollTask(up2, { timeoutMs: 120000 });
    }

    await waitForStatus(vmid, 'stopped', { timeoutMs: 180000, everyMs: 1200 });
  }

  const cfgRes = await c.get(`/nodes/${node}/lxc/${vmid}/config`);
  assertOk(cfgRes, 'lxc/get-config');
  const cfg = cfgRes.data?.data || {};

  let mpKey = mp;
  if (!mpKey) {
    for (let i = 0; i <= 9; i++) {
      if (!cfg[`mp${i}`]) {
        mpKey = `mp${i}`;
        break;
      }
    }
    if (!mpKey) throw new Error('No free mountpoint slots (mp0..mp9)');
  } else if (cfg[mpKey]) {
    throw new Error(`${mpKey} is already in use`);
  }

  const extra = Object.entries(options || {})
    .map(([k, v]) => `,${k}=${encodeURIComponent(v)}`)
    .join('');

  const value = `${STORAGE}:${Number(sizeGiB)},mp=${mountPath}${extra}`;

  const putRes = await c.put(
    `/nodes/${node}/lxc/${vmid}/config`,
    form({ [mpKey]: value }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  assertOk(putRes, 'lxc/config(mp)');

  const upid = await startContainer(vmid);
  await pollTask(upid, { timeoutMs: 120000 });
  await waitForStatus(vmid, 'running', { timeoutMs: 180000, everyMs: 1000 });

  return putRes.data?.data;
}

/* ------------------------------------------------------------------ */
/* Listing, status, misc                                               */
/* ------------------------------------------------------------------ */

export async function ping() {
  const { c } = await base();
  try {
    const { status, data } = await c.get('/cluster/status');
    return status >= 200 && status < 300 && Boolean(data?.data);
  } catch {
    return false;
  }
}

export async function getTaskStatus(upid) {
  if (!upid) return null;

  const { c, node, assertOk } = await base();
  const taskNode = upidNode(upid, node);

  const r = await c.get(`/nodes/${taskNode}/tasks/${encodeURIComponent(upid)}/status`);
  assertOk(r, 'tasks/status');

  return r.data?.data;
}

export async function getContainerInterfaces(vmid, nodeOverride) {
  const { c, node, assertOk } = await base(nodeOverride);
  const r = await c.get(`/nodes/${node}/lxc/${vmid}/interfaces`);
  assertOk(r, 'lxc/interfaces');
  return r.data?.data || [];
}

export async function listContainers(nodeOverride = null) {
  const { c, node, assertOk } = await base(nodeOverride);

  const activeNode = nodeOverride || node;
  try {
    const r = await c.get(`/nodes/${activeNode}/lxc`);
    assertOk(r, 'lxc/list');

    const containers = Array.isArray(r.data?.data) ? r.data.data : [];
    return containers.map((ct) => ({
      vmid: ct.vmid,
      hostname: ct.name || ct.hostname || `ct-${ct.vmid}`,
      status: ct.status,
    }));
  } catch (err) {
    console.error(`[proxmoxClient] Failed to list containers: ${err.message}`);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Final export                                                        */
/* ------------------------------------------------------------------ */

export default {
  cloneContainer,
  configureContainer,
  //cloneStartConfigure,
  startContainer,
  shutdownContainer,
  stopContainer,
  deleteContainer,
  getContainerStatus,
  getContainerConfig,
  resizeContainer,
  attachMountPoint,
  startWithRetry,
  pollTask,
  waitForStatus,
  resolveStorage,
  ping,
  getTaskStatus,
  getContainerInterfaces,
  listContainers,
};
