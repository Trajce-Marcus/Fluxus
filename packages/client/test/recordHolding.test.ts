// What the client holds (CONSOLE_RECORD_FETCHING §3): no records at connect;
// each record fetched by id and each list fetched is held until released, the
// local copy is rebuilt from what is held, and a refresh after an activity run
// fetches each again — without wiping a fetch that lands while it runs.

import { describe, expect, it } from 'vitest';
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
  const trpc = {
    records: {
      get: {
        query: async ({ recordId }: { recordId: string }) => {
          calls.get++;
          if (gate) await gate;
          const r = server.get(recordId);
          if (!r) throw new Error(`Record not found: ${recordId}`);
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
  return { server, client, adapter, calls, hold };
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

  it('refresh fetches each held entry once, and drops a record that no longer reads back', async () => {
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
