// Write-back sends only what a run changed (SERVER_DATA_LOADING §3, step 1).
//
// No record's history is loaded any more, and a changed record is patched —
// the fields that differ, merged in; new entries, appended — never rewritten
// whole. What that buys shows only when two requests overlap, so these tests
// overlap them: two GETs logging on one anchor, two runs changing different
// fields of one record, and a run changing a record another request deleted.

import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '../src/db/client';
import { ensureOperation, ensureSolution, findActivity, loadOperationHost, putConfig, RecordDeletedMeanwhileError, writeBack, type OperationHost } from '../src/host';
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

/** Run an activity inside an already-loaded host, as the router does — the way
 *  to hold two requests open at once and choose the order they write in. */
function runIn(host: OperationHost, activityId: string, attributes: Record<string, unknown>, recordId: string) {
  const activity = findActivity(host, activityId)!;
  return host.engine.runActivity(activity, attributes, host.adapter.getRecord(recordId));
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

  it('two runs changing different fields of one record keep both changes and both entries', async () => {
    const id = await create('Widget', '3');
    const first = await loadOperationHost(db, OP);
    const second = await loadOperationHost(db, OP);

    runIn(first, 'act_rename_items', { name: 'Gadget' }, id);
    runIn(second, 'act_recount_items', { qty: '7' }, id);
    await writeBack(db, first);
    // The second run loaded the old name; a whole-record write would put it back.
    await writeBack(db, second);

    const saved = (await row(id))!;
    expect(saved.customFields.name).toBe('Gadget');
    expect(saved.customFields.qty).toBe(7);
    expect(saved.activityHistory.map((e) => e.activityId)).toEqual([
      'act_create_items', 'act_rename_items', 'act_recount_items',
    ]);
  });

  it('writes nothing for a record the run did not change', async () => {
    const id = await create('Untouched', '1');
    const host = await loadOperationHost(db, OP);
    expect(await writeBack(db, host)).toEqual({ created: 0, changed: 0, deleted: 0 });
    expect((await row(id))!.activityHistory).toHaveLength(1);
  });

  it('a run changing a record another request deleted fails and writes nothing', async () => {
    const id = await create('Doomed', '1');
    const late = await loadOperationHost(db, OP);

    await caller().activities.run({ operationId: OP, activityId: 'act_delete_items', recordId: id, attributes: {}, acknowledgedWarnings: true });
    expect(await row(id)).toBeUndefined();

    runIn(late, 'act_rename_items', { name: 'Revived' }, id);
    await expect(writeBack(db, late)).rejects.toBeInstanceOf(RecordDeletedMeanwhileError);

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
