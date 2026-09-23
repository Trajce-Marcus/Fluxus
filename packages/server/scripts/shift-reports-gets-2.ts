// One-off, 2026-09-23 (same day, second pass). Three more GET activities the
// dashboard needs — found not by re-reading the spec but by running the real
// `validatePage` (the Console's own save-time check) against the pages this
// session wrote: `invoke(...).where(...)`/`.select(...)` chains work fine at
// runtime (the DSL's chain methods are generic over any array — verified
// directly against the evaluator before this build's first GETs landed), but
// the **static validator** only resolves bare field names inside a chain when
// it can see the schema of what is being queried, and an `invoke()` result is
// opaque to it. So `act_list_shift_reports).where(status <> 'Approved')` fails
// validation even though it runs, and three of the dashboard's dynamic props
// were built on it. The fix is what `act_list_work_group_reports` already is
// beside `act_list_shift_reports` — a narrower, purpose-built GET rather than
// a chain on a page — not a redesign, three more of the same shape:
//
// - **`act_list_contribution_rows`** (`wf_work_groups`) — exactly
//   `act_list_expected_work_groups`'s filter, shaped as `{key, label,
//   sublabel}` for the `Contributions` component's `rows` prop (CONTRIBUTIONS
//   §5) instead of reshaped on the page.
// - **`act_list_reports_awaiting_approval`** / **`act_list_recently_approved_reports`**
//   (`wf_shift_reports`) — `act_list_shift_reports`'s own filter, narrowed by
//   status, for the dashboard's two side panels.
//
// Idempotent, appends only. Pass --dry to print and write nothing.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { configCollections, getSolutionConfig, putConfigEntity } from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const dry = process.argv.includes('--dry');

const attrs = (...keys: string[]) => keys.map((key) => ({ attribute_ref: key }));

const LIST_CONTRIBUTION_ROWS = {
  id: 'act_list_contribution_rows', name: 'List Contribution Rows', record_map: 'GET', sort_order: 5,
  description: "act_list_expected_work_groups's own filter (§6: active, no children, Crew/Subcontractor), shaped as key/label/sublabel for the Contributions component's rows prop (§8) — a page cannot reshape an invoke() answer itself (bare field names in a chained .select() do not resolve against an opaque GET result in validatePage, though the same chain runs fine at the DSL evaluator).",
  returns: "records.work_groups.where(project_id = attributes.project_id and expired <> 'true' and active = 'true'"
    + " and (wg_type = 'Crew' or wg_type = 'Subcontractor')"
    + ' and not (id in records.work_groups.values(parent_id))).orderBy(wg_code)'
    + '.select(key: id, label: wg_code, sublabel: manager)',
  before_hook: null, after_hook: null, attributes: attrs('project_id'),
};

const LIST_AWAITING_APPROVAL = {
  id: 'act_list_reports_awaiting_approval', name: 'List Reports Awaiting Approval', record_map: 'GET', sort_order: 13,
  description: "act_list_shift_reports's own filter, narrowed to reports not yet Approved — the dashboard's 'Awaiting Approval' panel (§8), which cannot filter a page-side invoke() answer by status (same validator limit as List Contribution Rows).",
  returns: "records.shift_reports.where(project_id = attributes.project_id and expired <> 'true' and amended_report_id = '' and status <> 'Approved').orderBy(report_date desc)"
    + '.select(id, report_no, report_date, shift, wg_id, work_hours, status)',
  before_hook: null, after_hook: null, attributes: attrs('project_id'),
};

const LIST_RECENTLY_APPROVED = {
  id: 'act_list_recently_approved_reports', name: 'List Recently Approved Reports', record_map: 'GET', sort_order: 14,
  description: "act_list_shift_reports's own filter, narrowed to the ten most recently Approved — the dashboard's 'Recently Approved' panel (§8), same reason as List Reports Awaiting Approval.",
  returns: "records.shift_reports.where(project_id = attributes.project_id and expired <> 'true' and amended_report_id = '' and status = 'Approved').orderBy(report_date desc).top(10)"
    + '.select(id, report_no, report_date, shift, wg_id, work_hours, status)',
  before_hook: null, after_hook: null, attributes: attrs('project_id'),
};

// ── write ────────────────────────────────────────────────────────────────────

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const config = await getSolutionConfig(db, SOLUTION);
const wgFlow = config.workflows.find((w) => (w as { id: string }).id === 'wf_work_groups') as
  { id: string; name: string; activities: { id: string }[] } | undefined;
const srFlow = config.workflows.find((w) => (w as { id: string }).id === 'wf_shift_reports') as
  { id: string; name: string; activities: { id: string }[] } | undefined;
if (!wgFlow || !srFlow) throw new Error('wf_work_groups / wf_shift_reports not found — run shift-reports-model.ts first');

const wgAlready = new Set(wgFlow.activities.map((a) => a.id));
const srAlready = new Set(srFlow.activities.map((a) => a.id));
const wgToAdd = [LIST_CONTRIBUTION_ROWS].filter((a) => !wgAlready.has(a.id));
const srToAdd = [LIST_AWAITING_APPROVAL, LIST_RECENTLY_APPROVED].filter((a) => !srAlready.has(a.id));

if (wgToAdd.length === 0 && srToAdd.length === 0) {
  console.log('all three GET activities already present — nothing to do');
  await closeDb(db);
  process.exit(0);
}

for (const a of [...wgToAdd, ...srToAdd]) console.log(`activity   + ${a.id}`);

if (dry) {
  await closeDb(db);
  process.exit(0);
}

if (wgToAdd.length > 0) {
  await putConfigEntity(db, SOLUTION, configCollections.workflows, { ...wgFlow, activities: [...wgFlow.activities, ...wgToAdd] } as never);
  console.log('wf_work_groups updated');
}
if (srToAdd.length > 0) {
  await putConfigEntity(db, SOLUTION, configCollections.workflows, { ...srFlow, activities: [...srFlow.activities, ...srToAdd] } as never);
  console.log('wf_shift_reports updated');
}

await closeDb(db);
