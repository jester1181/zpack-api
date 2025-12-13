/**
 * ZeroLagHub – DNS Sync Audit v2
 * Compares DB, Technitium, and Cloudflare for divergence.
 * Returns which hostnames are missing, duplicated, or orphaned.
 */

import prisma from "../services/prisma.js";
import * as technitium from "../services/technitiumClient.js";
import * as cloudflare from "../services/cloudflareClient.js";

async function testDnsSync() {
  console.log("🔍 Running DNS sync test...");

  // --- 1️⃣ Get hostnames from DB ---
  const dbInstances = await prisma.containerInstance.findMany({
    select: { hostname: true },
  });
  const dbHostnames = dbInstances.map((i) => i.hostname);
  console.log(`🗃️ DB hostnames: ${dbHostnames.length}`);

  // --- 2️⃣ Get Technitium ---
  const techRecords = await technitium.listRecords();
  const techHosts = new Set(
    techRecords
      .filter((r) => ["A", "SRV"].includes(r.type))
      .map((r) =>
        r.type === "SRV"
          ? r.name.replace(/^_minecraft\._tcp\./, "")
          : r.name
      )
  );
  console.log(`🧩 Technitium records: ${techHosts.size}`);

  // --- 3️⃣ Get Cloudflare ---
  const cfRecords = await cloudflare.listAllRecords();
  const cfHosts = new Set(
    cfRecords
      .filter((r) => ["A", "SRV"].includes(r.type))
      .map((r) =>
        r.type === "SRV"
          ? r.name.replace(/^_minecraft\._tcp\./, "")
          : r.name
      )
  );
  console.log(`☁️ Cloudflare records: ${cfHosts.size}`);

  // --- 4️⃣ Compute sets ---
  const techOnly = [...techHosts].filter((h) => !dbHostnames.includes(h));
  const cfOnly = [...cfHosts].filter((h) => !dbHostnames.includes(h));
  const inBoth = [...techHosts].filter((h) => cfHosts.has(h));
  const dbMissing = dbHostnames.filter(
    (h) => !techHosts.has(h) && !cfHosts.has(h)
  );

  // --- 5️⃣ Display results ---
  console.log("\n🧾 ===== DNS Audit Summary =====");
  console.log(`Technitium-only records (${techOnly.length}):`);
  techOnly.forEach((h) => console.log(`  - ${h}`));

  console.log(`\nCloudflare-only records (${cfOnly.length}):`);
  cfOnly.forEach((h) => console.log(`  - ${h}`));

  console.log(`\nIn both (${inBoth.length}):`);
  inBoth.forEach((h) => console.log(`  - ${h}`));

  console.log(`\nMissing from both (${dbMissing.length}):`);
  dbMissing.forEach((h) => console.log(`  - ${h}`));

  console.log("\n✅ Done.\n");
}

testDnsSync()
  .catch((err) => console.error("❌ DNS sync test failed:", err))
  .finally(async () => await prisma.$disconnect());
