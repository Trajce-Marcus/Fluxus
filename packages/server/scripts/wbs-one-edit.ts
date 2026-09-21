// One-off, 2026-09-21. One Edit activity for a WBS node, replacing Modify +
// Baseline + Forecast.
//
// Three activities existed because availability is per activity: baseline and
// forecast fields belong only to a leaf, and approval freezes the baseline
// while leaving the forecast open. Splitting them was how that got said — at
// the cost of three buttons on every row, and a "Baseline" column the author
// had to know meant the budget rather than the dates.
//
// It can be said per attribute instead. An attribute usage carries its own
// `show_condition`, evaluated against the record as the form opens and
// re-checked by `validateSubmission` server-side — so the approval freeze is
// still enforced, not merely undrawn.
//
//   code / name / description / cbs_codes   while the project is unapproved
//   baseline_budget + target dates          leaf, while unapproved
//   forecast_cost + forecast dates          leaf, after approval as well
//
// The activity is offered when a node is a leaf OR the project is unapproved:
// an approved parent has nothing left to edit, and offering a form with every
// field hidden is worse than not offering it.
//
// The baseline's after hook is dropped with it — it copied the baseline into
// the matching forecast fields on the reasoning that a plan with no projection
// reads as unlooked-at. Entering target dates and finding the forecast dates
// silently filled was reported as a bug, and with one form the person can fill
// both in the same act if they mean to.
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

const DRAFT = "context.record.project_id.wbs_status <> 'approved'";
const LEAF = "records.wbs_nodes.where(parent_id = context.record.id and expired <> 'true').count = 0";

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const config = await getSolutionConfig(db, SOLUTION);
const flow = structuredClone(config.workflows.find((w) => w.id === 'wf_wbs_nodes'));
if (!flow) throw new Error('wf_wbs_nodes not found');

const edit = flow.activities.find((a) => a.id === 'act_modify_wbs_nodes');
if (!edit) throw new Error('act_modify_wbs_nodes not found');

edit.name = 'Edit WBS Node';
edit.description = "Everything about a node that can be changed: its identity, its baseline, and its forecast. What is offered depends on the node and on whether the project's WBS is approved.";
edit.show_condition = `${DRAFT} or ${LEAF}`;
edit.after_hook = null;
edit.attributes = [
  { attribute_ref: 'code', show_condition: DRAFT },
  { attribute_ref: 'name', show_condition: DRAFT },
  { attribute_ref: 'description', show_condition: DRAFT },
  { attribute_ref: 'cbs_codes', show_condition: DRAFT },
  { attribute_ref: 'baseline_budget', show_condition: `${DRAFT} and ${LEAF}` },
  { attribute_ref: 'target_start', show_condition: `${DRAFT} and ${LEAF}` },
  { attribute_ref: 'target_completion', show_condition: `${DRAFT} and ${LEAF}` },
  { attribute_ref: 'forecast_cost', show_condition: LEAF },
  { attribute_ref: 'forecast_start', show_condition: LEAF },
  { attribute_ref: 'forecast_completion', show_condition: LEAF },
];

const dropped = ['act_baseline_wbs_nodes', 'act_forecast_wbs_nodes'];
flow.activities = flow.activities.filter((a) => !dropped.includes(a.id));

console.log('activity   ~ act_modify_wbs_nodes  → "Edit WBS Node", 10 attributes, each with its own condition');
for (const id of dropped) console.log(`activity   - ${id}`);

if (!dry) await putConfigEntity(db, SOLUTION, configCollections.workflows, flow);
await closeDb(db);
