// One-off, 2026-09-14. The WBS gains figures and a lifecycle, per
// `solutions/projects/docs/PROJECT_PROFILE_PAGE.md` §4 and §5.
//
// Four things, in the order the validator needs them (every write validates the
// whole config graph in its own transaction, so a reference must already
// resolve when the thing naming it lands):
//   1. pool attributes for the new captured values;
//   2. fields — seven on `rt_wbs_nodes`, one (`wbs_status`) on `rt_projects`;
//   3. three named functions, which is how a total is computed at all: the
//      query chain has no `sum`, and a function is the scripts tier, so it can
//      loop (DSL_SPEC §8, and §3.5 of the page spec);
//   4. the activities — two new ones on the WBS, three project transitions, the
//      gates on the rest, and the GETs widened.
//
// The gates read `wbs_status <> 'approved'` rather than `= 'draft'` on purpose:
// equality in this language is total (null = null is true), so a project row
// that predates the field — every one of them — reads as not approved without
// a single record being touched.
//
// Idempotent: every write is an upsert of the whole entity, so a second run
// lands the same config. Nothing here writes a record. Pass --dry to print.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { configCollections, getSolutionConfig, putConfigEntity } from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const dry = process.argv.includes('--dry');

// ── 1. attributes ────────────────────────────────────────────────────────────
// `target_start` / `target_completion` already exist in the pool (the project
// uses them) and are reused rather than a second near-identical pair invented.
// `actual_cost` and `wbs_status` get no attribute: nothing captures them — one
// waits on a ledger, the other is set by the approve activity's hook.

const ATTRIBUTES = [
  { key: 'baseline_budget',     type: 'decimal',  label: 'Baseline budget',     description: 'The approved cost for this node. Leaf nodes only.' },
  { key: 'forecast_cost',       type: 'decimal',  label: 'Forecast cost',       description: 'The live cost projection for this node. Leaf nodes only.' },
  { key: 'forecast_start',      type: 'datetime', label: 'Forecast start',      description: 'The live start projection. Leaf nodes only.' },
  { key: 'forecast_completion', type: 'datetime', label: 'Forecast completion', description: 'The live completion projection. Leaf nodes only.' },
];

// ── 2. fields ────────────────────────────────────────────────────────────────

const WBS_FIELDS = [
  { key: 'baseline_budget',     type: 'decimal',  label: 'Baseline budget',     default: '' },
  { key: 'target_start',        type: 'datetime', label: 'Target start',        default: '' },
  { key: 'target_completion',   type: 'datetime', label: 'Target completion',   default: '' },
  { key: 'forecast_cost',       type: 'decimal',  label: 'Forecast cost',       default: '' },
  { key: 'forecast_start',      type: 'datetime', label: 'Forecast start',      default: '' },
  { key: 'forecast_completion', type: 'datetime', label: 'Forecast completion', default: '' },
  // Read-only by omission: no activity captures it, so nothing can write it
  // until a ledger exists to inject it.
  { key: 'actual_cost',         type: 'decimal',  label: 'Actual cost to date', default: '' },
];

const PROJECT_FIELD = {
  key: 'wbs_status', type: 'text', label: 'WBS status', default: 'draft', indexed: true,
};

// ── 3. functions ─────────────────────────────────────────────────────────────
// A blank figure is skipped rather than added: the field's default is '', and
// `'' + 0` is not arithmetic.

const total = (name: string, field: string, type: string) => ({
  id: `fn_${name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`,
  name,
  description: `Adds up ${field} across a project's ${type} nodes. Blank figures are skipped.`,
  body: [
    `function ${name}(project) {`,
    '  let total = 0',
    `  for each n in records.${type}_nodes.where(project_id = project and expired <> 'true') {`,
    `    total = total + iif(n.${field} = '' or n.${field} = null, 0, n.${field})`,
    '  }',
    '  return total',
    '}',
  ].join('\n'),
});

const FUNCTIONS = [
  total('wbsBaselineTotal', 'baseline_budget', 'wbs'),
  total('wbsForecastTotal', 'forecast_cost', 'wbs'),
  total('cbsBudgetTotal', 'budget_cost', 'cbs'),
];

// ── 4. the gates ─────────────────────────────────────────────────────────────

const DRAFT = "context.record.project_id.wbs_status <> 'approved'";
const LEAF = "records.wbs_nodes.where(parent_id = context.record.id and expired <> 'true').count = 0";

const CLEAR_PARENT = [
  "// A node that gains a child stops being a leaf, so it stops being where",
  '// money and dates live. Its figures are cleared, not moved.',
  'for each p in records.wbs_nodes.where(id = attributes.parent_id) {',
  "  p.update({ baseline_budget: '', target_start: '', target_completion: '', forecast_cost: '', forecast_start: '', forecast_completion: '', actual_cost: '' })",
  '}',
].join('\n');

const CREATE_GATE = [
  'for each p in records.projects.where(id = attributes.project_id) {',
  "  if p.wbs_status = 'approved' {",
  "    fail('The WBS for this project is approved — no new nodes.')",
  '  }',
  '}',
].join('\n');

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const config = await getSolutionConfig(db, SOLUTION);
const wbsType = structuredClone(config.recordTypes.find((r) => r.id === 'rt_wbs_nodes'));
const projectType = structuredClone(config.recordTypes.find((r) => r.id === 'rt_projects'));
const wbsFlow = structuredClone(config.workflows.find((w) => w.id === 'wf_wbs_nodes'));
const projectFlow = structuredClone(config.workflows.find((w) => w.id === 'wf_projects'));
const cbsFlow = structuredClone(config.workflows.find((w) => w.id === 'wf_cbs_nodes'));
if (!wbsType || !projectType || !wbsFlow || !projectFlow || !cbsFlow) throw new Error('projects model not found');

// Fields
for (const field of WBS_FIELDS) {
  const at = wbsType.custom_fields.findIndex((f) => f.key === field.key);
  if (at === -1) { console.log(`field      + rt_wbs_nodes.${field.key}`); wbsType.custom_fields.push(field as never); }
  else wbsType.custom_fields[at] = field as never;
}
const pf = projectType.custom_fields.findIndex((f) => f.key === PROJECT_FIELD.key);
if (pf === -1) { console.log(`field      + rt_projects.wbs_status`); projectType.custom_fields.push(PROJECT_FIELD as never); }
else projectType.custom_fields[pf] = PROJECT_FIELD as never;

// Activities — declared whole, then merged in by id so authored order holds.
const attrs = (...keys: string[]) => keys.map((attribute_ref) => ({ attribute_ref }));

const WBS_ACTIVITIES: Record<string, unknown> = {
  act_create_wbs_nodes: {
    id: 'act_create_wbs_nodes', name: 'Create WBS Node', record_map: 'CREATE', sort_order: 0,
    description: 'Adds a node under a phase, or at the root when no parent is given.',
    before_hook: CREATE_GATE, after_hook: CLEAR_PARENT,
    attributes: attrs('project_id', 'parent_id', 'code', 'name', 'description', 'cbs_codes'),
  },
  act_modify_wbs_nodes: {
    id: 'act_modify_wbs_nodes', name: 'Modify WBS Node', record_map: 'UPDATE', sort_order: 1,
    description: "Changes a node's code, name, scope description or CBS mapping.",
    show_condition: DRAFT, before_hook: null, after_hook: null,
    attributes: attrs('code', 'name', 'description', 'cbs_codes'),
  },
  act_baseline_wbs_nodes: {
    id: 'act_baseline_wbs_nodes', name: 'Baseline WBS Node', record_map: 'UPDATE', sort_order: 2,
    description: 'Sets the approved cost and dates for a leaf node. Closed once the WBS is approved.',
    show_condition: `${DRAFT} and ${LEAF}`,
    before_hook: null,
    // The baseline is also the first forecast — a plan with no projection
    // against it reads as a project nobody has looked at yet.
    after_hook: 'context.record.update({ forecast_cost: attributes.baseline_budget, forecast_start: attributes.target_start, forecast_completion: attributes.target_completion })',
    attributes: attrs('baseline_budget', 'target_start', 'target_completion'),
  },
  act_forecast_wbs_nodes: {
    id: 'act_forecast_wbs_nodes', name: 'Forecast WBS Node', record_map: 'UPDATE', sort_order: 3,
    description: 'Updates the live cost and date projection for a leaf node. Stays open after approval.',
    show_condition: LEAF, before_hook: null, after_hook: null,
    attributes: attrs('forecast_cost', 'forecast_start', 'forecast_completion'),
  },
  act_move_wbs_nodes: {
    id: 'act_move_wbs_nodes', name: 'Move WBS Node', record_map: 'UPDATE', sort_order: 4,
    description: 'Re-parents a node within its project.',
    show_condition: DRAFT, before_hook: null, after_hook: null, attributes: attrs('parent_id'),
  },
  act_delete_wbs_nodes: {
    id: 'act_delete_wbs_nodes', name: 'Delete WBS Node', record_map: 'UPDATE', sort_order: 5,
    description: 'Retires a childless node. Delete from the bottom: a node with children is refused.',
    show_condition: `${DRAFT} and ${LEAF}`, before_hook: null, after_hook: null, attributes: attrs('expired'),
  },
  act_list_wbs_nodes: {
    id: 'act_list_wbs_nodes', name: 'List WBS Nodes', record_map: 'GET', sort_order: 6,
    description: "A project's whole WBS, for the table that nests it.",
    returns: "records.wbs_nodes.where(project_id = attributes.project_id and expired <> 'true').orderBy(code)"
      + '.select(id, code, name, description, cbs_codes, parent_id, baseline_budget, target_start, target_completion,'
      + ' forecast_cost, forecast_start, forecast_completion, actual_cost)',
    before_hook: null, after_hook: null, attributes: attrs('project_id'),
  },
  act_total_wbs_baseline: {
    id: 'act_total_wbs_baseline', name: 'Total WBS Baseline', record_map: 'GET', sort_order: 7,
    description: "The sum of a project's baseline budgets.",
    returns: 'wbsBaselineTotal(attributes.project_id)',
    before_hook: null, after_hook: null, attributes: attrs('project_id'),
  },
  act_total_wbs_forecast: {
    id: 'act_total_wbs_forecast', name: 'Total WBS Forecast', record_map: 'GET', sort_order: 8,
    description: "The sum of a project's forecast costs.",
    returns: 'wbsForecastTotal(attributes.project_id)',
    before_hook: null, after_hook: null, attributes: attrs('project_id'),
  },
};

const PROJECT_ACTIVITIES: Record<string, unknown> = {
  act_modify_projects: {
    ...structuredClone(projectFlow.activities.find((a) => a.id === 'act_modify_projects')),
    // Status leaves: a transition is an act with a name in the history, not a
    // free edit of a text box, and it is the only way the Created → Active
    // rule can be enforced at all.
    attributes: attrs('name', 'description', 'client', 'job_type', 'target_start', 'target_completion', 'approved_budget'),
  },
  act_approve_wbs_projects: {
    id: 'act_approve_wbs_projects', name: 'Approve WBS', record_map: 'UPDATE', sort_order: 3,
    description: 'Signs off the work breakdown. The structure and the baseline freeze; forecasts stay open.',
    show_condition: "context.record.wbs_status <> 'approved'",
    before_hook: [
      "if records.wbs_nodes.where(project_id = context.record.id and expired <> 'true').count = 0 {",
      "  fail('This project has no WBS to approve.')",
      '}',
    ].join('\n'),
    after_hook: "context.record.update({ wbs_status: 'approved' })",
    attributes: [],
  },
  act_activate_projects: {
    id: 'act_activate_projects', name: 'Start Project', record_map: 'UPDATE', sort_order: 4,
    description: 'Moves the project into execution. Needs an approved WBS.',
    show_condition: "context.record.status = 'Created' and context.record.wbs_status = 'approved'",
    before_hook: null,
    after_hook: "context.record.update({ status: 'Active' })",
    attributes: [],
  },
  act_complete_projects: {
    id: 'act_complete_projects', name: 'Complete Project', record_map: 'UPDATE', sort_order: 5,
    description: 'Closes the project. Done by hand, when the works are finished.',
    show_condition: "context.record.status = 'Active'",
    before_hook: null,
    after_hook: "context.record.update({ status: 'Completed' })",
    attributes: [],
  },
  act_list_projects: {
    ...structuredClone(projectFlow.activities.find((a) => a.id === 'act_list_projects')),
    returns: 'records.projects.orderBy(project_no).select(id, project_no, name, description, status, wbs_status,'
      + ' client, job_type, target_start, target_completion, approved_budget)',
  },
};

const CBS_ACTIVITIES: Record<string, unknown> = {
  act_total_cbs_nodes: {
    id: 'act_total_cbs_nodes', name: 'Total CBS Budget', record_map: 'GET', sort_order: 5,
    description: "The sum of a project's CBS budgets.",
    returns: 'cbsBudgetTotal(attributes.project_id)',
    before_hook: null, after_hook: null, attributes: attrs('project_id'),
  },
};

const mergeActivities = (flow: { activities: { id: string }[] }, next: Record<string, unknown>) => {
  for (const [id, activity] of Object.entries(next)) {
    const at = flow.activities.findIndex((a) => a.id === id);
    if (at === -1) { console.log(`activity   + ${id}`); flow.activities.push(activity as never); }
    else { console.log(`activity   ~ ${id}`); flow.activities[at] = activity as never; }
  }
};
mergeActivities(wbsFlow as never, WBS_ACTIVITIES);
mergeActivities(projectFlow as never, PROJECT_ACTIVITIES);
mergeActivities(cbsFlow as never, CBS_ACTIVITIES);

if (dry) {
  for (const a of ATTRIBUTES) console.log(`attribute  + ${a.key}`);
  for (const f of FUNCTIONS) console.log(`function   + ${f.name}`);
  await closeDb(db);
  process.exit(0);
}

// ── writing, in dependency order ─────────────────────────────────────────────

for (const attribute of ATTRIBUTES) {
  console.log(`attribute  + ${attribute.key}`);
  await putConfigEntity(db, SOLUTION, configCollections.attributes, attribute);
}

console.log('record types');
await putConfigEntity(db, SOLUTION, configCollections.recordTypes, wbsType);
await putConfigEntity(db, SOLUTION, configCollections.recordTypes, projectType);

// Functions before the activities that call them: a GET naming one is
// validated against the function table the moment it lands.
for (const fn of FUNCTIONS) {
  console.log(`function   + ${fn.name}`);
  await putConfigEntity(db, SOLUTION, configCollections.functions, fn);
}

console.log('workflows');
await putConfigEntity(db, SOLUTION, configCollections.workflows, wbsFlow);
await putConfigEntity(db, SOLUTION, configCollections.workflows, projectFlow);
await putConfigEntity(db, SOLUTION, configCollections.workflows, cbsFlow);

console.log('\nmodel written');
await closeDb(db);
