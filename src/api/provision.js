// src/api/provision.js
// Orchestrates: clone → config → start → hook → IP → DB → enqueue (commit in worker).

import 'dotenv/config';
import crypto from 'node:crypto';

import { getTemplateOrThrow } from '../services/templateResolver.js';
import proxmox from '../services/proxmoxClient.js';
import prisma from '../services/prisma.js';
import { PortAllocationService } from '../services/portAllocator.js';
import { allocateVmid, confirmVmidAllocated, releaseVmid } from '../services/vmidAllocator.js';
import { enqueuePublishEdge } from '../queues/postProvision.js';
import { writeSlotEnv } from '../services/envFileWriter.js';
import { getCtIpWithRetry } from '../services/getCtIp.js';

const SLEEP_AFTER_START_MS = Number(process.env.CT_EXEC_GRACE_MS || 8000); // default 8s
const STEP_DELAY_MS = 2500; // pause between steps
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sanitizeHostname(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function mergeResources(template, override) {
  const t = template?.resources || {};
  const o = override || {};
  let cpu = o.cpu ?? t.cpu ?? 2;
  cpu = Math.max(1, Math.min(cpu, 3));
  return {
    cpu,
    memory: o.memory ?? t.memory ?? 1024,
    disk: o.disk ?? t.disk ?? 0,
  };
}

function pickBridge(ctype, template) {
  return template?.network?.bridge || (ctype === 'dev' ? 'vmbr2' : 'vmbr3');
}

// --- UPID helpers ---
function isUpidError(error) {
  const msg = (error?.message || error?.response?.data?.errors?.upid || '').toLowerCase();
  return msg.includes('unable to parse worker upid') || (msg.includes('upid') && msg.includes('parse'));
}

async function waitForTask(node, upid, timeoutMs = 180000, everyMs = 2000) {
  if (!upid) throw new Error('No UPID provided');
  const deadline = Date.now() + timeoutMs;
  let backoffMs = everyMs;

  while (Date.now() < deadline) {
    try {
      const st = await proxmox.getTaskStatus(upid);
      if (st.status === 'stopped') {
        if (st.exitstatus === 'OK') return true;
        throw new Error(`task ${upid} failed: ${st.exitstatus}`);
      }
      await sleep(backoffMs);
    } catch (err) {
      if (isUpidError(err)) {
        console.warn(`[provision] UPID error detected: ${err.message}`);
        throw err;
      }
      backoffMs = Math.min(backoffMs * 1.5, 10000);
      await sleep(backoffMs);
    }
  }
  throw new Error(`task ${upid} timed out`);
}

async function executeTaskSafely(taskPromise, vmid, expectedStatus, operation) {
  try {
    const task = await taskPromise;
    if (!task || !task.upid) {
      console.warn(`[provision] No UPID for ${operation}, falling back to status polling`);
      if (expectedStatus) {
        return await proxmox.waitForStatus(vmid, expectedStatus, { timeoutMs: 180000 });
      }
      return true;
    }
    await waitForTask('zlh-prod1', task.upid);
    return true;
  } catch (err) {
    if (isUpidError(err) && expectedStatus) {
      console.warn(`[provision] UPID error in ${operation}, falling back to status polling`);
      return await proxmox.waitForStatus(vmid, expectedStatus, { timeoutMs: 180000 });
    }
    throw err;
  }
}

// --- Post-start hook ---
async function runGamePostStartHook({ game, vmid, ports }) {
  if (String(game || '').toLowerCase() !== 'minecraft') return;
  console.log(`[hook] Minecraft env injection scheduled for vmid=${vmid}`);
}

// === Main ===
export async function createContainer(body) {
  const {
    templateSlug,
    game,
    variant,
    ctype: ctypeReq,
    name,
    customerId,
    resources: resourcesOverride,
    portsNeeded = 0,
    storage,
  } = body || {};

  console.log('[provision] STEP 0: Starting container creation request');
  if (!templateSlug && !(game && variant)) throw new Error('templateSlug required');
  if (!customerId) throw new Error('customerId required');

  console.log('[provision] STEP 1: Resolving template');
  const template = await getTemplateOrThrow({ templateSlug, game, variant });
  await sleep(STEP_DELAY_MS);

  const ctype = String(ctypeReq || template?.ctype || 'game');
  const gameFinal = game || template?.game || null;
  const variantFin = variant || template?.variant || null;

  let vmid, allocatedPorts = [], txnId, slotHostname, instanceHostname;

  try {
    console.log('[provision] STEP 2: Allocating VMID');
    vmid = await allocateVmid(ctype);
    await sleep(STEP_DELAY_MS);

    if (portsNeeded > 0) {
      console.log('[provision] STEP 3: Reserving ports');
      txnId = crypto.randomUUID();
      let ports = await PortAllocationService.reserve({
        game: gameFinal,
        variant: variantFin,
        customerId,
        vmid,
        purpose: ctype === 'game' ? 'game_main' : 'dev',
        txnId,
        count: portsNeeded,
      });
      if (Array.isArray(ports) && typeof ports[0] === 'object') ports = ports.map((p) => p.port);
      allocatedPorts = ports;
      await sleep(STEP_DELAY_MS);
    }

    // --- PREPARE CONFIG VALUES ---
    const res = mergeResources(template, resourcesOverride);
    const bridge = pickBridge(ctype, template);
    instanceHostname = sanitizeHostname(name || `${template.slug}-${vmid}`);
    const ZONE = process.env.TECHNITIUM_ZONE || 'zerolaghub.quest';
    slotHostname = `${instanceHostname}.${ZONE}`; // FQDN for DNS/Traefik
    const store = storage || template.storage || process.env.PROXMOX_STORAGE;

    const tagsStr = [
      `cust-${customerId}`,
      `type-${ctype}`,
      gameFinal ? `game-${gameFinal}` : null,
      variantFin ? `var-${variantFin}` : null,
      txnId ? `txn-${txnId}` : null,
    ].filter(Boolean).join(',');

    const description = `customer=${customerId}; template=${template.slug}; vmid=${vmid}; txn=${txnId || 'n/a'}`;

    console.log('[provision] STEP 4: Writing env file');
    await writeSlotEnv(vmid, {
      GAME: gameFinal,
      PORT: allocatedPorts[0],
      HOSTNAME: instanceHostname, // ✅ short hostname inside container
      MAX_PLAYERS: 20,
      MOTD: `ZeroLagHub ${gameFinal || 'Game'}`,
    });
    await sleep(STEP_DELAY_MS);

    console.log('[provision] STEP 5: Cloning container');
    await executeTaskSafely(
      proxmox.cloneContainer({ templateVmid: template.templateVmid, vmid, name: instanceHostname, storage: store, full: 1 }),
      vmid,
      'stopped',
      'clone'
    );
    await sleep(STEP_DELAY_MS);

    console.log('[provision] STEP 6: Configuring container');
    await executeTaskSafely(
      proxmox.configureContainer({ vmid, cpu: res.cpu, memory: res.memory, bridge, description, tags: tagsStr }),
      vmid,
      null,
      'configure'
    );
    await sleep(STEP_DELAY_MS);

    if (process.env.PVE_ALLOW_RESIZE === '1' && res.disk) {
      console.log('[provision] STEP 7: Resizing container');
      const resizeTask = await proxmox.resizeContainer(vmid, { disk: 'rootfs', addGiB: Number(res.disk) });
      if (resizeTask?.upid) await waitForTask('zlh-prod1', resizeTask.upid);
      const resizeGrace = Number(process.env.RESIZE_GRACE_MS || 45000);
      console.log(`[provision] waiting ${resizeGrace}ms after resize before start`);
      await sleep(resizeGrace);
    }

    console.log('[provision] STEP 8: Starting container');
    let started = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await executeTaskSafely(proxmox.startContainer(vmid), vmid, 'running', 'start');
        started = true;
        break;
      } catch (err) {
        console.warn(`[provision] Start attempt ${attempt} failed: ${err.message}`);
        if (attempt < 3) {
          const backoff = attempt * 15000;
          console.log(`[provision] Retrying start in ${backoff / 1000}s...`);
          await sleep(backoff);
        }
      }
    }
    if (!started) throw new Error(`Container ${vmid} did not start after retries`);
    if (SLEEP_AFTER_START_MS > 0) await sleep(SLEEP_AFTER_START_MS);

    console.log('[provision] STEP 9: Running post-start hook');
    await runGamePostStartHook({ game: gameFinal, vmid, ports: allocatedPorts });
    await sleep(STEP_DELAY_MS);

    console.log('[provision] STEP 10: Detecting container IP');
    const ctIp = await getCtIpWithRetry(vmid, process.env.PROXMOX_NODE, 12, 10000);
    await sleep(STEP_DELAY_MS);

    console.log('[provision] STEP 11: Inserting DB record');
const instance = await prisma.containerInstance.create({
  data: {
    vmid,
    customerId,
    ctype,
    game: gameFinal,
    variant: variantFin,
    ip: ctIp,
    ports: allocatedPorts,
    status: 'running',
    description,
    hostname: instanceHostname,

    // ⭐ CORRECT RELATION
    template: {
      connect: { id: template.id },
    },
  },
});

    await sleep(STEP_DELAY_MS);

    if (allocatedPorts.length > 0) {
      console.log('[provision] STEP 12: Enqueuing edge publish');
      try {
        await enqueuePublishEdge({
          vmid,
          slotHostname,      // ✅ full FQDN for DNS/Traefik
          game: gameFinal,
          instanceHostname,  // short
          ports: allocatedPorts,
          ctIp,
          txnId
        });
        await sleep(STEP_DELAY_MS);

        // Mark ports committed
        await PortAllocationService.commit({ vmid, ports: allocatedPorts });
      } catch (err) {
        console.error(`[provision] STEP 12 failed for vmid=${vmid}:`, err.message || err);
        throw err; // bubble up to outer catch
      }
    }

    // Confirm VMID committed
    await confirmVmidAllocated(vmid);

    console.log('[provision] COMPLETE: success');
    return { vmid, instance, ports: allocatedPorts, slotHostname, instanceHostname };
  } catch (err) {
    console.error('[provision] ERROR:', err.message || err);

    try {
      if (vmid) await PortAllocationService.releaseByVmid(vmid);
    } catch (e) {
      console.warn('[provision] rollback ports failed:', e.message || e);
    }

    if (!process.env.DEBUG_KEEP_FAILED) {
      try { if (vmid) await proxmox.deleteContainer(vmid); } catch {}
      try { if (vmid) await releaseVmid(vmid); } catch {}
    } else {
      console.warn(`[provision] DEBUG_KEEP_FAILED=1 → leaving container ${vmid} for inspection`);
    }

    throw err;
  }
}

export default { createContainer };
