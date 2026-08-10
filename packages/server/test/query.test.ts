// GET activities over the real stack (DSL_SPEC §5a, DATA_THROUGH_ACTIVITIES
// step 1): tRPC `activities.query` → validateSubmission on the parameters →
// the engine's read pipeline → the `returns` expression. The point of the
// design is that the query lives in the model, so these tests never write one:
// they name an activity and check the answer.

import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from '../src/db/client';
import { ensureOperation, ensureSolution, putConfig } from '../src/host';
import { appRouter, DEFAULT_OPERATION, DEFAULT_SOLUTION } from '../src/router';
import type { NotificationEvent, NotifySink } from '../src/services/notify';
import { config } from '../../runtime/src/config';

let db: Db;
const notifications: NotificationEvent[] = [];
const sink: NotifySink = { append: (event) => notifications.push(event) };
const caller = () => appRouter.createCaller({ db, sink });

type WorkOrderRow = { id: string; status: string; location: string; crew: string | null; due_date: string };

beforeAll(async () => {
  db = await createDb(); // in-memory PGlite
  await ensureSolution(db, DEFAULT_SOLUTION, 'Demo');
  await putConfig(db, DEFAULT_SOLUTION, config, sink);
  await ensureOperation(db, DEFAULT_OPERATION, DEFAULT_SOLUTION, 'Demo');

  // Everything the queries read is built through the write pipeline — an
  // operation has no seeding path.
  await caller().activities.run({
    activityId: 'act_raise_inspection_jobs',
    attributes: { id: 'JOB-Q', job_no: 'J-900', job_type: 'Inspection', contract_id: '', location: 'Depot', due_date: '2026-08-01' },
  });
  for (const [id, location, due] of [['WO-Q1', 'Site A', '2026-09-02'], ['WO-Q2', 'Site B', '2026-09-01']]) {
    await caller().activities.run({
      activityId: 'act_create_work_orders',
      attributes: { id, job_id: 'JOB-Q', activity_code: 'AC-1', problem_code: '', location, due_date: due, workgroup_id: '' },
    });
  }
});

describe('GET activities', () => {
  it('answers with what its returns expression yields', async () => {
    const result = await caller().activities.query({
      activityId: 'act_get_work_orders',
      attributes: { status: 'Raised' },
    });
    const rows = result.data as WorkOrderRow[];
    expect(rows.map((r) => r.id).sort()).toEqual(['WO-Q1', 'WO-Q2']);
    // select() decides the shape, and records arrive flattened — an SDM-blind
    // caller gets plain data, not DslRecords.
    expect(Object.keys(rows[0]).sort()).toEqual(['crew', 'due_date', 'id', 'location', 'status']);
  });

  it('honours the parameter — it is a real attribute, not a filter the client wrote', async () => {
    const result = await caller().activities.query({
      activityId: 'act_get_work_orders',
      attributes: { status: 'Completed' },
    });
    expect(result.data).toEqual([]);
  });

  it('orders by the expression, not by insertion', async () => {
    const result = await caller().activities.query({
      activityId: 'act_get_work_orders',
      attributes: { status: 'Raised' },
    });
    expect((result.data as WorkOrderRow[]).map((r) => r.id)).toEqual(['WO-Q2', 'WO-Q1']);
  });

  it('validates the parameters like any other submission', async () => {
    // `status` is required on this GET, so an empty ask is rejected before the
    // query runs — the trio applies to parameters because they are attributes.
    await expect(
      caller().activities.query({ activityId: 'act_get_work_orders', attributes: {} }),
    ).rejects.toThrow(/Status/i);
  });

  it('refuses a non-GET activity', async () => {
    await expect(
      caller().activities.query({ activityId: 'act_create_work_orders', attributes: {} }),
    ).rejects.toThrow(/not a GET activity/);
  });

  it('refuses to run a GET through the write door', async () => {
    await expect(
      caller().activities.run({ activityId: 'act_get_work_orders', recordId: 'WO-Q1', attributes: { status: 'Raised' } }),
    ).rejects.toThrow(/GET activity/);
  });

  it('changes no record data, and leaves no trace with nowhere to land', async () => {
    const before = await caller().records.partition({});
    await caller().activities.query({ activityId: 'act_get_work_orders', attributes: { status: 'Raised' } });
    const after = await caller().records.partition({});
    expect(after).toEqual(before);
  });
});

// Step 3: a GET is an activity, so its run is recorded like every other —
// logged light on the anchor record. What it must never record is the answer.
describe('a GET is logged light', () => {
  const historyOf = async (recordId: string) =>
    (await caller().records.get({ recordId })).activityHistory;

  it('records the run on the anchor: parameters, caller, outcome, duration', async () => {
    const before = (await historyOf('WO-Q1')).length;

    await caller().activities.query({
      activityId: 'act_get_work_orders',
      recordId: 'WO-Q1',
      attributes: { status: 'Raised' },
    });

    const history = await historyOf('WO-Q1');
    expect(history.length).toBe(before + 1);
    const entry = history[history.length - 1];
    expect(entry.activityId).toBe('act_get_work_orders');
    expect(entry.author).toBe('demo');
    // The parameters are the entry's attributes, because they ARE attributes.
    expect(entry.capturedAttributes.status).toBe('Raised');
    expect(entry.capturedAttributes.system_outcome).toBe('ok');
    expect(typeof entry.capturedAttributes.system_duration_ms).toBe('number');
  });

  it('never records what came back', async () => {
    await caller().activities.query({
      activityId: 'act_get_work_orders',
      recordId: 'WO-Q1',
      attributes: { status: 'Raised' },
    });

    const entry = (await historyOf('WO-Q1')).at(-1)!;
    // The answer named both work orders; nothing in the entry may.
    expect(JSON.stringify(entry.capturedAttributes)).not.toContain('WO-Q2');
  });

  it('leaves the record data untouched', async () => {
    const before = (await caller().records.get({ recordId: 'WO-Q2' })).customFields;
    await caller().activities.query({
      activityId: 'act_get_work_orders',
      recordId: 'WO-Q2',
      attributes: { status: 'Raised' },
    });
    expect((await caller().records.get({ recordId: 'WO-Q2' })).customFields).toEqual(before);
  });

  it('reaches the reporting projection like any other run', async () => {
    await caller().activities.query({
      activityId: 'act_get_work_orders',
      recordId: 'WO-Q1',
      attributes: { status: 'Raised' },
    });
    const rows = await db.execute(
      sql`SELECT activity_id FROM rpt_activities WHERE record_id = 'WO-Q1' AND activity_id = 'act_get_work_orders'`,
    );
    expect(rows.rows.length).toBeGreaterThan(0);
  });

  it('records a read that failed, and says so', async () => {
    const SOL = 'demo/get-failing';
    const OP = 'demo/get-failing-op';
    const broken = structuredClone(config);
    // A `returns` that is legal at save time and throws at run time: the
    // activity id is computed, so validateConfig leaves it to runtime — and at
    // runtime there is no such activity.
    broken.workflows.find((w) => w.id === 'wf_work_orders')!.activities
      .find((a) => a.id === 'act_get_work_orders')!.returns = "invoke('act_get_' + 'nothing', {})";
    await ensureSolution(db, SOL, 'Failing');
    await putConfig(db, SOL, broken, sink);
    await ensureOperation(db, OP, SOL, 'Failing');
    const c = () => appRouter.createCaller({ db, sink });
    await c().activities.run({ operationId: OP, activityId: 'act_raise_inspection_jobs', attributes: { id: 'JOB-F', job_no: 'J-902', job_type: 'Inspection', contract_id: '', location: 'Depot', due_date: '2026-08-01' } });

    await expect(
      c().activities.query({ operationId: OP, activityId: 'act_get_work_orders', recordId: 'JOB-F', attributes: { status: 'Raised' } }),
    ).rejects.toThrow();

    const entry = (await c().records.get({ operationId: OP, recordId: 'JOB-F' })).activityHistory.at(-1)!;
    expect(entry.activityId).toBe('act_get_work_orders');
    expect(entry.capturedAttributes.system_outcome).toBe('error');
    expect(String(entry.capturedAttributes.system_log)).toContain('returns failed');
  });

  it('does not log a GET a hook invoked — that read belongs to the run that asked', async () => {
    const SOL = 'demo/get-nested';
    const OP = 'demo/get-nested-op';
    const withGuard = structuredClone(config);
    withGuard.workflows.find((w) => w.id === 'wf_work_orders')!.activities
      .find((a) => a.id === 'act_complete_work_orders')!.before_hook =
        "if len(invoke('act_get_work_orders', { status: 'Nothing' })) > 0 { fail('x') }";
    await ensureSolution(db, SOL, 'Nested');
    await putConfig(db, SOL, withGuard, sink);
    await ensureOperation(db, OP, SOL, 'Nested');
    const c = () => appRouter.createCaller({ db, sink });
    const run = (activityId: string, attributes: Record<string, unknown>, recordId?: string) =>
      c().activities.run({ operationId: OP, activityId, recordId, attributes });

    await run('act_raise_inspection_jobs', { id: 'JOB-N', job_no: 'J-903', job_type: 'Inspection', contract_id: '', location: 'Depot', due_date: '2026-08-01' });
    await run('act_create_work_orders', { id: 'WO-N1', job_id: 'JOB-N', activity_code: 'AC-1', problem_code: '', location: 'Site D', due_date: '2026-09-04', workgroup_id: '' });
    await run('act_dispatch_work_orders', { crew: 'Crew A' }, 'WO-N1');
    await run('act_complete_work_orders', { completed_date: '2026-08-02' }, 'WO-N1');

    const history = (await c().records.get({ operationId: OP, recordId: 'WO-N1' })).activityHistory;
    expect(history.map((e) => e.activityId)).not.toContain('act_get_work_orders');
  });
});

describe('config validation of GET activities', () => {
  const solutionCount = { n: 0 };
  const saveBroken = async (mutate: (c: typeof config) => void) => {
    const broken = structuredClone(config);
    mutate(broken);
    const id = `demo/get-broken-${++solutionCount.n}`;
    await ensureSolution(db, id, 'Broken');
    return caller().config.put({ solutionId: id, config: broken });
  };
  const workOrderActivities = (c: typeof config) =>
    c.workflows.find((w) => w.id === 'wf_work_orders')!.activities;
  const getActivity = (c: typeof config) =>
    workOrderActivities(c).find((a) => a.id === 'act_get_work_orders')!;

  it('rejects a GET with no returns expression', async () => {
    await expect(saveBroken((c) => { delete getActivity(c).returns; })).rejects.toThrow(/needs a 'returns' expression/);
  });

  it('rejects a GET whose returns writes', async () => {
    await expect(
      saveBroken((c) => { getActivity(c).returns = "context.record.update({ status: 'Nope' })"; }),
    ).rejects.toThrow(/not allowed in expressions/);
  });

  it('rejects a GET with an after hook', async () => {
    await expect(
      saveBroken((c) => { getActivity(c).after_hook = "services.logger.note('nope')"; }),
    ).rejects.toThrow(/cannot have an after hook/);
  });

  it('rejects returns on an activity that is not a GET', async () => {
    await expect(
      saveBroken((c) => { workOrderActivities(c).find((a) => a.id === 'act_create_work_orders')!.returns = 'records.work_orders.count()'; }),
    ).rejects.toThrow(/'returns' belongs to GET activities/);
  });

  it('rejects invoke() of an activity that is not a GET', async () => {
    await expect(
      saveBroken((c) => {
        workOrderActivities(c).find((a) => a.id === 'act_complete_work_orders')!.before_hook =
          "if invoke('act_create_work_orders', {}) is null { fail('x') }";
      }),
    ).rejects.toThrow(/only GET activities can be invoked/);
  });

  it('rejects invoke() of an activity that does not exist', async () => {
    await expect(
      saveBroken((c) => {
        workOrderActivities(c).find((a) => a.id === 'act_complete_work_orders')!.before_hook =
          "if invoke('act_get_nothing', {}) is null { fail('x') }";
      }),
    ).rejects.toThrow(/no such activity/);
  });
});

describe('invoke() from a hook', () => {
  it('lets a gate ask a GET its question and fail closed on the answer', async () => {
    // §3 tier 2: the before hook re-invokes the declared producer and compares.
    const SOL = 'demo/get-invoke';
    const OP = 'demo/get-invoke-op';
    const withGuard = structuredClone(config);
    const activities = withGuard.workflows.find((w) => w.id === 'wf_work_orders')!.activities;
    activities.find((a) => a.id === 'act_complete_work_orders')!.before_hook = [
      "if len(invoke('act_get_work_orders', { status: 'Dispatched' })) = 0 {",
      "  fail('Nothing is dispatched — complete a dispatched work order')",
      '}',
    ].join('\n');
    await ensureSolution(db, SOL, 'Invoke');
    await putConfig(db, SOL, withGuard, sink);
    await ensureOperation(db, OP, SOL, 'Invoke');

    const run = (activityId: string, attributes: Record<string, unknown>, recordId?: string) =>
      appRouter.createCaller({ db, sink }).activities.run({ operationId: OP, activityId, recordId, attributes });

    await run('act_raise_inspection_jobs', { id: 'JOB-I', job_no: 'J-901', job_type: 'Inspection', contract_id: '', location: 'Depot', due_date: '2026-08-01' });
    await run('act_create_work_orders', { id: 'WO-I1', job_id: 'JOB-I', activity_code: 'AC-1', problem_code: '', location: 'Site C', due_date: '2026-09-03', workgroup_id: '' });

    // Nothing dispatched yet — the gate's query comes back empty and blocks.
    await expect(run('act_complete_work_orders', { completed_date: '2026-08-01' }, 'WO-I1'))
      .rejects.toThrow(/Nothing is dispatched/);

    // Dispatch one, and the same gate now passes on the same data.
    await run('act_dispatch_work_orders', { crew: 'Crew A' }, 'WO-I1');
    await expect(run('act_complete_work_orders', { completed_date: '2026-08-01' }, 'WO-I1')).resolves.toMatchObject({ status: 'done' });
  });
});
