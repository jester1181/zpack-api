// src/routes/debug.js
import { Router } from 'express';
import { getTemplateOrThrow } from '../services/templateResolver.js';

const r = Router();

r.get('/template', async (req, res, next) => {
  try {
    const { slug, game, variant } = req.query;
    const tpl = await getTemplateOrThrow({
      templateSlug: slug || undefined,
      game: game || undefined,
      variant: variant || undefined,
    });
    res.json({ ok: true, slug: tpl.slug, templateVmid: tpl.templateVmid });
  } catch (e) { next(e); }
});

export default r;
