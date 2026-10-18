// How a page reaches the record it is about (DATA_THROUGH_ACTIVITIES step 3):
// the id the host was given, fetched from the server.
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
  activities: [
    {
      id: 'act_create_dispatch_boards',
      name: 'Open Dispatch Board',
      description: 'Bring the board into being',
      record_map: 'CREATE',
      attributes: [],
    },
  ],
  workflows: [
    {
      id: 'wf_dispatch_boards',
      name: 'Dispatch Boards',
      description: 'Board lifecycle',
      activities: [{ activity_ref: 'act_create_dispatch_boards' }],
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

const BOARD = { type: 'rt_dispatch_boards' } as const;

describe('resolvePageAnchor', () => {
  it('gives a pure view no record at all', async () => {
    const { runtime, runActivity } = harness();
    expect(await resolvePageAnchor(runtime, {})).toBeNull();
    expect(runActivity).not.toHaveBeenCalled();
  });

  it('opens the record named in the URL, creating nothing', async () => {
    const { server, runtime, runActivity, fetchRecord } = harness();
    const board = server.createRecord('rt_dispatch_boards', { title: 'North' });

    expect((await resolvePageAnchor(runtime, { record: BOARD }, board.id))?.id).toBe(board.id);
    // Fetched from the server: the host may hold no records.
    expect(fetchRecord).toHaveBeenCalledExactlyOnceWith(board.id);
    expect(runActivity).not.toHaveBeenCalled();
  });

  // A single record per operation, found or created at open (`instances:
  // 'one'`), went with apps Part 2 step 2: the operation's app does its job.
  it('refuses to guess which record the page meant', async () => {
    const { runtime, runActivity, fetchRecords } = harness();
    await expect(resolvePageAnchor(runtime, { record: BOARD })).rejects.toThrow(/open it with a record id/);
    expect(fetchRecords).not.toHaveBeenCalled();
    expect(runActivity).not.toHaveBeenCalled();
  });

  it('refuses a record type the model does not have', async () => {
    const { runtime } = harness();
    await expect(resolvePageAnchor(runtime, { record: { type: 'rt_gone' } }, 'x'))
      .rejects.toThrow(/not a record type in this model/);
  });
});
