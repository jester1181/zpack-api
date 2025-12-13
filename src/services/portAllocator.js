// src/services/portAllocator.js
// Centralised port allocation logic for ZeroLagHub.
//
// Works with the new PortPool schema:
//
// model PortPool {
//   id          Int        @id @default(autoincrement())
//   port        Int
//   portType    String     // "game" | "dev" | custom
//   status      PortStatus @default(free)
//   allocatedTo Int?       // vmid
//   createdAt   DateTime   @default(now())
//   updatedAt   DateTime   @updatedAt
//
//   @@unique([port])
//   @@index([status, portType])
// }
//
// ENUM:
//
// enum PortStatus {
//   free
//   reserved
//   allocated
// }
//
// This allocator handles:
//   - reserve()  → lock free ports to a vmid (status=reserved)
//   - commit()   → convert reserved → allocated after provisioning
//   - release()  → free all ports for a vmid (rollback / deletion)

import prisma from '../services/prisma.js';
import { PortStatus } from '@prisma/client';

const DEFAULT_PORT_TYPE = 'game';

export class PortAllocationService {
  /**
   * Reserve a contiguous block of ports for a container.
   *
   * Used during provisioning (STEP 3). VMID is already known at this point,
   * so we bind the reservation to that VMID immediately with status "reserved".
   *
   * @param {Object} options
   * @param {number} options.count       How many ports to reserve.
   * @param {number} options.vmid        VMID the ports belong to.
   * @param {string} [options.portType]  "game" | "dev" | ...
   *
   * @returns {Promise<number[]>} Array of port numbers, sorted ascending.
   */
  static async reserve({ count, vmid, portType = DEFAULT_PORT_TYPE } = {}) {
    if (!count || count <= 0) {
      throw new Error('PortAllocationService.reserve: "count" must be > 0');
    }
    if (!vmid) {
      throw new Error('PortAllocationService.reserve: "vmid" is required');
    }

    // 1) Find free ports of the requested type
    const candidates = await prisma.portPool.findMany({
      where: {
        status: PortStatus.free,
        portType,
      },
      orderBy: { port: 'asc' },
      take: count,
    });

    if (candidates.length < count) {
      throw new Error(
        `PortAllocationService.reserve: not enough free ports for type "${portType}" ` +
        `(requested ${count}, found ${candidates.length})`
      );
    }

    const ids = candidates.map((p) => p.id);
    const ports = candidates.map((p) => p.port);

    // 2) Mark them as reserved for this VMID
    await prisma.portPool.updateMany({
      where: { id: { in: ids } },
      data: {
        status: PortStatus.reserved,
        allocatedTo: vmid,
      },
    });

    return ports;
  }

  /**
   * Commit a set of reserved ports to a VMID once provisioning succeeds.
   *
   * This converts status "reserved" → "allocated".
   * If no ports provided, it's a no-op.
   *
   * @param {Object} options
   * @param {number} options.vmid
   * @param {number[]} options.ports
   * @param {string} [options.portType]
   */
  static async commit({ vmid, ports, portType = DEFAULT_PORT_TYPE } = {}) {
    if (!vmid) {
      throw new Error('PortAllocationService.commit: "vmid" is required');
    }
    if (!ports || !Array.isArray(ports) || ports.length === 0) {
      // Nothing to commit – silently return
      return;
    }

    await prisma.portPool.updateMany({
      where: {
        port: { in: ports },
        portType,
        allocatedTo: vmid,
      },
      data: {
        status: PortStatus.allocated,
      },
    });
  }

  /**
   * Release all reserved/allocated ports associated with a VMID.
   *
   * Used in:
   *   - Provisioning rollback (on error)
   *   - Container deletion
   *   - Reconciler correcting orphan state
   *
   * @param {number} vmid
   */
  static async releaseByVmid(vmid) {
    if (!vmid) return;

    await prisma.portPool.updateMany({
      where: {
        allocatedTo: vmid,
      },
      data: {
        status: PortStatus.free,
        allocatedTo: null,
      },
    });
  }
}

// Backup export syntax for older imports like:
//   import { PortAllocationService } from '../services/portAllocator.js';
export default PortAllocationService;
