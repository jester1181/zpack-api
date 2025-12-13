// prisma/seedports.js
import prisma from '../services/prisma.js';


async function seedPortPool(start, end, proto = 'tcp') {
  const BATCH = 1000
  for (let p = start; p <= end; p += BATCH) {
    const rows = []
    for (let x = p; x < p + BATCH && x <= end; x++) {
      rows.push({ port: x, protocol: proto, status: 'free' })
    }
    await prisma.portPool.createMany({ data: rows, skipDuplicates: true })
  }
}

async function main() {
  // TCP range used for public gameplay ports
  await seedPortPool(50000, 59999, 'tcp')

  // If/when you want UDP too, uncomment:
  // await seedPortPool(50000, 59999, 'udp')
}

main()
  .then(() => console.log('PortPool seeded.'))
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => prisma.$disconnect())
