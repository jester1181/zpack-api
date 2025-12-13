// src/services/cloudflareClient.js
// FINAL, CLEAN, BULLETPROOF CLOUDFLARE CLIENT

import axios from "axios";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";
const CF_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CF_ZONE = process.env.CLOUDFLARE_ZONE_NAME || "zerolaghub.quest";

if (!CF_API_TOKEN || !CF_ZONE_ID) {
  console.warn("[cloudflareClient] ⚠ Missing API token or zone ID");
}

const cf = axios.create({
  baseURL: CF_API_BASE,
  headers: {
    Authorization: `Bearer ${CF_API_TOKEN}`,
    "Content-Type": "application/json",
  },
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function normalizeHostname(hostname) {
  if (!hostname) return "";

  const h = hostname.trim().toLowerCase();
  if (h.endsWith(`.${CF_ZONE}`)) return h;
  return `${h}.${CF_ZONE}`;
}

function extractBase(hostname) {
  const h = hostname.trim().toLowerCase();
  if (h.endsWith(`.${CF_ZONE}`))
    return h.slice(0, h.length - CF_ZONE.length - 1);
  return h;
}

/* -------------------------------------------------------------------------- */
/* Create A                                                                    */
/* -------------------------------------------------------------------------- */

export async function createARecord({ hostname, ip }) {
  const fqdn = normalizeHostname(hostname);

  try {
    await cf.post(`/zones/${CF_ZONE_ID}/dns_records`, {
      type: "A",
      name: fqdn,
      content: ip,
      ttl: 60,
      proxied: false,
    });

    console.log(`[cloudflareClient] ➕ A: ${fqdn} -> ${ip}`);
    return true;
  } catch (err) {
    console.error(
      `[cloudflareClient] ❌ A create failed for ${fqdn}`,
      err.response?.data || err.message
    );
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Create SRV (_minecraft._tcp)                                                */
/* -------------------------------------------------------------------------- */

export async function createSRVRecord({ hostname, port }) {
  const fqdn = normalizeHostname(hostname);
  const base = extractBase(hostname);

  // Cloudflare stores SRV as: _minecraft._tcp.<hostname>.<zone>
  const srvName = `_minecraft._tcp.${fqdn}`;

  try {
    await cf.post(`/zones/${CF_ZONE_ID}/dns_records`, {
      type: "SRV",
      name: srvName,
      data: {
        service: "_minecraft",
        proto: "_tcp",
        name: base, // Not full FQDN
        target: fqdn,
        port,
        priority: 0,
        weight: 0,
      },
      ttl: 60,
    });

    console.log(
      `[cloudflareClient] ➕ SRV: ${srvName} -> ${fqdn}:${port}`
    );
    return true;
  } catch (err) {
    console.error(
      `[cloudflareClient] ❌ SRV create failed for ${srvName}`,
      err.response?.data || err.message
    );
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Delete ANY matching A + SRV records                                        */
/* -------------------------------------------------------------------------- */

export async function deleteRecordByName(hostname) {
  const fqdn = normalizeHostname(hostname);
  const base = extractBase(hostname);

  // SRV stored format:
  const srvExact = `_minecraft._tcp.${fqdn}`;

  // All candidate names to search for
  const patterns = [
    fqdn,             // A record
    base,             // Rare case (not used)
    srvExact,         // Correct SRV
    `_minecraft._tcp.${base}`, // Rare CF variations
  ];

  let deleted = 0;
  const tried = new Set();

  console.log(`[cloudflareClient] 🧹 BEGIN delete for base=${hostname}`);

  for (const name of patterns) {
    if (!name || tried.has(name)) continue;
    tried.add(name);

    console.log(`[cloudflareClient] 🔍 Searching name=${name}`);

    let res;
    try {
      res = await cf.get(
        `/zones/${CF_ZONE_ID}/dns_records?name=${encodeURIComponent(name)}`
      );
    } catch (err) {
      console.warn(
        `[cloudflareClient] ⚠ Query failed for name=${name}:`,
        err.response?.data || err.message
      );
      continue;
    }

    const matches = res.data?.result || [];
    if (!matches.length) {
      console.log(`[cloudflareClient] (CF) No match for: ${name}`);
      continue;
    }

    for (const rec of matches) {
      try {
        await cf.delete(`/zones/${CF_ZONE_ID}/dns_records/${rec.id}`);
        console.log(
          `[cloudflareClient] 🗑️ Deleted ${rec.type} ${rec.name}`
        );
        deleted++;
      } catch (err) {
        console.error(
          `[cloudflareClient] ❌ Failed deleting ${rec.type} ${rec.name}`,
          err.response?.data || err.message
        );
      }
    }
  }

  if (deleted === 0) {
    console.log(
      `[cloudflareClient] ⚠️ No Cloudflare records deleted for ${hostname}`
    );
    return false;
  }

  console.log(
    `[cloudflareClient] ✅ Cloudflare cleanup completed for ${hostname}`
  );
  return true;
}

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

export default {
  createARecord,
  createSRVRecord,
  deleteRecordByName,
};
