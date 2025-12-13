// src/routes/ports.js
// Slot/port management for FE/ops.

import express from 'express';
import crypto from 'node:crypto';
import prisma from '../services/prisma.js';
import { PortAllocationService } from '../services/portAllocator.js';

const router = express.Router();

router.post('/reserve-slot', async (req, res) => {
  try {
    const { customerId, game, variant, vmid = null, purpose = 'game_main' } = req.body || {};
    if (!customerId || !game || !variant) {
      return res.status(400).json({ ok: false, error: 'customerId, game, variant are required' });
    }
    const txnId = crypto.randomUUID();
    const { slotId, port, hostname } = await PortAllocationService.reserveSlotAndPort({
      game, variant, customerId, vmid, purpose, txnId,
    });
    return res.json({ ok: true, txnId, slotId, port, hostname });
  } catch (err) {
    return res.status(err.httpCode || 500).json({ ok: false, error: err.message });
  }
});

router.post('/commit', async (req, res) => {
  try {
    const { txnId, vmid } = req.body || {};
    if (!txnId || !vmid) return res.status(400).json({ ok: false, error: 'txnId and vmid are required' });
    const result = await PortAllocationService.commit({ txnId, vmid: Number(vmid) });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(err.httpCode || 500).json({ ok: false, error: err.message });
  }
});

router.post('/rollback', async (req, res) => {
  try {
    const { txnId } = req.body || {};
    if (!txnId) return res.status(400).json({ ok: false, error: 'txnId is required' });
    const result = await PortAllocationService.rollbackPending({ txnId });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(err.httpCode || 500).json({ ok: false, error: err.message });
  }
});

router.get('/customer/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const ports = await prisma.portPool.findMany({
      where: { customerId, status: 'allocated' },
      orderBy: { port: 'asc' },
      select: { port: true, protocol: true, vmid: true, purpose: true },
    });
    const slots = await prisma.hostSlot.findMany({
      where: { customerId, status: 'allocated' },
      orderBy: { port: 'asc' },
      select: { hostname: true, port: true, vmid: true, purpose: true, game: true, variant: true },
    });
    return res.json({ ok: true, ports, slots });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
