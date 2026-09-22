// Numbers are stored as numbers (2026-09-22, correcting a defect).
//
// `runActivity` wrote the raw captured bag into the record, so a `decimal`
// field kept the form's string: the CBS budgets read `"2400000"`. The coercion
// existed and ran on the way to the hooks — it never reached storage. What it
// cost downstream: `+` concatenated instead of adding, so nothing could be
// totalled in a script, and a money column sorted as text.

import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/memoryAdapter';
import type { ClientSolutionConfig } from '../src/types';

const config = {
  attributes: [],
  recordTypes: [
    { id: 'rt_cbs_nodes', name: 'CBS', workflow_ref: 'wf_cbs_nodes', custom_fields: [
      { key: 'code', type: 'text', label: 'Code', default: '' },
      { key: 'budget_cost', type: 'decimal', label: 'Budget', default: '' },
      { key: 'budget_qty', type: 'int', label: 'Qty', default: '' },
    ] },
  ],
  workflows: [{ id: 'wf_cbs_nodes', name: 'CBS', activities: [] }],
} as unknown as ClientSolutionConfig;

const adapter = () => new MemoryAdapter(config);

describe('a numeric field holds a number', () => {
  it('coerces what a form submits, on create', () => {
    const node = adapter().createRecord('rt_cbs_nodes', { code: '1000', budget_cost: '2400000', budget_qty: '12' });
    expect(node.customFields.budget_cost).toBe(2400000);
    expect(node.customFields.budget_qty).toBe(12);
    expect(node.customFields.code).toBe('1000');
  });

  it('coerces on update too — a hook writes through the same door', () => {
    const store = adapter();
    const node = store.createRecord('rt_cbs_nodes', { code: '1100' });
    store.updateRecord(node.id, { budget_cost: '640000.50' });
    expect(store.getRecord(node.id).customFields.budget_cost).toBe(640000.5);
  });

  it('leaves a number alone', () => {
    const node = adapter().createRecord('rt_cbs_nodes', { code: '1200', budget_cost: 480000 });
    expect(node.customFields.budget_cost).toBe(480000);
  });

  // Blank means blank everywhere; turning it into null here would be a second
  // change riding on this one.
  it('leaves a blank blank', () => {
    const node = adapter().createRecord('rt_cbs_nodes', { code: '1300', budget_cost: '' });
    expect(node.customFields.budget_cost).toBe('');
  });

  // A typo stays visible rather than silently becoming null.
  it('leaves a value that is not a number as it was typed', () => {
    const node = adapter().createRecord('rt_cbs_nodes', { code: '1400', budget_cost: '2,400,000' });
    expect(node.customFields.budget_cost).toBe('2,400,000');
  });

  it('never touches a text field that happens to hold digits', () => {
    const node = adapter().createRecord('rt_cbs_nodes', { code: '1000', budget_cost: '1' });
    expect(node.customFields.code).toBe('1000');
    expect(typeof node.customFields.code).toBe('string');
  });

  // The point of the whole change: arithmetic works on what comes back.
  it('adds up', () => {
    const store = adapter();
    const a = store.createRecord('rt_cbs_nodes', { code: 'a', budget_cost: '600000' });
    const b = store.createRecord('rt_cbs_nodes', { code: 'b', budget_cost: '480000' });
    const total = (store.getRecord(a.id).customFields.budget_cost as number)
      + (store.getRecord(b.id).customFields.budget_cost as number);
    expect(total).toBe(1080000);
  });
});
