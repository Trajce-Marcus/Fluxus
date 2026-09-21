// One-off, 2026-09-22. Gives the projects list its create button.
//
// The page already wired `onNew` to `act_create_projects`; what it lacked was a
// label. `newLabel` blank is RecordList's documented way of saying "no create
// button" — the control is drawn from the label, not from whether a callback
// happens to be attached (VISIBILITY_IS_NOT_WIRING) — so the list had a create
// path nobody could reach.
//
// Idempotent. Pass --dry to print.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { listPages, putPage } from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const PATH = 'pages/projects';
const LABEL = 'New project';
const dry = process.argv.includes('--dry');

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const page = (await listPages(db, SOLUTION)).find((p) => p.path === PATH);
if (!page) throw new Error(`${PATH} not found`);
const def = structuredClone(page.def) as {
  slotConfigs?: Record<string, { staticConfig?: Record<string, unknown>; callbacks?: Record<string, string> }>;
};

const list = def.slotConfigs?.['slot-main'];
if (!list?.staticConfig) throw new Error('slot-main has no staticConfig');
if (!list.callbacks?.onNew) throw new Error('slot-main has no onNew callback — nothing for the button to do');

console.log(`slot-main  ~ newLabel ${JSON.stringify(list.staticConfig.newLabel)} → ${JSON.stringify(LABEL)}`);
console.log(`           onNew: ${list.callbacks.onNew}`);
list.staticConfig.newLabel = LABEL;

if (!dry) {
  await putPage(db, SOLUTION, PATH, def as never);
  console.log('\npage saved as a DRAFT — publish it in the Console for the Runtime app to see it.');
}
await closeDb(db);
