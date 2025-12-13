// src/services/edgePublisher.js
// Publishes Traefik/Velocity backend routing + DNS (Technitium + Cloudflare)
// and handles multi-game support. Minecraft uses Velocity, other games use Traefik.
//
// Relies on env:
//   VELOCITY_EDGE_IP        (e.g. 10.70.0.241)
//   TRAEFIK_EDGE_IP         (e.g. 10.60.0.242)
//   CLOUDFLARE_EDGE_IP      (e.g. 139.64.165.248)  // public ZPACK OPNsense
//   EDGE_PUBLIC_IP          (legacy fallback for public IP)
//   DNS_ZONE or TECHNITIUM_ZONE (e.g. zerolaghub.quest)

import proxyClient from "./proxyClient.js";
import dns from "./technitiumClient.js";
import cloudflareClient from "./cloudflareClient.js";
import velocityClient from "./velocityClient.js";
import { unpublish } from "./dePublisher.js";

/* -------------------------------------------------------------------------- */
/*  Game metadata                                                             */
/* -------------------------------------------------------------------------- */

const GAME_SRV = {
  minecraft: { service: "minecraft", protocol: "tcp", defaultPort: 25565 },
  mc: { service: "minecraft", protocol: "tcp", defaultPort: 25565 },
  rust: { service: "rust", protocol: "udp", defaultPort: 28015 },
  terraria: { service: "terraria", protocol: "tcp", defaultPort: 7777 },
  projectzomboid: { service: "projectzomboid", protocol: "udp", defaultPort: 16261 },
  valheim: { service: "valheim", protocol: "udp", defaultPort: 2456 },
  palworld: { service: "palworld", protocol: "udp", defaultPort: 8211 },
  generic: { service: "game", protocol: "tcp", defaultPort: 25565 },
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function isMinecraftGame(game) {
  const g = String(game || "").toLowerCase();
  return g === "mc" || g.includes("minecraft");
}

/**
 * Decide which internal edge IP Technitium should point to.
 * - Minecraft  → Velocity (VELOCITY_EDGE_IP)
 * - Other      → Traefik  (TRAEFIK_EDGE_IP)
 */
function pickInternalEdgeIp(game) {
  if (isMinecraftGame(game)) {
    return (
      process.env.VELOCITY_EDGE_IP || // 10.70.0.241
      process.env.TRAEFIK_EDGE_IP ||  // fallback if misconfigured
      "10.70.0.241"
    );
  }

  // Non-Minecraft: default to Traefik
  return (
    process.env.TRAEFIK_EDGE_IP ||    // 10.60.0.242
    process.env.VELOCITY_EDGE_IP ||   // last-resort fallback
    "10.60.0.242"
  );
}

/**
 * Public edge IP for Cloudflare A/SRV.
 * Always the ZPACK OPNsense WAN (139.64.165.248).
 */
function pickPublicEdgeIp() {
  return (
    process.env.CLOUDFLARE_EDGE_IP ||
    process.env.EDGE_PUBLIC_IP || // legacy name
    "139.64.165.248"
  );
}

/* -------------------------------------------------------------------------- */
/*  Primary publisher                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Publish edge routing + DNS + Velocity registration.
 *
 * Called from postProvision:
 *   edgePublisher.publishEdge({
 *     vmid,
 *     ports,          // external/public ports OR [25565] for MC
 *     ip,             // container IP (ctIp)
 *     slotHostname,   // short hostname (mc-paper-5013)
 *     game
 *   })
 */
export async function publishEdge({
  vmid,
  ports = [],
  ip,
  ctIp,           // older callers may pass ctIp instead of ip
  slotHostname,
  game,
}) {
  const backendIp = ctIp || ip;
  if (!vmid) throw new Error("[edgePublisher] vmid is required");
  if (!backendIp)
    throw new Error(
      `[edgePublisher] Missing backend IP (ctIp/ip) for vmid=${vmid}`
    );

  const gameKey = String(game || "").toLowerCase();
  const meta = GAME_SRV[gameKey] || GAME_SRV.generic;
  const isMC = isMinecraftGame(gameKey);

  const ZONE =
    process.env.TECHNITIUM_ZONE ||
    process.env.DNS_ZONE ||
    "zerolaghub.quest";

  // fqdn: ensure we have <hostname>.<zone>
  if (!slotHostname)
    throw new Error("[edgePublisher] slotHostname is required");
  const fqdn = slotHostname.includes(".")
    ? slotHostname
    : `${slotHostname}.${ZONE}`;

  const internalEdgeIp = pickInternalEdgeIp(gameKey); // Technitium A
  const publicEdgeIp = pickPublicEdgeIp();            // Cloudflare A

  const externalPort = ports[0] || meta.defaultPort;

  console.log(
    `[edgePublisher] START vmid=${vmid}, game=${gameKey}, backend=${backendIp}, internalEdgeIp=${internalEdgeIp}, publicEdgeIp=${publicEdgeIp}, ports=${ports.join(
      ","
    )}`
  );

  /* ---------------------------------------------------------------------- */
  /* 1) Traefik / TCP routing (non-Minecraft only)                           */
  /* ---------------------------------------------------------------------- */

  if (isMC) {
    console.log(
      `[edgePublisher] Skipping Traefik TCP config (Minecraft handled by Velocity)`
    );
  } else {
    for (const port of ports) {
      try {
        console.log(
          `[edgePublisher] Adding Traefik TCP entry for ${fqdn}:${port} -> ${backendIp}:${meta.defaultPort ||
            port}`
        );
        await proxyClient.addProxyConfig({
          vmid,
          hostname: slotHostname,
          externalPort: port,
          ctIp: backendIp,                      // LXC IP
          ctPort: meta.defaultPort || port,     // internal game port
          game: gameKey,
          protocol: meta.protocol,
        });
        console.log(
          `[edgePublisher] ✓ Traefik config applied for ${slotHostname}:${port}`
        );
      } catch (err) {
        console.error(
          `[edgePublisher] ❌ Failed to push Traefik config for ${slotHostname}:${port}:`,
          err?.message || err
        );
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 2) Technitium internal DNS                                             */
  /* ---------------------------------------------------------------------- */

  try {
    console.log(
      `[edgePublisher] Creating Technitium A record ${fqdn} → ${internalEdgeIp}`
    );
    await dns.addARecord({
      hostname: fqdn,
      ipAddress: internalEdgeIp,
      ttl: 60,
    });
    console.log(
      `[edgePublisher] ✓ Technitium A record created: ${fqdn} → ${internalEdgeIp}`
    );

    if (externalPort) {
      console.log(
        `[edgePublisher] Creating Technitium SRV _${meta.service}._${meta.protocol}.${fqdn} → ${fqdn}:${externalPort}`
      );
      await dns.addSRVRecord({
        service: meta.service,
        protocol: meta.protocol,
        hostname: fqdn,
        port: externalPort,
        target: fqdn,
        ttl: 60,
      });
      console.log(
        `[edgePublisher] ✓ Technitium SRV created for ${fqdn} port ${externalPort}`
      );
    }
  } catch (err) {
    console.error(
      `[edgePublisher] ❌ Technitium DNS publish failed for ${fqdn}:`,
      err?.response?.data || err?.message || err
    );
  }

  /* ---------------------------------------------------------------------- */
  /* 3) Cloudflare public DNS                                               */
  /* ---------------------------------------------------------------------- */

  try {
    console.log(
      `[edgePublisher] Creating Cloudflare A record ${fqdn} → ${publicEdgeIp}`
    );
    await cloudflareClient.createARecord({
      hostname: fqdn,
      ip: publicEdgeIp,
    });

    if (externalPort) {
      await cloudflareClient.createSRVRecord({
        service: meta.service,
        protocol: meta.protocol,
        hostname: fqdn,
        port: externalPort,
        target: fqdn,
      });
      console.log(
        `[edgePublisher] ✓ Cloudflare SRV created for ${fqdn} on port ${externalPort}`
      );
    } else {
      console.log(
        `[edgePublisher] ✓ Cloudflare A record created (no SRV needed)`
      );
    }
  } catch (err) {
    console.error(
      `[edgePublisher] ⚠️ Cloudflare publish failed for ${fqdn}:`,
      err?.response?.data || err?.message || err
    );
  }

  /* ---------------------------------------------------------------------- */
  /* 4) Velocity registration (Minecraft only)                              */
  /* ---------------------------------------------------------------------- */

  if (isMC) {
    try {
      console.log(
        `[edgePublisher] Registering Minecraft backend with Velocity: ${slotHostname} → ${backendIp}:25565`
      );
      const res = await velocityClient.registerServer({
        name: slotHostname,
        address: backendIp,
        port: 25565, // internal MC port in the container
      });
      console.log(
        `[edgePublisher] ✓ Velocity registered ${slotHostname} → ${backendIp}:25565 (${res})`
      );
    } catch (err) {
      console.error(
        `[edgePublisher] ⚠️ Velocity registration failed for ${slotHostname}:`,
        err?.message || err
      );
    }
  } else {
    console.log(
      `[edgePublisher] Skipping Velocity registration (game=${gameKey})`
    );
  }

  console.log(
    `[edgePublisher] COMPLETE vmid=${vmid}, fqdn=${fqdn}, game=${gameKey}`
  );
}

/* -------------------------------------------------------------------------- */
/*  Rollback helper (delegates to dePublisher)                               */
/* -------------------------------------------------------------------------- */

export async function rollbackEdge({ slotHostname, vmid, game, ports }) {
  console.log(
    `[edgePublisher] ⚠️ Edge rollback requested for ${slotHostname || vmid}`
  );
  try {
    await unpublish({ hostname: slotHostname, vmid, game, ports });
    console.log(
      `[edgePublisher] ✓ Edge rollback completed for ${slotHostname || vmid}`
    );
  } catch (err) {
    console.error(
      `[edgePublisher] ❌ Edge rollback failed for ${slotHostname || vmid}:`,
      err?.message || err
    );
  }
}

/* -------------------------------------------------------------------------- */
/*  Health Check (optional)                                                   */
/* -------------------------------------------------------------------------- */

export async function edgeHealth() {
  try {
    // Minimal health response
    return {
      ok: true,
      message: "edgePublisher online (dummy health check)",
    };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}


export const unpublishEdge = rollbackEdge;

export default {
  publishEdge,
  rollbackEdge,
  unpublishEdge,
  edgeHealth,
};
