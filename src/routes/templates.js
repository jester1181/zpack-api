// src/routes/templates.js
import { Router } from 'express';
import prisma from '../services/prisma.js';

const router = Router();

/**
 * GET /api/containers/templates
 * Returns templates for FE selection (read-only).
 */
router.get('/api/containers/templates', async (req, res, next) => {
  try {
    const rows = await prisma.containerTemplate.findMany({
      orderBy: [{ game: 'asc' }, { variant: 'asc' }],
      select: {
        id: true,
        slug: true,
        ctype: true,
        game: true,
        variant: true,
        templateVmid: true,
        resources: true,
        network: true,
        storage: true,
        tags: true,
      },
    });

    const out = rows.map(r => ({
      slug: r.slug,
      ctype: r.ctype,
      game: r.game,
      variant: r.variant,
      templateVmid: r.templateVmid,
      defaultResources: r.resources,
      network: r.network,
      storage: r.storage,
      tags: r.tags,
    }));

    res.json(out);
  } catch (err) {
    next(err);
  }
});

export default router;
