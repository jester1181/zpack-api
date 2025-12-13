import proxyClient from "./proxyClient.js";
import dns from "./technitiumClient.js";
import cloudflareClient from "./cloudflareClient.js";
import velocityClient from "./velocityClient.js";

function normalizeHostname(hostname) {
  if (!hostname) return "";
  return hostname.trim().toLowerCase();
}

function toFqdn(hostname) {
  const zone = process.env.CF_ZONE_NAME || "zerolaghub.quest";
  if (!hostname.includes(".")) {
    return `${hostname}.${zone}`;
  }
  return hostname;
}

export async function unpublish({
  hostname,
  vmid,
  game = "minecraft",
  ports = [],
  dryRun = false,
}) {
  hostname = normalizeHostname(hostname);
  const fqdn = toFqdn(hostname);

  console.log(`[dePublisher] BEGIN teardown for vmid=${vmid} (${hostname})`);

  /* ---------------------- 1️⃣ Traefik cleanup ---------------------- */
  try {
    console.log(`[dePublisher] Removing Traefik config for ${hostname}`);
    if (!dryRun) {
      const removed = await proxyClient.removeProxyConfig({ hostname });
      if (!removed) console.log(`[dePublisher] No Traefik config found`);
    }
  } catch (err) {
    console.warn(`[dePublisher] ⚠️ Traefik cleanup failed: ${err.message}`);
  }

  /* ---------------------- 2️⃣ Velocity cleanup ---------------------- */
  try {
    if (!dryRun) {
      console.log(`[dePublisher] Unregistering from Velocity using FQDN: ${fqdn}`);
      const res = await velocityClient.unregisterServer(fqdn);
      console.log(`[dePublisher] ✓ Velocity unregistered ${fqdn}: ${res}`);
    }
  } catch (err) {
    console.warn(`[dePublisher] ⚠️ Velocity cleanup failed: ${err.message}`);
  }

  /* ---------------------- 3️⃣ Technitium ---------------------- */
  try {
    console.log(`[dePublisher] Deleting Technitium records for ${hostname}`);
    if (!dryRun) {
      await dns.delARecord({ hostname });
      await dns.delSRVRecord({ hostname });
    }
    console.log(`[dePublisher] ✓ Technitium cleanup OK`);
  } catch (err) {
    console.warn(`[dePublisher] ⚠️ Technitium cleanup failed: ${err.message}`);
  }

  /* ---------------------- 5️⃣ Cloudflare ---------------------- */
// Cloudflare cleanup
try {
  console.log(`[dePublisher] Removing Cloudflare A + SRV for ${hostname}`);
  if (!dryRun) {
    await cloudflareClient.deleteRecordByName(hostname);
    await cloudflareClient.deleteRecordByName(`_minecraft._tcp.${hostname}`);
  }
  console.log(`[dePublisher] ✓ Cloudflare cleanup OK`);
} catch (err) {
  console.warn(
    `[dePublisher] ⚠️ Cloudflare cleanup failed: ${err.message}`
  );
}

  console.log(`[dePublisher] ✅ Teardown complete for ${hostname}`);
  return true;
}

export default { unpublish };
