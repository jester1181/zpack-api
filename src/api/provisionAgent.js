// src/api/provisionAgent.js
// FINAL AGENT-DRIVEN PROVISIONING PIPELINE (STABLE + SCALABLE)

import "dotenv/config";
import fetch from "node-fetch";

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
  process.env.PROXMOX_AGENT_TEMPLATE_VMID
);

const AGENT_PORT = Number(process.env.ZLH_AGENT_PORT || 18888);
const AGENT_TOKEN = process.env.ZLH_AGENT_TOKEN || null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (name) =>
  console.log(`[agentProvision] step=${name}`);

/* -------------------------------------------------------------
   HOSTNAME BUILDER
------------------------------------------------------------- */
function buildHostname({ ctype, game, variant, vmid }) {
  if (ctype === "dev") return `dev-${vmid}`;

  if (game === "minecraft") {
    const v = (variant || "").toLowerCase();
    if (v) return `mc-${v}-${vmid}`;
    return `mc-${vmid}`;
  }

  return `${game || "game"}-${vmid}`;
}

/* -------------------------------------------------------------
   JAVA SELECTION (FIX)
------------------------------------------------------------- */
function pickJavaForMinecraftVersion(version) {
  // version like "1.21.7"
  const parts = String(version).split(".");
  const minor = Number(parts[1] || 0);

  return minor >= 21
    ? "java/21/OpenJDK21.tar.gz"
    : "java/17/OpenJDK17.tar.gz";
}

/* -------------------------------------------------------------
   PAYLOAD BUILDERS
------------------------------------------------------------- */

function buildDevAgentPayload({ vmid, runtime, version, memoryMiB }) {
  if (!runtime) throw new Error("runtime required for dev container");
  if (!version) throw new Error("version required for dev container");

  return {
    vmid,
    container_type: "dev",
    runtime,
    version,
    memory_mb: Number(memoryMiB) || 2048,
  };
}

function buildGameAgentPayload(req) {
  let javaPath = req.javaPath;
  let artifactPath = req.artifactPath;

  // 🔧 FIXED JAVA LOGIC — NOTHING ELSE CHANGED
  if (!javaPath && req.game === "minecraft") {
    if (!req.version) {
      throw new Error("minecraft version required for java selection");
    }
    javaPath = pickJavaForMinecraftVersion(req.version);
  }

  if (!artifactPath && req.game === "minecraft") {
    switch (req.variant) {
      case "forge":
        artifactPath = `minecraft/forge/${req.version}/forge-installer.jar`;
        break;
      case "fabric":
        artifactPath = `minecraft/fabric/${req.version}/fabric-server.jar`;
        break;
      case "neoforge":
        artifactPath = `minecraft/neoforge/${req.version}/neoforge-installer.jar`;
        break;
      case "paper":
      case "purpur":
      case "vanilla":
        artifactPath = `minecraft/${req.variant}/${req.version}/server.jar`;
        break;
    }
  }

  if (!javaPath) {
    throw new Error(`BUG: java_path missing for ${req.game} ${req.variant}`);
  }

  if (!artifactPath) {
    throw new Error(`BUG: artifact_path missing for ${req.game} ${req.variant}`);
  }

  return {
    vmid: req.vmid,
    container_type: "game",
    game: req.game,
    variant: req.variant,
    version: req.version,
    world: req.world,
    ports: req.ports || [],
    artifact_path: artifactPath,
    java_path: javaPath,
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

async function waitForAgentTerminalState({ ip, timeoutMs = 10 * 60_000 }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${ip}:${AGENT_PORT}/status`);
      if (res.ok) {
        const data = await res.json();

        if (data.state === "running") return;

        if (data.state === "error") {
          throw new Error(data.error || "agent error");
        }
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
  const rawType =
    body.container_type ??
    body.containerType ??
    body.ctype ??
    "game";

  if (!["game", "dev"].includes(rawType)) {
    throw new Error(`invalid container type: ${rawType}`);
  }

  const ctype = rawType;
  console.log(`[agentProvision] starting ${ctype} provisioning`);

  const req =
    ctype === "dev"
      ? normalizeDevRequest(body)
      : normalizeGameRequest(body);

  let vmid;
  let ctIp;

  try {
    step("allocate-vmid");
    vmid = await allocateVmid(ctype);

    const hostname = buildHostname({
      ctype,
      game: req.game,
      variant: req.variant,
      vmid,
    });

    step("clone-container");
    await cloneContainer({
      templateVmid: AGENT_TEMPLATE_VMID,
      vmid,
      name: hostname,
      full: 1,
    });

    step("configure-container");
    await configureContainer({
      vmid,
      cpu: req.cpuCores || 2,
      memory: req.memoryMiB || 2048,
      bridge: ctype === "dev" ? "vmbr2" : "vmbr3",
    });

    step("start-container");
    await startWithRetry(vmid);

    step("wait-for-ip");
    ctIp = await getCtIpWithRetry(vmid);

    step("build-agent-payload");
    const payload =
      ctype === "dev"
        ? buildDevAgentPayload({
            vmid,
            runtime: body.runtime,
            version: body.version,
            memoryMiB: req.memoryMiB,
          })
        : buildGameAgentPayload({ ...req, vmid });

    step("send-agent-config");
    await sendAgentConfig({ ip: ctIp, payload });

    await waitForAgentTerminalState({ ip: ctIp });

    step("persist-instance");
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

    if (ctype === "game") {
      step("publish-edge");

      const edgePorts =
        req.ports?.length
          ? req.ports
          : req.game === "minecraft"
          ? [25565]
          : [];

      await enqueuePublishEdge({
        vmid,
        slotHostname: hostname,
        ctIp,
        game: req.game,
        ports: edgePorts,
      });
    }

    step("confirm-vmid");
    await confirmVmidAllocated(vmid);

    return { vmid, hostname, ip: ctIp };
  } catch (err) {
    step("error-cleanup");
    if (vmid) {
      try { await deleteContainer(vmid); } catch {}
      try { await releaseVmid(vmid); } catch {}
    }
    throw err;
  }
}

export default { provisionAgentInstance };
