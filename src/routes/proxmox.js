// /src/routes/proxmox.js
import { Router } from 'express'
import proxmox from '../services/proxmoxClient.js'
const router = Router()

router.get('/ping', async (_req, res) => {
  try {
    const data = await proxmox.ping()
    res.json({ ok: true, nodes: data })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

export default router
