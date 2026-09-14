// One-off, 2026-09-14. Puts padding on the panels of the two pages that were
// relying on their component's own.
//
// A component's root no longer carries outer padding (ruled today, written up
// in `manifest.ts`): the container owns layout, the component owns content.
// The css ships with the code rather than with the page, so the moment that
// lands, `pages/projects` and `pages/cbs` draw their tables flush against the
// edge until their panels say otherwise. This says otherwise.
//
// Only panels that hold a component are touched, and only those with no padding
// of their own — a panel someone deliberately set is left exactly as it is.
// Drafts only; both pages need republishing afterwards. Pass --dry to print.

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { pages } from '../src/db/schema';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const PATHS = ['pages/projects', 'pages/cbs'];
const PAD = { top: 12, right: 16, bottom: 12, left: 16 };
const dry = process.argv.includes('--dry');

interface Node { id: string; padding?: unknown; children?: Node[] }

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

for (const path of PATHS) {
  const row = (await db.select().from(pages).where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, path))))[0];
  if (!row) { console.log(`${path}: not found`); continue; }

  const def = structuredClone(row.def) as { layout?: { root: Node }; slotConfigs?: Record<string, unknown> };
  const filled = new Set(Object.keys(def.slotConfigs ?? {}));
  let changed = 0;

  const walk = (panel: Node) => {
    const holdsComponent = (panel.children?.length ?? 0) === 0 && filled.has(panel.id);
    if (holdsComponent && !panel.padding) {
      panel.padding = PAD;
      changed += 1;
      console.log(`${path.padEnd(16)} ${panel.id} + padding`);
    }
    for (const child of panel.children ?? []) walk(child);
  };
  if (def.layout) walk(def.layout.root);

  if (changed === 0) { console.log(`${path}: nothing to change`); continue; }
  if (!dry) {
    await db.update(pages).set({ def, updatedAt: new Date() })
      .where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, path)));
    console.log(`${path}: written (draft — republish it)`);
  }
}

await closeDb(db);
