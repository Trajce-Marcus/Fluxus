// Labels held without their records (CONSOLE_RECORD_FETCHING §4): a list row's
// reference column shows its target's display field from a label the server
// sent beside the rows, answered only for the type and field it was resolved
// with, and replaced with the rest of the snapshot.

import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/memoryAdapter';
import type { ClientSolutionModel } from '../src/types';

const config = {
  attributes: [], activities: [],
  workflows: [{ id: 'wf_areas', name: 'Areas', activities: [] }],
  recordTypes: [{ id: 'rt_areas', name: 'Areas', workflow_ref: 'wf_areas', custom_fields: [{ key: 'name', type: 'text' }] }],
} as unknown as ClientSolutionModel;

const KITCHEN = { id: 'K1', typeRef: 'rt_areas', field: 'name', label: 'Kitchen' };

describe('labels held without their records', () => {
  it('answers a label for the type and display field it was resolved with, and nothing else', () => {
    const adapter = new MemoryAdapter(config);
    adapter.replaceRecords([], [], [KITCHEN]);
    expect(adapter.resolveDisplayLabel('rt_areas', 'name', 'K1')).toBe('Kitchen');
    expect(adapter.resolveDisplayLabel('rt_areas', 'code', 'K1')).toBe('K1');
    expect(adapter.resolveDisplayLabel('rt_jobs', 'name', 'K1')).toBe('K1');
    expect(adapter.resolveDisplayLabel('rt_areas', undefined, 'K1')).toBe('K1');
  });

  it('a held record answers before a label', () => {
    const adapter = new MemoryAdapter(config);
    adapter.replaceRecords([['K1', { id: 'K1', typeRef: 'rt_areas', customFields: { name: 'Kitchen (renamed)' }, activityHistory: [] }]], [], [KITCHEN]);
    expect(adapter.resolveDisplayLabel('rt_areas', 'name', 'K1')).toBe('Kitchen (renamed)');
  });

  it('replacing the snapshot replaces the labels', () => {
    const adapter = new MemoryAdapter(config);
    adapter.replaceRecords([], [], [KITCHEN]);
    adapter.replaceRecords([]);
    expect(adapter.resolveDisplayLabel('rt_areas', 'name', 'K1')).toBe('K1');
  });
});
