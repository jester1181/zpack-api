/* ======================================================
   SERVERS ROUTE
   ====================================================== */

import express from "express";
import requireAuth from "../middleware/requireAuth.js";
import prisma from "../services/prisma.js";
import { mergeLiveStatus } from "../services/liveState.js";
import proxmoxClient from "../services/proxmoxClient.js";

// If you are on Node 18+ and using global fetch, this import is optional
import fetch from "node-fetch";

const router = express.Router();

/* ======================================================
   LIST SERVERS (READ-ONLY)
   ====================================================== */

router.get("/", requireAuth, async (req, res, next) => {
  try {
    // ✅ THIS LINE WAS MISSING
const customerId = req.user.customerId;

const instances = await prisma.containerInstance.findMany({
  where: {
    customerId,
  },
  orderBy: {
    createdAt: "asc",
  },
});

    const servers = await mergeLiveStatus(instances);
    res.json({ servers });
  } catch (err) {
    next(err);
  }
});
/* ======================================================
   GAME SERVER CONTROL – START
   ====================================================== */

router.post("/:id/game/start", requireAuth, async (req, res, next) => {
  try {
    const vmid = Number(req.params.id);
    const userId = req.user.id;

    const server = await prisma.containerInstance.findFirst({
      where: {
        vmid,
        customerId: userId,
      },
    });

    if (!server) {
      return res.sendStatus(404);
    }

    if (!server.ip) {
      return res.status(400).json({
        error: "Server does not have an IP address yet",
      });
    }

    const agentUrl = `http://${server.ip}:18888/start`;

    const r = await fetch(agentUrl, { method: "POST" });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(500).json({
        error: "Agent start failed",
        detail,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ======================================================
   GAME SERVER CONTROL – STOP
   ====================================================== */

router.post("/:id/game/stop", requireAuth, async (req, res, next) => {
  try {
    const vmid = Number(req.params.id);
    const userId = req.user.id;

    const server = await prisma.containerInstance.findFirst({
      where: {
        vmid,
        customerId: userId,
      },
    });

    if (!server) {
      return res.sendStatus(404);
    }

    if (!server.ip) {
      return res.status(400).json({
        error: "Server does not have an IP address yet",
      });
    }

    const agentUrl = `http://${server.ip}:18888/stop`;

    const r = await fetch(agentUrl, { method: "POST" });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(500).json({
        error: "Agent stop failed",
        detail,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ======================================================
   GAME SERVER CONTROL – RESTART
   ====================================================== */

router.post("/:id/game/restart", requireAuth, async (req, res, next) => {
  try {
    const vmid = Number(req.params.id);
    const userId = req.user.id;

    const server = await prisma.containerInstance.findFirst({
      where: {
        vmid,
        customerId: userId,
      },
    });

    if (!server) {
      return res.sendStatus(404);
    }

    if (!server.ip) {
      return res.status(400).json({
        error: "Server does not have an IP address yet",
      });
    }

    const agentUrl = `http://${server.ip}:18888/restart`;

    const r = await fetch(agentUrl, { method: "POST" });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(500).json({
        error: "Agent restart failed",
        detail,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ======================================================
   Host (Container) Controls
   ====================================================== */

/* ======================================================
   HOST CONTROL – STOP
   ====================================================== */

router.post("/:id/host/stop", requireAuth, async (req, res, next) => {
  try {
    const vmid = Number(req.params.id);
    if (!Number.isInteger(vmid)) {
      return res.status(400).json({ error: "Invalid VMID" });
    }

    await proxmoxClient.shutdownContainer(vmid, { timeout: 60 });

    res.json({
      success: true,
      message: "Host stopped",
    });
  } catch (err) {
    next(err);
  }
});

/* ======================================================
   HOST CONTROL – START
   ====================================================== */

router.post("/:id/host/start", requireAuth, async (req, res, next) => {
  try {
    const vmid = Number(req.params.id);
    if (!Number.isInteger(vmid)) {
      return res.status(400).json({ error: "Invalid VMID" });
    }

    await proxmoxClient.startWithRetry(vmid);

    res.json({
      success: true,
      message: "Host started",
    });
  } catch (err) {
    next(err);
  }
});

/* ======================================================
   HOST CONTROL – RESTART
   ====================================================== */

router.post("/:id/host/restart", requireAuth, async (req, res, next) => {
  try {
    const vmid = Number(req.params.id);
    if (!Number.isInteger(vmid)) {
      return res.status(400).json({ error: "Invalid VMID" });
    }

    await proxmoxClient.shutdownContainer(vmid, { timeout: 60 });
    await proxmoxClient.startWithRetry(vmid);

    res.json({
      success: true,
      message: "Host restarted",
    });
  } catch (err) {
    next(err);
  }
});




/* ======================================================
   EXPORT ROUTER
   ====================================================== */

export default router;
