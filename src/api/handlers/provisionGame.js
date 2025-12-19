// src/api/provisionGame.js
// GAME-SIDE request normalization + validation (no payload changes yet)

export function normalizeGameRequest(body = {}) {
  const {
    customerId,
    game,
    variant,
    version,
    world,
    name,
    cpuCores,
    memoryMiB,
    diskGiB,
    portsNeeded,
    artifactPath,
    javaPath,

    // passthrough creds (kept here just for shaping; payload stays in provisionAgent.js for now)
    steamUser,
    steamPass,
    steamAuth,
    adminUser,
    adminPass,
  } = body;

  if (!customerId) throw new Error("customerId required");
  if (!game) throw new Error("game required");
  if (!variant) throw new Error("variant required");

  const gameLower = String(game).toLowerCase();
  const isMinecraft = gameLower.includes("minecraft");

  return {
    customerId,
    game,
    variant,
    version,
    world,

    name,
    cpuCores,
    memoryMiB,
    diskGiB,
    portsNeeded,

    artifactPath,
    javaPath,

    steamUser,
    steamPass,
    steamAuth,
    adminUser,
    adminPass,

    isMinecraft,
  };
}

export default { normalizeGameRequest };
