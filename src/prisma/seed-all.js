// src/prisma/seed-all.js
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seedTemplates() {
  console.log("▶ Seeding ContainerTemplate…");

  const templates = [
    { slug: "mc-vanilla",      game: "minecraft", variant: "vanilla",    ctype: "game", templateVmid: 900, defBridge: "vmbr3" },
    { slug: "mc-paper",        game: "minecraft", variant: "paper",      ctype: "game", templateVmid: 901, defBridge: "vmbr3" },
    { slug: "mc-forge",        game: "minecraft", variant: "forge",      ctype: "game", templateVmid: 902, defBridge: "vmbr3" },
    { slug: "mc-fabric",       game: "minecraft", variant: "fabric",     ctype: "game", templateVmid: 903, defBridge: "vmbr3" },
    { slug: "mc-bedrock",      game: "minecraft", variant: "bedrock",    ctype: "game", templateVmid: 904, defBridge: "vmbr3" },
    { slug: "mc-pocketmine",   game: "minecraft", variant: "pocketmine", ctype: "game", templateVmid: 905, defBridge: "vmbr3" },
    { slug: "rust",            game: "rust",      variant: "vanilla",    ctype: "game", templateVmid: 906, defBridge: "vmbr3" },
    { slug: "pz",              game: "pz",        variant: "vanilla",    ctype: "game", templateVmid: 907, defBridge: "vmbr3" },
    { slug: "valheim",         game: "valheim",   variant: "vanilla",    ctype: "game", templateVmid: 908, defBridge: "vmbr3" },
    { slug: "valheim-plus",    game: "valheim",   variant: "plus",       ctype: "game", templateVmid: 909, defBridge: "vmbr3" },
    { slug: "valheim-bepinex", game: "valheim",   variant: "bepinex",    ctype: "game", templateVmid: 910, defBridge: "vmbr3" },
    { slug: "terraria-tmod",   game: "terraria",  variant: "tmod",       ctype: "game", templateVmid: 911, defBridge: "vmbr3" },
    { slug: "terraria-tshock", game: "terraria",  variant: "tshock",     ctype: "game", templateVmid: 912, defBridge: "vmbr3" },
  ];

  for (const t of templates) {
    await prisma.containerTemplate.upsert({
      where: { slug: t.slug },
      update: {},
      create: {
        slug: t.slug,
        game: t.game,
        variant: t.variant,
        ctype: t.ctype,
        templateVmid: t.templateVmid,
        defBridge: t.defBridge,
        resources: { memory: 2048, disk: 20, cpu: 2 },
      },
    });
  }

  console.log("✔ ContainerTemplate seeding complete.");
}

async function seedVmidCounters() {
  console.log("▶ Seeding VmidCounter…");

  const rows = [
    { key: "game", current: 5000 },
    { key: "dev", current: 6000 },
  ];

  for (const row of rows) {
    await prisma.vmidCounter.upsert({
      where: { key: row.key },
      update: {},
      create: row,
    });
  }

  console.log("✔ VmidCounter seeded.");
}

async function seedPortPool() {
  console.log("▶ Seeding PortPool (Game Ports)…");

  const START = 50000;
  const COUNT = 1000; // 50000–50999

  const entries = [];

  for (let i = 0; i < COUNT; i++) {
    entries.push({
      port: START + i,
      portType: "game",
      status: "free",
    });
  }

  await prisma.portPool.createMany({
    data: entries,
    skipDuplicates: true,
  });

  console.log(`✔ PortPool seeded (${COUNT} ports).`);
}

async function main() {
  console.log("== ZeroLagHub schema seed-all starting ==");

  await seedTemplates();
  await seedVmidCounters();
  await seedPortPool();

  console.log("== Seed complete ==");
}

main()
  .catch((err) => {
    console.error("❌ SEED FAILED");
    console.error(err);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
