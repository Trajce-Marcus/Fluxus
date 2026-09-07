// One-off, 2026-09-08. Converts `pages/projects` (projects) to step 2's row
// actions: the Edit and Cost Breakdown buttons were `onEdit`/`onOpen`
// callbacks with `editLabel`/`openLabel` beside them, and those four
// properties no longer exist on RecordList. Each becomes an unbound action
// column naming the same activity or page, so the page does exactly what it
// did before.
//
// The toolbar's New button is untouched — `newLabel`/`onNew` still stand.
//
// Writes ONE page row. Prints the before and after; pass --dry to print only.

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { pages } from '../src/db/schema';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const PATH = 'pages/projects';
const dry = process.argv.includes('--dry');

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const [row] = await db
  .select()
  .from(pages)
  .where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, PATH)));

if (!row) {
  console.log(`no such page: ${SOLUTION} · ${PATH}`);
  await closeDb(db);
  process.exit(0);
}

interface Column { key?: string; label?: string; component?: string; target?: string }
interface Slot {
  componentName?: string;
  callbacks?: Record<string, string>;
  staticConfig?: Record<string, unknown>;
}
const def = structuredClone(row.def) as { slotConfigs?: Record<string, Slot> };

// The activity a retired callback ran, or the page it opened — read out of the
// script rather than assumed, so a page wired differently is left alone.
const targetOf = (source: string | undefined, fn: string): string | null => {
  const m = source ? new RegExp(`${fn}\\(\\s*'([^']+)'`).exec(source) : null;
  return m ? m[1] : null;
};

let changed = 0;
for (const [slotId, slot] of Object.entries(def.slotConfigs ?? {})) {
  if (slot.componentName !== 'RecordList') continue;
  const config = slot.staticConfig ?? {};
  const columns = Array.isArray(config.columns) ? (config.columns as Column[]) : [];

  const actions: Column[] = [];
  const edit = targetOf(slot.callbacks?.onEdit, 'services\\.activities\\.run');
  if (edit) actions.push({ component: 'RunActivity', label: String(config.editLabel ?? 'Edit'), target: edit });
  const open = targetOf(slot.callbacks?.onOpen, 'services\\.page\\.open');
  if (open) actions.push({ component: 'OpenPage', label: String(config.openLabel ?? 'Open'), target: open });
  if (actions.length === 0) continue;

  console.log(`${slotId} (${slot.componentName})`);
  console.log(`  was: callbacks ${Object.keys(slot.callbacks ?? {}).join(', ')}`);
  console.log(`       ${columns.length} columns, editLabel=${JSON.stringify(config.editLabel)} openLabel=${JSON.stringify(config.openLabel)}`);

  config.columns = [...columns, ...actions];
  delete config.editLabel;
  delete config.openLabel;
  delete slot.callbacks?.onEdit;
  delete slot.callbacks?.onOpen;
  slot.staticConfig = config;

  console.log(`  now: callbacks ${Object.keys(slot.callbacks ?? {}).join(', ') || '(none)'}`);
  console.log(`       ${(config.columns as Column[]).length} columns, last two:`);
  for (const a of actions) console.log(`         ${JSON.stringify(a)}`);
  changed++;
}

if (changed === 0) {
  console.log('nothing to change — no RecordList slot with an onEdit/onOpen callback.');
} else if (dry) {
  console.log(`\n${changed} slot(s) would change. Re-run without --dry to write.`);
} else {
  await db.update(pages).set({ def }).where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, PATH)));
  console.log(`\n${changed} slot(s) written.`);
}

await closeDb(db);
