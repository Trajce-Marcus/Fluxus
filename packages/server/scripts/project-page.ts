// One-off, 2026-09-14. Writes `projects · pages/project` — the project profile
// page, per `solutions/projects/docs/PROJECT_PROFILE_PAGE.md` §3 — and adds the
// `Open` column that gets to it from the projects list.
//
// Built out of `Text` and `RecordList` alone, plus the two action components
// every page already has. Nothing new; that is the point of the exercise.
//
// **A page written by a script is not validated**, because `validatePage` runs
// in the Console's save path and this reaches past it. So before writing
// anything, the script evaluates every dynamic prop and every `{{ }}` hole
// through the real engine against the real project record, and refuses to write
// if one throws. That is the same evaluator the page will use at render.
//
// Drafts only — `pages.def`. Publishing is a person's act, in the Console.
// Pass --dry to print the def and the evaluation without writing.

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { findActivity, loadOperationHost } from '../src/host';
import { pages } from '../src/db/schema';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const OPERATION = 'projects-dev';
const PROJECT = 'P26-011';
const PATH = 'pages/project';
const ROLES = ['role_project_admin', 'role_project_user'];
const dry = process.argv.includes('--dry');

// ── the pieces ───────────────────────────────────────────────────────────────

const panel = (id: string, size: number, fixed = false, children: unknown[] = [], direction = 'vertical') => ({
  id,
  size: { type: fixed ? 'fixed' : 'flex', value: size },
  children,
  direction,
  background: '#ffffff',
  padding: { top: 4, right: 8, bottom: 4, left: 8 },
});

/** A panel as tall as whatever it holds, and the thing that says how much room
 *  to leave around it.
 *
 *  **Padding lives here now** (ruled 2026-09-14): a component's root carries
 *  none, because a component cannot see the page it is on and should not be
 *  deciding its spacing. Before that rule, three stacked `Text` blocks sat 32px
 *  apart — 1rem below one, 1rem above the next — and no page definition could
 *  take it back. The header stacks tight; the scrolling sections get room to
 *  breathe.
 *
 *  Heights are never stated for the same reason they were wrong before: only
 *  the component knows how tall it is. `minSize` is not used either — the
 *  renderer does not read it (page spec §8-5). */
const auto = (id: string, pad: number, children: unknown[] = []) => ({
  id,
  size: { type: 'auto' },
  children,
  direction: 'vertical',
  background: '#ffffff',
  padding: { top: pad, right: 16, bottom: pad, left: 16 },
});

const text = (body: string, style: string) => ({
  componentName: 'Text',
  staticConfig: { text: body, style, align: 'left', verticalAlign: 'middle' },
  dynamicProps: {},
  callbacks: {},
});

/** A button standing on its own, about the page's project. */
const button = (label: string, target: string, attribute?: string) => ({
  componentName: 'RunActivity',
  staticConfig: { label, target, ...(attribute ? { attribute } : {}) },
  dynamicProps: { record: 'context.record.id' },
  callbacks: {},
});

const action = (label: string, target: string, attribute?: string) =>
  ({ label, component: 'RunActivity', target, ...(attribute ? { attribute } : {}) });

const money = (key: string, label: string) =>
  ({ key, label, type: 'decimal', format: 'C0', currency: 'AUD', width: 120 });
const day = (key: string, label: string) =>
  ({ key, label, type: 'datetime', format: 'dd/MM/yyyy', width: 110 });

// The details table's rows are a literal list, not a query: the page's own
// record is already resolved and carries every field, so asking the server for
// what is in hand would be a round trip for nothing. Each row needs an `id` —
// the table keys on it.
const DETAILS_ROWS = [
  "[ { id: 'client',     property: 'Client',            value: context.record.client },",
  "  { id: 'job_type',   property: 'Job type',          value: context.record.job_type },",
  "  { id: 'status',     property: 'Status',            value: context.record.status },",
  "  { id: 'wbs_status', property: 'WBS',               value: context.record.wbs_status },",
  "  { id: 'start',      property: 'Target start',      value: context.record.target_start },",
  "  { id: 'finish',     property: 'Target completion', value: context.record.target_completion },",
  "  { id: 'budget',     property: 'Approved budget',   value: context.record.approved_budget },",
  "  { id: 'desc',       property: 'Description',       value: context.record.description } ]",
].join('\n');

const slotConfigs: Record<string, unknown> = {
  'slot-title': text('Project {{ context.record.project_no }}', 'title'),
  'slot-subtitle': text('{{ context.record.name }}', 'subheading'),
  'slot-caption': text('{{ context.record.client }} · {{ context.record.job_type }} · {{ context.record.status }}', 'caption'),

  // Not four hand-placed buttons: the model already knows what may be done to
  // this project, and each activity's own `show_condition` decides whether it
  // is offered. So "Start project" appears when the WBS is approved and not
  // before, and nobody keeps the page in step with the workflow.
  'slot-activities': {
    componentName: 'RecordActivities',
    staticConfig: { title: 'Actions', emptyMessage: 'Nothing can be done to this project right now.' },
    dynamicProps: { record: 'context.record.id' },
    callbacks: {},
  },

  'slot-details': {
    componentName: 'RecordList',
    staticConfig: {
      title: 'Details',
      selection: 'none',
      newLabel: '',
      emptyMessage: 'No details.',
      columns: [
        { key: 'property', label: 'Property', width: 180 },
        { key: 'value', label: 'Value' },
      ],
    },
    dynamicProps: { rows: DETAILS_ROWS },
    callbacks: {},
  },

  'slot-cbs': {
    componentName: 'RecordList',
    staticConfig: {
      title: 'Cost Breakdown Structure',
      parentKey: 'parent_id',
      search: true,
      sortable: true,
      columnFilters: true,
      selection: 'one',
      newLabel: '',
      emptyMessage: 'No cost codes yet.',
      columns: [
        { key: 'code', label: 'Code', width: 90 },
        { key: 'name', label: 'Resource category' },
        { key: 'description', label: 'Inclusions & operational scope' },
        money('budget_cost', 'Budget'),
        action('Edit', 'act_modify_cbs_nodes'),
        action('Add child', 'act_create_cbs_nodes', 'parent_id'),
        action('Move', 'act_move_cbs_nodes'),
        action('Delete', 'act_delete_cbs_nodes'),
      ],
    },
    dynamicProps: { rows: "invoke('act_list_cbs_nodes', { project_id: context.record.id })" },
    callbacks: {},
  },
  'slot-cbs-new': button('New code', 'act_create_cbs_nodes', 'project_id'),

  'slot-wbs': {
    componentName: 'RecordList',
    staticConfig: {
      title: 'Work Breakdown Structure',
      parentKey: 'parent_id',
      search: true,
      sortable: true,
      columnFilters: true,
      selection: 'one',
      newLabel: '',
      emptyMessage: 'No WBS yet.',
      columns: [
        { key: 'code', label: 'Code', width: 90 },
        { key: 'name', label: 'Name' },
        { key: 'cbs_codes', label: 'CBS', width: 90 },
        money('baseline_budget', 'Baseline'),
        day('target_start', 'Target start'),
        day('target_completion', 'Target finish'),
        money('forecast_cost', 'Forecast'),
        day('forecast_start', 'Forecast start'),
        day('forecast_completion', 'Forecast finish'),
        money('actual_cost', 'Actual'),
        action('Edit', 'act_modify_wbs_nodes'),
        action('Baseline', 'act_baseline_wbs_nodes'),
        action('Forecast', 'act_forecast_wbs_nodes'),
        action('Add child', 'act_create_wbs_nodes', 'wbs_parent'),
        action('Move', 'act_move_wbs_nodes'),
        action('Delete', 'act_delete_wbs_nodes'),
      ],
    },
    dynamicProps: { rows: "invoke('act_list_wbs_nodes', { project_id: context.record.id })" },
    callbacks: {},
  },
  // No seed: `act_create_wbs_nodes` sources the project itself from
  // `context.page.record.id` (2026-09-15), so the button only has to say which
  // activity to run.
  'slot-wbs-new': button('New node', 'act_create_wbs_nodes'),

  // The totals the spec asks for are NOT here: a decimal field is stored as
  // text and the language has no way to turn text into a number, so no script
  // can add money up today (page spec §8). What stands in its place is the one
  // total that is a stored figure — the contract's own — said as exactly that.
  'slot-cbs-total': text('Approved budget (contract): {{ context.record.approved_budget }}', 'caption'),
};

// The page reads as a document, not as a split screen: a **fixed** title that
// stays put, and a **flex** body that scrolls, holding a stack of **auto**
// panels — each as tall as what is in it. The stack comes to more than the body
// and the body scrolls, once, for the whole page. That is what `auto` was added
// for on 2026-09-14 (layout.ts): `flex` and `fixed` both take their size from
// the space available, so a layout built only from those can never be longer
// than the window, and each table ends up a cramped scroller of its own.
const layout = {
  root: {
    id: 'root',
    size: { type: 'flex', value: 1 },
    direction: 'vertical',
    children: [
      // The header stays put: who this is, and what may be done about it. It is
      // `auto` rather than a fixed height because only the components know how
      // tall they are — see the note on `auto` above. The lines sit close
      // together; the block as a whole is what gets the room.
      auto('panel-header', 0, [
        { ...auto('slot-title', 0), padding: { top: 14, right: 16, bottom: 0, left: 16 } },
        auto('slot-subtitle', 1),
        auto('slot-caption', 1),
        { ...auto('slot-activities', 0), padding: { top: 10, right: 16, bottom: 12, left: 16 } },
      ]),
      // …and everything else scrolls beneath it, as one column.
      {
        ...panel('panel-body', 1, false, [
          auto('slot-details', 10),
          // The create button belongs above its table: it is what you reach for
          // before reading the list, not after it. It cannot be the table's own
          // `newLabel` toolbar button, because that one cannot seed the new
          // node's project — a placed `RunActivity` with `attribute` can.
          auto('slot-wbs-new', 6),
          auto('slot-wbs', 4),
          auto('slot-cbs-new', 10),
          auto('slot-cbs', 4),
          auto('slot-cbs-total', 6),
        ]),
        padding: { top: 0, right: 0, bottom: 16, left: 0 },
        overflow: 'scroll',
      },
    ],
  },
};

const def = {
  access: { open: ROLES },
  record: { type: 'rt_projects', instances: 'many' },
  layout,
  slotConfigs,
  contextSchema: [],
  componentDependencies: [
    { name: 'RecordActivities', version: '1.0.0' },
    { name: 'RecordList', version: '1.0.0' },
    { name: 'RunActivity', version: '1.0.0' },
    { name: 'Text', version: '1.0.0' },
  ],
};

// ── the check: every expression, through the real engine ─────────────────────

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const user = { id: 'script', name: 'page writer', email: null, roles: ['role_project_admin'] };
const host = await loadOperationHost(db, OPERATION, undefined, user);
const anchor = host.adapter.getRecord(PROJECT);
if (!anchor) throw new Error(`${PROJECT} not found`);

const holes = (s: string) => [...s.matchAll(/\{\{([\s\S]*?)\}\}/g)].map((m) => m[1].trim());
let failed = 0;

// `engine.evaluate` is the plain expression door and deliberately has no
// `invoke` — that one is handed to a page's props by the page host, not by the
// engine's own evaluator. So a prop that names a GET is checked by running that
// GET, which is the same trip the page will make.
const named = (source: string) => source.match(/^\s*invoke\('([^']+)'/)?.[1] ?? null;

const evaluate = (where: string, source: string) => {
  try {
    const get = named(source);
    const value = get
      ? host.engine.runQuery(findActivity(host, get)!, { project_id: PROJECT }, anchor).data
      : host.engine.evaluate(source, { anchorRecord: anchor });
    const shown = Array.isArray(value) ? `${value.length} rows` : JSON.stringify(value);
    console.log(`ok    ${where.padEnd(28)} ${String(shown).slice(0, 60)}`);
  } catch (err) {
    console.log(`FAIL  ${where.padEnd(28)} ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
};

for (const [slot, config] of Object.entries(slotConfigs) as [string, {
  dynamicProps?: Record<string, string>; staticConfig?: Record<string, unknown>;
}][]) {
  for (const [prop, source] of Object.entries(config.dynamicProps ?? {})) evaluate(`${slot}.${prop}`, source);
  for (const [key, value] of Object.entries(config.staticConfig ?? {})) {
    if (typeof value !== 'string') continue;
    for (const hole of holes(value)) evaluate(`${slot}.${key} {{}}`, hole);
  }
}

// Every activity a button or an action column names must exist.
const targets = new Set<string>();
for (const config of Object.values(slotConfigs) as { staticConfig?: Record<string, unknown> }[]) {
  const s = config.staticConfig ?? {};
  if (typeof s.target === 'string') targets.add(s.target);
  for (const column of (s.columns as { target?: string }[] ?? [])) if (column.target) targets.add(column.target);
}
for (const id of [...targets].sort()) {
  if (findActivity(host, id)) console.log(`ok    activity                     ${id}`);
  else { console.log(`FAIL  activity                     ${id} does not exist`); failed += 1; }
}

// A seeded attribute has to be one the activity declares, or the run is refused
// at the click — which is how 'act_create_wbs_nodes has no attribute
// project_id' reached the app after the attributes were renamed.
const seeds: { where: string; target: string; attribute: string }[] = [];
for (const [slot, config] of Object.entries(slotConfigs) as [string, { staticConfig?: Record<string, unknown> }][]) {
  const s = config.staticConfig ?? {};
  if (typeof s.target === 'string' && typeof s.attribute === 'string') {
    seeds.push({ where: slot, target: s.target, attribute: s.attribute });
  }
  for (const column of (s.columns as { target?: string; attribute?: string; label?: string }[] ?? [])) {
    if (column.target && column.attribute) {
      seeds.push({ where: `${slot} · ${column.label ?? ''}`, target: column.target, attribute: column.attribute });
    }
  }
}
for (const seed of seeds) {
  const found = findActivity(host, seed.target);
  if (found?.attributes.some((a) => a.key === seed.attribute)) {
    console.log(`ok    seeds                        ${seed.where} → ${seed.attribute}`);
  } else {
    console.log(`FAIL  seeds                        ${seed.where} → '${seed.target}' has no attribute '${seed.attribute}'`);
    failed += 1;
  }
}

if (failed > 0) {
  console.log(`\n${failed} problem${failed === 1 ? '' : 's'} — nothing written`);
  await closeDb(db);
  process.exit(1);
}

if (dry) {
  console.log(`\n${JSON.stringify(def, null, 2).slice(0, 1200)}\n…`);
  await closeDb(db);
  process.exit(0);
}

// ── write: the page, then the way in ─────────────────────────────────────────

await db.insert(pages).values({ solutionId: SOLUTION, path: PATH, def })
  .onConflictDoUpdate({ target: [pages.solutionId, pages.path], set: { def, updatedAt: new Date() } });
console.log(`\npage written  ${PATH}  (draft — publish it in the Console)`);

// The projects list gains one action column: the row is the project, so opening
// it is `?page=pages/project&record=<id>`.
const listRow = (await db.select().from(pages).where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, 'pages/projects'))))[0];
if (listRow) {
  const listDef = structuredClone(listRow.def) as {
    slotConfigs?: Record<string, { staticConfig?: { columns?: { label?: string; component?: string; target?: string }[] } }>;
  };
  const main = listDef.slotConfigs?.['slot-main'];
  const columns = main?.staticConfig?.columns;
  if (columns && !columns.some((c) => c.component === 'OpenPage' && c.target === PATH)) {
    columns.push({ label: 'Open', component: 'OpenPage', target: PATH });
    await db.update(pages).set({ def: listDef, updatedAt: new Date() })
      .where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, 'pages/projects')));
    console.log('page written  pages/projects  + Open column');
  } else {
    console.log('pages/projects already has the Open column');
  }
}

await closeDb(db);
