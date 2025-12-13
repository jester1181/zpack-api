// src/jobs/reconcilePorts.js
import prisma from '../services/prisma.js';
import { PortPool } from '../services/portPool.js'



export async function reconcilePorts() {
  const allocated = await prisma.portPool.findMany({ where: { status: 'allocated' } })
  const vmids = new Set((await prisma.containerInstance.findMany({ select: { vmid: true } })).map(x => x.vmid))
  for (const p of allocated) {
    if (!vmids.has(p.vmid ?? -1)) {
      await PortPool.releaseByVmid(p.vmid) // idempotent if you code it so
    }
  }
}
