// src/queues/postProvision.js
// Post-provision edge publish queue (BullMQ v4+). Worker commits/rolls back.
// Self-heals missing ctIp/ports by querying DB/Proxmox.
// Server startup is now handled by the agent (not here).

import pkg from 'bullmq';
import IORedis from 'ioredis';
import prisma from '../services/prisma.js';
import proxmox from '../services/proxmoxClient.js';
import { PortAllocationService } from '../services/portAllocator.js';
import edgePublisher from '../services/edgePublisher.js';

const { Queue, Worker, QueueEvents } = pkg;

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

const QUEUE_NAME = 'post-provision';
const queue = new Queue(QUEUE_NAME, { connection });

// ---------------------------------------------------------------------------
// Queue events
// ---------------------------------------------------------------------------
const events = new QueueEvents(QUEUE_NAME, { connection });
events.on('completed', ({ jobId, returnvalue }) => {
  try {
    console.log(
      `[postProvision] job ${jobId} completed`,
      typeof returnvalue === 'string' ? JSON.parse(returnvalue) : returnvalue
    );
  } catch {}
});
events.on('failed', ({ jobId, failedReason }) => {
  console.warn(`[postProvision] job ${jobId} failed:`, failedReason);
});

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------
export async function enqueuePublishEdge(payload) {
  // payload: { vmid, slotHostname, instanceHostname, ports, ctIp, game }
  const opts = {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  };
  return queue.add('publish', payload, opts);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Best-effort fetch of CT IPv4 if not provided. */
async function resolveCtIp({ vmid, hintIp }) {
  if (hintIp) return hintIp;

  // Try pulling from DB
  const inst = await prisma.containerInstance.findUnique({
    where: { vmid: Number(vmid) },
    select: { ip: true },
  });
  if (inst?.ip) return inst.ip;

  // Try inspecting the container directly
  try {
    const cmd = `ip -4 -o addr show dev eth0 | awk '{print $4}' | cut -d/ -f1 | head -n1`;
    const out = await proxmox.execInContainer(vmid, cmd);
    const ip = String(out || '').trim();
    if (ip) return ip;
  } catch {}

  return null;
}

/** Resolve public ports for publishing DNS/Velocity. */
async function resolvePublicPorts({ vmid, hintPorts }) {
  // If the job already provided ports, trust them
  if (Array.isArray(hintPorts) && hintPorts.length) return hintPorts;

  // Pull from DB (new schema uses allocatedPorts JSON: { game: [xxxx] })
  const inst = await prisma.containerInstance.findUnique({
    where: { vmid: Number(vmid) },
    select: { allocatedPorts: true },
  });

  if (inst?.allocatedPorts && typeof inst.allocatedPorts === 'object') {
    const gamePorts = inst.allocatedPorts.game;
    if (Array.isArray(gamePorts) && gamePorts.length) {
      return gamePorts;
    }
  }

  // As last resort: no ports found
  return [];
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { vmid, ports = [], ctIp, slotHostname, game } = job.data || {};
    if (!vmid) throw new Error('invalid job payload: missing vmid');

    // ----------------------------
    // 1. Resolve ports + container IP
    // ----------------------------
    const resolvedPorts = await resolvePublicPorts({
      vmid,
      hintPorts: ports,
    });

    const ip = await resolveCtIp({
      vmid,
      hintIp: ctIp,
    });

    if (!resolvedPorts.length)
      throw new Error('invalid job payload: cannot resolve port(s)');
    if (!ip)
      throw new Error('invalid job payload: cannot resolve CT IP');

    // ----------------------------
    // 2. Publish DNS + Velocity
    // ----------------------------
    await edgePublisher.publishEdge({
      vmid,
      ports: resolvedPorts,
      ip,
      slotHostname,
      game,
    });

    // ----------------------------
    // 3. Commit port allocations
    // ----------------------------
    await PortAllocationService.commit({
      vmid,
      ports: resolvedPorts,
      portType: 'game',
    });

    // ----------------------------
    // 4. Return worker result
    // ----------------------------
    return {
      vmid,
      ports: resolvedPorts,
      ip,
      dns: true,
    };
  },
  { connection }
);

// ---------------------------------------------------------------------------
// Failure Handler
// ---------------------------------------------------------------------------
worker.on('failed', async (job, err) => {
  console.warn(`[postProvision] job ${job?.id} failed:`, err?.message || err);
});

export default { enqueuePublishEdge };
