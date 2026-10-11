// A record the server would not send (2026-10-12): following a reference to it
// says "Record access denied" instead of reading as null, so a page tells the
// reader rather than showing a blank that reads as "there is none".

import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '@fluxus/dsl';
import { MemoryAdapter } from '../src/memoryAdapter';
import { buildEvalHost } from '../src/bridge';
import { RecordAccessDeniedError } from '../src/errors';
import type { ClientSolutionConfig } from '../src/types';

const config = {
  attributes: [], activities: [],
  workflows: [{ id: 'wf_jobs', name: 'Jobs', activities: [] }, { id: 'wf_quotes', name: 'Quotes', activities: [] }],
  recordTypes: [
    { id: 'rt_quotes', name: 'Quotes', workflow_ref: 'wf_quotes', custom_fields: [{ key: 'amount', type: 'text' }] },
    { id: 'rt_jobs', name: 'Jobs', workflow_ref: 'wf_jobs', custom_fields: [{ key: 'quote', type: 'fk_ref', fk_record_type: 'rt_quotes', fk_display_field: 'amount' }] },
  ],
} as unknown as ClientSolutionConfig;

const QUOTE = '01a12b26-0000-7000-8000-000000000001';

function setup() {
  const adapter = new MemoryAdapter(config);
  const job = adapter.createRecord('rt_jobs', { quote: QUOTE });
  const read = (source: string) => evaluateExpression(source, buildEvalHost(adapter, config, { anchorRecord: job, readonlyRecords: true }));
  return { adapter, job, read };
}

describe('a withheld record', () => {
  it('says access is denied when a reference to it is followed', () => {
    const { adapter, read } = setup();
    adapter.mergeRecords([], [QUOTE]);
    expect(() => read('context.record.quote.amount')).toThrow(RecordAccessDeniedError);
    expect(() => read('context.record.quote.amount')).toThrow('Record access denied');
  });

  it('is told apart from a record that is simply not held, which still reads as null', () => {
    const { read } = setup();
    expect(read('context.record.quote.amount')).toBeNull();
  });

  it('stops being withheld once the record itself arrives', () => {
    const { adapter, job, read } = setup();
    adapter.mergeRecords([], [QUOTE]);
    adapter.mergeRecords([[QUOTE, { id: QUOTE, typeRef: 'rt_quotes', customFields: { amount: '495' }, activityHistory: [] }]]);
    expect(read('context.record.quote.amount')).toBe('495');
    expect(job.customFields.quote).toBe(QUOTE);
  });

  it('is replaced wholesale by a refresh', () => {
    const { adapter, job, read } = setup();
    adapter.mergeRecords([], [QUOTE]);
    adapter.replaceRecords([[job.id, job]]);
    expect(read('context.record.quote.amount')).toBeNull();
  });
});
