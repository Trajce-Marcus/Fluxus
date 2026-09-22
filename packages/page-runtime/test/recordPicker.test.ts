// Resolving a GET's rows into what the picker draws — the pure half, tested
// without a DOM.
//
// The behaviour worth pinning is the one the spec calls out as NEW rather than
// copied: a row with no value in the key field is skipped AND counted. The
// dropdown turns such a row into a blank entry and says nothing, which is a
// quieter version of the same bug.

import { describe, expect, it } from 'vitest';
import { resolveCandidates, SEARCH_DEBOUNCE_MS, SEARCH_MIN_CHARS } from '../src/capture/RecordPicker';

describe('resolveCandidates — the row shapes a GET answers with', () => {
  it('reads a projected row by its named fields', () => {
    const { candidates, skipped } = resolveCandidates(
      [{ id: 'wbs_3_4', code: '3.4', name: 'Mechanized Welding' }],
      'id', 'name', [],
    );
    expect(candidates).toEqual([{ value: 'wbs_3_4', label: 'Mechanized Welding', secondary: '' }]);
    expect(skipped).toBe(0);
  });

  it('reads a DslRecord — id off the record, the rest out of fields', () => {
    const { candidates } = resolveCandidates(
      [{ id: 'wbs_3_4', type: 'rt_wbs_nodes', fields: { code: '3.4', name: 'Mechanized Welding' } }],
      'id', 'name', [],
    );
    expect(candidates).toEqual([{ value: 'wbs_3_4', label: 'Mechanized Welding', secondary: '' }]);
  });

  it('keys on a field other than id when told to', () => {
    const { candidates } = resolveCandidates(
      [{ id: 'row1', code: '3.4', name: 'Mechanized Welding' }],
      'code', 'name', [],
    );
    expect(candidates[0].value).toBe('3.4');
  });

  it('draws the extra columns as secondary text', () => {
    const { candidates } = resolveCandidates(
      [{ id: 'w', code: '3.4', name: 'Mechanized Welding', discipline: 'Welding' }],
      'id', 'name', ['code', 'discipline'],
    );
    expect(candidates[0].secondary).toBe('3.4 · Welding');
  });

  it('leaves out an empty column rather than drawing a stray separator', () => {
    const { candidates } = resolveCandidates(
      [{ id: 'w', name: 'Welding', code: '', discipline: null }],
      'id', 'name', ['code', 'discipline'],
    );
    expect(candidates[0].secondary).toBe('');
  });
});

describe('resolveCandidates — rows it cannot use', () => {
  it('skips a row with no value in the key field, and counts it', () => {
    const { candidates, skipped } = resolveCandidates(
      [
        { id: 'ok', name: 'Kept' },
        { name: 'No id at all' },
        { id: '', name: 'Empty id' },
        { id: null, name: 'Null id' },
      ],
      'id', 'name', [],
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].label).toBe('Kept');
    expect(skipped).toBe(3);
  });

  it('counts a row that is not an object at all', () => {
    const { candidates, skipped } = resolveCandidates(['just a string', 42, null], 'id', 'name', []);
    expect(candidates).toHaveLength(0);
    expect(skipped).toBe(3);
  });

  it('falls back to the stored value when the row lacks the display field', () => {
    // Not a guess about which field to use — that is settled before this runs.
    // This is one row missing the field the rest have, and showing its id is
    // more honest than showing a blank.
    const { candidates, skipped } = resolveCandidates([{ id: 'wbs_3_4' }], 'id', 'name', []);
    expect(candidates).toEqual([{ value: 'wbs_3_4', label: 'wbs_3_4', secondary: '' }]);
    expect(skipped).toBe(0);
  });

  it('stringifies a numeric key and label', () => {
    const { candidates } = resolveCandidates([{ id: 17, name: 42 }], 'id', 'name', []);
    expect(candidates).toEqual([{ value: '17', label: '42', secondary: '' }]);
  });

  it('an empty answer is no candidates and nothing skipped', () => {
    expect(resolveCandidates([], 'id', 'name', [])).toEqual({ candidates: [], skipped: 0 });
  });
});

describe('the search rules the picker applies', () => {
  it('holds the spec’s numbers', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(300);
    expect(SEARCH_MIN_CHARS).toBe(2);
  });
});
