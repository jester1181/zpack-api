// src/api/handlers/provisionDev.js

export function normalizeDevRequest(body = {}) {
  if (!body.runtime) {
    throw new Error("runtime is required for dev container");
  }

  if (!body.version) {
    throw new Error("version is required for dev container");
  }

  return {
    customerId: body.customerId,
    runtime: body.runtime,
    version: body.version,
    memoryMiB: body.memoryMiB || 2048,
    cpuCores: body.cpuCores || 2,
    portsNeeded: body.portsNeeded || 0,
  };
}
