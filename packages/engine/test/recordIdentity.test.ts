// Every record gets its own id, issued by the platform (ruled 2026-09-18).
//
// A record type could nominate a field to key on, and the WBS keyed on its
// code. That made the code load-bearing in three ways nobody asked for: a
// deleted node reserved its code forever against the reporting rows that
// outlive the record, renaming a node left its id saying the old code, and two
// record types picking the same short code collided outright. A code is a
// value; identity is the platform's to issue.

import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/memoryAdapter';
import type { ClientSolutionConfig } from '../src/types';

const config = {
  attributes: [],
  recordTypes: [
    { id: 'rt_wbs_nodes', name: 'WBS', workflow_ref: 'wf_wbs_nodes',
      custom_fields: [{ key: 'code', type: 'text', label: 'Code', default: '', unique: true }] },
    { id: 'rt_cbs_nodes', name: 'CBS', workflow_ref: 'wf_cbs_nodes',
      custom_fields: [{ key: 'code', type: 'text', label: 'Code', default: '' }] },
  ],
  workflows: [
    { id: 'wf_wbs_nodes', name: 'WBS', activities: [] },
    { id: 'wf_cbs_nodes', name: 'CBS', activities: [] },
  ],
} as unknown as ClientSolutionConfig;

const adapter = () => new MemoryAdapter(config);

describe('the id a record is given', () => {
  it('is issued, not taken from a field', () => {
    const store = adapter();
    const node = store.createRecord('rt_wbs_nodes', { code: 'AAA' });
    expect(node.id).not.toBe('AAA');
    expect(node.customFields.code).toBe('AAA');
  });

  it('is a UUID, and a different one every time', () => {
    const store = adapter();
    const ids = Array.from({ length: 50 }, (_, i) => store.createRecord('rt_wbs_nodes', { code: `C${i}` }).id);
    expect(new Set(ids).size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  // Version 7 leads with a timestamp, so ids sort by creation and inserts land
  // at the end of the index rather than scattering across it. Same-millisecond
  // ids are ordered by the counter the spec reserves for exactly this.
  it('sorts by creation', () => {
    const store = adapter();
    const ids = Array.from({ length: 20 }, (_, i) => store.createRecord('rt_wbs_nodes', { code: `S${i}` }).id);
    expect([...ids].sort()).toEqual(ids);
  });

  // The three things natural keys made impossible, each now unremarkable.
  it('lets two record types hold the same code', () => {
    const store = adapter();
    const wbs = store.createRecord('rt_wbs_nodes', { code: '1.0' });
    const cbs = store.createRecord('rt_cbs_nodes', { code: '1.0' });
    expect(wbs.id).not.toBe(cbs.id);
  });

  it('survives a rename of the value it used to be keyed on', () => {
    const store = adapter();
    const node = store.createRecord('rt_wbs_nodes', { code: 'AAA' });
    store.updateRecord(node.id, { code: 'BBB' });
    expect(store.getRecord(node.id).customFields.code).toBe('BBB');
  });

  it('frees the code when the record goes, and never reuses the id', () => {
    const store = adapter();
    const first = store.createRecord('rt_wbs_nodes', { code: 'AAA' });
    store.deleteRecord(first.id);
    const second = store.createRecord('rt_wbs_nodes', { code: 'AAA' });
    expect(second.id).not.toBe(first.id);
  });

  // What the code keeps: a `unique` field is still a unique field. Uniqueness
  // used to fall out of being the id, so retiring natural keys had to leave it
  // stated somewhere — it is a field constraint now, and the WBS declares it.
  it('still enforces a unique code while the record holding it exists', () => {
    const store = adapter();
    store.createRecord('rt_wbs_nodes', { code: 'AAA' });
    expect(() => store.createRecord('rt_wbs_nodes', { code: 'AAA' })).toThrow(/must be unique/);
  });
});
