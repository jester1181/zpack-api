// src/api/provisionDev.js
// DEV-SIDE request normalization + validation (payload not implemented yet)

export function normalizeDevRequest(body = {}) {
  const {
    customerId,
    name,
    cpuCores,
    memoryMiB,
    diskGiB,
    portsNeeded,

    // dev-specific fields (future)
    runtime,
    runtimeVersion,
    addons,
  } = body;

  if (!customerId) throw new Error("customerId required");

  // NOTE: Do NOT require game/variant/world for dev.
  // Payload work is explicitly deferred per instruction.
  return {
    customerId,
    name,
    cpuCores,
    memoryMiB,
    diskGiB,
    portsNeeded,
    runtime,
    runtimeVersion,
    addons,
  };
}

export default { normalizeDevRequest };
