// ESM, Node 20+
// Uses your Prisma model: PortPool (status: free|allocated|reserved)

import prisma from '../services/prisma.js';


const START = 50000;
const END   = 59000;

export async function allocatePorts(count, { vmid, customerId, purpose } = {}) {
  if (!count || count < 1) return [];
  const out = [];

  for (let p = START; p <= END && out.length < count; p++) {
    // try to find a seeded free row first
    const freeRow = await prisma.portPool.findFirst({
      where: { port: p, status: 'free' },
      select: { id: true },
    });

    if (freeRow) {
      await prisma.portPool.update({
        where: { id: freeRow.id },
        data: {
          status: 'allocated',
          vmid: vmid ?? null,
          customerId: customerId ?? null,
          purpose: purpose ?? null,
          allocatedAt: new Date(),
          releasedAt: null,
        },
      });
      out.push(p);
      continue;
    }

    // if not seeded, create on the fly (unique by ip+port+protocol)
    const exists = await prisma.portPool.findFirst({ where: { port: p } });
    if (!exists) {
      await prisma.portPool.create({
        data: {
          port: p,
          protocol: 'tcp',
          status: 'allocated',
          vmid: vmid ?? null,
          customerId: customerId ?? null,
          purpose: purpose ?? null,
          allocatedAt: new Date(),
        },
      });
      out.push(p);
    }
  }

  if (out.length < count) {
    throw new Error(`Not enough free ports in ${START}-${END}`);
  }
  return out;
}

export async function releasePorts(ports) {
  if (!ports?.length) return;
  await prisma.portPool.updateMany({
    where: { port: { in: ports } },
    data: {
      status: 'free',
      vmid: null,
      customerId: null,
      purpose: null,
      releasedAt: new Date(),
      allocatedAt: null,
    },
  });
}
