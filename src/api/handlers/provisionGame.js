// src/api/handlers/provisionGame.js

export function normalizeGameRequest(body = {}) {
  if (!body.game) {
    throw new Error("game is required");
  }

  if (!body.variant) {
    throw new Error("variant is required");
  }

  return {
    customerId: body.customerId,
    game: body.game,
    variant: body.variant,
    version: body.version,
    world: body.world || "world",
    memoryMiB: body.memoryMiB || 2048,
    cpuCores: body.cpuCores || 2,
    portsNeeded: body.portsNeeded || 0,
  };
}
