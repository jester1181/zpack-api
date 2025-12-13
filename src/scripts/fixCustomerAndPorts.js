// scripts/fixCustomerAndPorts.js
import 'dotenv/config'
import prisma from '../services/prisma.js';


async function main() {
  const customerId = process.argv[2] || 'u001'
  const email = process.argv[3] || 'dev@zerolaghub.local'

  // 1) Ensure customer exists
  const customer = await prisma.customer.upsert({
    where: { id: customerId },
    update: {},
    create: { id: customerId, email }
  })
  console.log('Customer ready:', customer.id)

  // 2) Ensure a port block exists (adjust basePort/count if you want different)
  const basePort = 50000
  const count = 10

  const pa = await prisma.portAllocation.upsert({
    where: { customerId: customerId },
    update: {}, // keep existing if present
    create: { customerId: customerId, basePort, count }
  })
  console.log('PortAllocation ready:', pa.customerId, pa.basePort, pa.count)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
