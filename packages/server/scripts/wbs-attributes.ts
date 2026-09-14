// One-off, 2026-09-15. Puts the WBS create/move activities onto attributes that
// say what they are, so nothing has to be typed by hand and nothing is checked
// against the wrong record type.
//
// Two mechanisms, both new today, both the user's design:
//
//   1. **A reference attribute names the field it fills**, fully qualified —
//      `wbs_parent` → `rt_wbs_nodes.parent_id`. The attribute key is an
//      identity for a captured value, not a pointer to a field; with the key
//      doing both jobs one pooled `parent_id` had to serve the CBS and the WBS
//      and could name only one target, so a WBS parent was checked against cost
//      codes ("Parent: no cbs_nodes record 'WBS 1'"). The target now comes from
//      the named field, so it is stated once and the two cannot disagree.
//
//   2. **An attribute may be sourced rather than asked for** — `wbs_project`
//      takes `context.page.record.id`, the record the page was showing when the
//      button was pressed. A CREATE has no anchor, so this is the only way the
//      project reaches a new node without someone picking it out of a list of
//      eleven. A sourced attribute does not appear in the form.
//
// The CBS keeps the pooled `parent_id` / `project_id` exactly as they are.
// Idempotent. Pass --dry to print.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { configCollections, getSolutionConfig, putConfigEntity } from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const dry = process.argv.includes('--dry');

const ATTRIBUTES = [
  {
    key: 'wbs_parent', type: 'reference', label: 'Parent',
    description: "The node this one sits under. Names the WBS's own parent field, so it is checked against WBS nodes.",
    type_config: { field: 'rt_wbs_nodes.parent_id' },
  },
  {
    key: 'wbs_project', type: 'reference', label: 'Project',
    description: "The project the node belongs to. Sourced from the page, never asked for.",
    type_config: { field: 'rt_wbs_nodes.project_id' },
  },
];

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const config = await getSolutionConfig(db, SOLUTION);
const flow = structuredClone(config.workflows.find((w) => w.id === 'wf_wbs_nodes'));
if (!flow) throw new Error('wf_wbs_nodes not found');

const create = flow.activities.find((a) => a.id === 'act_create_wbs_nodes');
const move = flow.activities.find((a) => a.id === 'act_move_wbs_nodes');
if (!create || !move) throw new Error('WBS activities not found');

// A new node: the project comes from the page, the parent from the row that was
// clicked (blank for a root node), and the rest is typed.
create.attributes = [
  { attribute_ref: 'wbs_project', source: 'context.page.record.id' },
  { attribute_ref: 'wbs_parent' },
  { attribute_ref: 'code' },
  { attribute_ref: 'name' },
  { attribute_ref: 'description' },
  { attribute_ref: 'cbs_codes' },
];
// Moving a node is choosing a new parent — the one case where the picker is the
// question, so it is neither sourced nor seeded.
move.attributes = [{ attribute_ref: 'wbs_parent' }];

// The hooks name attributes, so renaming one rewrites them. Both were written
// against the field keys back when an attribute had to be called after the
// field it filled; that is exactly the coupling these attributes undo.
create.before_hook = [
  "for each p in records.projects.where(id = attributes.wbs_project) {",
  "  if p.wbs_status = 'approved' {",
  "    fail('The WBS for this project is approved — no new nodes.')",
  '  }',
  '}',
].join('\n');
create.after_hook = [
  '// A node that gains a child stops being a leaf, so it stops being where',
  '// money and dates live. Its figures are cleared, not moved.',
  'for each p in records.wbs_nodes.where(id = attributes.wbs_parent) {',
  "  p.update({ baseline_budget: '', target_start: '', target_completion: '', forecast_cost: '', forecast_start: '', forecast_completion: '', actual_cost: '' })",
  '}',
].join('\n');

if (dry) {
  for (const a of ATTRIBUTES) console.log(`attribute  + ${a.key}  → ${a.type_config.field}`);
  console.log(`activity   ~ act_create_wbs_nodes  ${create.attributes.map((a) => a.attribute_ref).join(', ')}`);
  console.log('activity   ~ act_move_wbs_nodes    wbs_parent');
  await closeDb(db);
  process.exit(0);
}

for (const attribute of ATTRIBUTES) {
  console.log(`attribute  + ${attribute.key}  → ${attribute.type_config.field}`);
  await putConfigEntity(db, SOLUTION, configCollections.attributes, attribute);
}
await putConfigEntity(db, SOLUTION, configCollections.workflows, flow);
console.log('\nactivity   ~ act_create_wbs_nodes  project sourced, parent named');
console.log('activity   ~ act_move_wbs_nodes    parent named');
await closeDb(db);
