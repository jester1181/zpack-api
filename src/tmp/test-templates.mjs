import prisma from '../services/prisma.js';

// adjust relative paths: tmp → services (one level up)
import { getTemplateOrThrow } from '../services/templateResolver.js';
import { resolveTemplate } from '../services/templateService.js';
const p = new PrismaClient();

function okRange(vmid) {
  return typeof vmid === 'number' && vmid >= 900 && vmid <= 925;
}

async function runOnce(label, fn) {
  try {
    const tpl = await fn();
    console.log(`✅ ${label}`, {
      slug: tpl.slug ?? tpl?.slug,
      vmid: tpl.templateVmid ?? tpl?.templateVmid,
    });
    if (!okRange(tpl.templateVmid ?? tpl?.templateVmid)) {
      console.error('⚠ vmid out of expected template range (900–925)');
      process.exitCode = 2;
    }
  } catch (e) {
    console.error(`❌ ${label}`, e?.message || e);
    process.exitCode = 1;
  }
}

(async () => {
  await runOnce('resolver by slug', () => getTemplateOrThrow({ templateSlug: 'mc-vanilla' }));
  await runOnce('resolver by (game,variant)', () => getTemplateOrThrow({ game: 'minecraft', variant: 'vanilla' }));
  await runOnce('service wrapper by slug', () => resolveTemplate({ templateSlug: 'mc-vanilla' }));
  await runOnce('service wrapper by (game,variant)', () => resolveTemplate({ game: 'minecraft', variant: 'vanilla' }));
  await p.$disconnect();
})();
