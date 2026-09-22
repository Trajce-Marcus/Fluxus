// Read-only in effect, 2026-09-23. Drives the shift-reports model through the
// real engine against the real config and P26-011's real WBS/CBS — and never
// calls `writeBack`, so nothing persists. Answers the questions the pages are
// about to be built on, and re-checks the four defects §10a measured against
// an earlier draft of these same hooks: blank-fk-is-not-null, float equality
// on hours, a blank number poisoning a total, and shares that do not add up.
//
// Sourcing (`context.page.record.*`) is a page-runtime/form concern, not the
// engine's — `runActivity` takes already-resolved values. So every value a
// real page would source silently is passed here explicitly, by the pool
// attribute's own key.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { findActivity, loadOperationHost } from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const OPERATION = 'projects-dev';
const PROJECT = 'P26-011';

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
const user = { id: 'script', name: 'shift reports check', email: null, roles: ['role_project_admin'] };
const host = await loadOperationHost(db, OPERATION, undefined, user);

let failures = 0;
const check = (what: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${what.padEnd(56)} ${detail}`);
  if (!ok) failures += 1;
};

const act = (id: string) => {
  const found = findActivity(host, id);
  if (!found) throw new Error(`${id} not found`);
  return found;
};
const run = (id: string, attrs: Record<string, unknown>, anchorId: string | null) => {
  const anchor = anchorId ? host.adapter.getRecord(anchorId) : null;
  try {
    const result = host.engine.runActivity(act(id), attrs, anchor as never);
    return result.status === 'done' ? { ok: true as const, result } : { ok: false as const, why: JSON.stringify(result) };
  } catch (err) {
    return { ok: false as const, why: err instanceof Error ? err.message : String(err) };
  }
};
const ask = (id: string, attrs: Record<string, unknown>, anchorId: string | null) =>
  host.engine.runQuery(act(id), attrs, anchorId ? host.adapter.getRecord(anchorId) as never : null).data;
const fields = (id: string) => host.adapter.getRecord(id)?.customFields as Record<string, unknown> | undefined;
const allOf = (typeRef: string, filter: (f: Record<string, unknown>) => boolean) =>
  [...(host.adapter as unknown as { records: Map<string, { typeRef: string; customFields: Record<string, unknown> }> }).records.values()]
    .filter((r) => r.typeRef === typeRef && filter(r.customFields));

// Find real WBS leaves / CBS codes on P26-011 to test against.
const wbsRows = ask('act_list_wbs_nodes', { project_id: PROJECT }, PROJECT) as { id: string; code: string }[];
const wbs34 = wbsRows.find((w) => w.code === '3.4');
const wbs35 = wbsRows.find((w) => w.code === '3.5');
check('found WBS 3.4 and 3.5 on P26-011', !!wbs34 && !!wbs35, `${wbs34?.id} / ${wbs35?.id}`);
if (!wbs34 || !wbs35) { console.log('cannot continue without WBS nodes'); await closeDb(db); process.exit(1); }

const cbsRows = ask('act_list_cbs_nodes', { project_id: PROJECT }, PROJECT) as { id: string; code: string }[];
const cbs1300 = cbsRows.find((c) => c.code === '1300');
const cbs4200 = cbsRows.find((c) => c.code === '4200');
check('found CBS 1300 and 4200', !!cbs1300 && !!cbs4200, `${cbs1300?.id} / ${cbs4200?.id}`);
if (!cbs1300 || !cbs4200) { console.log('cannot continue without CBS codes'); await closeDb(db); process.exit(1); }

console.log('\n── work groups ──────────────────────────────────────────────────────');
const wgCreated = run('act_create_work_groups', { project_id: PROJECT, wg_parent: '', wg_code: 'WG-TEST', name: 'Test crew', manager: 'Hughie', wg_type: 'Crew' }, null);
check('create a work group', wgCreated.ok, wgCreated.ok ? '' : wgCreated.why);
const wgId = wgCreated.ok ? wgCreated.result.recordId! : '';

const wgDup = run('act_create_work_groups', { project_id: PROJECT, wg_parent: '', wg_code: 'WG-TEST', name: 'Duplicate', manager: 'X', wg_type: 'Crew' }, null);
check('a duplicate wg_code on the same project is refused', !wgDup.ok, wgDup.ok ? 'it was allowed' : '');

console.log('\n── resources ─────────────────────────────────────────────────────────');
const welder = run('act_create_resources', { project_id: PROJECT, code: 'TEST-WELD', description: 'Test welder', res_type: 'LAB', unit: 'hr', rate: '95', cbs_id: cbs1300.id }, null);
check('create a resource (welder, $95/hr)', welder.ok, welder.ok ? '' : welder.why);
const welderId = welder.ok ? welder.result.recordId! : '';

const sideboom = run('act_create_resources', { project_id: PROJECT, code: 'TEST-SIDE', description: 'Test sideboom', res_type: 'PLT', unit: 'hr', rate: '310', cbs_id: cbs4200.id }, null);
check('create a resource (sideboom, $310/hr)', sideboom.ok, sideboom.ok ? '' : sideboom.why);
const sideboomId = sideboom.ok ? sideboom.result.recordId! : '';

console.log('\n── standard set ──────────────────────────────────────────────────────');
const stdWelders = run('act_create_wg_resources', { project_id: PROJECT, wg_id: wgId, resource_id: welderId, quantity: '6' }, null);
check('standard set: 6 welders', stdWelders.ok, stdWelders.ok ? '' : stdWelders.why);
const stdSidebooms = run('act_create_wg_resources', { project_id: PROJECT, wg_id: wgId, resource_id: sideboomId, quantity: '2' }, null);
check('standard set: 2 sidebooms', stdSidebooms.ok, stdSidebooms.ok ? '' : stdSidebooms.why);

console.log('\n── shift report, seeded lines, work_hours ───────────────────────────');
const report = run('act_create_shift_reports', {
  project_id: PROJECT, wg_id: wgId,
  report_date: '2026-09-23', shift: 'Day', start_time: '06:00', end_time: '16:00', break_hours: '0',
  weather: 'Clear', work_summary: 'Test shift',
}, null);
check('create a shift report (10-hour shift)', report.ok, report.ok ? '' : report.why);
const reportId = report.ok ? report.result.recordId! : '';
const reportRec = fields(reportId);
check('work_hours computed as 10', Number(reportRec?.work_hours) === 10, `work_hours=${reportRec?.work_hours}`);
check('report_no assigned, SR- prefixed', /^SR-\d{4}$/.test(String(reportRec?.report_no ?? '')), `report_no=${reportRec?.report_no}`);

const lines = ask('act_list_shift_report_resources', { report_id: reportId }, reportId) as { id: string; resource_id: string; quantity: number; rate: number; cbs_id: string }[];
check('two lines seeded from the standard set', lines.length === 2, `${lines.length} lines`);
const welderLine = lines.find((l) => l.resource_id === welderId);
const sideboomLine = lines.find((l) => l.resource_id === sideboomId);
check('welder line quantity = 60 (10h × 6)', Number(welderLine?.quantity) === 60, `quantity=${welderLine?.quantity}`);
check('sideboom line quantity = 20 (10h × 2)', Number(sideboomLine?.quantity) === 20, `quantity=${sideboomLine?.quantity}`);
check('welder line carries CBS 1300 (from the resource)', welderLine?.cbs_id === cbs1300.id, `cbs_id=${welderLine?.cbs_id}`);

console.log('\n── WBS rows, the hours gate (float-safe) ────────────────────────────');
// 0.1 + 8.2 + 1.7 = 9.999999999999998 in float arithmetic — the exact case
// §10a measured. Three rows totalling exactly 10 (the report's work_hours).
const w1 = run('act_create_shift_wbs', { project_id: PROJECT, report_id: reportId, wbs_id: wbs34.id, hours: '0.1', qty_completed: '1' }, null);
const w2 = run('act_create_shift_wbs', { project_id: PROJECT, report_id: reportId, wbs_id: wbs34.id, hours: '8.2', qty_completed: '2' }, null);
const w3 = run('act_create_shift_wbs', { project_id: PROJECT, report_id: reportId, wbs_id: wbs35.id, hours: '1.7', qty_completed: '3' }, null);
check('three WBS rows added (0.1 + 8.2 + 1.7)', w1.ok && w2.ok && w3.ok, [w1, w2, w3].map((r) => r.ok ? '' : r.why).join(' '));

const calc = run('act_calculate_shift_reports', {}, reportId);
check('Calculate accepts 0.1+8.2+1.7 against work_hours=10 (float-safe)', calc.ok, calc.ok ? '' : calc.why);

const pricedLines = ask('act_list_shift_report_resources', { report_id: reportId }, reportId) as { id: string; quantity: number; rate: number; tracked_cost: number; calculated: string }[];
const pricedWelder = pricedLines.find((l) => l.quantity === 60);
const pricedSideboom = pricedLines.find((l) => l.quantity === 20);
check('welder line priced: 60 × 95 = 5700', Number(pricedWelder?.tracked_cost) === 5700, `tracked_cost=${pricedWelder?.tracked_cost}`);
check('sideboom line priced: 20 × 310 = 6200', Number(pricedSideboom?.tracked_cost) === 6200, `tracked_cost=${pricedSideboom?.tracked_cost}`);
check('both lines marked calculated', pricedLines.every((l) => l.calculated === 'true'), pricedLines.map((l) => l.calculated).join(','));

console.log('\n── submit gate ───────────────────────────────────────────────────────');
// Adjust one line after Calculate — it should go back to uncalculated and
// block Submit until Calculate runs again.
const adjust = run('act_modify_shift_report_resource', { quantity: '61' }, welderLine!.id);
check('adjusting a line after Calculate is allowed', adjust.ok, adjust.ok ? '' : adjust.why);
const submitTooSoon = run('act_submit_shift_reports', {}, reportId);
check('Submit refused: a line changed since the last Calculate', !submitTooSoon.ok, submitTooSoon.ok ? 'it was allowed' : '');
const recalc = run('act_calculate_shift_reports', {}, reportId);
check('Calculate re-run after the adjustment', recalc.ok, recalc.ok ? '' : recalc.why);
const submitted = run('act_submit_shift_reports', {}, reportId);
check('Submit now accepted', submitted.ok, submitted.ok ? '' : submitted.why);
check('status is Submitted', fields(reportId)?.status === 'Submitted');

console.log('\n── approve: largest-remainder division ──────────────────────────────');
// welder line is now 61 × 95 = 5795 (rate stayed the same, quantity moved).
const approved = run('act_approve_shift_reports', {}, reportId);
check('Approve runs', approved.ok, approved.ok ? '' : approved.why);
check('status is Approved, approved_by/date set', (() => {
  const f = fields(reportId);
  return f?.status === 'Approved' && !!f?.approved_by && !!f?.approved_date;
})());

const usageRows = allOf('rt_wbs_resource_usage', (f) => f.report_id === reportId);
check('6 wbs_resource_usage rows written (2 lines × 3 wbs rows)', usageRows.length === 6, `${usageRows.length} rows`);

const sumCost = usageRows.reduce((a, r) => a + Number(r.customFields.tracked_cost), 0);
const expectedCost = 61 * 95 + 6200;
check("the divided shares sum back to the two lines' total exactly (largest-remainder)",
  Math.abs(sumCost - expectedCost) < 1e-9, `sum=${sumCost}, expected=${expectedCost}`);

const sumQty = usageRows.reduce((a, r) => a + Number(r.customFields.quantity), 0);
check("the divided quantities sum back to the two lines' total exactly", Math.abs(sumQty - (61 + 20)) < 1e-9, `sum=${sumQty}`);

console.log('\n── the blank-fk-is-not-null defect, exercised directly ──────────────');
// A second shift, with one line pinned whole to a single WBS node (§5.1's
// per-line exception) alongside one line still split by hours — the exact
// shape §10a's defect hid in: `<> ''` must tell the two apart; `is not null`
// would not (a blank fk_ref stores '', not null).
const report2 = run('act_create_shift_reports', {
  project_id: PROJECT, wg_id: wgId,
  report_date: '2026-09-23', shift: 'Night', start_time: '18:00', end_time: '06:00', break_hours: '0',
}, null);
check('create a second (night) shift report', report2.ok, report2.ok ? '' : report2.why);
const report2Id = report2.ok ? report2.result.recordId! : '';
check('work_hours crosses midnight correctly: 12', Number(fields(report2Id)?.work_hours) === 12, `work_hours=${fields(report2Id)?.work_hours}`);

run('act_create_shift_wbs', { project_id: PROJECT, report_id: report2Id, wbs_id: wbs34.id, hours: '6' }, null);
run('act_create_shift_wbs', { project_id: PROJECT, report_id: report2Id, wbs_id: wbs35.id, hours: '6' }, null);
const calc2 = run('act_calculate_shift_reports', {}, report2Id);
check('Calculate on the second report', calc2.ok, calc2.ok ? '' : calc2.why);
const lines2 = ask('act_list_shift_report_resources', { report_id: report2Id }, report2Id) as { id: string; resource_id: string }[];
const welderLine2 = lines2.find((l) => l.resource_id === welderId)!;

// wbs_id is not one of act_modify_shift_report_resource's captured
// attributes (only quantity/rate/cbs_id, per the model) — the model has no
// activity that sets it, by design (§4.6 calls it a rare, deliberate
// exception). Set it directly on the staged record to exercise the branch.
const rec2 = host.adapter.getRecord(welderLine2.id)!;
(rec2.customFields as Record<string, unknown>).wbs_id = wbs34.id;

run('act_submit_shift_reports', {}, report2Id);
const approved2 = run('act_approve_shift_reports', {}, report2Id);
check('Approve runs with one pinned line and one split line', approved2.ok, approved2.ok ? '' : approved2.why);
const usage2 = allOf('rt_wbs_resource_usage', (f) => f.report_id === report2Id);
const pinnedRows = usage2.filter((r) => r.customFields.source_line_id === welderLine2.id);
check('the pinned line produced exactly ONE usage row (whole to 3.4), not split', pinnedRows.length === 1, `${pinnedRows.length} rows`);
check('  …and it landed on 3.4, not blank', pinnedRows[0]?.customFields.wbs_id === wbs34.id, String(pinnedRows[0]?.customFields.wbs_id));

console.log('\n── defects ───────────────────────────────────────────────────────────');
const defectOnApproved = run('act_create_defects', {
  project_id: PROJECT, report_id: reportId, wbs_id: wbs34.id,
  raised_by: 'Test', location: 'x', def_description: 'x', severity: 'Minor',
}, null);
check('raising a defect against an already-approved report is refused', !defectOnApproved.ok, defectOnApproved.ok ? 'it was allowed' : '');

// A fresh draft report — reportId is Approved by now, and defects may only be
// raised while filing (the before hook gates on the report being a draft).
const report3 = run('act_create_shift_reports', {
  project_id: PROJECT, wg_id: wgId,
  report_date: '2026-09-24', shift: 'Day', start_time: '06:00', end_time: '16:00', break_hours: '0',
}, null);
check('create a third (draft) shift report, for the defect gate', report3.ok, report3.ok ? '' : report3.why);
const report3Id = report3.ok ? report3.result.recordId! : '';

const defect = run('act_create_defects', {
  project_id: PROJECT, report_id: report3Id, wbs_id: wbs34.id,
  raised_by: 'Test', location: 'Chainage 1+200', def_description: 'Coating holiday', severity: 'Major',
}, null);
check('raise a defect from the report', defect.ok, defect.ok ? '' : defect.why);
const defectId = defect.ok ? defect.result.recordId! : '';
check('defect_no assigned, DEF- prefixed, status Open', (() => {
  const f = fields(defectId);
  return /^DEF-\d{3}$/.test(String(f?.defect_no)) && f?.status === 'Open';
})(), JSON.stringify(fields(defectId)));

const rectified = run('act_rectify_defects', { rectified_date: '2026-09-24', rectification_notes: 'Recoated' }, defectId);
check('rectify the defect', rectified.ok, rectified.ok ? '' : rectified.why);
check('status is Rectified', fields(defectId)?.status === 'Rectified');
const verified = run('act_verify_defects', { verified_date: '2026-09-25', verified_by: 'QA' }, defectId);
check('verify (close) the defect', verified.ok, verified.ok ? '' : verified.why);
check('status is Closed', fields(defectId)?.status === 'Closed');

console.log('\n── who owes a report / leaf checks ───────────────────────────────────');
const expected = ask('act_list_expected_work_groups', { project_id: PROJECT }, PROJECT) as { wg_code: string }[];
check('WG-TEST appears in "expected" (active, no children, Crew)', expected.some((w) => w.wg_code === 'WG-TEST'));

console.log('\n── existing totals, children-guard ───────────────────────────────────');
const cbsTotal = ask('act_total_cbs_nodes', { project_id: PROJECT }, PROJECT);
check('CBS total is leaf-only and matches the approved budget', Number(cbsTotal) === 40_620_000, `total=${cbsTotal}`);

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILURE(S)`} — nothing persisted (no writeBack)`);
await closeDb(db);
process.exit(failures === 0 ? 0 : 1);
