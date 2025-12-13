/**
 * ZeroLagHub – DNS Reconciliation Utility (Final)
 * ------------------------------------------------
 * Compares DB + Proxmox + DNS (Technitium + Cloudflare)
 * Produces a 3-way sync summary, optional cleanup, and optional JSON output.
 */

import prisma from "../services/prisma.js";
import * as technitium from "../services/technitiumClient.js";
import * as cloudflare from "../services/cloudflareClient.js";
import proxmox from "../services/proxmoxClient.js";
import { unpublish } from "../services/dePublisher.js";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */
const ZONE = process.env.TECHNITIUM_ZONE || "zerolaghub.quest";
const zoneDot = `.${ZONE}`;

// Normalize hostnames
function normalizeHost(name) {
  if (!name) return null;
  let h = name.toString().trim().toLowerCase();

  // Strip SRV prefixes (_minecraft._tcp. or __minecraft.__tcp.)
  h = h.replace(/^_+minecraft\._+tcp\./, "");

  // Remove trailing dots
  h = h.replace(/\.*$/, "");

  // Ensure fully qualified domain
  if (!h.endsWith(zoneDot) && !h.includes(".")) h = `${h}${zoneDot}`;

  return h;
}

// Return short + FQDN variants
function variants(host) {
  const fqdn = normalizeHost(host);
  if (!fqdn) return [];
  const short = fqdn.endsWith(zoneDot) ? fqdn.slice(0, -zoneDot.length) : fqdn;
  return [fqdn, short];
}

/* -------------------------------------------------------------------------- */
/* Main reconciliation                                                        */
/* -------------------------------------------------------------------------- */
export async function reconcileDNS({ apply = false, json = false } = {}) {
  console.log(`🔍 Starting DNS reconciliation (${apply ? "apply" : "dry run"})...`);

  /* ---------- 1️⃣ Database ---------- */
  const dbInstances = await prisma.containerInstance.findMany({
    select: { hostname: true },
  });
  const dbHosts = new Set();
  for (const i of dbInstances) variants(i.hostname).forEach(v => dbHosts.add(v));

  /* ---------- 2️⃣ Proxmox ---------- */
  let containers = [];
  try {
    containers = await proxmox.listContainers();
  } catch (err) {
    console.warn(`[API] ⚠️ Could not fetch Proxmox containers: ${err.message}`);
  }
  const proxHosts = new Set();
  for (const c of containers) variants(c.hostname).forEach(v => proxHosts.add(v));

  /* ---------- 3️⃣ DNS ---------- */
  const techRecords = await technitium.listRecords();
  const cfRecords = await cloudflare.listAllRecords();
  const dnsHosts = new Set();
  for (const r of [...techRecords, ...cfRecords]) {
    if (!["A", "SRV"].includes(r.type)) continue;
    const normalized = normalizeHost(r.name);
    if (normalized) dnsHosts.add(normalized);
  }

  /* ---------- 4️⃣ Comparison ---------- */
  const IGNORE = new Set([
    normalizeHost("zerolaghub.quest"),
    normalizeHost("ns1.zerolaghub.quest"),
  ]);

  const orphans = [];
  for (const fq of dnsHosts) {
    const [fqdn, short] = variants(fq);
    if (IGNORE.has(fqdn) || IGNORE.has(short)) continue;
    if (!dbHosts.has(fqdn) && !proxHosts.has(fqdn) && !dbHosts.has(short) && !proxHosts.has(short)) {
      orphans.push(fqdn);
    }
  }

  const dbOnly = [...dbHosts].filter(h => !proxHosts.has(h));
  const proxOnly = [...proxHosts].filter(h => !dbHosts.has(h));

  /* ---------- 5️⃣ JSON or Pretty Output ---------- */
  const summary = {
    timestamp: new Date().toISOString(),
    counts: {
      db: dbInstances.length,
      proxmox: containers.length,
      technitium: techRecords.length,
      cloudflare: cfRecords.length,
      dnsHosts: dnsHosts.size,
      dbOnly: dbOnly.length,
      proxOnly: proxOnly.length,
      orphans: orphans.length,
    },
    dbOnly,
    proxOnly,
    orphans,
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  console.log(`\n🧾 ===== Environment Sync Summary =====`);
  console.log(`📘 DB-only hosts (not in Proxmox): ${dbOnly.length}`);
  if (dbOnly.length) dbOnly.forEach(h => console.log(`  - ${h}`));

  console.log(`\n🖥️ Proxmox-only hosts (not in DB): ${proxOnly.length}`);
  if (proxOnly.length) proxOnly.forEach(h => console.log(`  - ${h}`));

  console.log(`\n☁️ DNS-only (orphans): ${orphans.length}`);
  if (orphans.length) orphans.forEach(h => console.log(`  - ${h}`));

  console.log(`\nCounts → DB:${summary.counts.db}  |  Proxmox:${summary.counts.proxmox}  |  DNS:${summary.counts.dnsHosts}`);

  /* ---------- 6️⃣ Optional Cleanup ---------- */
  if (apply && orphans.length) {
    console.log("\n🧹 Cleaning up orphaned records...");
    for (const hostname of orphans) {
      try {
        await unpublish({ hostname, game: "minecraft", ports: [25565] });
        await prisma.deletedInstance.create({
          data: { hostname, origin: "reconcile" },
        });
        console.log(`  ✓ Unpublished and logged ${hostname}`);
      } catch (err) {
        console.warn(`  ⚠️ Failed to unpublish ${hostname}: ${err.message}`);
      }
    }
    console.log("\n✅ Cleanup complete.");
  } else if (!apply) {
    console.log("\n(dry run — no changes made)");
  }
}
