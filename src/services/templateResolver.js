// src/services/templateResolver.js
import prisma from './prisma.js';

/**
 * Resolve a template by slug (preferred) or by (game, variant).
 * Throws with clear messages if Prisma is mis-generated or the row is missing.
 */
export async function getTemplateOrThrow({ templateSlug, game, variant }) {
  // Guard: ensure the Prisma delegate exists
  if (!prisma?.containerTemplate) {
    throw new Error(
      "[templateResolver] prisma.containerTemplate is missing. " +
      "Run `npx prisma generate` and ensure model `ContainerTemplate` exists."
    );
  }

  // Build where clause
  const where =
    templateSlug ? { slug: templateSlug } :
    (game && variant ? { game, variant } : null);

  if (!where) {
    const err = new Error('templateSlug is required (or provide game+variant)');
    err.httpCode = 400;
    throw err;
  }

  // Query
  const tpl = templateSlug
    ? await prisma.containerTemplate.findUnique({ where })
    : await prisma.containerTemplate.findFirst({ where });

  if (!tpl) {
    throw new Error(`Template not found for ${JSON.stringify(where)}`);
  }

  // Sanity: your golden templates live at 900–925
  if (tpl.templateVmid < 900 || tpl.templateVmid > 925) {
    throw new Error(
      `[templateResolver] Unexpected templateVmid ${tpl.templateVmid} for slug ${tpl.slug}`
    );
  }

  return tpl;
}

// Optional default export (same function) to support both import styles
export default { getTemplateOrThrow };
