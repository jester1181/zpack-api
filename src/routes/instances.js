// src/routes/instances.js
import express from 'express';
import { provisionAgentInstance } from '../api/provisionAgent.js';

const router = express.Router();

/**
 * POST /api/instances
 *
 * Body (v1, agent-driven):
 *   {
 *     customerId: "u001",
 *     game: "minecraft",
 *     variant: "paper",
 *     version: "1.20.1",
 *     world: "world",
 *     ctype: "game",       // or "dev"
 *     name: "my-first-server",
 *     cpuCores: 2,
 *     memoryMiB: 2048,
 *     diskGiB: 10,
 *     portsNeeded: 0,      // non-MC games only
 *     artifactPath: "...", // optional
 *     javaPath: "..."      // optional
 *   }
 */
router.post('/', async (req, res, next) => {
  try {
    const result = await provisionAgentInstance(req.body);
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
});

export default router;
