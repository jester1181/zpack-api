import { createARecord, createSRVRecord } from "./src/services/cloudflareClient.js";

// ensure Cloudflare env vars are loaded
if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ZONE_ID) {
  console.error("❌ Missing Cloudflare env vars!");
  process.exit(1);
}

const hostname = "mc-test-421.zerolaghub.quest";
const ip = "139.64.165.248";
const port = 50065;

console.log("\n=== TEST: A + SRV Creation ===\n");

await createARecord({ hostname, ip });

await createSRVRecord({
  service: "minecraft",
  protocol: "tcp",
  hostname,
  port,
  target: hostname,
});

console.log("\n✅ Done. Check Cloudflare for both A + SRV.\n");
