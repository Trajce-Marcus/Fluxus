// Selecting rows (RECORD_LIST_DESIGN §7 step 3). The rule under test
// throughout: a page that never mentions selection behaves exactly as it did
// before this step, and `many` is the same idea with the boxes drawn.

import { describe, expect, it } from 'vitest';
import {
  emitted,
  headerState,
  hiddenCount,
  inRowOrder,
  nextSelection,
  selectAll,
  selectionMode,
} from '../src/components/selection';

const rows = ['a', 'b', 'c'];

describe('the declared mode', () => {
  it('is one when nothing is declared', () => {
    expect(selectionMode(undefined)).toBe('one');
    expect(selectionMode('')).toBe('one');
  });

  it('takes the three it knows', () => {
    expect(selectionMode('none')).toBe('none');
    expect(selectionMode('one')).toBe('one');
    expect(selectionMode('many')).toBe('many');
  });

  it('falls back rather than erroring on a typo', () => {
    expect(selectionMode('multiple')).toBe('one');
    expect(selectionMode('MANY')).toBe('one');
  });
});

describe('clicking a row', () => {
  it('selects nothing when selection is off', () => {
    expect(nextSelection('none', rows, [], 'b')).toEqual([]);
    expect(nextSelection('none', rows, ['a'], 'b')).toEqual([]);
  });

  it('replaces in one, and a second click keeps the row selected', () => {
    expect(nextSelection('one', rows, [], 'b')).toEqual(['b']);
    expect(nextSelection('one', rows, ['a'], 'b')).toEqual(['b']);
    expect(nextSelection('one', rows, ['b'], 'b')).toEqual(['b']);
  });

  it('toggles in many', () => {
    expect(nextSelection('many', rows, [], 'b')).toEqual(['b']);
    expect(nextSelection('many', rows, ['b'], 'a')).toEqual(['a', 'b']);
    expect(nextSelection('many', rows, ['a', 'b'], 'a')).toEqual(['b']);
  });

  it('keeps the selection in the order the screen reads', () => {
    expect(nextSelection('many', rows, ['c'], 'a')).toEqual(['a', 'c']);
  });

  it('drops an id the rows no longer hold', () => {
    expect(nextSelection('many', rows, ['gone'], 'b')).toEqual(['b']);
  });
});

describe('the select-all box', () => {
  it('is empty, part-filled or full', () => {
    expect(headerState(rows, [])).toBe('none');
    expect(headerState(rows, ['b'])).toBe('some');
    expect(headerState(rows, ['a', 'b', 'c'])).toBe('all');
  });

  it('is empty when there are no rows, never full', () => {
    expect(headerState([], [])).toBe('none');
  });

  it('counts only the rows in hand', () => {
    expect(headerState(rows, ['a', 'b', 'c', 'gone'])).toBe('all');
    expect(headerState(rows, ['gone'])).toBe('none');
  });

  it('fills from empty or part-filled, and empties from full', () => {
    expect(selectAll(rows, rows, [])).toEqual(['a', 'b', 'c']);
    expect(selectAll(rows, rows, ['b'])).toEqual(['a', 'b', 'c']);
    expect(selectAll(rows, rows, ['a', 'b', 'c'])).toEqual([]);
  });
});

// A search narrows what is on screen (step 4). The box acts on what is shown;
// what a previous search left ticked stays ticked.
describe('the select-all box over a searched-down table', () => {
  const shown = ['a', 'c'];

  it('is full when everything shown is ticked, whatever is hidden', () => {
    expect(headerState(shown, ['a', 'c'])).toBe('all');
    expect(headerState(shown, ['a', 'b', 'c'])).toBe('all');
  });

  it('adds the shown rows without dropping a hidden tick', () => {
    expect(selectAll(shown, rows, ['b'])).toEqual(['a', 'b', 'c']);
  });

  it('removes only the shown rows', () => {
    expect(selectAll(shown, rows, ['a', 'b', 'c'])).toEqual(['b']);
  });
});

describe('ticks that are off screen', () => {
  it('counts what a search is hiding', () => {
    expect(hiddenCount(['a'], ['a', 'b', 'c'])).toBe(2);
    expect(hiddenCount(rows, ['a', 'b'])).toBe(0);
  });
});

describe('what the selection is drawn from', () => {
  it('prunes ids the rows no longer hold, in row order', () => {
    expect(inRowOrder(rows, ['c', 'gone', 'a'])).toEqual(['a', 'c']);
    expect(inRowOrder([], ['a'])).toEqual([]);
  });
});

describe('what onSelect emits', () => {
  // Ruled 2026-09-08: always a list, so no script is mode-specific.
  it('emits a list of one for a single selection', () => {
    expect(emitted(['b'])).toEqual(['b']);
  });

  it('emits an empty list for nothing selected', () => {
    expect(emitted([])).toEqual([]);
  });

  it('emits the whole selection, in order', () => {
    expect(emitted(['a', 'c'])).toEqual(['a', 'c']);
  });

  it('emits a copy, so a script cannot write back into the table', () => {
    const selected = ['a'];
    const out = emitted(selected);
    out.push('b');
    expect(selected).toEqual(['a']);
  });
});
