// Sorting and searching the delivered rows (RECORD_LIST_DESIGN §7 step 4). The
// rule under test throughout: search matches what the reader can see, sort
// orders what the value means.

import { describe, expect, it } from 'vitest';
import type { RecordListColumn, RecordListRow } from '../src/components/RecordList';
import {
  compareValues,
  isSortable,
  matchesSearch,
  nextSort,
  searchRows,
  sortRows,
} from '../src/components/searchSort';

const columns: RecordListColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'cost', label: 'Cost', type: 'decimal', format: 'N2' },
  { key: 'due', label: 'Due', type: 'datetime', format: 'dd/MM/yyyy' },
  { label: 'Open', component: 'OpenPage', target: 'pages/x' },
];

const rows: RecordListRow[] = [
  { id: 'a', name: 'Bridge deck', cost: 9, due: '2026-03-12' },
  { id: 'b', name: 'abutment', cost: 1000, due: '2026-01-04' },
  { id: 'c', name: 'Piling', cost: null, due: null },
];

const ids = (rs: RecordListRow[]) => rs.map((r) => r.id);

describe('which columns sort', () => {
  it('sorts a column with a key unless it says otherwise', () => {
    expect(isSortable({ key: 'name' })).toBe(true);
    expect(isSortable({ key: 'name', sortable: false })).toBe(false);
  });

  it('never sorts an action column — it draws a button, not a value', () => {
    expect(isSortable({ label: 'Open', component: 'OpenPage' })).toBe(false);
  });
});

describe('clicking a heading', () => {
  it('goes ascending, descending, then back to the order given', () => {
    const first = nextSort(null, 'name');
    expect(first).toEqual({ key: 'name', direction: 'asc' });
    const second = nextSort(first, 'name');
    expect(second).toEqual({ key: 'name', direction: 'desc' });
    expect(nextSort(second, 'name')).toBeNull();
  });

  it('starts again at ascending on a different column', () => {
    expect(nextSort({ key: 'name', direction: 'desc' }, 'cost')).toEqual({ key: 'cost', direction: 'asc' });
  });
});

describe('ordering a value', () => {
  it('compares numbers as numbers, not as text', () => {
    expect(compareValues(9, 1000, 'decimal')).toBeLessThan(0);
    expect(compareValues('9', '1000', 'int')).toBeLessThan(0);
  });

  it('compares dates chronologically', () => {
    expect(compareValues('2026-01-04', '2026-03-12', 'datetime')).toBeLessThan(0);
  });

  it('compares text case-blind, so apple comes before Banana', () => {
    expect(compareValues('apple', 'Banana', 'text')).toBeLessThan(0);
  });

  it('falls back to text when a number will not read as one', () => {
    expect(compareValues('n/a', 'zzz', 'int')).toBeLessThan(0);
  });

  it('puts a blank last, whichever value it is compared with', () => {
    expect(compareValues(null, 5, 'int')).toBeGreaterThan(0);
    expect(compareValues(5, null, 'int')).toBeLessThan(0);
    expect(compareValues(null, undefined, 'int')).toBe(0);
  });
});

describe('sorting the rows', () => {
  it('returns the order given when nothing is sorted', () => {
    expect(ids(sortRows(rows, columns, null))).toEqual(['a', 'b', 'c']);
  });

  it('sorts by the underlying value, not the drawn one', () => {
    // 1,000.00 draws before 9.00 as text; as money it is the larger.
    expect(ids(sortRows(rows, columns, { key: 'cost', direction: 'asc' }))).toEqual(['a', 'b', 'c']);
    expect(ids(sortRows(rows, columns, { key: 'cost', direction: 'desc' }))).toEqual(['b', 'a', 'c']);
  });

  it('keeps blanks last in both directions', () => {
    for (const direction of ['asc', 'desc'] as const) {
      expect(ids(sortRows(rows, columns, { key: 'cost', direction }))[2]).toBe('c');
    }
  });

  it('sorts text case-blind', () => {
    expect(ids(sortRows(rows, columns, { key: 'name', direction: 'asc' }))).toEqual(['b', 'a', 'c']);
  });

  it('leaves the rows alone when the column is not there', () => {
    expect(ids(sortRows(rows, columns, { key: 'nope', direction: 'asc' }))).toEqual(['a', 'b', 'c']);
  });

  it('does not touch the array it was given', () => {
    const given = [...rows];
    sortRows(given, columns, { key: 'name', direction: 'desc' });
    expect(ids(given)).toEqual(['a', 'b', 'c']);
  });
});

describe('searching the rows', () => {
  it('keeps every row for an empty term', () => {
    expect(ids(searchRows(rows, columns, ''))).toEqual(['a', 'b', 'c']);
    expect(ids(searchRows(rows, columns, '   '))).toEqual(['a', 'b', 'c']);
  });

  it('matches any column, case-blind', () => {
    expect(ids(searchRows(rows, columns, 'BRIDGE'))).toEqual(['a']);
    expect(ids(searchRows(rows, columns, 'piling'))).toEqual(['c']);
  });

  it('matches the drawn value, so a date is searched as it is written', () => {
    expect(matchesSearch(rows[0], columns, '12/03/2026')).toBe(true);
    expect(matchesSearch(rows[0], columns, '2026-03-12')).toBe(false);
  });

  it('matches a formatted number as the reader sees it', () => {
    expect(matchesSearch(rows[1], columns, '1,000.00')).toBe(true);
  });

  it('ignores an action column, which holds no value', () => {
    expect(ids(searchRows(rows, columns, 'Open'))).toEqual([]);
  });

  it('keeps nothing when nothing matches', () => {
    expect(ids(searchRows(rows, columns, 'zzz'))).toEqual([]);
  });
});
