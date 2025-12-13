// src/api/provisionAgent.js
// FINAL AGENT-DRIVEN PROVISIONING PIPELINE
// Supports: paper, vanilla, purpur, forge, fabric, neoforge + Steam creds passthrough

import "dotenv/config";
import fetch from "node-fetch";
import crypto from "crypto";

import prisma from "../services/prisma.js";
import proxmox, {
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
   VERSION PARSER
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
   JAVA RUNTIME SELECTOR
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
function generateSystemHostname({ game, variant, vmid }) {
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
   BUILD AGENT PAYLOAD
------------------------------------------------------------- */
function buildAgentPayload({
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

  if (!v) throw new Error("variant is required (paper, forge, fabric, vanilla, purpur)");

  let art = artifactPath;
  let jpath = javaPath;

  // --------- VARIANT → ARTIFACT PATH ---------
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

  // --------- JAVA RUNTIME SELECTOR ----------
  if (!jpath && g === "minecraft") {
    const javaVersion = pickJavaRuntimeForMc(ver);
    jpath =
      javaVersion === 21
        ? "java/21/OpenJDK21.tar.gz"
        : "java/17/OpenJDK17.tar.gz";
  }

  // --------- MEMORY DEFAULTS ----------
  let mem = Number(memoryMiB) || 0;
  if (mem <= 0) mem = ["forge", "neoforge"].includes(v) ? 4096 : 2048;

  // Steam + admin credentials (persisted, optional)
  const resolvedSteamUser = steamUser || "anonymous";
  const resolvedSteamPass = steamPass || "";
  const resolvedSteamAuth = steamAuth || "";

  const resolvedAdminUser = adminUser || "admin";
  const resolvedAdminPass = adminPass || generateAdminPassword();

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

    steam_user: resolvedSteamUser,
    steam_pass: resolvedSteamPass,
    steam_auth: resolvedSteamAuth,

    admin_user: resolvedAdminUser,
    admin_pass: resolvedAdminPass,
  };
}

/* -------------------------------------------------------------
   SEND CONFIG  → triggers async provision+start in agent
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
   WAIT FOR AGENT READY  (poll /status)
------------------------------------------------------------- */
async function waitForAgentRunning({ ip, timeoutMs = 10 * 60_000 }) {
  const url = `http://${ip}:${AGENT_PORT}/status`;
  const headers = {};
  if (AGENT_TOKEN) headers["Authorization"] = `Bearer ${AGENT_TOKEN}`;

  const deadline = Date.now() + timeoutMs;
  let last;

  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        last = new Error(`/status HTTP ${resp.status}`);
      } else {
        const data = await resp.json().catch(() => ({}));
        const state = (data.state || data.status || "").toLowerCase();

        // Agent's state machine:
        // idle → installing → verifying → starting → running
        if (state === "running") return { state: "running", raw: data };
        if (state === "error" || state === "crashed") {
          const msg = data.error || "";
          throw new Error(`agent state=${state} ${msg ? `(${msg})` : ""}`);
        }

        last = new Error(`agent state=${state || "unknown"}`);
      }
    } catch (err) {
      last = err;
    }

    await sleep(3000);
  }

  throw last || new Error("Agent did not reach running state");
}

/* -------------------------------------------------------------
   MAIN PROVISION ENTRYPOINT
------------------------------------------------------------- */
export async function provisionAgentInstance(body = {}) {
  const {
    customerId,
    game,
    variant,
    version,
    world,
    ctype: rawCtype,
    name,
    cpuCores,
    memoryMiB,
    diskGiB,
    portsNeeded,
    artifactPath,
    javaPath,

    // NEW optional fields
    steamUser,
    steamPass,
    steamAuth,
    adminUser,
    adminPass,
  } = body;

  if (!customerId) throw new Error("customerId required");
  if (!game) throw new Error("game required");
  if (!variant) throw new Error("variant required");

  const ctype = rawCtype || "game";
  const isMinecraft = game.toLowerCase().includes("minecraft");

  let vmid;
  let allocatedPortsMap = null;
  let gamePorts = [];
  let ctIp;
  let instanceHostname;

  try {
    console.log("[agentProvision] STEP 1: allocate VMID");
    vmid = await allocateVmid(ctype);

    instanceHostname = generateSystemHostname({ game, variant, vmid });

    console.log("[agentProvision] STEP 2: port allocation");
    if (!isMinecraft && (portsNeeded ?? 0) > 0) {
      gamePorts = await PortAllocationService.reserve({
        vmid,
        count: portsNeeded,
        portType: "game",
      });
      allocatedPortsMap = { game: gamePorts };
    } else {
      gamePorts = [25565];
      allocatedPortsMap = { game: gamePorts };
    }

    const node = process.env.PROXMOX_NODE || "zlh-prod1";
    const bridge = ctype === "dev" ? "vmbr2" : "vmbr3";
    const cpu = cpuCores ? Number(cpuCores) : 2;
    const memory = memoryMiB ? Number(memoryMiB) : 2048;

    const description = name
      ? `${name} (customer=${customerId}; vmid=${vmid}; agent=v1)`
      : `customer=${customerId}; vmid=${vmid}; agent=v1`;

    const tags = [
      `cust-${customerId}`,
      `type-${ctype}`,
      `game-${game}`,
      variant ? `var-${variant}` : null,
    ]
      .filter(Boolean)
      .join(",");

    console.log(
      `[agentProvision] STEP 3: clone template ${AGENT_TEMPLATE_VMID} → vmid=${vmid}`
    );

    await cloneContainer({
      templateVmid: AGENT_TEMPLATE_VMID,
      vmid,
      name: instanceHostname,
      full: 1,
    });

    console.log("[agentProvision] STEP 4: configure CPU/mem/bridge/tags");
    await configureContainer({
      vmid,
      cpu,
      memory,
      bridge,
      description,
      tags,
    });

    console.log("[agentProvision] STEP 5: start container");
    await startWithRetry(vmid);

    console.log("[agentProvision] STEP 6: detect container IP");
    const ip = await getCtIpWithRetry(vmid, node, 12, 10_000);
    if (!ip) throw new Error("Failed to detect container IP");
    ctIp = ip;

    console.log(`[agentProvision] ctIp=${ctIp}`);

    console.log("[agentProvision] STEP 7: build agent payload");
    const payload = buildAgentPayload({
      vmid,
      game,
      variant,
      version,
      world,
      ports: gamePorts,
      artifactPath,
      javaPath,
      memoryMiB,

      steamUser,
      steamPass,
      steamAuth,
      adminUser,
      adminPass,
    });

    console.log("[agentProvision] STEP 8: POST /config to agent (async provision+start)");
    await sendAgentConfig({ ip: ctIp, payload });

    console.log("[agentProvision] STEP 9: wait for agent to be running via /status");
    const agentResult = await waitForAgentRunning({ ip: ctIp });

    console.log("[agentProvision] STEP 10: DB save");
    const instance = await prisma.containerInstance.create({
      data: {
        vmid,
        customerId,
        ctype,
        hostname: instanceHostname,
        ip: ctIp,
        allocatedPorts: allocatedPortsMap,
        payload,
        agentState: agentResult.state,
        agentLastSeen: new Date(),
      },
    });

    console.log("[agentProvision] STEP 11: commit ports");
    if (!isMinecraft && gamePorts.length) {
      await PortAllocationService.commit({
        vmid,
        ports: gamePorts,
        portType: "game",
      });
    }

    console.log("[agentProvision] STEP 12: publish edge");
    await enqueuePublishEdge({
      vmid,
      slotHostname: instanceHostname,
      instanceHostname,
      ports: gamePorts,
      ctIp,
      game,
    });

    await confirmVmidAllocated(vmid);

    console.log("[agentProvision] COMPLETE");

    return {
      vmid,
      ip: ctIp,
      hostname: instanceHostname,
      ports: gamePorts,
      instance,
    };
  } catch (err) {
    console.error("[agentProvision] ERROR:", err.message);

    try {
      if (vmid) await PortAllocationService.releaseByVmid(vmid);
    } catch {}

    try {
      if (vmid) await deleteContainer(vmid);
    } catch {}

    try {
      if (vmid) await releaseVmid(vmid);
    } catch {}

    throw err;
  }
}

export default { provisionAgentInstance };
