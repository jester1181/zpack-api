// prisma/seed.js
// Seeds ContainerTemplate + HostSlot (slots for Minecraft variants)
import prisma from '../services/prisma.js';


function pad4(n) { return String(n).padStart(4, '0') }

async function upsertTemplates() {
  const templates = [
    { slug: 'mc-vanilla',      game: 'minecraft', variant: 'vanilla',    ctype: 'game', templateVmid: 200, defBridge: 'vmbr3' },
    { slug: 'mc-paper',        game: 'minecraft', variant: 'paper',      ctype: 'game', templateVmid: 201, defBridge: 'vmbr3' },
    { slug: 'mc-forge',        game: 'minecraft', variant: 'forge',      ctype: 'game', templateVmid: 202, defBridge: 'vmbr3' },
    { slug: 'mc-fabric',       game: 'minecraft', variant: 'fabric',     ctype: 'game', templateVmid: 203, defBridge: 'vmbr3' },
    { slug: 'mc-bedrock',      game: 'minecraft', variant: 'bedrock',    ctype: 'game', templateVmid: 204, defBridge: 'vmbr3' },
    { slug: 'mc-pocketmine',   game: 'minecraft', variant: 'pocketmine', ctype: 'game', templateVmid: 205, defBridge: 'vmbr3' },
    { slug: 'rust',            game: 'rust',      variant: 'vanilla',    ctype: 'game', templateVmid: 206, defBridge: 'vmbr3' },
    { slug: 'pz',              game: 'pz',        variant: 'vanilla',    ctype: 'game', templateVmid: 207, defBridge: 'vmbr3' },
    { slug: 'valheim',         game: 'valheim',   variant: 'vanilla',    ctype: 'game', templateVmid: 208, defBridge: 'vmbr3' },
    { slug: 'valheim-plus',    game: 'valheim',   variant: 'plus',       ctype: 'game', templateVmid: 209, defBridge: 'vmbr3' },
    { slug: 'valheim-bepinex', game: 'valheim',   variant: 'bepinex',    ctype: 'game', templateVmid: 210, defBridge: 'vmbr3' },
    { slug: 'terraria-tmod',   game: 'terraria',  variant: 'tmod',       ctype: 'game', templateVmid: 211, defBridge: 'vmbr3' },
    { slug: 'terraria-tshock', game: 'terraria',  variant: 'tshock',     ctype: 'game', templateVmid: 212, defBridge: 'vmbr3' },
  ]

  for (const t of templates) {
    await prisma.containerTemplate.upsert({
      where: { slug: t.slug },
      update: {
        templateVmid: t.templateVmid,
        game: t.game, variant: t.variant, ctype: t.ctype,
        resources: { memory: 2048, disk: 20, cpu: 2 },
        network: { bridge: t.defBridge },
      },
      create: {
        slug: t.slug, game: t.game, variant: t.variant, ctype: t.ctype,
        templateVmid: t.templateVmid,
        resources: { memory: 2048, disk: 20, cpu: 2 },
        network: { bridge: t.defBridge },
      }
    })
  }
  console.log('ContainerTemplate upsert complete.')
}

async function seedHostSlots({ game, variant, base, count, label, edgeIp = null }) {
  const rows = []
  for (let slot = 0; slot < count; slot++) {
    const port = base + slot
    const hostname = `${label}-${pad4(slot)}.zpack.zerolaghub.com`
    rows.push({
      game, variant, slot, basePort: base, port, hostname, edgeIp, status: 'free'
    })
  }
  // Insert in chunks to avoid packet size limits
  const CHUNK = 1000
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.hostSlot.createMany({ data: rows.slice(i, i + CHUNK), skipDuplicates: true })
  }
}

async function upsertHostSlots() {
  // Minecraft Vanilla: 1000 slots (50000–50999) label "mcv"
  await seedHostSlots({ game: 'minecraft', variant: 'vanilla', base: 50000, count: 1000, label: 'mcv' })

  // Minecraft Paper: 1000 slots (51000–51999) label "mcp"
  await seedHostSlots({ game: 'minecraft', variant: 'paper', base: 51000, count: 1000, label: 'mcp' })

  // You can add others when ready; leaving commented to keep IP budget simple for now:
  // await seedHostSlots({ game: 'rust', variant: 'vanilla', base: 52000, count: 1000, label: 'rst' })
  // await seedHostSlots({ game: 'pz', variant: 'vanilla', base: 53000, count: 500, label: 'pz' })
  // await seedHostSlots({ game: 'valheim', variant: 'vanilla', base: 54000, count: 500, label: 'val' })
  // await seedHostSlots({ game: 'valheim', variant: 'plus', base: 54500, count: 250, label: 'valp' })
  // await seedHostSlots({ game: 'valheim', variant: 'bepinex', base: 54750, count: 250, label: 'valb' })
  // await seedHostSlots({ game: 'terraria', variant: 'tmod', base: 55000, count: 500, label: 'tmod' })
  // await seedHostSlots({ game: 'terraria', variant: 'tshock', base: 55500, count: 500, label: 'tshock' })

  console.log('HostSlot seed complete.')
}

async function main() {
  await upsertTemplates()
  await upsertHostSlots()
}

main()
  .then(() => console.log('Seed complete.'))
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => prisma.$disconnect())
