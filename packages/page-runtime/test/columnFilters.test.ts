// A filter per column (RECORD_LIST_DESIGN §7 step 5). The rules under test: a
// filter ticks what the reader can see, an unfiltered column is not an empty
// one, and the contains box narrows the choices rather than the rows.

import { describe, expect, it } from 'vitest';
import type { RecordListColumn, RecordListRow } from '../src/components/RecordList';
import {
  choiceState,
  choices,
  clearColumn,
  filterCount,
  filterRows,
  hasFilterableValues,
  keepMatching,
  isTicked,
  matchesFilters,
  narrowChoices,
  setColumn,
  toggleAll,
  toggleChoice,
  type ColumnFilters,
} from '../src/components/columnFilters';

const columns: RecordListColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'crew', label: 'Crew' },
  { key: 'cost', label: 'Cost', type: 'decimal', format: 'N2' },
  { key: 'due', label: 'Due', type: 'datetime', format: 'dd/MM/yyyy' },
  { label: 'Open', component: 'OpenPage', target: 'pages/x' },
];

const rows: RecordListRow[] = [
  { id: 'a', name: 'Bridge deck', crew: 'North', cost: 9, due: '2026-03-12' },
  { id: 'b', name: 'Abutment', crew: 'South', cost: 1000, due: '2026-01-04' },
  { id: 'c', name: 'Piling', crew: 'North', cost: null, due: null },
];

const ids = (rs: RecordListRow[]) => rs.map((r) => r.id);
const crew = columns[1];

describe('which columns can filter', () => {
  it('is any column naming a field', () => {
    expect(hasFilterableValues({ key: 'crew' })).toBe(true);
  });

  it('is never an action column — it draws a button, not a value', () => {
    expect(hasFilterableValues({ label: 'Open', component: 'OpenPage' })).toBe(false);
  });
});

describe('the choices a column offers', () => {
  it('is its distinct values, each listed once', () => {
    expect(choices(rows, crew)).toEqual(['North', 'South']);
  });

  it('is what the reader sees, so a date is ticked as it is written', () => {
    expect(choices(rows, columns[3])).toEqual(['04/01/2026', '12/03/2026', '—']);
  });

  it('orders by what the value means, not by the drawn text', () => {
    // 9 before 1,000.00 — the sort the column itself would use.
    expect(choices(rows, columns[2])).toEqual(['9.00', '1,000.00', '—']);
  });

  it('has nothing for an action column', () => {
    expect(choices(rows, columns[4])).toEqual([]);
  });
});

describe('the contains box', () => {
  const all = ['North', 'South', 'North West'];

  it('narrows the choices it offers', () => {
    expect(narrowChoices(all, 'north')).toEqual(['North', 'North West']);
  });

  it('keeps every choice when it is empty', () => {
    expect(narrowChoices(all, '  ')).toEqual(all);
  });

  // The fix of 2026-09-13: narrowing the list and leaving the rows to a further
  // click read as broken. A term filters on the keystroke.
  it('keeps the matching values as the term is typed', () => {
    expect(keepMatching({}, 'crew', 'north', all)).toEqual({ crew: ['North', 'North West'] });
  });

  it('replaces what was ticked rather than narrowing it', () => {
    expect(keepMatching({ crew: ['South'] }, 'crew', 'north', all)).toEqual({ crew: ['North', 'North West'] });
  });

  it('puts the column back to unfiltered when the term is cleared', () => {
    expect(keepMatching({ crew: ['North'] }, 'crew', '', all)).toEqual({});
  });

  it('keeps nothing when the term matches nothing, and says so by filtering', () => {
    expect(keepMatching({}, 'crew', 'zzz', all)).toEqual({ crew: [] });
  });
});

describe('an unfiltered column is not an empty one', () => {
  it('shows every box ticked while the column is absent', () => {
    expect(isTicked({}, 'crew', 'North')).toBe(true);
    expect(choiceState({}, 'crew', choices(rows, crew))).toBe('all');
  });

  it('keeps every row', () => {
    expect(ids(filterRows(rows, columns, {}))).toEqual(['a', 'b', 'c']);
    expect(filterCount({})).toBe(0);
  });

  it('keeps no row when the reader unticks everything, and counts as a filter', () => {
    const none: ColumnFilters = { crew: [] };
    expect(ids(filterRows(rows, columns, none))).toEqual([]);
    expect(filterCount(none)).toBe(1);
    expect(choiceState(none, 'crew', choices(rows, crew))).toBe('none');
  });
});

describe('ticking one value', () => {
  it('excludes it, rather than keeping only it', () => {
    const next = toggleChoice({}, 'crew', 'North', choices(rows, crew));
    expect(next.crew).toEqual(['South']);
    expect(ids(filterRows(rows, columns, next))).toEqual(['b']);
  });

  it('puts the column back to unfiltered when the last missing value returns', () => {
    const off = toggleChoice({}, 'crew', 'North', choices(rows, crew));
    const back = toggleChoice(off, 'crew', 'North', choices(rows, crew));
    expect(back).toEqual({});
  });

  it('reads part-filled while some but not all are ticked', () => {
    const next = toggleChoice({}, 'crew', 'North', choices(rows, crew));
    expect(choiceState(next, 'crew', choices(rows, crew))).toBe('some');
  });
});

describe('the box above the list', () => {
  const all = choices(rows, crew);

  it('unticks everything when every choice is listed and ticked', () => {
    expect(toggleAll({}, 'crew', all, all)).toEqual({ crew: [] });
  });

  it('ticks the rest, back to unfiltered, when something is unticked', () => {
    const some: ColumnFilters = { crew: ['North'] };
    expect(toggleAll(some, 'crew', all, all)).toEqual({});
  });

  it('unticks what is listed and leaves the rest alone', () => {
    // One rule whether or not the list is narrowed: typing has already applied
    // itself, so this box is never doing the contains box's job.
    expect(toggleAll({}, 'crew', ['North'], all)).toEqual({ crew: ['South'] });
  });

  it('ticks what is listed back on', () => {
    expect(toggleAll({ crew: ['South'] }, 'crew', ['North'], all)).toEqual({});
  });
});

describe('narrowing the rows', () => {
  it('matches the drawn cell, so a filter ticks what the reader sees', () => {
    expect(matchesFilters(rows[1], columns, { cost: ['1,000.00'] })).toBe(true);
    expect(matchesFilters(rows[1], columns, { cost: ['1000'] })).toBe(false);
  });

  it('ticks a blank cell as the blank it draws', () => {
    expect(ids(filterRows(rows, columns, { due: ['—'] }))).toEqual(['c']);
  });

  it('combines two columns with AND', () => {
    expect(ids(filterRows(rows, columns, { crew: ['North'], due: ['12/03/2026'] }))).toEqual(['a']);
    expect(ids(filterRows(rows, columns, { crew: ['South'], due: ['12/03/2026'] }))).toEqual([]);
  });

  it('ignores a filter left over from a column no longer shown', () => {
    expect(ids(filterRows(rows, columns, { gone: ['x'] }))).toEqual(['a', 'b', 'c']);
  });
});

describe('clearing', () => {
  it('drops one column and leaves the others', () => {
    expect(clearColumn({ crew: ['North'], due: ['—'] }, 'crew')).toEqual({ due: ['—'] });
  });

  it('treats "keep everything" as unfiltered rather than a filter that keeps everything', () => {
    expect(setColumn({}, 'crew', ['North', 'South'], ['North', 'South'])).toEqual({});
  });
});
