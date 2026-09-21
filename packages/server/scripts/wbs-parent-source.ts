// One-off, 2026-09-21. Sources `wbs_parent` on the WBS create, so the parent is
// never asked for.
//
// One activity serves two launches: "Add child" on a row seeds the parent, and
// "New node" seeds nothing and means a root. The unseeded case was showing a
// parent picker on a form whose answer is "no parent". Sourcing says the value
// is not this person's question either way — the seed still wins where there is
// one, and where there is none the expression yields nothing and the node is a
// root.
//
// Paired with the platform rule changed the same day: a sourced attribute is
// hidden even when its source resolves to nothing (page-runtime SPEC).
//
// Idempotent. Pass --dry to print.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { configCollections, getSolutionConfig, putConfigEntity } from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const dry = process.argv.includes('--dry');

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const config = await getSolutionConfig(db, SOLUTION);
const flow = structuredClone(config.workflows.find((w) => w.id === 'wf_wbs_nodes'));
if (!flow) throw new Error('wf_wbs_nodes not found');
const create = flow.activities.find((a) => a.id === 'act_create_wbs_nodes');
if (!create) throw new Error('act_create_wbs_nodes not found');

create.attributes = create.attributes.map((a) =>
  'attribute_ref' in a && a.attribute_ref === 'wbs_parent' ? { ...a, source: "''" } : a);

console.log("activity   ~ act_create_wbs_nodes  wbs_parent sourced ('' — a root unless seeded)");
if (!dry) await putConfigEntity(db, SOLUTION, configCollections.workflows, flow);
await closeDb(db);
