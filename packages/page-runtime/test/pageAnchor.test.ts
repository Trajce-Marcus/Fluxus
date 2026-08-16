// How a page reaches the record it is about (DATA_THROUGH_ACTIVITIES step 3).
// The rule under test: a page that acts has exactly one record, and the only
// way one comes into being is a create activity — a page opening its board for
// the first time takes the same path as a person raising a work order.
//
// The client is a stub over a store that stands in for the server's, so these
// tests are about the resolution, not the wire. Note what the stub does NOT
// do: put anything in a local snapshot. Since 2026-08-16 the resolution asks
// the client for the record — a pages-only host connects with no records, and
// asking an empty snapshot whether the board exists yet would open a second
// board on every page open.

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
  // Stands in for the server's records, not for a browser snapshot.
  const server = new MemoryAdapter(CONFIG);
  const runActivity = vi.fn(async ({ activityId }: { activityId: string }) => {
    // What the server does, seen from the browser: the record exists
    // afterwards, and can be fetched by the id the run answered with.
    const created = server.createRecord('rt_dispatch_boards', { title: `via ${activityId}` });
    return { status: 'done' as const, warnings: [], recordId: created.id };
  });
  const fetchRecord = vi.fn(async (recordId: string) => server.getRecord(recordId));
  const fetchRecords = vi.fn(async (typeId: string) => server.getRecordTypeData(typeId));
  const runtime = {
    store: new MemoryAdapter(CONFIG), // the browser's own, deliberately empty
    client: { runActivity, fetchRecord, fetchRecords },
  } as unknown as PageRuntime;
  return { server, runtime, runActivity, fetchRecord, fetchRecords };
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
    const { server, runtime, runActivity } = harness();
    const existing = server.createRecord('rt_dispatch_boards', { title: 'The board' });

    const record = await resolvePageAnchor(runtime, { record: ONE });

    expect(record?.id).toBe(existing.id);
    expect(runActivity).not.toHaveBeenCalled();
  });

  it('picks the same one every time when a type wrongly holds two', async () => {
    const { server, runtime } = harness();
    server.createRecord('rt_dispatch_boards', { title: 'Second' });
    server.createRecord('rt_dispatch_boards', { title: 'First' });
    const ids = server.getRecordTypeData('rt_dispatch_boards').map((r) => r.id).sort();

    const first = await resolvePageAnchor(runtime, { record: ONE });
    const again = await resolvePageAnchor(runtime, { record: ONE });

    expect(first?.id).toBe(ids[0]);
    expect(again?.id).toBe(first?.id);
  });

  it('opens the record named in the URL when the type has many', async () => {
    const { server, runtime, runActivity } = harness();
    const board = server.createRecord('rt_dispatch_boards', { title: 'North' });

    expect((await resolvePageAnchor(runtime, { record: MANY }, board.id))?.id).toBe(board.id);
    expect(runActivity).not.toHaveBeenCalled();
  });

  it('asks the server, not the local snapshot — the host may hold no records', async () => {
    const { server, runtime, runActivity, fetchRecords } = harness();
    server.createRecord('rt_dispatch_boards', { title: 'The board' });

    // The browser's own store is empty and stays empty: if the resolution
    // consulted it, this would raise a second board.
    await resolvePageAnchor(runtime, { record: ONE });

    expect(fetchRecords).toHaveBeenCalledExactlyOnceWith('rt_dispatch_boards');
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
