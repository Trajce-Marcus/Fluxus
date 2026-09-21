// A hook that deletes, over the real stack: tRPC → engine → the transactional
// store. Built 2026-09-21 with the DSL `delete` verb.
//
// What it proves that the engine test cannot: `writeBack` diffs the partition
// by absence, so a record a hook removed in memory becomes a real row delete.
// Destruction deserves proof at the database, not one layer above it.

import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '../src/db/client';
import { ensureOperation, ensureSolution, putConfig } from '../src/host';
import { appRouter } from '../src/router';
import { records, rptActivities } from '../src/db/schema';
import type { SolutionConfig } from '@fluxus/engine';

const SOL = 'test/hook-delete';
const OP = 'test/hook-delete';

const config = {
  attributes: [
    { key: 'code', type: 'text', label: 'Code', description: '' },
    { key: 'reason', type: 'text', label: 'Reason', description: '' },
  ],
  recordTypes: [
    { id: 'rt_bins', name: 'Bins', description: '', workflow_ref: 'wf_bins',
      custom_fields: [{ key: 'code', type: 'text', label: 'Code', default: '' }] },
    { id: 'rt_ledgers', name: 'Ledgers', description: '', workflow_ref: 'wf_ledgers',
      custom_fields: [{ key: 'code', type: 'text', label: 'Code', default: '' }] },
  ],
  workflows: [
    { id: 'wf_bins', name: 'Bins', description: '', activities: [{
      id: 'act_create_bins', name: 'Create Bin', description: '', sort_order: 0, record_map: 'CREATE',
      before_hook: null, after_hook: null, attributes: [{ attribute_ref: 'code' }],
    }] },
    { id: 'wf_ledgers', name: 'Ledgers', description: '', activities: [
      { id: 'act_create_ledgers', name: 'Create Ledger', description: '', sort_order: 0, record_map: 'CREATE',
        before_hook: null, after_hook: null, attributes: [{ attribute_ref: 'code' }] },
      // The purge is anchored on the ledger, which survives it and carries the
      // entry saying what went and why.
      { id: 'act_purge_bins_ledgers', name: 'Purge Bins', description: '', sort_order: 1, record_map: 'UPDATE',
        before_hook: null, after_hook: "records.bins.where(code <> 'keep').delete()",
        attributes: [{ attribute_ref: 'reason' }] },
    ] },
  ],
} as unknown as SolutionConfig;

let db: Db;
const caller = () => appRouter.createCaller({ db });
const run = (activityId: string, attributes: Record<string, unknown>, recordId?: string) =>
  caller().activities.run({ operationId: OP, activityId, recordId, attributes });

let ledgerId: string;
let goneIds: string[];
let keptId: string;

beforeAll(async () => {
  db = await createDb(); // in-memory PGlite
  await ensureSolution(db, SOL, 'Hook delete');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Hook delete');

  ledgerId = (await run('act_create_ledgers', { code: 'L-1' })).recordId!;
  goneIds = [];
  for (const code of ['a', 'b']) goneIds.push((await run('act_create_bins', { code })).recordId!);
  keptId = (await run('act_create_bins', { code: 'keep' })).recordId!;
});

const rowsFor = (id: string) =>
  db.select().from(records).where(and(eq(records.operationId, OP), eq(records.id, id)));

describe('a hook that deletes, through the server', () => {
  it('leaves the rows there until it runs', async () => {
    expect(await rowsFor(goneIds[0])).toHaveLength(1);
  });

  it('removes the selected rows from the transactional store', async () => {
    await run('act_purge_bins_ledgers', { reason: 'test data' }, ledgerId);
    for (const id of goneIds) expect(await rowsFor(id)).toHaveLength(0);
  });

  it('leaves the rows it did not select', async () => {
    expect(await rowsFor(keptId)).toHaveLength(1);
  });

  it('records what happened on the anchor, which is still there', async () => {
    const ledger = await caller().records.get({ operationId: OP, recordId: ledgerId });
    const entry = ledger.activityHistory.at(-1)!;
    expect(entry.activityId).toBe('act_purge_bins_ledgers');
    expect(entry.capturedAttributes.reason).toBe('test data');
  });

  // Deferred deliberately (2026-09-21): the reporting rows projected from a
  // deleted record's history are NOT purged with it. Asserted so the day that
  // changes, this test says so rather than the behaviour drifting unnoticed.
  it('leaves the reporting rows standing — the open question, pinned', async () => {
    const rpt = await db.select().from(rptActivities)
      .where(and(eq(rptActivities.operationId, OP), eq(rptActivities.recordId, goneIds[0])));
    expect(rpt.length).toBeGreaterThan(0);
  });
});
