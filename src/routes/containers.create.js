import { Router } from 'express';
import { createContainer } from '../api/provision.js';

const router = Router();

// POST /api/containers/create  (relative path: /create)
router.post('/', async (req, res) => {
  try {
    const instance = await createContainer(req.body, req.user);
    res.status(201).json({ ok: true, data: instance });
  } catch (err) {
    res.status(err.httpCode || 500).json({ ok: false, error: err.message });
  }
});

export default router;
