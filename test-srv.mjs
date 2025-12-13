import { createSRVRecord } from "./src/services/cloudflareClient.js";

await createSRVRecord({
  service: "minecraft",
  protocol: "tcp",
  hostname: "mc-test-420.zerolaghub.quest",
  port: 50065,
  target: "mc-test-420.zerolaghub.quest"
});
