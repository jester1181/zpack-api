// src/services/velocityClient.js
// Handles dynamic backend registration with the Velocity ZpackVelocityBridge plugin.

import fetch from "node-fetch";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const VELOCITY_URL = process.env.VELOCITY_URL || "http://10.70.0.241:8081";
const SHARED_SECRET = process.env.ZPACK_SECRET;

function getSecretHash() {
  return crypto.createHash("sha256").update(SHARED_SECRET).digest("hex");
}

/* -------------------------------------------------------------------------- */
/* EXISTENCE CHECK                                                            */
/* -------------------------------------------------------------------------- */
export async function serverExists(name) {
  try {
    const res = await fetch(`${VELOCITY_URL}/zpack/list`);
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data.servers) && data.servers.some(s => s.name === name);
  } catch (err) {
    console.error(`[velocityClient] ⚠️ Server existence check failed: ${err.message}`);
    return false;
  }
}

// --- Internal deduplication cache ---
const registrationCache = new Map();

/**
 * Register a backend server with Velocity dynamically.
 * Adds deduplication to prevent duplicate registration attempts within 10 seconds.
 *
 * @param {Object} params
 * @param {string} params.name - FQDN or short server name
 * @param {string} params.address - IP address of the backend container
 * @param {number} params.port - Listening port (e.g. 25565)
 */
export async function registerServer({ name, address, port }) {
  const key = `${name}:${address}:${port}`;
  const now = Date.now();

  // Debounce repeated registrations for the same backend
  if (registrationCache.has(key) && now - registrationCache.get(key) < 10000) {
    console.log(`[velocityClient] Skipping duplicate registration for ${key}`);
    return "duplicate-skip";
  }
  registrationCache.set(key, now);

  const payload = { server_name: name, address, port };
  const secretHash = getSecretHash();

  console.log(`[velocityClient] Registering backend: ${name} -> ${address}:${port}`);
  console.log(`[velocityClient] Using Velocity URL: ${VELOCITY_URL}`);

  const res = await fetch(`${VELOCITY_URL}/zpack/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Zpack-Secret": secretHash,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Velocity register failed (${res.status}): ${text}`);
  }

  const text = await res.text();
  console.log(`[velocityClient] ✓ Velocity registered ${name} → ${address}:${port}`);
  return text;
}

/**
 * Unregister a backend server from Velocity dynamically.
 * @param {string} name - Short hostname or FQDN
 */
export async function unregisterServer(name) {
  // Convert short name → full FQDN if needed
  let serverName = name;
  const ZONE = process.env.CF_ZONE_NAME || "zerolaghub.quest";
  if (!serverName.includes(".")) {
    serverName = `${serverName}.${ZONE}`;
  }

  const payload = { server_name: serverName };
  const secretHash = getSecretHash();

  console.log(`[velocityClient] Unregistering backend: ${serverName}`);

  let res;
  try {
    res = await fetch(`${VELOCITY_URL}/zpack/unregister`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Zpack-Secret": secretHash,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(`[velocityClient] ⚠️ Velocity unreachable: ${err.message}`);
    return false;
  }

  const text = await res.text();

  // ---------------------------
  // Idempotent delete:
  // Velocity returns 404 when the backend is already removed → this is SUCCESS
  // ---------------------------
  if (res.status === 404) {
    console.log(
      `[velocityClient] ✓ Backend already removed (idempotent): ${serverName}`
    );
    return true;
  }

  if (!res.ok) {
    console.error(
      `[velocityClient] ❌ Velocity unregister failed (${res.status}): ${text}`
    );
    return false;
  }

  console.log(`[velocityClient] ✓ Velocity unregistered ${serverName}`);
  return true;
}



export default { registerServer, unregisterServer };
