// How a page reaches the record it is about (DATA_THROUGH_ACTIVITIES step 3).
// The rule under test: a page that acts has exactly one record, and the only
// way one comes into being is a create activity — a page opening its board for
// the first time takes the same path as a person raising a work order.
//
// The client is a stub that does what the server does (run, then the snapshot
// holds the new record), so these tests are about the resolution, not the wire.

import { describe, expect, it, vi } from 'vitest';
import { MemoryAdapter, type ClientSolutionConfig } from '@fluxus/engine';
import { resolvePageAnchor } from '../src/pageAnchor';
import type { PageRuntime } from '../src/runtime';

const CONFIG: ClientSolutionConfig = {
  attributes: [],
  recordTypes: [
    {
      id: 'rt_dispatch_boards',
      name: 'Dispatch Boards',
      description: 'One board per crew group — an app record, an ordinary type',
      workflow_ref: 'wf_dispatch_boards',
      custom_fields: [{ key: 'title', label: 'Title', description: 'What this board is', type: 'text' }],
    },
    {
      id: 'rt_notifications',
      name: 'Notifications',
      description: 'Raised by other workflows only',
      workflow_ref: 'wf_notifications',
      custom_fields: [],
    },
  ],
  workflows: [
    {
      id: 'wf_dispatch_boards',
      name: 'Dispatch Boards',
      description: 'Board lifecycle',
      activities: [
        {
          id: 'act_create_dispatch_boards',
          name: 'Open Dispatch Board',
          description: 'Bring the board into being',
          sort_order: 1,
          record_map: 'CREATE',
          attributes: [],
        },
      ],
    },
    {
      id: 'wf_notifications',
      name: 'Notifications',
      description: 'No way in from a page',
      activities: [],
    },
  ],
};

function harness() {
  const store = new MemoryAdapter(CONFIG);
  const runActivity = vi.fn(async ({ activityId }: { activityId: string }) => {
    // What the server does, seen from the browser: the record exists
    // afterwards, and the snapshot has it.
    const created = store.createRecord('rt_dispatch_boards', { title: `via ${activityId}` });
    return { status: 'done' as const, warnings: [], recordId: created.id };
  });
  const runtime = { store, client: { runActivity } } as unknown as PageRuntime;
  return { store, runtime, runActivity };
}

const ONE = { type: 'rt_dispatch_boards', instances: 'one' } as const;
const MANY = { type: 'rt_dispatch_boards', instances: 'many' } as const;

describe('resolvePageAnchor', () => {
  it('gives a pure view no record at all', async () => {
    const { runtime, runActivity } = harness();
    expect(await resolvePageAnchor(runtime, {})).toBeNull();
    expect(runActivity).not.toHaveBeenCalled();
  });

  it('creates the one instance the first time the page is opened', async () => {
    const { runtime, runActivity } = harness();

    const record = await resolvePageAnchor(runtime, { record: ONE });

    expect(record?.typeRef).toBe('rt_dispatch_boards');
    // Created through the create activity, not written into the store behind
    // the pipeline's back — so the record's history starts with "created".
    expect(runActivity).toHaveBeenCalledExactlyOnceWith({ activityId: 'act_create_dispatch_boards', attributes: {} });
  });

  it('opens the one that exists instead of creating a second', async () => {
    const { store, runtime, runActivity } = harness();
    const existing = store.createRecord('rt_dispatch_boards', { title: 'The board' });

    const record = await resolvePageAnchor(runtime, { record: ONE });

    expect(record?.id).toBe(existing.id);
    expect(runActivity).not.toHaveBeenCalled();
  });

  it('picks the same one every time when a type wrongly holds two', async () => {
    const { store, runtime } = harness();
    store.createRecord('rt_dispatch_boards', { title: 'Second' });
    store.createRecord('rt_dispatch_boards', { title: 'First' });
    const ids = store.getRecordTypeData('rt_dispatch_boards').map((r) => r.id).sort();

    const first = await resolvePageAnchor(runtime, { record: ONE });
    const again = await resolvePageAnchor(runtime, { record: ONE });

    expect(first?.id).toBe(ids[0]);
    expect(again?.id).toBe(first?.id);
  });

  it('opens the record named in the URL when the type has many', async () => {
    const { store, runtime, runActivity } = harness();
    const board = store.createRecord('rt_dispatch_boards', { title: 'North' });

    expect((await resolvePageAnchor(runtime, { record: MANY }, board.id))?.id).toBe(board.id);
    expect(runActivity).not.toHaveBeenCalled();
  });

  it('refuses to guess which of many the page meant', async () => {
    const { runtime } = harness();
    await expect(resolvePageAnchor(runtime, { record: MANY })).rejects.toThrow(/open it with a record id/);
  });

  it('refuses a record type the model does not have', async () => {
    const { runtime } = harness();
    await expect(resolvePageAnchor(runtime, { record: { type: 'rt_gone', instances: 'one' } }))
      .rejects.toThrow(/not a record type in this model/);
  });

  it('refuses a type with no way in — a page cannot invent a record', async () => {
    const { runtime } = harness();
    await expect(resolvePageAnchor(runtime, { record: { type: 'rt_notifications', instances: 'one' } }))
      .rejects.toThrow(/no create activity/);
  });
});
