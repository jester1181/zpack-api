// src/services/prisma.js
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;

const _prisma =
  globalForPrisma.__zlh_prisma ??
  new PrismaClient({
    log: (process.env.PRISMA_LOG ?? 'error').split(',').map((s) => s.trim()),
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__zlh_prisma = _prisma;
}

export const prisma = _prisma;   // ← named export (compat with imports using { prisma })
export default _prisma;          // ← keep default export too
