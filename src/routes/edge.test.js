import express from 'express';
import { publishEdge, unpublishEdge, edgeHealth } from '../services/edgePublisher.js';

const r = express.Router();

r.get('/edge/health', async (_req, res) => {
  const out = await edgeHealth();
  res.status(out.ok ? 200 : 503).json(out);
});

r.post('/edge/publish', async (req, res) => {
  try {
    const result = await publishEdge(req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

r.post('/edge/unpublish', async (req, res) => {
  try {
    const result = await unpublishEdge(req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

export default r;
