import express from 'express';
import { publishEdge, unpublishEdge } from '../services/edgePublisher.js';
import opnsenseClient from '../services/opnsenseClient.js';
import technitiumClient from '../services/technitiumClient.js';

const router = express.Router();

router.get('/health', async (_req, res) => {
  try {
    const opnsense = await opnsenseClient.health();
    const technitium = await technitiumClient.healthDiag();

    res.json({
      ok: opnsense.ok && technitium.ok,
      opnsense: opnsense.ok ? 'reachable' : 'unreachable',
      technitium: technitium.ok ? 'reachable' : 'unreachable',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});


router.post('/publish', async (req, res) => {
  try {
    const out = await publishEdge(req.body);
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/unpublish', async (req, res) => {
  try {
    const out = await unpublishEdge(req.body);
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
