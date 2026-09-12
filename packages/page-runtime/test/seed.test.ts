// Records a control hands to an activity, landing in one named attribute
// (2026-09-08). The rule under test: the seed is always a list, and the
// attribute's own cardinality decides what it becomes.

import { describe, expect, it } from 'vitest';
import type { AttributeDef } from '@fluxus/engine';
import { seedValue } from '../src/capture/seed';

const one = { key: 'work_order', name: 'Work order', type: 'reference' } as AttributeDef;
const many = { key: 'work_orders', name: 'Work orders', type: 'reference', type_config: { multi: true } } as AttributeDef;

describe('a multi attribute', () => {
  it('takes the whole list', () => {
    expect(seedValue(many, ['WO-1', 'WO-2'])).toEqual({ value: ['WO-1', 'WO-2'] });
  });

  it('takes a list of one', () => {
    expect(seedValue(many, ['WO-1'])).toEqual({ value: ['WO-1'] });
  });

  it('takes an empty list, so the form starts empty rather than broken', () => {
    expect(seedValue(many, [])).toEqual({ value: [] });
  });

  it('takes a copy, so the table cannot be written through', () => {
    const records = ['WO-1'];
    const out = seedValue(many, records).value as string[];
    out.push('WO-2');
    expect(records).toEqual(['WO-1']);
  });
});

describe('a single-valued attribute', () => {
  it('takes the only record there is', () => {
    expect(seedValue(one, ['WO-1'])).toEqual({ value: 'WO-1' });
  });

  it('says so rather than silently keeping the first of many', () => {
    const result = seedValue(one, ['WO-1', 'WO-2']);
    expect(result.value).toBeUndefined();
    expect(result.error).toContain('holds one record');
  });

  it('leaves the attribute alone when nothing was selected', () => {
    expect(seedValue(one, [])).toEqual({});
  });
});
