// A run writes only what it changed (SERVER_DATA_LOADING §3, step 1; kept
// through step 2's write-through store).
//
// No record's history is loaded, and a changed record is patched — the fields
// it changes, merged in; new entries, appended — never rewritten whole. What
// that buys shows only when two requests overlap, so these tests overlap them:
// two GETs logging on one anchor, a run changing a record whose other field
// another request changed after the run read it, and a run changing a record
// another request deleted. (PGlite serialises transactions, so the overlap is
// arranged by reading before the other request writes, as a real Postgres
// interleaving would.)

import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '../src/db/client';
import { ensureOperation, ensureSolution, findActivity, loadOperationHost, putConfig, RecordDeletedMeanwhileError, type OperationHost } from '../src/host';
import { appRouter } from '../src/router';
import { records, rptActivities } from '../src/db/schema';
import type { ActivityHistoryEntry, SolutionConfig } from '@fluxus/engine';

const SOL = 'test/write-back';
const OP = 'test/write-back';

const config = {
  attributes: [
    { key: 'name', type: 'text', label: 'Name', description: '' },
    { key: 'qty', type: 'text', label: 'Qty', description: '' },
  ],
  recordTypes: [
    { id: 'rt_items', name: 'Items', description: '', workflow_ref: 'wf_items',
      custom_fields: [
        { key: 'name', type: 'text', label: 'Name', default: '' },
        { key: 'qty', type: 'int', label: 'Qty', default: '' },
      ] },
  ],
  workflows: [
    { id: 'wf_items', name: 'Items', description: '', activities: [
      { id: 'act_create_items', name: 'Create Item', description: '', sort_order: 0, record_map: 'CREATE',
        before_hook: null, after_hook: null, attributes: [{ attribute_ref: 'name' }, { attribute_ref: 'qty' }] },
      { id: 'act_rename_items', name: 'Rename Item', description: '', sort_order: 1, record_map: 'UPDATE',
        before_hook: null, after_hook: null, attributes: [{ attribute_ref: 'name' }] },
      { id: 'act_recount_items', name: 'Recount Item', description: '', sort_order: 2, record_map: 'UPDATE',
        before_hook: null, after_hook: null, attributes: [{ attribute_ref: 'qty' }] },
      // Its after hook always fails: the run is "recorded, but no changes
      // applied" — the rename and the entry persist, the hook's effects do not.
      { id: 'act_rename_failing_items', name: 'Rename Item (failing hook)', description: '', sort_order: 5, record_map: 'UPDATE',
        before_hook: null, after_hook: "records.items.create({ name: 'side effect' })\nfail('hook refused')", attributes: [{ attribute_ref: 'name' }] },
      { id: 'act_delete_items', name: 'Delete Item', description: '', sort_order: 3, record_map: 'DELETE',
        before_hook: null, after_hook: null, attributes: [] },
      { id: 'act_get_items', name: 'Get Items', description: '', sort_order: 4, record_map: 'GET',
        before_hook: null, after_hook: null, attributes: [], returns: 'records.items' },
    ] },
  ],
} as unknown as SolutionConfig;

let db: Db;
const caller = () => appRouter.createCaller({ db });
const create = async (name: string, qty: string) =>
  (await caller().activities.run({ operationId: OP, activityId: 'act_create_items', attributes: { name, qty } })).recordId!;

async function row(id: string) {
  const [r] = await db.select().from(records).where(and(eq(records.operationId, OP), eq(records.id, id)));
  return r as { customFields: Record<string, unknown>; activityHistory: ActivityHistoryEntry[] } | undefined;
}

/** Run an activity on a record the host already read, in its own transaction —
 *  the way to let another request write between a run's read and its write. */
async function runOn(host: OperationHost, activityId: string, attributes: Record<string, unknown>, anchor: Awaited<ReturnType<OperationHost['store']['getRecord']>>) {
  const activity = findActivity(host, activityId)!;
  await host.store.begin();
  try {
    await host.engine.runActivity(activity, attributes, anchor);
  } catch (err) {
    await host.store.rollback();
    throw err;
  }
  return host.store.commit();
}

beforeAll(async () => {
  db = await createDb(); // in-memory PGlite
  await ensureSolution(db, SOL, 'Write-back');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Write-back');
});

describe('write-back sends only what changed', () => {
  it('two GETs on one anchor at the same time both leave their entry', async () => {
    const id = await create('Anchor', '1');
    await Promise.all([
      caller().activities.query({ operationId: OP, activityId: 'act_get_items', recordId: id }),
      caller().activities.query({ operationId: OP, activityId: 'act_get_items', recordId: id }),
    ]);
    const history = (await row(id))!.activityHistory;
    expect(history.filter((e) => e.activityId === 'act_get_items')).toHaveLength(2);
    // …and the create entry that was there before either GET loaded is kept.
    expect(history[0].activityId).toBe('act_create_items');
  });

  it('a run changing one field keeps the field another request changed after the run read it', async () => {
    const id = await create('Widget', '3');
    const first = await loadOperationHost(db, OP);
    const anchor = await first.store.getRecord(id); // holds qty 3

    await caller().activities.run({ operationId: OP, activityId: 'act_recount_items', recordId: id, attributes: { qty: '7' } });
    // The first run still holds the old qty; a whole-record write would put it back.
    await runOn(first, 'act_rename_items', { name: 'Gadget' }, anchor);

    const saved = (await row(id))!;
    expect(saved.customFields.name).toBe('Gadget');
    expect(saved.customFields.qty).toBe(7);
    expect(saved.activityHistory.map((e) => e.activityId)).toEqual([
      'act_create_items', 'act_recount_items', 'act_rename_items',
    ]);
  });

  it('writes nothing for a run that changed nothing', async () => {
    const id = await create('Untouched', '1');
    const host = await loadOperationHost(db, OP);
    await host.store.getRecord(id);
    await host.store.begin();
    expect(await host.store.commit()).toEqual({ created: 0, changed: 0, deleted: 0 });
    expect((await row(id))!.activityHistory).toHaveLength(1);
  });

  it('a run changing a record another request deleted fails and writes nothing', async () => {
    const id = await create('Doomed', '1');
    const late = await loadOperationHost(db, OP);
    const anchor = await late.store.getRecord(id);

    await caller().activities.run({ operationId: OP, activityId: 'act_delete_items', recordId: id, attributes: {}, acknowledgedWarnings: true });
    expect(await row(id)).toBeUndefined();

    await expect(runOn(late, 'act_rename_items', { name: 'Revived' }, anchor)).rejects.toBeInstanceOf(RecordDeletedMeanwhileError);

    // Not brought back to life, and no reporting row for the run that failed.
    expect(await row(id)).toBeUndefined();
    const renames = await db
      .select()
      .from(rptActivities)
      .where(and(eq(rptActivities.recordId, id), eq(rptActivities.activityId, 'act_rename_items')));
    expect(renames).toHaveLength(0);
  });

  it('a failing after hook still saves the record map change and the entry, and none of the hook', async () => {
    const id = await create('Before', '1');
    await expect(
      caller().activities.run({ operationId: OP, activityId: 'act_rename_failing_items', recordId: id, attributes: { name: 'After' } }),
    ).rejects.toThrow(/no changes were applied/);

    const saved = (await row(id))!;
    expect(saved.customFields.name).toBe('After');
    expect(saved.activityHistory.map((e) => e.activityId)).toEqual(['act_create_items', 'act_rename_failing_items']);
    const sideEffects = await db.select().from(records).where(eq(records.operationId, OP));
    expect(sideEffects.filter((r) => (r.customFields as Record<string, unknown>).name === 'side effect')).toHaveLength(0);
  });

  it('a record created and changed in one run is inserted with all of it', async () => {
    const id = await create('Fresh', '2');
    const saved = (await row(id))!;
    expect(saved.customFields).toMatchObject({ name: 'Fresh', qty: 2 });
    expect(saved.activityHistory.map((e) => e.activityId)).toEqual(['act_create_items']);
  });
});
