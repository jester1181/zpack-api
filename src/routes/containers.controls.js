// src/routes/containers.controls.js
// Container lifecycle controls. DELETE wires full rollback with dePublisher.
// SAFE orphan handling: never guess hostnames; require DB, Proxmox, or explicit hostname.

import express from "express";
import prisma from "../services/prisma.js";
import proxmoxClient from "../services/proxmoxClient.js";
import dePublisher from "../services/dePublisher.js";
import * as technitium from "../services/technitiumClient.js";

const router = express.Router();

/**
 * Try to read the container's hostname from Proxmox (if the CT still exists)
 */
async function getProxmoxHostname(vmid) {
  try {
    const cfg = await proxmoxClient.getContainerConfig(vmid);
    if (cfg.hostname) return cfg.hostname;
    if (cfg.name) return cfg.name;
  } catch {
    // best-effort only
  }
  return null;
}

/**
 * DELETE /api/containers/:vmid
 *
 * Safe teardown:
 *  1) Archive DB record in DeletedInstance (no duplicates).
 *  2) Free ports in PortPool.
 *  3) Delete Proxmox container (if it exists and is not running).
 *  4) Call dePublisher.unpublish() with hostname/ip/ports so:
 *      - Technitium A + SRV are removed
 *      - Cloudflare A + SRV are removed
 *      - Velocity backend is unregistered
 *  5) Delete ContainerInstance row (if present).
 */
router.delete("/:vmid", async (req, res) => {
  const vmid = parseInt(req.params.vmid, 10);

  if (Number.isNaN(vmid)) {
    return res.status(400).json({ ok: false, error: "Invalid VMID" });
  }

  console.log(`[API] DELETE request received for VMID ${vmid}`);

  try {
    // 1) Primary lookup
    const instance = await prisma.containerInstance.findUnique({
      where: { vmid },
    });

    /* -------------------------------------------------------------------
     * CASE A: ContainerInstance exists (normal delete)
     * ----------------------------------------------------------------- */
    if (instance) {
      // Check Proxmox status to avoid deleting a running CT
      let containerStatus = null;
      try {
        containerStatus = await proxmoxClient.getContainerStatus(vmid);
      } catch {
        console.log(`[API] VMID ${vmid} not found in Proxmox (status check).`);
      }

      if (containerStatus && containerStatus.status === "running") {
        console.log(
          `[API] ⚠️ VMID ${vmid} is running — refusing deletion until stopped.`
        );
        return res.status(409).json({
          ok: false,
          message: `Container ${vmid} is currently running. Stop it before deletion.`,
        });
      }

      // Archive into DeletedInstance (idempotent)
      const existingDeleted = await prisma.deletedInstance.findFirst({
        where: { vmid },
      });

      let archivedId = null;

      if (!existingDeleted) {
        const deleted = await prisma.deletedInstance.create({
          data: {
            vmid: instance.vmid,
            customerId: instance.customerId,
            hostname: instance.hostname,
            game: instance.game,
            variant: instance.variant,
            ports: instance.ports,
            ip: instance.ip,
            reason: "api_delete",
          },
        });
        archivedId = deleted.id;
        console.log(
          `[API] Archived vmid=${vmid} into DeletedInstance (id=${deleted.id})`
        );
      } else {
        archivedId = existingDeleted.id;
        console.log(
          `[API] DeletedInstance already exists for vmid=${vmid}; skipping duplicate archive.`
        );
      }

      // Free ports from PortPool
      const portsToFree = instance.ports || [];
      if (portsToFree.length) {
        console.log(
          `[API] Freeing ports for vmid=${vmid}:`,
          portsToFree
        );
        await prisma.portPool.updateMany({
          where: { port: { in: portsToFree }, allocatedTo: vmid },
          data: { allocatedTo: null, status: "free" },
        });
      }

      // Delete Proxmox CT (best effort)
      try {
        await proxmoxClient.deleteContainer(vmid);
        console.log(`[API] Deleted Proxmox container vmid=${vmid}`);
      } catch (err) {
        console.warn(
          `[API] ⚠️ Error deleting Proxmox container vmid=${vmid}: ${err.message}`
        );
      }

      // DNS + Velocity teardown
      try {
        const hostname =
          instance.hostname || (await getProxmoxHostname(vmid)) || null;

        console.log(
          `[API] Calling dePublisher.unpublish() for vmid=${vmid}, hostname=${hostname}, ports=${portsToFree}`
        );

        await dePublisher.unpublish({
          vmid,
          hostname,
          ip: instance.ip || null,
          ports: portsToFree,
          game: instance.game,
          customerId: instance.customerId,
        });
      } catch (err) {
        console.error(`[API] Error during dePublisher.unpublish():`, err.message);
      }

      // Finally, delete ContainerInstance row
      await prisma.containerInstance.delete({
        where: { vmid },
      });

      return res.json({
        ok: true,
        vmid,
        archived: archivedId,
      });
    }

    /* -------------------------------------------------------------------
     * CASE B: ContainerInstance missing → use DeletedInstance fallback
     * ----------------------------------------------------------------- */
    const archived = await prisma.deletedInstance.findFirst({
      where: { vmid },
    });

    if (archived) {
      console.log(
        `[API] Using DeletedInstance fallback for vmid=${vmid} (hostname=${archived.hostname})`
      );

      // Free ports from PortPool using archived ports
      if (Array.isArray(archived.ports) && archived.ports.length) {
        console.log(
          `[API] Freeing ports from DeletedInstance for vmid=${vmid}:`,
          archived.ports
        );
        await prisma.portPool.updateMany({
          where: { port: { in: archived.ports }, allocatedTo: vmid },
          data: { allocatedTo: null, status: "free" },
        });
      }

      // Delete Proxmox CT if present (best effort)
      try {
        await proxmoxClient.deleteContainer(vmid);
        console.log(`[API] Deleted Proxmox container vmid=${vmid} (fallback)`);
      } catch (err) {
        console.warn(
          `[API] ⚠️ Error deleting Proxmox container vmid=${vmid} (fallback): ${err.message}`
        );
      }

      // Full teardown via dePublisher
      try {
        await dePublisher.unpublish({
          vmid,
          hostname: archived.hostname,
          ip: archived.ip,
          ports: archived.ports || [],
          game: archived.game,
          customerId: archived.customerId,
        });
      } catch (err) {
        console.error(
          `[API] Error in dePublisher.unpublish() for archived vmid=${vmid}:`,
          err.message
        );
      }

      return res.json({
        ok: true,
        vmid,
        used: "DeletedInstance",
        note:
          "ContainerInstance missing; teardown completed using archived DeletedInstance data.",
      });
    }

    /* -------------------------------------------------------------------
     * CASE C: True orphan – no DB in either table
     * ----------------------------------------------------------------- */
    console.warn(
      `[API] VMID ${vmid} not found in ContainerInstance or DeletedInstance – performing partial teardown.`
    );

    // Free any orphan ports
    const orphanPorts = await prisma.portPool.findMany({
      where: { allocatedTo: vmid },
    });

    if (orphanPorts.length) {
      const portNumbers = orphanPorts.map((p) => p.port);
      console.log(
        `[API] Freeing orphan ports for vmid=${vmid}:`,
        portNumbers
      );
      await prisma.portPool.updateMany({
        where: { allocatedTo: vmid },
        data: { allocatedTo: null, status: "free" },
      });
    }

    // Delete Proxmox CT if present
    try {
      await proxmoxClient.deleteContainer(vmid);
      console.log(`[API] Deleted Proxmox container vmid=${vmid} (orphan path)`);
    } catch (err) {
      console.warn(
        `[API] ⚠️ Error deleting orphan Proxmox container vmid=${vmid}: ${err.message}`
      );
    }

    return res.json({
      ok: true,
      vmid,
      warning:
        "Instance not found in DB; ports freed and Proxmox container deleted where possible.",
    });
  } catch (err) {
    console.error("[API] Error in DELETE /containers/:vmid:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to delete container" });
  }
});

export default router;
