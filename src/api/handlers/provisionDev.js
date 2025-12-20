// src/api/provisionDev.js
// DEV-SIDE request normalization + validation

export function normalizeDevRequest(body = {}) {
  const {
    customerId,
    name,
    cpuCores,
    memoryMiB,
    diskGiB,
    portsNeeded,

    // dev fields
    runtime,

    // canonical runtime version field for dev (matches your curl)
    version,

    // legacy/alternate naming (optional)
    runtimeVersion,

    // optional addons
    addons,
  } = body;

  if (!customerId) throw new Error("customerId required");
  if (!runtime) throw new Error("runtime required");
  const resolvedVersion = version || runtimeVersion;
  if (!resolvedVersion) throw new Error("version required");

  return {
    customerId,
    name,
    cpuCores,
    memoryMiB,
    diskGiB,
    portsNeeded,

    runtime,
    version: String(resolvedVersion),

    addons: Array.isArray(addons) ? addons : undefined,
  };
}

export default { normalizeDevRequest };
