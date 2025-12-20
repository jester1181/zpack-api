// src/api/provisionAgent.js
// FINAL AGENT-DRIVEN PROVISIONING PIPELINE
// Supports: paper, vanilla, purpur, forge, fabric, neoforge + dev containers
//
// Updated (Dec 2025):
// - Keep V3 hostname behavior (FQDN: mc-vanilla-5072.zerolaghub.quest)
// - Decouple edge publishing from PortPool allocation
// - Minecraft does NOT allocate PortPool ports, but still publishes edge using routing port 25565
// - Preserve game/dev validation split (normalizeGameRequest / normalizeDevRequest)

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

// V3 behavior: slotHostname is FQDN built here
const ZONE = process.env.TECHNITIUM_ZONE || "zerolaghub.quest";

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
    if (
      ["paper", "forge", "fabric", "vanilla", "purpur", "neoforge"].includes(v)
    ) {
      varPart = v;
    }
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
   GAME PAYLOAD
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
   DEV PAYLOAD
------------------------------------------------------------- */
function buildDevAgentPayload({ vmid, runtime, version, memoryMiB, ports }) {
  if (!runtime) throw new Error("runtime required for dev container");
  if (!version) throw new Error("version required for dev container");

  return {
    vmid,
    ctype: "dev",
    runtime,
    version,
    memory_mb: Number(memoryMiB) || 2048,
    ports: Array.isArray(ports) ? ports : [ports].filter(Boolean),
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
  let lastLoggedStep = null;

  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, { headers });
      if (resp.ok) {
        const data = await resp.json();
        const state = (data.state || "").toLowerCase();
        const step = data.installStep || data.currentStep || "unknown";
        const progress = data.progress || "";

        if (step !== lastLoggedStep) {
          console.log(`[AGENT ${ip}] state=${state} step=${step} ${progress}`);
          lastLoggedStep = step;
        }

        if (state === "running") {
          console.log(`[AGENT ${ip}] ✓ Provisioning complete`);
          return data;
        }

        if (state === "error") {
          const errorMsg = data.error || "agent error";
          console.error(`[AGENT ${ip}] ✗ ERROR:`, errorMsg);
          throw new Error(errorMsg);
        }
      }
    } catch (err) {
      if (
        !err.message.includes("ECONNREFUSED") &&
        !err.message.includes("fetch failed")
      ) {
        console.error(`[AGENT ${ip}] Poll error:`, err.message);
      }
    }
    await sleep(3000);
  }

  throw new Error("Agent did not reach running state");
}

/* -------------------------------------------------------------
   MAIN ENTRYPOINT
------------------------------------------------------------- */
export async function provisionAgentInstance(body = {}) {
  const ctype = body.ctype || "game";
  console.log(`[agentProvision] STEP 0: Starting ${ctype} container provisioning`);

  const req =
    ctype === "dev" ? normalizeDevRequest(body) : normalizeGameRequest(body);

  const gameLower = String(req.game || "").toLowerCase();
  const isMinecraft = ctype === "game" && gameLower.includes("minecraft");

  let vmid;
  let ctIp;
  let allocatedPorts = [];
  let txnId = null;

  try {
    console.log("[agentProvision] STEP 1: allocate VMID");
    vmid = await allocateVmid(ctype);
    console.log(`[agentProvision] → Allocated vmid=${vmid}`);

    // Allocate ports if needed (Minecraft skips PortPool; uses 25565 via Velocity)
    if (!isMinecraft && req.portsNeeded && req.portsNeeded > 0) {
      console.log("[agentProvision] STEP 2: port allocation");
      txnId = crypto.randomUUID();

      const portObjs = await PortAllocationService.reserve({
        game: req.game,
        variant: req.variant,
        customerId: req.customerId,
        vmid,
        purpose: ctype === "game" ? "game_main" : "dev",
        txnId,
        count: req.portsNeeded,
      });

      allocatedPorts = Array.isArray(portObjs)
        ? portObjs.map((p) => (typeof p === "object" ? p.port : p))
        : [portObjs];

      console.log(`[agentProvision] → Allocated ports: ${allocatedPorts.join(", ")}`);
    } else {
      console.log("[agentProvision] STEP 2: port allocation (skipped)");
    }

    const hostname = generateSystemHostname({
      ctype,
      game: req.game,
      variant: req.variant,
      vmid,
    });

    // V3 correct behavior: build FQDN here
    const slotHostname = `${hostname}.${ZONE}`;

    console.log(
      `[agentProvision] STEP 3: clone template ${AGENT_TEMPLATE_VMID} → vmid=${vmid}`
    );
    await cloneContainer({
      templateVmid: AGENT_TEMPLATE_VMID,
      vmid,
      name: hostname,
      full: 1,
    });

    console.log("[agentProvision] STEP 4: configure CPU/mem/bridge/tags");
    await configureContainer({
      vmid,
      cpu: req.cpuCores || 2,
      memory: req.memoryMiB || 2048,
      bridge: ctype === "dev" ? "vmbr2" : "vmbr3",
    });

    console.log("[agentProvision] STEP 5: start container");
    await startWithRetry(vmid);

    console.log("[agentProvision] STEP 6: detect container IP");
    ctIp = await getCtIpWithRetry(vmid);
    console.log(`[agentProvision] → ctIp=${ctIp}`);

    console.log("[agentProvision] STEP 7: build agent payload");
    const payload =
      ctype === "dev"
        ? buildDevAgentPayload({
            vmid,
            runtime: body.runtime,
            version: body.version,
            memoryMiB: req.memoryMiB,
            ports: allocatedPorts,
          })
        : buildGameAgentPayload({
            vmid,
            ...req,
            // agent can still use ports; for minecraft, provide 25565 semantic port
            ports: allocatedPorts.length > 0 ? allocatedPorts : isMinecraft ? [25565] : [],
          });

    console.log("[agentProvision] STEP 8: POST /config to agent (async provision+start)");
    await sendAgentConfig({ ip: ctIp, payload });

    console.log("[agentProvision] STEP 9: wait for agent to be running via /status");
    await waitForAgentRunning({ ip: ctIp });

    console.log("[agentProvision] STEP 10: DB save");
    await prisma.containerInstance.create({
      data: {
        vmid,
        customerId: req.customerId,
        ctype,
        hostname,
        ip: ctIp,
        allocatedPorts, // matches schema
        payload,
        agentState: "running",
        agentLastSeen: new Date(),
      },
    });

    // STEP 11: commit ports ONLY if allocated from PortPool
    if (allocatedPorts.length > 0) {
      console.log("[agentProvision] STEP 11: commit ports");
      await PortAllocationService.commit({ vmid, ports: allocatedPorts });
    } else {
      console.log("[agentProvision] STEP 11: commit ports (skipped - none allocated)");
    }

    // STEP 12: publish edge for ALL game servers (Minecraft included)
    if (ctype === "game") {
      console.log("[agentProvision] STEP 12: publish edge");

      const edgePorts =
        allocatedPorts.length > 0 ? allocatedPorts : isMinecraft ? [25565] : [];

      await enqueuePublishEdge({
        vmid,
        slotHostname, // FQDN (V3 behavior)
        instanceHostname: hostname, // short (optional, kept for compatibility)
        ports: edgePorts,
        ctIp,
        game: req.game,
        txnId,
      });
    } else {
      console.log("[agentProvision] STEP 12: publish edge (skipped - dev container)");
    }

    await confirmVmidAllocated(vmid);

    console.log("[agentProvision] COMPLETE: success");
    return { vmid, hostname, ip: ctIp, ports: allocatedPorts };
  } catch (err) {
    console.error("[agentProvision] ERROR:", err.message);

    // Rollback ports on failure
    if (vmid && allocatedPorts.length > 0) {
      try {
        await PortAllocationService.releaseByVmid(vmid);
        console.log(`[agentProvision] → Rolled back ports for vmid=${vmid}`);
      } catch (rollbackErr) {
        console.error("[agentProvision] → Port rollback failed:", rollbackErr.message);
      }
    }

    if (vmid) {
      try {
        await deleteContainer(vmid);
      } catch {}
      try {
        await releaseVmid(vmid);
      } catch {}
    }

    throw err;
  }
}

export default { provisionAgentInstance };
