// src/services/templateService.js
// Thin wrapper over templateResolver to keep old imports working.
// Prefer importing getTemplateOrThrow directly from templateResolver.

import { getTemplateOrThrow } from './templateResolver.js';

/**
 * New API (preferred):
 *   resolveTemplate({ templateSlug, game, variant })
 *
 * Back-compat:
 *   resolveTemplate(game, variant, ctype)  // ctype is ignored for slug lookup
 */
export async function resolveTemplate(a, b, c) {
  // Back-compat detection: (game, variant, ctype)
  if (typeof a === 'string' && typeof b === 'string') {
    const game = a;
    const variant = b;
    // NOTE: ctype is intentionally ignored for slug resolution.
    const tpl = await getTemplateOrThrow({ game, variant });
    return normalizeTemplate(tpl);
  }

  // Preferred object form: { templateSlug, game, variant }
  const { templateSlug, game, variant } = (a || {});
  const tpl = await getTemplateOrThrow({ templateSlug, game, variant });
  return normalizeTemplate(tpl);
}

function normalizeTemplate(tpl) {
  return {
    slug: tpl.slug,
    ctype: tpl.ctype,
    game: tpl.game,
    variant: tpl.variant,
    templateVmid: tpl.templateVmid,
    resources: tpl.resources ?? {},
    network: tpl.network ?? {},
    files: tpl.files ?? {},
    startup: Array.isArray(tpl.startup) ? tpl.startup : [],
  };
}

export default { resolveTemplate };
