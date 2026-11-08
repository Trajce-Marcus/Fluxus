// What the client holds (CONSOLE_RECORD_FETCHING §3): no records at connect;
// each record fetched by id and each list fetched is held until released, the
// local copy is rebuilt from what is held, and a refresh after an activity run
// fetches each again — without wiping a fetch that lands while it runs.

import { describe, expect, it } from 'vitest';
import { TRPCClientError } from '@trpc/client';
import { MemoryAdapter, type ClientSolutionModel, type RecordInstance } from '@fluxus/engine';
import { FluxusClient } from '../src/index';

const model = {
  attributes: [], activities: [],
  workflows: [{ id: 'wf_areas', name: 'Areas', activities: [] }, { id: 'wf_findings', name: 'Findings', activities: [] }],
  recordTypes: [
    { id: 'rt_areas', name: 'Areas', workflow_ref: 'wf_areas', custom_fields: [{ key: 'name', type: 'text' }] },
    { id: 'rt_findings', name: 'Findings', workflow_ref: 'wf_findings', custom_fields: [{ key: 'area', type: 'fk_ref', fk_record_type: 'rt_areas', fk_display_field: 'name' }] },
  ],
} as unknown as ClientSolutionModel;

const rec = (id: string, typeRef: string, customFields: Record<string, unknown> = {}, history = 0): RecordInstance =>
  ({ id, typeRef, customFields, activityHistory: Array.from({ length: history }, () => ({}) as never) });

/** A server of records, and a client built on a fake tRPC over it that counts calls. */
function harness() {
  const server = new Map<string, RecordInstance>([
    ['K1', rec('K1', 'rt_areas', { name: 'Kitchen' }, 1)],
    ['F1', rec('F1', 'rt_findings', { area: 'K1' }, 2)],
    ['F2', rec('F2', 'rt_findings', { area: 'K1' }, 1)],
  ]);
  const calls = { get: 0, list: 0 };
  let gate: Promise<void> | null = null;
  // records.get fails as a dropped connection would: while offline, and for
  // the next `failNext` calls.
  let offline = false;
  let failNext = 0;
  const trpc = {
    records: {
      get: {
        query: async ({ recordId }: { recordId: string }) => {
          calls.get++;
          if (gate) await gate;
          if (offline || (failNext > 0 && failNext-- > 0)) throw new TypeError('Failed to fetch');
          const r = server.get(recordId);
          if (!r) throw new TRPCClientError(`Record not found: ${recordId}`, { result: { error: { message: 'not found', code: -32004, data: { code: 'NOT_FOUND' } } } } as never);
          const area = r.customFields.area ? server.get(r.customFields.area as string) : undefined;
          return { ...r, references: area ? [area] : [], withheld: [] };
        },
      },
      list: {
        query: async ({ typeId, fieldKey, value }: { typeId: string; fieldKey?: string; value?: string }) => {
          calls.list++;
          if (gate) await gate;
          const rows = [...server.values()]
            .filter((r) => r.typeRef === typeId && (fieldKey === undefined || r.customFields[fieldKey] === value))
            .map((r) => ({ ...r, activityHistory: [] }));
          return { rows, labels: typeId === 'rt_findings' ? [{ id: 'K1', typeRef: 'rt_areas', field: 'name', label: 'Kitchen' }] : [] };
        },
      },
    },
  };
  const adapter = new MemoryAdapter(model);
  const Ctor = FluxusClient as unknown as new (...args: unknown[]) => FluxusClient;
  const client = new Ctor(trpc, 'op', 'sol', model, adapter, new Map(), [], '', 'sol', 'op', '', [], false);
  const hold = () => { let open!: () => void; gate = new Promise((r) => { open = r; }); return () => { gate = null; open(); }; };
  const goOffline = (on: boolean) => { offline = on; };
  const failNextGets = (n: number) => { failNext = n; };
  return { server, client, adapter, calls, hold, goOffline, failNextGets };
}

describe('what the client holds', () => {
  it('holds nothing until something is fetched', () => {
    const { adapter } = harness();
    expect(adapter.allRecords()).toEqual([]);
  });

  it('a list brings its rows and labels, not the records behind its references', async () => {
    const { client, adapter } = harness();
    await client.fetchRecords('rt_findings');
    expect(adapter.allRecords().map((r) => r.id).sort()).toEqual(['F1', 'F2']);
    expect(adapter.resolveDisplayLabel('rt_areas', 'name', 'K1')).toBe('Kitchen');
    expect(client.isRecordFetched('F1')).toBe(false);
  });

  it('a record fetched by id is held in full, and wins over its list row', async () => {
    const { client, adapter } = harness();
    await client.fetchRecords('rt_findings');
    await client.fetchRecord('F1');
    expect(client.isRecordFetched('F1')).toBe(true);
    expect(adapter.getRecord('F1').activityHistory).toHaveLength(2);
    expect(adapter.allRecords().map((r) => r.id).sort()).toEqual(['F1', 'F2', 'K1']);
  });

  it('counts holders, and lets go when the last one releases', async () => {
    const { client, adapter } = harness();
    await client.fetchRecord('F1');
    await client.fetchRecord('F1');
    client.releaseRecord('F1');
    expect(client.isRecordFetched('F1')).toBe(true);
    client.releaseRecord('F1');
    expect(client.isRecordFetched('F1')).toBe(false);
    expect(adapter.allRecords()).toEqual([]);
    await client.fetchRecords('rt_findings', { fieldKey: 'area', value: 'K1' });
    client.releaseRecords('rt_findings', { fieldKey: 'area', value: 'K1' });
    expect(adapter.allRecords()).toEqual([]);
  });

  it('refresh fetches each held entry once, and stops showing a record the server says is gone', async () => {
    const { client, adapter, calls, server } = harness();
    await client.fetchRecords('rt_findings');
    await client.fetchRecord('F1');
    await client.fetchRecord('F2');
    calls.get = 0; calls.list = 0;
    server.delete('F2');
    await client.refresh();
    expect(calls).toEqual({ get: 2, list: 1 });
    expect(client.isRecordFetched('F2')).toBe(false);
    expect(adapter.allRecords().map((r) => r.id).sort()).toEqual(['F1', 'K1']);
  });

  it('a gone record keeps its holders, so their releases still pair', async () => {
    const { client, server } = harness();
    await client.fetchRecord('F2');
    server.delete('F2');
    await client.refresh();
    server.set('F2', rec('F2', 'rt_findings', { area: 'K1' }, 1));
    await client.fetchRecord('F2'); // a second holder, of the same entry
    client.releaseRecord('F2'); // the first holder lets go
    expect(client.isRecordFetched('F2')).toBe(true);
  });

  it('refresh keeps the last copy when the server cannot be reached', async () => {
    const { client, adapter, goOffline } = harness();
    await client.fetchRecord('F1');
    goOffline(true);
    await client.refresh();
    expect(client.isRecordFetched('F1')).toBe(true);
    expect(adapter.allRecords().map((r) => r.id)).toContain('F1');
  });

  it('refresh leaves a record still on its first fetch to that fetch', async () => {
    const { client, hold, goOffline, calls } = harness();
    const release = hold();
    const fetching = client.fetchRecord('F1');
    calls.get = 0;
    await client.refresh();
    expect(calls.get).toBe(0);
    release();
    await fetching;
    goOffline(false);
    expect(client.isRecordFetched('F1')).toBe(true);
  });

  it('a fetch that fails after its holder let go takes no hold from a newer one', async () => {
    const { client, hold, failNextGets } = harness();
    const release = hold();
    failNextGets(1);
    const first = client.fetchRecord('F1').catch(() => null);
    client.releaseRecord('F1'); // the first holder moves on while its fetch is out
    const second = client.fetchRecord('F1'); // a newer holder, its fetch out too
    release();
    await Promise.all([first, second]); // the first fails — and must not release the second's hold
    expect(client.isRecordFetched('F1')).toBe(true);
  });

  it('a fetch that lands while a refresh runs survives it', async () => {
    const { client, adapter, hold } = harness();
    await client.fetchRecord('F1');
    const release = hold();
    const refreshing = client.refresh();
    // F2 arrives only through this list, fetched while the refresh is out.
    const fetching = client.fetchRecords('rt_findings', { fieldKey: 'area', value: 'K1' });
    release();
    await Promise.all([refreshing, fetching]);
    expect(adapter.allRecords().map((r) => r.id).sort()).toEqual(['F1', 'F2', 'K1']);
    expect(client.isRecordFetched('F1')).toBe(true);
  });
});
