// The database store (SERVER_DATA_LOADING §4, §7 step 2): a run reads only
// what it touches, writes through as it goes inside one transaction with a
// savepoint per hook, and commits exactly what §4.2 lists. Over the real
// stack — tRPC → engine → DatabaseStore → PGlite — because what is being
// proved is what reaches the database.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '../src/db/client';
import { DatabaseStore, ensureOperation, ensureSolution, findActivity, loadOperationHost, putConfig } from '../src/host';
import { appRouter } from '../src/router';
import { records } from '../src/db/schema';
import type { NotificationEvent, NotifySink } from '../src/services/notify';
import type { ActivityHistoryEntry, SolutionConfig } from '@fluxus/engine';

const SOL = 'test/database-store';
const OP = 'test/database-store';

const text = (key: string) => ({ key, type: 'text', label: key, description: '' });
const act = (id: string, record_map: string | null, attributes: string[], hooks: { before?: string; after?: string; returns?: string } = {}) => ({
  id, name: id, description: '', sort_order: 0, record_map,
  before_hook: hooks.before ?? null, after_hook: hooks.after ?? null,
  attributes: attributes.map((a) => ({ attribute_ref: a })),
  ...(hooks.returns ? { returns: hooks.returns } : {}),
});

const config = {
  attributes: [text('name'), text('note'), text('target'), { key: 'item_id', type: 'text', label: 'Item', description: '' }],
  recordTypes: [
    { id: 'rt_items', name: 'Items', description: '', workflow_ref: 'wf_items',
      custom_fields: [{ key: 'name', type: 'text', label: 'Name', default: '' }] },
    { id: 'rt_parts', name: 'Parts', description: '', workflow_ref: 'wf_parts',
      custom_fields: [
        { key: 'name', type: 'text', label: 'Name', default: '' },
        { key: 'item_id', type: 'fk_ref', fk_record_type: 'rt_items', fk_display_field: 'name', label: 'Item', default: '' },
      ] },
    { id: 'rt_tags', name: 'Tags', description: '', workflow_ref: 'wf_tags',
      custom_fields: [{ key: 'name', type: 'text', label: 'Name', default: '' }] },
  ],
  workflows: [
    { id: 'wf_items', name: 'Items', description: '', activities: [
      act('act_create_items', 'CREATE', ['name']),
      act('act_rename_items', 'UPDATE', ['name']),
      act('act_delete_items', 'DELETE', []),
      act('act_gated_rename_items', 'UPDATE', ['name'], { before: "warn('Are you sure?')" }),
      // Reads one type only, so a run of it must not read the others.
      act('act_count_tags_items', null, [], { after: "warn('tags:' + records.tags.count)" }),
      // A hook that writes all three ways, then reads each back.
      act('act_shuffle_items', null, [], { after: `
        records.tags.create({ name: 'fresh' })
        records.tags.where(name = 'old').first.update({ name: 'renamed' })
        records.tags.where(name = 'doomed').first.delete()
        warn('fresh:' + records.tags.where(name = 'fresh').count)
        warn('renamed:' + records.tags.where(name = 'renamed').count)
        warn('old:' + records.tags.where(name = 'old').count)
        warn('doomed:' + records.tags.where(name = 'doomed').count)` }),
      // The same writes, then a refusal: the record map's rename and the entry
      // stand, the hook's writes do not.
      act('act_shuffle_failing_items', 'UPDATE', ['name'], { after: `
        records.tags.create({ name: 'fresh' })
        records.tags.where(name = 'old').first.update({ name: 'renamed' })
        records.tags.where(name = 'doomed').first.delete()
        fail('refused')` }),
      // A subtree in one hook: the item and every part pointing at it.
      act('act_prune_items', null, ['target'], { after: `
        let it = records.items.where(name = attributes.target).first
        for each p in it.parts { p.delete() }
        it.delete()` }),
      // The parent alone, while parts still point at it — and a write before
      // it, which the refusal must undo too.
      act('act_prune_parent_items', null, ['target'], { after: `
        records.tags.create({ name: 'before the delete' })
        records.items.where(name = attributes.target).first.delete()` }),
      // What the after hook sees of the anchor the record map just changed.
      act('act_rename_seen_items', 'UPDATE', ['name'], { after: 'warn(context.record.name)' }),
      // A database error mid-run: a NUL character is text Postgres refuses in
      // jsonb, so the hook's create fails in the database, not in a check.
      act('act_rename_broken_items', 'UPDATE', ['name', 'note'], { after: `
        records.tags.create({ name: 'first' })
        records.tags.create({ name: attributes.note })` }),
      act('act_notify_items', null, ['note'], { after: "queue services.notify.user('hello')" }),
      act('act_notify_failing_items', null, [], { after: "queue services.notify.user('never')\nfail('no')" }),
      act('act_get_items', 'GET', [], { returns: 'records.items' }),
      act('act_get_broken_items', 'GET', [], { returns: '1 / 0' }),
    ] },
    { id: 'wf_parts', name: 'Parts', description: '', activities: [act('act_create_parts', 'CREATE', ['name', 'item_id'])] },
    { id: 'wf_tags', name: 'Tags', description: '', activities: [act('act_create_tags', 'CREATE', ['name'])] },
  ],
} as unknown as SolutionConfig;

let db: Db;
const notifications: NotificationEvent[] = [];
const events: string[] = [];
const sink: NotifySink = {
  append: (event) => {
    notifications.push(event);
    events.push(`notify ${event.message}`);
  },
};
const caller = () => appRouter.createCaller({ db, sink });
const runOn = (activityId: string, recordId: string | undefined, attributes: Record<string, unknown> = {}, acknowledgedWarnings?: boolean) =>
  caller().activities.run({ operationId: OP, activityId, recordId, attributes, acknowledgedWarnings });
const create = async (activityId: string, attributes: Record<string, unknown>) => (await runOn(activityId, undefined, attributes)).recordId!;

async function row(id: string) {
  const [r] = await db.select().from(records).where(and(eq(records.operationId, OP), eq(records.id, id)));
  return r as { customFields: Record<string, unknown>; activityHistory: ActivityHistoryEntry[] } | undefined;
}
async function tagNames() {
  const rows = await db.select().from(records).where(and(eq(records.operationId, OP), eq(records.typeRef, 'rt_tags')));
  return rows.map((r) => (r.customFields as Record<string, unknown>).name as string).sort();
}
async function clearTags() {
  await db.delete(records).where(and(eq(records.operationId, OP), eq(records.typeRef, 'rt_tags')));
}

beforeAll(async () => {
  db = await createDb(); // in-memory PGlite
  await ensureSolution(db, SOL, 'Database store');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Database store');
});

afterEach(() => {
  vi.restoreAllMocks();
  notifications.length = 0;
  events.length = 0;
});

describe('a run reads only what it touches', () => {
  it('reads the anchor and the one type its hook names — no other record, no other type', async () => {
    const item = await create('act_create_items', { name: 'Anchor' });
    const other = await create('act_create_items', { name: 'Other' });
    await create('act_create_parts', { name: 'P', item_id: other });
    await create('act_create_tags', { name: 'T1' });

    const byType = vi.spyOn(DatabaseStore.prototype, 'getRecordTypeData');
    const byId = vi.spyOn(DatabaseStore.prototype, 'getRecord');
    const byField = vi.spyOn(DatabaseStore.prototype, 'getRecordsByField');

    const result = await runOn('act_count_tags_items', item);
    expect(result.warnings).toContain(`tags:${(await tagNames()).length}`);

    expect(byType.mock.calls.map(([type]) => type)).toEqual(['rt_tags']);
    expect(new Set(byId.mock.calls.map(([id]) => id))).toEqual(new Set([item]));
    expect(byField).not.toHaveBeenCalled();
  });

  it('a host_load reads no record at all', async () => {
    const byType = vi.spyOn(DatabaseStore.prototype, 'getRecordTypeData');
    const byId = vi.spyOn(DatabaseStore.prototype, 'getRecord');
    const host = await loadOperationHost(db, OP);
    expect(host.store).toBeInstanceOf(DatabaseStore);
    expect(byType).not.toHaveBeenCalled();
    expect(byId).not.toHaveBeenCalled();
  });
});

describe('writes go through as they happen (ruling 10)', () => {
  it('a hook creates, updates and deletes, and reads each back — its deletes included', async () => {
    await clearTags();
    const item = await create('act_create_items', { name: 'Shuffler' });
    await create('act_create_tags', { name: 'old' });
    await create('act_create_tags', { name: 'doomed' });

    const result = await runOn('act_shuffle_items', item);
    expect(result.warnings).toEqual(expect.arrayContaining(['fresh:1', 'renamed:1', 'old:0', 'doomed:0']));
    expect(await tagNames()).toEqual(['fresh', 'renamed']);
  });

  it('a failing hook leaves none of its writes, and keeps the record map change and the entry', async () => {
    await clearTags();
    const item = await create('act_create_items', { name: 'Before' });
    await create('act_create_tags', { name: 'old' });
    await create('act_create_tags', { name: 'doomed' });

    await expect(runOn('act_shuffle_failing_items', item, { name: 'After' })).rejects.toThrow(/no changes were applied: refused/);

    expect(await tagNames()).toEqual(['doomed', 'old']);
    const saved = (await row(item))!;
    expect(saved.customFields.name).toBe('After');
    expect(saved.activityHistory.map((e) => e.activityId)).toEqual(['act_create_items', 'act_shuffle_failing_items']);
  });

  it('deleting a subtree in one hook works', async () => {
    const anchor = await create('act_create_items', { name: 'Pruner' });
    const doomed = await create('act_create_items', { name: 'Subtree root' });
    const parts = [
      await create('act_create_parts', { name: 'A', item_id: doomed }),
      await create('act_create_parts', { name: 'B', item_id: doomed }),
    ];

    const result = await runOn('act_prune_items', anchor, { target: 'Subtree root' });
    expect(result.status).toBe('done');
    expect(await row(doomed)).toBeUndefined();
    for (const id of parts) expect(await row(id)).toBeUndefined();
  });

  it('deleting a referenced parent alone fails, and undoes the whole hook', async () => {
    await clearTags();
    const anchor = await create('act_create_items', { name: 'Pruner 2' });
    const parent = await create('act_create_items', { name: 'Held parent' });
    const part = await create('act_create_parts', { name: 'C', item_id: parent });

    await expect(runOn('act_prune_parent_items', anchor, { target: 'Held parent' }))
      .rejects.toThrow(/cannot be deleted — rt_parts.item_id still points at it/);

    expect(await row(parent)).toBeDefined();
    expect(await row(part)).toBeDefined();
    expect(await tagNames()).toEqual([]);
    // The run was recorded: the refusal is the hook's, not the activity's.
    expect((await row(anchor))!.activityHistory.map((e) => e.activityId)).toContain('act_prune_parent_items');
  });
});

describe('the anchor is one object for the whole request', () => {
  it('the object the router holds sees the record map change, and the after hook reads it', async () => {
    const id = await create('act_create_items', { name: 'Old name' });
    const host = await loadOperationHost(db, OP);
    await host.store.begin();
    const anchor = await host.store.getRecord(id);
    const result = await host.engine.runActivity(findActivity(host, 'act_rename_seen_items')!, { name: 'New name' }, anchor);
    await host.store.commit();

    expect(anchor.customFields.name).toBe('New name');
    expect(await host.store.getRecord(id)).toBe(anchor);
    expect(result.warnings).toContain('New name');
  });
});

describe('what commits (§4.2)', () => {
  it('needs-confirmation writes nothing', async () => {
    const id = await create('act_create_items', { name: 'Unchanged' });
    const result = await runOn('act_gated_rename_items', id, { name: 'Changed' });
    expect(result.status).toBe('needs-confirmation');
    const saved = (await row(id))!;
    expect(saved.customFields.name).toBe('Unchanged');
    expect(saved.activityHistory).toHaveLength(1);
  });

  it('a DELETE record map deletes nothing until confirmed, then deletes', async () => {
    const id = await create('act_create_items', { name: 'Delete me' });
    const asked = await runOn('act_delete_items', id);
    expect(asked.status).toBe('needs-confirmation');
    expect(await row(id)).toBeDefined();

    const done = await runOn('act_delete_items', id, {}, true);
    expect(done).toMatchObject({ status: 'done', deleted: true });
    expect(await row(id)).toBeUndefined();
  });

  it("a GET whose `returns` throws writes its error entry", async () => {
    const id = await create('act_create_items', { name: 'Read on' });
    await expect(
      caller().activities.query({ operationId: OP, activityId: 'act_get_broken_items', recordId: id }),
    ).rejects.toThrow(/Division by zero/);
    const last = (await row(id))!.activityHistory.at(-1)!;
    expect(last.activityId).toBe('act_get_broken_items');
    expect(last.capturedAttributes.system_outcome).toBe('error');
  });

  it('a database error rolls back everything — the record map change, the hook, the entry', async () => {
    await clearTags();
    const id = await create('act_create_items', { name: 'Intact' });
    await expect(runOn('act_rename_broken_items', id, { name: 'Renamed', note: 'bad\u0000text' })).rejects.toThrow();

    const saved = (await row(id))!;
    expect(saved.customFields.name).toBe('Intact');
    expect(saved.activityHistory.map((e) => e.activityId)).toEqual(['act_create_items']);
    expect(await tagNames()).toEqual([]);
  });
});

describe('queued calls wait for the commit', () => {
  it('fire only after the commit', async () => {
    const commit = DatabaseStore.prototype.commit;
    vi.spyOn(DatabaseStore.prototype, 'commit').mockImplementation(async function (this: DatabaseStore) {
      events.push('commit starts');
      const counts = await commit.call(this);
      events.push('commit done');
      return counts;
    });
    const id = await create('act_create_items', { name: 'Notifier' });
    events.length = 0;

    await runOn('act_notify_items', id, { note: 'ok' });
    expect(events).toEqual(['commit starts', 'notify hello', 'commit done']);
    // `notify hello` sits between the two because dispatch is the last thing
    // commit does — after the transaction has resolved.
    expect(notifications.map((n) => n.message)).toEqual(['hello']);
  });

  it('never fire when the hook fails', async () => {
    const id = await create('act_create_items', { name: 'Quiet' });
    await expect(runOn('act_notify_failing_items', id)).rejects.toThrow(/no changes were applied/);
    expect(notifications).toEqual([]);
  });

  it('never fire when the run rolls back after the hook succeeded', async () => {
    const id = await create('act_create_items', { name: 'Quiet too' });
    // The hook queues and succeeds; the entry then carries a NUL the database
    // refuses, so the run rolls back — and the queued call goes with it.
    await expect(runOn('act_notify_items', id, { note: 'bad\u0000text' })).rejects.toThrow();
    expect(notifications).toEqual([]);
    expect((await row(id))!.activityHistory).toHaveLength(1);
  });
});
