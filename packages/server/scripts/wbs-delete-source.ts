// One-off, 2026-09-18. Sources `expired` on the WBS delete activity, so Delete
// deletes.
//
// `act_delete_wbs_nodes` is an UPDATE whose one attribute is `expired` — a text
// field holding 'false' or 'true'. Nothing filled it, so the row action opened
// a form with a single text box, and an UPDATE prefills from the record it is
// about: the box arrived holding `false`, and pressing Run wrote false over
// false. Four runs are in the history of the dev data, every one of them
// capturing `{ expired: 'false' }`, and no node ever expired.
//
// The answer was never a question. `source` is a FluxScript expression the form
// evaluates when it opens, and here it reads nothing at all — the value is
// always the same, so the expression is the string literal `'true'`, the same
// spelling the GET filters on (`expired <> 'true'`). A sourced attribute is not
// shown, which leaves this activity with nothing to capture, so the row's
// Delete button skips the form and runs.
//
// **This removes a confirmation step that was never meant as one.** Delete
// becomes one click. What still holds: `show_condition` refuses a node with
// children or a project whose WBS is approved, and the act is reversible — the
// record stays and the flag can go back.
//
// Only this one usage is touched; the rest of the stored model is left exactly
// as it is. In particular `wbs-lifecycle.ts` must NOT be re-run to achieve the
// same thing: it predates `wbs-attributes.ts` and would put the create and move
// activities back onto the pooled `project_id`/`parent_id`, undoing both the
// named field and the sourced project.
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

const del = flow.activities.find((a) => a.id === 'act_delete_wbs_nodes');
if (!del) throw new Error('act_delete_wbs_nodes not found');

del.attributes = [{ attribute_ref: 'expired', source: "'true'" }];

console.log(`activity   ~ act_delete_wbs_nodes  expired ← 'true' (sourced, not asked)`);
if (!dry) await putConfigEntity(db, SOLUTION, configCollections.workflows, flow);
await closeDb(db);
