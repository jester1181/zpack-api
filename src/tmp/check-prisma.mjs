import prisma from '../services/prisma.js';

const p = new PrismaClient();

try {
  const keys = Object.keys(p);
  console.log('Delegates:', keys);
  console.log('has containerTemplate:', !!p.containerTemplate);
} catch (e) {
  console.error('Prisma introspection failed:', e);
} finally {
  await p.$disconnect();
}
