// src/jobs/reconcileEdges.js
// Simple, idempotent reconciler: re-apply publishEdge for all running instances
// Later you can diff against actual OPNsense/Technitium state to do true healing.

import prisma from '../services/prisma.js';
import { publishEdge } from '../services/edgePublisher.js';

export async function reconcileEdgesOnce() {
  const running = await prisma.containerInstance.findMany({
    where: { status: 'running' },
    select: { vmid: true, ip: true, name: true, ports: true },
  });

  for (const r of running) {
    try {
      if (!r.ip || !r.ports || r.ports.length === 0) continue;
      await publishEdge({ vmid: r.vmid, ctIp: r.ip, hostname: r.name, ports: r.ports });
    } catch (e) {
      console.warn('reconcileEdges failed', { vmid: r.vmid, msg: e?.message });
    }
  }
}

export default { reconcileEdgesOnce };
