// One-off, 2026-09-21. Takes the Baseline and Forecast buttons off the WBS
// table and renames Edit, following the merge into one Edit activity
// (scripts/wbs-one-edit.ts). A page naming an activity that no longer exists
// fails at the click, and `validatePage` would refuse the page on its next
// save — so the page has to move with the model.
//
// Idempotent. Pass --dry to print.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { listPages, putPage } from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const PATH = 'pages/project';
const GONE = ['act_baseline_wbs_nodes', 'act_forecast_wbs_nodes'];
const dry = process.argv.includes('--dry');

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const page = (await listPages(db, SOLUTION)).find((p) => p.path === PATH);
if (!page) throw new Error(`${PATH} not found`);
const def = structuredClone(page.def) as {
  slotConfigs?: Record<string, { staticConfig?: { columns?: { label?: string; target?: string }[] } }>;
};

const wbs = def.slotConfigs?.['slot-wbs'];
if (!wbs?.staticConfig?.columns) throw new Error('slot-wbs has no columns');

const before = wbs.staticConfig.columns.length;
wbs.staticConfig.columns = wbs.staticConfig.columns.filter((c) => !GONE.includes(c.target ?? ''));
for (const col of wbs.staticConfig.columns) {
  if (col.target === 'act_modify_wbs_nodes') col.label = 'Edit';
}
console.log(`slot-wbs   ~ ${before} columns → ${wbs.staticConfig.columns.length} (Baseline, Forecast removed)`);

if (!dry) {
  await putPage(db, SOLUTION, PATH, def as never);
  console.log('\npage saved as a DRAFT — publish it in the Console for the Runtime app to see it.');
}
await closeDb(db);
