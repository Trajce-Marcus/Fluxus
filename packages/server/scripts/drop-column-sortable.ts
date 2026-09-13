// One-off, 2026-09-13. Strips the retired `sortable` key from stored columns.
//
// Sorting stopped being a per-column setting and became one property on the
// table. Columns written through the page builder before that carry
// `"sortable": false`, which the table now ignores — but a dead key in a stored
// def is a thing the next reader has to work out is dead, so it goes.
//
// Drafts only. The published versions are left exactly as they are: a page
// becomes live by being published, never by a script reaching past it.
// Pass --dry to print only.

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { pages } from '../src/db/schema';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const dry = process.argv.includes('--dry');
const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

interface Slot { componentName?: string; staticConfig?: Record<string, unknown> }

let changed = 0;
for (const row of await db.select().from(pages)) {
  const def = structuredClone(row.def) as { slotConfigs?: Record<string, Slot> };
  let touched = 0;

  for (const [slotId, slot] of Object.entries(def.slotConfigs ?? {})) {
    if (slot?.componentName !== 'RecordList' && slot?.componentName !== 'RecordTree') continue;
    const columns = slot.staticConfig?.columns;
    if (!Array.isArray(columns)) continue;
    for (const column of columns as Record<string, unknown>[]) {
      if (!('sortable' in column)) continue;
      console.log(`${row.solutionId} · ${row.path} · ${slotId}: ${String(column.key ?? column.label)} — dropping sortable=${JSON.stringify(column.sortable)}`);
      delete column.sortable;
      touched++;
    }
  }

  if (touched > 0 && !dry) {
    await db.update(pages).set({ def }).where(and(eq(pages.solutionId, row.solutionId), eq(pages.path, row.path)));
    changed += touched;
  }
}

console.log(dry ? '\nnothing written' : `\n${changed} column(s) cleaned — publish the page for the Runtime to see it`);
await closeDb(db);
