// One-off, 2026-09-23. Two GET activities `pages/shift-reports` and
// `pages/shift-report` need and the model did not yet have — flagged in the
// build brief for this session rather than found mid-page:
//
// - **`act_list_shift_report_contributions`** — nothing returned the
//   per-work-group-per-date state the Contributions grid draws (SHIFT_REPORTS
//   §8). The grid needs one cell per ordinary report, coloured green only when
//   that report AND every amendment against it are approved — a correlated
//   count that has to go through a named function (§7's own rule: a query
//   written inline inside `select` binds to the wrong row; a function called
//   from `select` receives the outer row correctly). Verified directly against
//   the real evaluator before writing this: a function called from a `select`
//   alias, taking the row's own `id`, sees the right row every time.
// - **`act_list_shift_report_amendments`** — `act_list_shift_reports`
//   deliberately excludes amendments (§6: "amendments are not filings"), so a
//   report has no way to list what was raised against it, which `pages/shift-
//   report` needs ("it lists the amendments raised against it", §8).
//
// Both land on the existing `wf_shift_reports` workflow — appended, not
// replacing anything already there. Everything else §8's pages need already
// exists: rows for Contributions come from `act_list_expected_work_groups`
// reshaped in the page's own dynamic prop (`.select(key: id, ...)` — the
// query chain methods work on any list, not only a live `records.X` query,
// confirmed the same way), and the dashboard's other panels filter/sort the
// existing `act_list_shift_reports` answer the same way. Nothing else is
// added to the model.
//
// Idempotent — the workflow write is a full upsert of the whole entity, and
// this script is safe to re-run: it only appends the two activities if they
// are not already present. Pass --dry to print and write nothing.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { configCollections, getSolutionConfig, putConfigEntity } from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const dry = process.argv.includes('--dry');

const attrs = (...keys: string[]) => keys.map((key) => ({ attribute_ref: key }));

// A report's own amendments are never all approved by default — vacuously
// true when there are none, so an approved report with no amendment against
// it still folds to green on its own.
const AMENDMENTS_ALL_APPROVED = {
  id: 'fn_amendments_all_approved',
  name: 'amendmentsAllApproved',
  description: "Whether every amendment raised against a report is Approved — true when it has none. Folds a day's amendments into that report's Contributions colour (§8): green only when the report and every amendment against it are approved.",
  body: [
    'function amendmentsAllApproved(reportId) {',
    "  return records.shift_reports.where(amended_report_id = reportId and expired <> 'true' and status <> 'Approved').count = 0",
    '}',
  ].join('\n'),
};

const LIST_CONTRIBUTIONS = {
  id: 'act_list_shift_report_contributions', name: 'List Shift Report Contributions', record_map: 'GET', sort_order: 11,
  description: "One cell per ordinary shift report, for the Contributions grid (§8): 'key' is the filing work group, 'date' the report date as plain text, 'state' folds in every amendment against it (approved only when the report and all its amendments are). Amendments are not filings in their own right (§6) and never appear as their own cell — a hole with no ordinary report stays a hole, which is what draws the missing/red state.",
  returns: "records.shift_reports.where(project_id = attributes.project_id and expired <> 'true' and amended_report_id = '').orderBy(report_date)"
    + '.select(id, key: wg_id, date: report_date, report_no, work_hours, status,'
    + " state: iif(status = 'Approved' and amendmentsAllApproved(id), 'approved', 'inflight'))",
  before_hook: null, after_hook: null, attributes: attrs('project_id'),
};

const LIST_AMENDMENTS = {
  id: 'act_list_shift_report_amendments', name: 'List Amendments', record_map: 'GET', sort_order: 12,
  description: "A report's own amendments — act_list_shift_reports deliberately excludes them (§6), so a report has no other way to list what was raised against it (§8).",
  returns: "records.shift_reports.where(amended_report_id = attributes.report_id and expired <> 'true').orderBy(report_no)"
    + '.select(id, report_no, status, site_notes)',
  before_hook: null, after_hook: null, attributes: attrs('report_id'),
};

// ── write ────────────────────────────────────────────────────────────────────

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const config = await getSolutionConfig(db, SOLUTION);
const flow = config.workflows.find((w) => (w as { id: string }).id === 'wf_shift_reports') as
  { id: string; name: string; activities: { id: string }[] } | undefined;
if (!flow) throw new Error('wf_shift_reports not found — run shift-reports-model.ts first');

const already = new Set(flow.activities.map((a) => a.id));
const toAdd = [LIST_CONTRIBUTIONS, LIST_AMENDMENTS].filter((a) => !already.has(a.id));

if (toAdd.length === 0) {
  console.log('both GET activities already present — nothing to do');
  await closeDb(db);
  process.exit(0);
}

for (const a of toAdd) console.log(`activity   + ${a.id}`);
console.log(`function   ${config.functions.some((f) => (f as { id: string }).id === AMENDMENTS_ALL_APPROVED.id) ? '~' : '+'} ${AMENDMENTS_ALL_APPROVED.name}`);

if (dry) {
  await closeDb(db);
  process.exit(0);
}

await putConfigEntity(db, SOLUTION, configCollections.functions, AMENDMENTS_ALL_APPROVED);
await putConfigEntity(db, SOLUTION, configCollections.workflows, {
  ...flow,
  activities: [...flow.activities, ...toAdd],
} as never);

console.log('\nwf_shift_reports updated');
await closeDb(db);
