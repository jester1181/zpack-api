// src/api/provisionAgent.js
// FINAL AGENT-DRIVEN PROVISIONING PIPELINE (STABLE + SCALABLE)

import "dotenv/config";
import fetch from "node-fetch";
import crypto from "crypto";

import prisma from "../services/prisma.js";
import {
  cloneContainer,
  configureContainer,
  startWithRetry,
  deleteContainer,
} from "../services/proxmoxClient.js";

import { getCtIpWithRetry } from "../services/getCtIp.js";
import {
  allocateVmid,
  confirmVmidAllocated,
  releaseVmid,
} from "../services/vmidAllocator.js";

import { enqueuePublishEdge } from "../queues/postProvision.js";

import { normalizeGameRequest } from "./handlers/provisionGame.js";
import { normalizeDevRequest } from "./handlers/provisionDev.js";


const AGENT_TEMPLATE_VMID = Number(
  process.env.AGENT_TEMPLATE_VMID ||
    process.env.BASE_TEMPLATE_VMID ||
    process.env.PROXMOX_AGENT_TEMPLATE_VMID ||
    900
);

const AGENT_PORT = Number(process.env.ZLH_AGENT_PORT || 18888);
const AGENT_TOKEN = process.env.ZLH_AGENT_TOKEN || null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------------------
   PAYLOAD BUILDERS (CANONICAL)
------------------------------------------------------------- */

function buildDevAgentPayload({ vmid, runtime, version, memoryMiB }) {
  if (!runtime) throw new Error("runtime required for dev container");
  if (!version) throw new Error("version required for dev container");

  return {
    vmid,
    ctype: "dev", // ← CRITICAL, AGENT CONTRACT
    runtime,
    version,
    memory_mb: Number(memoryMiB) || 2048,
  };
}

function buildGameAgentPayload(req) {
  // req already normalized by provisionGame
  return {
    vmid: req.vmid,
    game: req.game,
    variant: req.variant,
    version: req.version,
    world: req.world,
    ports: req.ports || [],
    artifact_path: req.artifactPath,
    java_path: req.javaPath,
    memory_mb: req.memoryMiB,
    admin_user: req.adminUser,
    admin_pass: req.adminPass,
  };
}

/* -------------------------------------------------------------
   AGENT COMMUNICATION
------------------------------------------------------------- */

async function sendAgentConfig({ ip, payload }) {
  const headers = { "Content-Type": "application/json" };
  if (AGENT_TOKEN) headers.Authorization = `Bearer ${AGENT_TOKEN}`;

  const resp = await fetch(`http://${ip}:${AGENT_PORT}/config`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`/config failed (${resp.status}): ${text}`);
  }
}

async function waitForAgentRunning({ ip, timeoutMs = 10 * 60_000 }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${ip}:${AGENT_PORT}/status`);
      if (res.ok) {
        const data = await res.json();
        if (data.state === "running") return;
        if (data.state === "error") throw new Error(data.error || "agent error");
      }
    } catch {}
    await sleep(3000);
  }

  throw new Error("Agent did not reach running state");
}

/* -------------------------------------------------------------
   MAIN ENTRYPOINT
------------------------------------------------------------- */

export async function provisionAgentInstance(body = {}) {
  const ctype = body.ctype || "game";
  if (!["game", "dev"].includes(ctype)) {
    throw new Error(`invalid ctype: ${ctype}`);
  }

  console.log(`[agentProvision] starting ${ctype} provisioning`);

  // EARLY SPLIT — DO NOT MOVE
  const req =
    ctype === "dev"
      ? normalizeDevRequest(body)
      : normalizeGameRequest(body);

  let vmid;
  let ctIp;

  try {
    vmid = await allocateVmid(ctype);
    console.log(`[agentProvision] vmid=${vmid}`);

    const hostname =
      ctype === "dev"
        ? `dev-${vmid}`
        : req.hostname || `game-${vmid}`;

    await cloneContainer({
      templateVmid: AGENT_TEMPLATE_VMID,
      vmid,
      name: hostname,
      full: 1,
    });

    await configureContainer({
      vmid,
      cpu: req.cpuCores || 2,
      memory: req.memoryMiB || 2048,
      bridge: ctype === "dev" ? "vmbr2" : "vmbr3",
    });

    await startWithRetry(vmid);
    ctIp = await getCtIpWithRetry(vmid);

    const payload =
      ctype === "dev"
        ? buildDevAgentPayload({
            vmid,
            runtime: body.runtime,
            version: body.version,
            memoryMiB: req.memoryMiB,
          })
        : buildGameAgentPayload({ ...req, vmid });

    console.log(`[agentProvision] payload:`);
    console.log(JSON.stringify(payload, null, 2));

    await sendAgentConfig({ ip: ctIp, payload });
    await waitForAgentRunning({ ip: ctIp });

    await prisma.containerInstance.create({
      data: {
        vmid,
        customerId: req.customerId,
        ctype,
        hostname,
        ip: ctIp,
        payload,
        agentState: "running",
        agentLastSeen: new Date(),
      },
    });

    if (!payload.ctype) {
  throw new Error("Payload missing ctype (game|dev)");
}

    if (ctype === "game") {
      await enqueuePublishEdge({
        vmid,
        instanceHostname: hostname,
        ctIp,
        game: req.game,
      });
    }

    await confirmVmidAllocated(vmid);

    return { vmid, hostname, ip: ctIp };
  } catch (err) {
    if (vmid) {
      try { await deleteContainer(vmid); } catch {}
      try { await releaseVmid(vmid); } catch {}
    }
    throw err;
  }
}

export default { provisionAgentInstance };
