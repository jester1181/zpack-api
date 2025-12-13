// src/services/vmidAllocator.js
// Counter-based VMID allocator with wrap + clash probe.

import * as prismaSvc from './prisma.js';
const prisma = prismaSvc.prisma ?? prismaSvc.default;

const RANGES = {
  game: { min: 5000, max: 5999 },
  dev:  { min: 6000, max: 6999 },
};

/**
 * Internal helper: allocate the next VMID in a given range for a key ("game" | "dev").
 * - Uses VmidCounter as the single source of truth.
 * - Wraps when exceeding max.
 * - Probes ContainerInstance to avoid collisions.
 */
async function nextId(key, { min, max }) {
  return prisma.$transaction(async (tx) => {
    // Get or create the counter row
    let row = await tx.vmidCounter.findUnique({ where: { key } });
    if (!row) {
      row = await tx.vmidCounter.create({
        data: { key, current: min - 1 },
      });
    }

    const totalSlots = max - min + 1;
    let candidate = row.current;
    let attempts = 0;

    while (attempts < totalSlots) {
      candidate += 1;
      if (candidate > max) candidate = min;

      // Check for an existing ContainerInstance with this vmid
      const existing = await tx.containerInstance.findUnique({
        where: { vmid: candidate },
      });

      if (!existing) {
        // Update the counter to this new value
        await tx.vmidCounter.update({
          where: { key },
          data: { current: candidate },
        });

        return candidate;
      }

      attempts += 1;
    }

    // If we got here, the range is fully exhausted
    throw new Error(
      `No free VMIDs available in range ${min}-${max} for key="${key}".`
    );
  });
}

/**
 * Allocate a VMID for a container type.
 * ctype: "game" | "dev"
 */
export async function allocateVmid(ctype) {
  const key = ctype === 'dev' ? 'dev' : 'game';
  return nextId(key, RANGES[key]);
}

/**
 * Stub for now – kept for API compatibility.
 * If you ever want to do extra verification after provisioning,
 * you can expand this.
 */
export async function confirmVmidAllocated(_vmid) {
  return true;
}

/**
 * Stub for now – VMIDs are not re-used immediately.
 * If you later decide to support "returning" VMIDs to a free pool,
 * implement that here (carefully).
 */
export async function releaseVmid(_vmid) {
  return true;
}

export default { allocateVmid, confirmVmidAllocated, releaseVmid };
