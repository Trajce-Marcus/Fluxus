// Read-only in effect, 2026-09-23 (second pass, against the reworked design —
// SHIFT_REPORTS.md §1.1). Drives the shift-reports model through the real
// engine against the real config and P26-011's real WBS/CBS — and never calls
// `writeBack`, so nothing persists. Re-checks the four defects §10a measured
// (float equality on hours, a blank number poisoning a total, shares that do
// not add up, and a blank fk_ref reading as not-null — now the branch that
// tells an amendment's whole-line posting from an ordinary report's divided
// one) and drives the paths this pass added: `services.math.distribute`
// directly, the work-group one-level cap and expire-children-first order, the
// Submit/Approve hours warning, Reject and Cancel, and an amendment posting a
// signed line to the ledger undivided.
//
// Sourcing (`context.page.record.*`) is a page-runtime/form concern, not the
// engine's — `runActivity` takes already-resolved values. So every value a
// real page would source silently is passed here explicitly, by the pool
// attribute's own key.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { findActivity, loadOperationHost } from '../src/host';
import { buildMathModule } from '@fluxus/engine';

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
const run = (id: string, attrs: Record<string, unknown>, anchorId: string | null, options?: { acknowledgedWarnings?: boolean }) => {
  const anchor = anchorId ? host.adapter.getRecord(anchorId) : null;
  try {
    const result = host.engine.runActivity(act(id), attrs, anchor as never, options);
    return result.status === 'done'
      ? { ok: true as const, result, why: '' }
      : { ok: false as const, why: JSON.stringify(result), result };
  } catch (err) {
    return { ok: false as const, why: err instanceof Error ? err.message : String(err), result: undefined };
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

console.log('\n── services.math.distribute, direct ─────────────────────────────────');
const distribute = (weights: number[], total: number, precision: number) =>
  buildMathModule().functions.distribute.fn(weights, total, precision) as number[];
check('[3.5, 4.0, 2.5] over 81 at precision 0 is [28, 33, 20]',
  JSON.stringify(distribute([3.5, 4.0, 2.5], 81, 0)) === JSON.stringify([28, 33, 20]));
check('[1, 1, 1] over 100 at precision 2 is [33.34, 33.33, 33.33]',
  JSON.stringify(distribute([1, 1, 1], 100, 2)) === JSON.stringify([33.34, 33.33, 33.33]));
const negShares = distribute([1, 1, 1], -100, 2);
check('a negative total gives negative parts that still sum to it',
  negShares.every((s) => s <= 0) && Math.abs(negShares.reduce((a, b) => a + b, 0) - -100) < 1e-9,
  JSON.stringify(negShares));

console.log('\n── work groups: one level only, split, expire order ─────────────────');
const wgCreated = run('act_create_work_groups', { project_id: PROJECT, wg_parent: '', wg_code: 'WG-TEST', name: 'Test crew', manager: 'Hughie', wg_type: 'Crew' }, null);
check('create a work group', wgCreated.ok, wgCreated.ok ? '' : wgCreated.why);
const wgId = wgCreated.ok ? wgCreated.result.recordId! : '';

const wgParentCreated = run('act_create_work_groups', { project_id: PROJECT, wg_parent: '', wg_code: 'WG-TEST-SPREAD', name: 'Test spread', manager: 'Owner', wg_type: 'Crew' }, null);
check('create a would-be parent group', wgParentCreated.ok, wgParentCreated.ok ? '' : wgParentCreated.why);
const wgParentId = wgParentCreated.ok ? wgParentCreated.result.recordId! : '';

const wgChildCreated = run('act_create_work_groups', { project_id: PROJECT, wg_parent: wgParentId, wg_code: 'WG-TEST-CHILD', name: 'Test child', manager: 'Child mgr', wg_type: 'Crew' }, null);
check('create a child under it — one level is fine', wgChildCreated.ok, wgChildCreated.ok ? '' : wgChildCreated.why);
const wgChildId = wgChildCreated.ok ? wgChildCreated.result.recordId! : '';

const wgGrandchild = run('act_create_work_groups', { project_id: PROJECT, wg_parent: wgChildId, wg_code: 'WG-TEST-GRANDCHILD', name: 'Test grandchild', manager: 'X', wg_type: 'Crew' }, null);
check('a group under a group that already has a parent is refused (one level only)', !wgGrandchild.ok, wgGrandchild.ok ? 'it was allowed' : '');

const expireParentTooSoon = run('act_delete_work_groups', { expired: 'true' }, wgParentId);
check('expiring a parent with an unexpired child is refused', !expireParentTooSoon.ok, expireParentTooSoon.ok ? 'it was allowed' : '');
const expireChild = run('act_delete_work_groups', { expired: 'true' }, wgChildId);
check('expire the child first', expireChild.ok, expireChild.ok ? '' : expireChild.why);
const expireParentNow = run('act_delete_work_groups', { expired: 'true' }, wgParentId);
check('now the parent expires (its only child is already expired)', expireParentNow.ok, expireParentNow.ok ? '' : expireParentNow.why);

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

console.log('\n── a second report: midnight crossing, and an even split ───────────');
// The per-line "pin to one node" exception (§5.1) was designed, built, and
// then removed 2026-09-23 — it was never reachable through any activity, so
// every line always divides by hours now. This report checks that plainly: a
// night shift crossing midnight, split evenly 6h/6h across two WBS nodes.
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
run('act_submit_shift_reports', {}, report2Id);
const approved2 = run('act_approve_shift_reports', {}, report2Id);
check('Approve runs', approved2.ok, approved2.ok ? '' : approved2.why);
const usage2 = allOf('rt_wbs_resource_usage', (f) => f.report_id === report2Id);
check('every line split across both nodes (no per-line pinning left in the model)', usage2.length === 4, `${usage2.length} rows`);
const cost34 = usage2.filter((r) => r.customFields.wbs_id === wbs34.id).reduce((a, r) => a + Number(r.customFields.tracked_cost), 0);
const cost35 = usage2.filter((r) => r.customFields.wbs_id === wbs35.id).reduce((a, r) => a + Number(r.customFields.tracked_cost), 0);
check('an even 6h/6h split lands the cost evenly, 50/50', Math.abs(cost34 - cost35) < 0.01, `3.4=${cost34}, 3.5=${cost35}`);

console.log('\n── §5.2: Submit and Approve warn rather than fail on stale hours ────');
// A WBS row edited after Calculate, with no recalculation — the case §5.2
// exists for. Ten-hour shift, one ten-hour WBS row, matching at Calculate;
// then the row is edited to 8h, so work_hours (10) and the WBS total (8) part
// company with no gate noticing until Submit re-checks.
const reportWarn = run('act_create_shift_reports', {
  project_id: PROJECT, wg_id: wgId,
  report_date: '2026-09-23', shift: 'Day', start_time: '06:00', end_time: '16:00', break_hours: '0',
}, null);
check('create a report for the warning check', reportWarn.ok, reportWarn.ok ? '' : reportWarn.why);
const reportWarnId = reportWarn.ok ? reportWarn.result.recordId! : '';
const wbsWarnRow = run('act_create_shift_wbs', { project_id: PROJECT, report_id: reportWarnId, wbs_id: wbs34.id, hours: '10' }, null);
check('add a matching 10h WBS row', wbsWarnRow.ok, wbsWarnRow.ok ? '' : wbsWarnRow.why);
const wbsWarnRowId = wbsWarnRow.ok ? wbsWarnRow.result.recordId! : '';
const calcWarn = run('act_calculate_shift_reports', {}, reportWarnId);
check('Calculate accepts the matching total', calcWarn.ok, calcWarn.ok ? '' : calcWarn.why);

run('act_modify_shift_wbs', { hours: '8' }, wbsWarnRowId);
const submitWarn = run('act_submit_shift_reports', {}, reportWarnId);
check('Submit needs confirmation once the WBS hours (8) no longer total work_hours (10)',
  !submitWarn.ok && submitWarn.result?.status === 'needs-confirmation', JSON.stringify(submitWarn.result?.warnings));
check('the warning names both figures', (submitWarn.result?.warnings ?? []).some((w) => w.includes('8') && w.includes('10')),
  JSON.stringify(submitWarn.result?.warnings));
const submitAck = run('act_submit_shift_reports', {}, reportWarnId, { acknowledgedWarnings: true });
check('acknowledging the warning is a legitimate answer — Submit goes through', submitAck.ok, submitAck.ok ? '' : submitAck.why);

const approveWarn = run('act_approve_shift_reports', {}, reportWarnId);
check('Approve also needs confirmation for the parent manager, same mismatch',
  !approveWarn.ok && approveWarn.result?.status === 'needs-confirmation', JSON.stringify(approveWarn.result?.warnings));
const approveAck = run('act_approve_shift_reports', {}, reportWarnId, { acknowledgedWarnings: true });
check('acknowledged, Approve runs — nothing reaches back and stops the division', approveAck.ok, approveAck.ok ? '' : approveAck.why);

console.log('\n── §5.3: Reject sends a submitted report back to Draft, free ────────');
const reportRC = run('act_create_shift_reports', {
  project_id: PROJECT, wg_id: wgId,
  report_date: '2026-09-23', shift: 'Day', start_time: '06:00', end_time: '16:00', break_hours: '0',
}, null);
const reportRCId = reportRC.ok ? reportRC.result.recordId! : '';
run('act_create_shift_wbs', { project_id: PROJECT, report_id: reportRCId, wbs_id: wbs34.id, hours: '10' }, null);
run('act_calculate_shift_reports', {}, reportRCId);
const submitRC = run('act_submit_shift_reports', {}, reportRCId);
check('submit a clean report (no warning, hours match)', submitRC.ok, submitRC.ok ? '' : submitRC.why);

const rejected = run('act_reject_shift_reports', {}, reportRCId);
check('Reject sends it back to Draft', rejected.ok && fields(reportRCId)?.status === 'Draft', rejected.ok ? '' : rejected.why);
check('nothing posted to the ledger by a reject', allOf('rt_wbs_resource_usage', (f) => f.report_id === reportRCId).length === 0);

console.log('\n── §5.3: Cancel expires a Draft report — §6 reads it as nothing filed ─');
const cancelled = run('act_cancel_shift_reports', { expired: 'true' }, reportRCId);
check('Cancel expires the (rejected, now draft) report', cancelled.ok && fields(reportRCId)?.expired === 'true', cancelled.ok ? '' : cancelled.why);
const listAfterCancel = ask('act_list_shift_reports', { project_id: PROJECT }, PROJECT) as { id: string }[];
check('the cancelled report no longer appears in the project\'s list', !listAfterCancel.some((r) => r.id === reportRCId));

console.log('\n── §5.4: an amendment posts a signed line to the ledger, undivided ──');
// A blank amended_report_id is sourced, not asked (§4.9), so `required` on
// the attribute usage would not help even if set — a hidden/sourced
// attribute is exempt from it. Refusing this in the hook is what stops the
// activity from being used to create what is structurally an ordinary
// report (missing every field the real Create/Modify activities require,
// and none of its lines ever seeded) through the amendment-only path.
const amendmentWithNoParent = run('act_create_shift_report_amendments', { project_id: PROJECT, wg_id: wgId, amended_report_id: '' }, null);
check('Raise Amendment refuses a blank amended_report_id', !amendmentWithNoParent.ok, amendmentWithNoParent.ok ? 'it was allowed' : '');

// reportId (the first report, above) is Approved by now — an amendment
// corrects it. project_id/wg_id/amended_report_id are sourced from the page
// in the real app; here they are passed explicitly, by the pool attribute's
// own key, the same way every other sourced value in this script is.
const amendment = run('act_create_shift_report_amendments', { project_id: PROJECT, wg_id: wgId, amended_report_id: reportId }, null);
check('raise an amendment against the approved report', amendment.ok, amendment.ok ? '' : amendment.why);
const amendmentId = amendment.ok ? amendment.result.recordId! : '';
check('the amendment carries amended_report_id, project_id and wg_id — sourced, not asked',
  fields(amendmentId)?.amended_report_id === reportId
  && fields(amendmentId)?.project_id === PROJECT
  && fields(amendmentId)?.wg_id === wgId);
check('date, shift, start and end time are never asked — they sit blank',
  fields(amendmentId)?.report_date === '' && fields(amendmentId)?.start_time === '' && fields(amendmentId)?.end_time === '');
check('report_no assigned from the shared sequence', /^SR-\d{4}$/.test(String(fields(amendmentId)?.report_no ?? '')));

const amendOnDraft = run('act_create_shift_report_amendments', { project_id: PROJECT, wg_id: wgId, amended_report_id: reportRCId }, null);
check('an amendment cannot be raised against a report that is not approved', !amendOnDraft.ok, amendOnDraft.ok ? 'it was allowed' : '');

const notes = run('act_edit_shift_report_amendment_notes', { site_notes: 'Welder hours overstated on the original report.' }, amendmentId);
check('edit the amendment notes while draft', notes.ok, notes.ok ? '' : notes.why);

// Four welder-hours overstated: -4 at $95, landing whole on 3.4 (§5.1, §5.4).
const amendLine = run('act_add_shift_report_amendment_line', {
  project_id: PROJECT, report_id: amendmentId, resource_id: welderId, quantity: '-4', wbs_id: wbs34.id, notes: 'Overstated hours',
}, null);
check('add a signed correction line, naming its own WBS node', amendLine.ok, amendLine.ok ? '' : amendLine.why);
const amendLineId = amendLine.ok ? amendLine.result.recordId! : '';
check('the line prices itself immediately — no Calculate for an amendment', (() => {
  const f = fields(amendLineId);
  return Number(f?.rate) === 95 && Number(f?.tracked_cost) === -380;
})(), JSON.stringify(fields(amendLineId)));

console.log('\n── §5.4: each activity set refuses the other\'s records ─────────────');
// An activity reachable through one page is reachable through any caller, so
// the refusal has to be a hook gate on both sides, not just a page's choice
// of which button to show. reportRCId is Draft (§5.3 left it that way) and
// amendmentId is still Draft here too — neither has been Submitted yet, so
// DRAFT_REPORT_GATE cannot be what refuses either of these.
const amendLineOnOrdinary = run('act_add_shift_report_amendment_line', {
  project_id: PROJECT, report_id: reportRCId, resource_id: welderId, quantity: '-1', wbs_id: wbs34.id,
}, null);
check('an amendment-line activity is refused on an ordinary report', !amendLineOnOrdinary.ok, amendLineOnOrdinary.ok ? 'it was allowed' : '');

const ordinaryLineOnAmendment = run('act_add_shift_report_resource', {
  project_id: PROJECT, report_id: amendmentId, resource_id: welderId, quantity: '1',
}, null);
check('an ordinary line activity is refused on an amendment', !ordinaryLineOnAmendment.ok, ordinaryLineOnAmendment.ok ? 'it was allowed' : '');

// reportRCId is still Draft (Reject then Cancel — Cancel only sets expired,
// it does not submit or approve), so its standard-set-seeded lines are still
// reachable through the ordinary activities — the case the two checks below
// tell apart: the gate must refuse the WRONG activity, not Draft-only reports
// generally.
const rcLines = allOf('rt_shift_report_resource_usage', (f) => f.report_id === reportRCId);
const rcWelderLine = rcLines.find((l) => l.customFields.resource_id === welderId);
check('found the ordinary report\'s seeded welder line to test against', !!rcWelderLine);
const adjustOrdinaryLineOrdinary = run('act_modify_shift_report_resource', { quantity: '99' }, rcWelderLine!.id);
check('adjusting an ordinary line via the ordinary activity still works (unaffected by the new gates)', adjustOrdinaryLineOrdinary.ok, adjustOrdinaryLineOrdinary.ok ? '' : adjustOrdinaryLineOrdinary.why);

const adjustOrdinaryLineOnAmendment = run('act_adjust_shift_report_amendment_line', { quantity: '-5' }, rcWelderLine!.id);
check('the amendment-line Adjust activity is refused on an ordinary line', !adjustOrdinaryLineOnAmendment.ok, adjustOrdinaryLineOnAmendment.ok ? 'it was allowed' : '');

const modifyOrdinaryReport = run('act_modify_shift_reports', { report_date: '2026-09-23', shift: 'Day', start_time: '06:00', end_time: '16:00', break_hours: '0' }, reportRCId);
check('Modify Shift Report still works on an ordinary report (unaffected by the new gate)', modifyOrdinaryReport.ok, modifyOrdinaryReport.ok ? '' : modifyOrdinaryReport.why);
const modifyAmendmentAsReport = run('act_modify_shift_reports', { report_date: '2026-09-23', shift: 'Day', start_time: '07:00', end_time: '15:00' }, amendmentId);
check('Modify Shift Report is refused on an amendment (it would write date/times nothing asks for)', !modifyAmendmentAsReport.ok, modifyAmendmentAsReport.ok ? 'it was allowed' : '');

const editNotesOnOrdinary = run('act_edit_shift_report_amendment_notes', { site_notes: 'should not land here' }, reportRCId);
check('Edit Notes (amendment-only) is refused on an ordinary report', !editNotesOnOrdinary.ok, editNotesOnOrdinary.ok ? 'it was allowed' : '');

// §5.4's body: "date, shift, times, work_hours, WBS hours rows, photos... is
// simply not asked for." Add WBS Row is an ordinary-report activity same as
// Modify Shift Report — an amendment has no WBS rows at all.
const wbsRowOnAmendment = run('act_create_shift_wbs', { project_id: PROJECT, report_id: amendmentId, wbs_id: wbs34.id, hours: '4' }, null);
check('Add WBS Row is refused on an amendment', !wbsRowOnAmendment.ok, wbsRowOnAmendment.ok ? 'it was allowed' : '');

// §8's amendment page paragraph: "No Calculate, no WBS hours rows, no
// photos, no defects."
const defectOnAmendment = run('act_create_defects', {
  project_id: PROJECT, report_id: amendmentId, wbs_id: wbs34.id,
  raised_by: 'Test', location: 'x', def_description: 'x', severity: 'Minor',
}, null);
check('Raise Defect is refused on an amendment', !defectOnAmendment.ok, defectOnAmendment.ok ? 'it was allowed' : '');

const calcOnAmendment = run('act_calculate_shift_reports', {}, amendmentId);
check('Calculate is refused outright on an amendment', !calcOnAmendment.ok, calcOnAmendment.ok ? 'it was allowed' : '');
check('...with a controlled message, not a raw round() type error', (calcOnAmendment.ok ? '' : calcOnAmendment.why).includes('WBS rows') && !(calcOnAmendment.ok ? '' : calcOnAmendment.why).includes('round()'));

const amendSubmit = run('act_submit_shift_reports', {}, amendmentId);
check('Submit the amendment — no WBS rows, no hours check to fail', amendSubmit.ok, amendSubmit.ok ? '' : amendSubmit.why);
check('...and no hours warning either — an amendment has nothing to compare', (amendSubmit.result?.warnings ?? []).length === 0, JSON.stringify(amendSubmit.result?.warnings));
const amendApprove = run('act_approve_shift_reports', {}, amendmentId);
check('Approve the amendment — no shift_wbs rows, and none are needed', amendApprove.ok, amendApprove.ok ? '' : amendApprove.why);
check('...and no hours warning on Approve either', (amendApprove.result?.warnings ?? []).length === 0, JSON.stringify(amendApprove.result?.warnings));

const amendUsage = allOf('rt_wbs_resource_usage', (f) => f.report_id === amendmentId);
check('exactly one ledger row, posted whole (not divided)', amendUsage.length === 1, `${amendUsage.length} rows`);
check('it carries the sign through pricing: -4 qty, -380 cost, on 3.4', (() => {
  const f = amendUsage[0]?.customFields;
  return f?.wbs_id === wbs34.id && Number(f?.quantity) === -4 && Number(f?.tracked_cost) === -380;
})(), JSON.stringify(amendUsage[0]?.customFields));

console.log('\n── §6: amendments are not filings ───────────────────────────────────');
const listWithAmendment = ask('act_list_shift_reports', { project_id: PROJECT }, PROJECT) as { id: string }[];
check('the amendment does not appear in the project\'s shift-report list', !listWithAmendment.some((r) => r.id === amendmentId));
const groupListWithAmendment = ask('act_list_work_group_reports', { wg_id: wgId }, PROJECT) as { id: string }[];
check('nor in the work group\'s own list', !groupListWithAmendment.some((r) => r.id === amendmentId));

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

// §8's project-page Defects panel lists the whole project, no report filter —
// report_id is sourced('') for "no filter". A cold test found this always
// came back empty: `report_id` is a CAPTURED value, coerced to null when
// blank, so testing it against '' never matched. Confirmed live before the
// fix (0 rows either way); the fix tests `= null`.
const allProjectDefects = ask('act_list_defects', { project_id: PROJECT }, PROJECT) as { id: string }[];
check('List Defects with no report_id returns the whole project\'s defects, not zero',
  allProjectDefects.some((d) => d.id === defectId), `${allProjectDefects.length} rows`);
const reportOnlyDefects = ask('act_list_defects', { project_id: PROJECT, report_id: report3Id }, PROJECT) as { id: string }[];
check('List Defects scoped to a report still returns only that report\'s defect',
  reportOnlyDefects.length === 1 && reportOnlyDefects[0].id === defectId, `${reportOnlyDefects.length} rows`);

console.log('\n── who owes a report / leaf checks ───────────────────────────────────');
const expected = ask('act_list_expected_work_groups', { project_id: PROJECT }, PROJECT) as { wg_code: string }[];
check('WG-TEST appears in "expected" (active, no children, Crew)', expected.some((w) => w.wg_code === 'WG-TEST'));

console.log('\n── existing totals, children-guard ───────────────────────────────────');
const cbsTotal = ask('act_total_cbs_nodes', { project_id: PROJECT }, PROJECT);
check('CBS total is leaf-only and matches the approved budget', Number(cbsTotal) === 40_620_000, `total=${cbsTotal}`);

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILURE(S)`} — nothing persisted (no writeBack)`);
await closeDb(db);
process.exit(failures === 0 ? 0 : 1);
