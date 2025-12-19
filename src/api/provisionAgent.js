// src/api/provisionAgent.js
// FINAL AGENT-DRIVEN PROVISIONING PIPELINE
// Supports: paper, vanilla, purpur, forge, fabric, neoforge + dev containers
//
// Phase 12-14-25:
// - Orchestrator remains unified
// - Game/Dev validation split
// - Dev containers provision like game infra, diverge at runtime semantics

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
import { PortAllocationService } from "../services/portAllocator.js";
import {
  allocateVmid,
  confirmVmidAllocated,
  releaseVmid,
} from "../services/vmidAllocator.js";

import { enqueuePublishEdge } from "../queues/postProvision.js";

import { normalizeGameRequest } from "./handlers/provisionGame.js";
import { normalizeDevRequest } from "./handlers/provisionDev.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const AGENT_TEMPLATE_VMID = Number(
  process.env.AGENT_TEMPLATE_VMID ||
    process.env.BASE_TEMPLATE_VMID ||
    process.env.PROXMOX_AGENT_TEMPLATE_VMID ||
    900
);

const AGENT_PORT = Number(process.env.ZLH_AGENT_PORT || 18888);
const AGENT_TOKEN = process.env.ZLH_AGENT_TOKEN || null;

/* -------------------------------------------------------------
   VERSION PARSER (Minecraft only)
------------------------------------------------------------- */
function parseMcVersion(ver) {
  if (!ver) return { major: 0, minor: 0, patch: 0 };
  const p = String(ver).split(".");
  return {
    major: Number(p[0]) || 0,
    minor: Number(p[1]) || 0,
    patch: Number(p[2]) || 0,
  };
}

/* -------------------------------------------------------------
   JAVA RUNTIME SELECTOR (Minecraft only)
------------------------------------------------------------- */
function pickJavaRuntimeForMc(version) {
  const { major, minor, patch } = parseMcVersion(version);

  if (major > 1) return 21;

  if (major === 1) {
    if (minor >= 21) return 21;
    if (minor === 20 && patch >= 5) return 21;
    if (minor > 20) return 21;
    return 17;
  }

  return 17;
}

/* -------------------------------------------------------------
   HOSTNAME GENERATION
------------------------------------------------------------- */
function generateSystemHostname({ ctype, game, variant, vmid }) {
  if (ctype === "dev") return `dev-${vmid}`;

  const g = (game || "").toLowerCase();
  const v = (variant || "").toLowerCase();

  let prefix = "game";
  if (g.includes("minecraft")) prefix = "mc";
  else if (g.includes("terraria")) prefix = "terraria";
  else if (g.includes("valheim")) prefix = "valheim";
  else if (g.includes("rust")) prefix = "rust";

  let varPart = "";
  if (g.includes("minecraft")) {
    if (["paper", "forge", "fabric", "vanilla", "purpur", "neoforge"].includes(v))
      varPart = v;
  }

  return varPart ? `${prefix}-${varPart}-${vmid}` : `${prefix}-${vmid}`;
}

/* -------------------------------------------------------------
   ADMIN PASSWORD GENERATOR
------------------------------------------------------------- */
function generateAdminPassword() {
  return crypto.randomBytes(12).toString("base64url");
}

/* -------------------------------------------------------------
   GAME PAYLOAD (UNCHANGED)
------------------------------------------------------------- */
function buildGameAgentPayload({
  vmid,
  game,
  variant,
  version,
  world,
  ports,
  artifactPath,
  javaPath,
  memoryMiB,
  steamUser,
  steamPass,
  steamAuth,
  adminUser,
  adminPass,
}) {
  const g = (game || "minecraft").toLowerCase();
  const v = (variant || "").toLowerCase();
  const ver = version || "1.20.1";
  const w = world || "world";

  if (!v) throw new Error("variant is required");

  let art = artifactPath;
  let jpath = javaPath;

  if (!art && g === "minecraft") {
    switch (v) {
      case "paper":
      case "vanilla":
      case "purpur":
        art = `minecraft/${v}/${ver}/server.jar`;
        break;
      case "forge":
        art = `minecraft/forge/${ver}/forge-installer.jar`;
        break;
      case "fabric":
        art = `minecraft/fabric/${ver}/fabric-server.jar`;
        break;
      case "neoforge":
        art = `minecraft/neoforge/${ver}/neoforge-installer.jar`;
        break;
      default:
        throw new Error(`Unsupported Minecraft variant: ${v}`);
    }
  }

  if (!jpath && g === "minecraft") {
    const javaVersion = pickJavaRuntimeForMc(ver);
    jpath =
      javaVersion === 21
        ? "java/21/OpenJDK21.tar.gz"
        : "java/17/OpenJDK17.tar.gz";
  }

  let mem = Number(memoryMiB) || 0;
  if (mem <= 0) mem = ["forge", "neoforge"].includes(v) ? 4096 : 2048;

  return {
    vmid,
    game: g,
    variant: v,
    version: ver,
    world: w,
    ports: Array.isArray(ports) ? ports : [ports].filter(Boolean),
    artifact_path: art,
    java_path: jpath,
    memory_mb: mem,
    steam_user: steamUser || "anonymous",
    steam_pass: steamPass || "",
    steam_auth: steamAuth || "",
    admin_user: adminUser || "admin",
    admin_pass: adminPass || generateAdminPassword(),
  };
}

/* -------------------------------------------------------------
   DEV PAYLOAD (NEW, MINIMAL, CANONICAL)
------------------------------------------------------------- */
function buildDevAgentPayload({ vmid, runtime, version, memoryMiB }) {
  if (!runtime) throw new Error("runtime required for dev container");
  if (!version) throw new Error("version required for dev container");

  return {
    vmid,
    ctype: "dev",
    runtime,
    version,
    memory_mb: Number(memoryMiB) || 2048,
  };
}

/* -------------------------------------------------------------
   SEND CONFIG
------------------------------------------------------------- */
async function sendAgentConfig({ ip, payload }) {
  const url = `http://${ip}:${AGENT_PORT}/config`;
  const headers = { "Content-Type": "application/json" };
  if (AGENT_TOKEN) headers["Authorization"] = `Bearer ${AGENT_TOKEN}`;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`/config failed (${resp.status}): ${text}`);
  }
}

/* -------------------------------------------------------------
   WAIT FOR AGENT READY
------------------------------------------------------------- */
async function waitForAgentRunning({ ip, timeoutMs = 10 * 60_000 }) {
  const url = `http://${ip}:${AGENT_PORT}/status`;
  const headers = {};
  if (AGENT_TOKEN) headers["Authorization"] = `Bearer ${AGENT_TOKEN}`;

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, { headers });
      if (resp.ok) {
        const data = await resp.json();
        const state = (data.state || "").toLowerCase();
        if (state === "running") return data;
        if (state === "error") throw new Error(data.error || "agent error");
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

  const req =
    ctype === "dev"
      ? normalizeDevRequest(body)
      : normalizeGameRequest(body);

  let vmid;
  let ctIp;

  try {
    vmid = await allocateVmid(ctype);

    const hostname = generateSystemHostname({
      ctype,
      game: req.game,
      variant: req.variant,
      vmid,
    });

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
        : buildGameAgentPayload({
            vmid,
            ...req,
          });

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

    await enqueuePublishEdge({
      vmid,
      instanceHostname: hostname,
      ctIp,
      game: req.game,
    });

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
