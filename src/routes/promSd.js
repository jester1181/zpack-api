// /src/routes/promSd.js
import { Router } from 'express'
import prisma from '../services/prisma.js';

const router = Router()

function auth(req, res, next) {
  const hdr = req.headers.authorization || ''
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null
  if (!token || token !== process.env.PROM_SD_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  next()
}

// Bridge-driven exporter targets
router.get('/exporters', auth, async (_req, res) => {
  const rows = await prisma.containerInstance.findMany({
    where: { status: { in: ['running'] }, ip: { not: null }, bridge: { not: null } }
  })

  const BRIDGE_EXPORTERS = {
    vmbr2: [{ name: 'node', port: 9100, path: '/metrics' }],
    vmbr3: [{ name: 'node', port: 9100, path: '/metrics' }]
  }

  const groups = []
  for (const r of rows) {
    const exporters = BRIDGE_EXPORTERS[r.bridge] || BRIDGE_EXPORTERS.vmbr3
    for (const ex of exporters) {
      groups.push({
        targets: [`${r.ip}:${ex.port}`],
        labels: {
          job: `zlh_${ex.name}`,
          exporter: ex.name,
          vmid: String(r.vmid),
          customerId: r.customerId,
          ctype: r.ctype,
          game: r.game,
          variant: r.variant,
          bridge: r.bridge,
          __meta_metrics_path: ex.path,
          __meta_scheme: ex.scheme || 'http'
        }
      })
    }
  }

  res.json(groups)
})

export default router   // <-- important
