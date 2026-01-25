/* ======================================================
   AGENT POLLER
   - Polls zlh-agent /health + /status
   - Stores live host + server state in Redis
   ====================================================== */

import fetch from "node-fetch";
import prisma from "../services/prisma.js";
import redis from "./redis.js";

const AGENT_PORT = 18888;
const POLL_INTERVAL_MS = 5000;

async function pollAgentsOnce() {
  const instances = await prisma.containerInstance.findMany({
    where: { ip: { not: null } },
    select: { vmid: true, ip: true },
  });

  for (const ci of instances) {
    const base = `http://${ci.ip}:${AGENT_PORT}`;

    let hostOnline = false;
    let statusData = null;
    let error = null;

    // 1️⃣ HEALTH CHECK (host/agent)
    try {
      const healthRes = await fetch(`${base}/health`, { timeout: 2000 });
      if (healthRes.ok) hostOnline = true;
      else throw new Error("health check failed");
    } catch (err) {
      error = err.message;
    }

    // 2️⃣ STATUS CHECK (only if host is online)
    if (hostOnline) {
      try {
        const statusRes = await fetch(`${base}/status`, { timeout: 2000 });
        if (!statusRes.ok) throw new Error(`status HTTP ${statusRes.status}`);
        statusData = await statusRes.json();
      } catch (err) {
        error = err.message;
      }
    }

    await redis.set(
      `agent:${ci.vmid}`,
      JSON.stringify({
        hostOnline,
        ...(statusData ?? {}),
        error,
        lastSeen: Date.now(),
      }),
      { EX: 15 }
    );
  }
}


export function startAgentPoller() {
  console.log("[agent-poller] started");
  setInterval(pollAgentsOnce, POLL_INTERVAL_MS);
}
