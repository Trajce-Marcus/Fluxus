// Records a control hands to an activity, landing in one named attribute
// (2026-09-08). The rule under test: the seed is always a list, and the
// attribute's own cardinality decides what it becomes.

import { describe, expect, it } from 'vitest';
import type { AttributeDef } from '@fluxus/engine';
import { contextFilledKeys, seedValue } from '../src/capture/seed';

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

// What actually reaches the run. The form hides an attribute it answered for
// the user — a sourced one, a seeded one — and until 2026-09-18 added only the
// sourced half back to the payload, so the seeded value was hidden and then
// dropped: "Add child" on a WBS row made a root node, and a bulk action
// carried none of the records that were ticked.
describe('what the form answered for the user still reaches the run', () => {
  const parent = { key: 'wbs_parent', label: 'Parent', type: 'reference' } as AttributeDef;
  const project = { key: 'wbs_project', label: 'Project', type: 'reference', source: 'context.page.record.id' } as AttributeDef;
  const code = { key: 'code', label: 'Code', type: 'text' } as AttributeDef;

  it('keeps a seeded attribute — the row the action was launched from', () => {
    const keys = contextFilledKeys([parent, code], { wbs_parent: 'AAA', code: 'AAA111' }, { attribute: 'wbs_parent', records: ['AAA'] });
    expect([...keys]).toEqual(['wbs_parent']);
  });

  it('keeps a sourced attribute — the record the page was showing', () => {
    const keys = contextFilledKeys([project, code], { wbs_project: 'P24-042', code: 'AAA111' }, undefined);
    expect([...keys]).toEqual(['wbs_project']);
  });

  it('keeps both at once, which is the WBS create form', () => {
    const keys = contextFilledKeys(
      [project, parent, code],
      { wbs_project: 'P24-042', wbs_parent: 'AAA', code: 'AAA111' },
      { attribute: 'wbs_parent', records: ['AAA'] },
    );
    expect([...keys].sort()).toEqual(['wbs_parent', 'wbs_project']);
  });

  it('keeps the whole list a bulk action ticked', () => {
    const crews = { key: 'work_orders', label: 'Work orders', type: 'reference', type_config: { multi: true } } as AttributeDef;
    const keys = contextFilledKeys([crews], { work_orders: ['WO-1', 'WO-2'] }, { attribute: 'work_orders', records: ['WO-1', 'WO-2'] });
    expect([...keys]).toEqual(['work_orders']);
  });

  // The three ways an attribute is an ordinary question again: nothing filled
  // it, the source resolved to nothing, or the seed was refused. Each stays
  // visible in the form, so each is captured the ordinary way, and none of
  // them belongs in this set.
  it('leaves out a source that resolved to nothing', () => {
    expect([...contextFilledKeys([project], { wbs_project: '' }, undefined)]).toEqual([]);
  });

  it('leaves out an empty selection', () => {
    expect([...contextFilledKeys([parent], { wbs_parent: '' }, { attribute: 'wbs_parent', records: [] })]).toEqual([]);
  });

  // Forty rows into a single-valued attribute: the form refuses the seed and
  // shows its error, so whatever the field happens to hold is not an answer
  // this run may carry.
  it('leaves out a seed the attribute cannot hold, even holding a value', () => {
    const values = { wbs_parent: 'AAA' };
    expect([...contextFilledKeys([parent], values, { attribute: 'wbs_parent', records: ['AAA', 'BBB'] })]).toEqual([]);
  });

  it('leaves an ordinary typed attribute alone', () => {
    expect([...contextFilledKeys([code], { code: 'AAA111' }, undefined)]).toEqual([]);
  });
});

// A sourced attribute is hidden even when its source resolves to nothing
// (2026-09-21). It used to stay visible in that case so a page that could not
// answer it left someone who could — but that made one activity serve two
// launches badly: the WBS create is seeded with a parent from "Add child" and
// has none from "New node", and the unseeded case then showed a parent picker
// on a form whose answer is "no parent".
//
// `contextFilledKeys` is the payload half of the same rule, and it does NOT
// change: a blank stays out of the submission, so the field keeps its default
// rather than being written empty.
describe('a source that resolves to nothing', () => {
  const parent = { key: 'wbs_parent', label: 'Parent', type: 'reference', source: "''" } as AttributeDef;

  it('still carries a seeded value when there is one', () => {
    const keys = contextFilledKeys([parent], { wbs_parent: 'P1' }, { attribute: 'wbs_parent', records: ['P1'] });
    expect([...keys]).toEqual(['wbs_parent']);
  });

  it('submits nothing when it resolved to nothing', () => {
    expect([...contextFilledKeys([parent], { wbs_parent: '' }, undefined)]).toEqual([]);
  });
});
