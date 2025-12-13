import {
  createARecord,
  createSRVRecord,
  delARecord,
  delSRVRecord,
} from "./src/services/cloudflareClient.js";

const hostname = "mc-test-422.zerolaghub.quest";
const ip = "139.64.165.248";
const port = 50065;

console.log("\n=== TEST: A + SRV Create / Delete ===\n");

// --- Create ---
await createARecord({ hostname, ip });
await createSRVRecord({
  service: "minecraft",
  protocol: "tcp",
  hostname,
  port,
  target: hostname,
});

console.log("\n✅ Created both records. Check Cloudflare now.");

// --- Wait 5 seconds ---
await new Promise((r) => setTimeout(r, 5000));

// --- Delete ---
await delSRVRecord({ service: "minecraft", protocol: "tcp", hostname });
await delARecord({ hostname });

console.log("\n✅ Deleted both records. Verify in Cloudflare.\n");
