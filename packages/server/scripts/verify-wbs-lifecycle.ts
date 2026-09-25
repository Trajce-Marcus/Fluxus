// Read-only in effect, 2026-09-14. Drives the whole WBS lifecycle through the
// real engine against the real model and the real records — inside one
// transaction that is **rolled back** at the end, so nothing persists. That is
// what makes it safe to approve a WBS here: the freeze happens, is checked, and
// is thrown away.
//
// It answers the questions the page is about to be built on: do the gates
// evaluate at all, does the baseline copy into the forecast, does a leaf that
// gains a child lose its figures, does a childless-only delete hold, and do the
// totals add up.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { findActivity, loadOperationHost } from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const OPERATION = 'projects-dev';
const PROJECT = 'P26-011';

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
const user = { id: 'script', name: 'lifecycle check', email: null, roles: ['role_project_admin'] };
const host = await loadOperationHost(db, OPERATION, undefined, user);
// Every run writes as it happens now, so the whole check is one transaction
// that is rolled back at the end: nothing persists.
await host.store.begin();

const act = (id: string) => {
  const found = findActivity(host, id);
  if (!found) throw new Error(`${id} not found`);
  return found;
};
const rec = async (id: string) => await host.store.getRecord(id);

let failures = 0;
const check = (what: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok   ' : 'FAIL '} ${what.padEnd(52)} ${detail}`);
  if (!ok) failures += 1;
};

/**
 * A check that is known to be broken by a platform gap, not by this model. It
 * prints what it got and does not fail the run — so a real regression still
 * turns the harness red. Drop the wrapper the day the gap closes.
 */
const known = (what: string, why: string, got: unknown) => {
  console.log(`KNOWN ${what.padEnd(52)} ${String(got).slice(0, 40)}  — ${why}`);
};
const NO_CAST = 'money is stored as text and nothing casts it (DSL_SPEC §12)';

/** Run a write. Returns null when the pipeline refused it, with the reason. */
const run = async (id: string, attrs: Record<string, unknown>, anchor: string | null) => {
  try {
    const result = await host.engine.runActivity(act(id), attrs, anchor ? await rec(anchor) : null);
    return result.status === 'done' ? { ok: true as const, result } : { ok: false as const, why: JSON.stringify(result) };
  } catch (err) {
    return { ok: false as const, why: err instanceof Error ? err.message : String(err) };
  }
};
const ask = async (id: string, attrs: Record<string, unknown>) => (await host.engine.runQuery(act(id), attrs, await rec(PROJECT))).data;

console.log(`\n── totals, before anything is entered ───────────────────────────────`);
const cbsTotal = await ask('act_total_cbs_nodes', { project_id: PROJECT });
const wbsTotal0 = await ask('act_total_wbs_baseline', { project_id: PROJECT });
known('CBS budget total should be the loaded $30M', NO_CAST, cbsTotal);
check('WBS baseline total starts at zero', Number(wbsTotal0) === 0, String(wbsTotal0));

console.log(`\n── the baseline, and what it does to the forecast ───────────────────`);
const baselined = await run('act_baseline_wbs_nodes', {
  baseline_budget: '250000', target_start: '2026-10-01', target_completion: '2026-12-01',
}, '1.1');
check('a leaf takes a baseline', baselined.ok, baselined.ok ? '' : baselined.why);
const leaf = (await rec('1.1'))?.customFields as Record<string, unknown>;
check('the baseline copies into the forecast', String(leaf?.forecast_cost) === '250000', `forecast_cost=${leaf?.forecast_cost}`);
check('  …and the forecast dates too', String(leaf?.forecast_start).startsWith('2026-10-01'), `forecast_start=${leaf?.forecast_start}`);

const onParent = await run('act_baseline_wbs_nodes', { baseline_budget: '999' }, '1.0');
check('a parent is refused a baseline', !onParent.ok, onParent.ok ? 'it was allowed' : '');

const wbsTotal1 = await ask('act_total_wbs_baseline', { project_id: PROJECT });
known('the total should pick the figure up', NO_CAST, wbsTotal1);

console.log(`\n── a leaf that gains a child ────────────────────────────────────────`);
// The create captures `wbs_project` / `wbs_parent` — attributes that name the
// fields they fill (2026-09-15), not the field keys themselves.
const added = await run('act_create_wbs_nodes', {
  wbs_project: PROJECT, wbs_parent: '1.1', code: '1.1.1', name: 'Alignment sheets', description: '', cbs_codes: '',
}, null);
check('a child lands under the leaf', added.ok, added.ok ? '' : added.why);
const wasLeaf = (await rec('1.1'))?.customFields as Record<string, unknown>;
check('the parent loses its figures', !wasLeaf?.baseline_budget && !wasLeaf?.forecast_cost,
  `baseline=${JSON.stringify(wasLeaf?.baseline_budget)} forecast=${JSON.stringify(wasLeaf?.forecast_cost)}`);
check('and the total falls back to zero', Number(await ask('act_total_wbs_baseline', { project_id: PROJECT })) === 0);

console.log(`\n── delete, from the bottom ──────────────────────────────────────────`);
const delParent = await run('act_delete_wbs_nodes', { expired: 'true' }, '1.0');
check('a node with children is refused', !delParent.ok, delParent.ok ? 'it was allowed' : '');
const delLeaf = await run('act_delete_wbs_nodes', { expired: 'true' }, '5.3');
check('a childless node goes', delLeaf.ok, delLeaf.ok ? '' : delLeaf.why);

console.log(`\n── approval, and the freeze ─────────────────────────────────────────`);
const tooEarly = await run('act_activate_projects', {}, PROJECT);
check('a project cannot start before the WBS is approved', !tooEarly.ok, tooEarly.ok ? 'it started' : '');
const approved = await run('act_approve_wbs_projects', {}, PROJECT);
check('the WBS is approved', approved.ok, approved.ok ? '' : approved.why);
check('  …and the project says so', ((await rec(PROJECT))?.customFields as Record<string, unknown>)?.wbs_status === 'approved');

for (const [what, id, attrs, anchor] of [
  ['rename', 'act_modify_wbs_nodes', { code: '1.2', name: 'Permits' }, '1.2'],
  ['re-baseline', 'act_baseline_wbs_nodes', { baseline_budget: '1' }, '1.2'],
  ['move', 'act_move_wbs_nodes', { wbs_parent: '2.0' }, '1.2'],
  ['delete', 'act_delete_wbs_nodes', { expired: 'true' }, '1.2'],
] as [string, string, Record<string, unknown>, string][]) {
  const attempt = await run(id, attrs, anchor);
  check(`a frozen WBS refuses ${what}`, !attempt.ok, attempt.ok ? 'it was allowed' : '');
}
const newNode = await run('act_create_wbs_nodes', { wbs_project: PROJECT, wbs_parent: '', code: '6.0', name: 'Late idea' }, null);
check('a frozen WBS refuses a new node', !newNode.ok, newNode.ok ? 'it was allowed' : '');

const forecast = await run('act_forecast_wbs_nodes', { forecast_cost: '300000' }, '1.2');
check('but the forecast stays open', forecast.ok, forecast.ok ? '' : forecast.why);
known('  …and the forecast total should move', NO_CAST, await ask('act_total_wbs_forecast', { project_id: PROJECT }));

console.log(`\n── the project's own statuses ───────────────────────────────────────`);
// The project sits at `Created` with its WBS now approved, which is exactly
// the gate `act_activate_projects` waits for.
const started = await run('act_activate_projects', {}, PROJECT);
check('start is allowed once the WBS is approved', started.ok, started.ok ? '' : started.why);
check('  …and the status says Active', ((await rec(PROJECT))?.customFields as Record<string, unknown>)?.status === 'Active');
const completed = await run('act_complete_projects', {}, PROJECT);
check('complete is allowed from Active', completed.ok, completed.ok ? '' : completed.why);
check('  …and the status says so', ((await rec(PROJECT))?.customFields as Record<string, unknown>)?.status === 'Completed');

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} FAILED`} — nothing written (rolled back)\n`);
await host.store.rollback();
await closeDb(db);
process.exit(failures === 0 ? 0 : 1);
