// src/routes/instances.js
import express from 'express';
import prisma from '../services/prisma.js';
import { provisionAgentInstance } from '../api/provisionAgent.js';

const router = express.Router();

/**
 * GET /api/instances
 * List all instances (no auth yet)
 */
router.get('/', async (req, res, next) => {
  try {
    const rows = await prisma.containerInstance.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json({ ok: true, rows });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/instances
 * Provision a new instance (agent-driven)
 */
router.post('/', async (req, res, next) => {
  try {
    const result = await provisionAgentInstance(req.body);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

export default router;
