#!/usr/bin/env node
import { reconcileDNS } from "../audit/dnsReconcile.js";
import prisma from "../services/prisma.js";

const apply = process.argv.includes("--apply");

await reconcileDNS({ apply });
await prisma.$disconnect();
