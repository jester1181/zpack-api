/* ======================================================
   LIVE STATUS MERGER
   ====================================================== */

import { redis } from "../utils/redis.js";
import { getContainerStatus } from "../services/proxmoxClient.js";

export async function mergeLiveStatus(instances) {
  return Promise.all(
    instances.map(async (ci) => {
      // ------------------------------
      // Agent data (cached)
      // ------------------------------
      const raw = await redis.get(`agent:${ci.vmid}`);
      const agent = raw ? JSON.parse(raw) : null;

      // ------------------------------
      // Proxmox data (authoritative)
      // ------------------------------
      let containerRunning = false;

      try {
        const ct = await getContainerStatus(ci.vmid);
        containerRunning = ct?.status === "running";
      } catch {
        containerRunning = false;
      }

      const payload = ci.payload || {};
      const isGame = ci.ctype === "game";

      // ------------------------------
      // Status resolution
      // ------------------------------
      let status;

      if (isGame) {
        // GAME: runtime from agent, gated by container power
        status = containerRunning
          ? agent?.state ?? "stopped"
          : "stopped";
      } else {
        // DEV: container IS the service
        status = containerRunning ? "running" : "stopped";
      }

      return {
        id: ci.vmid.toString(),
        name: ci.hostname,
        category: isGame ? "GAME" : "DEV",

        runtime: isGame
          ? payload.game ?? "unknown"
          : payload.runtime ?? "unknown",

        flavor: isGame
          ? payload.variant ?? "unknown"
          : payload.runtime ?? "unknown",

        version: payload.version ?? "unknown",

        // ------------------------------
        // Host / container state
        // ------------------------------
        hostStatus: containerRunning ? "online" : "offline",

        // ------------------------------
        // Server / environment state
        // ------------------------------
        status,

        // ------------------------------
        // Agent diagnostics (not authority)
        // ------------------------------
        agentStatus: agent ? "online" : "offline",
        installStep: agent?.installStep ?? null,
        crashCount: agent?.crashCount ?? 0,
        lastSeen: agent?.lastSeen ?? null,
      };
    })
  );
}
