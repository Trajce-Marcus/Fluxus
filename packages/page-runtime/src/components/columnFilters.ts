// A filter per column (RECORD_LIST_DESIGN §4.10, step 5). Pure — rows in, rows
// out — beside `columnFormat`, `searchSort` and `selection` for the same
// reasons: testable without a DOM, and usable by anything that wraps the
// table's guts (§6, the Gantt seam).
//
// Like the search box (§4.2) it narrows **the rows already delivered**. It is
// not §4.3: nothing here fetches, and no filter reaches the read path.
//
// **A filter is the set of ticked drawn values**, one set per column — the same
// rule search follows, that a reader filters what they can see, so a date is
// ticked as it is written and a blank cell is ticked as `—`. There is no second
// kind of filter, and no second predicate to design, explain or combine: the
// contains box **is** ticking. Typing in it keeps the values it matches, live,
// on every keystroke (2026-09-13) — a box that narrowed only the list, leaving
// the rows to a further click, read as broken on the first real screen.
//
// **A column absent from the map is unfiltered; an empty list is not.** They
// look alike and are opposites: absent means every value passes and every box
// reads ticked, while an empty list is a reader who unticked everything and
// meant it, which shows no rows. Keeping them apart is what lets a filter start
// with all its boxes ticked — the state a reader expects — without "untick one"
// being read as "keep only that one". Ticking the last missing value puts the
// column back to absent, so there is one way to say unfiltered, not two.

import { drawCell, resolveCurrency } from './columnFormat';
import { compareValues } from './searchSort';
import type { RecordListColumn, RecordListRow } from './RecordList';

/** Which drawn values each column keeps, by column key. A column absent filters nothing. */
export type ColumnFilters = Record<string, readonly string[]>;

/** Whether the box above a choice list is empty, part-filled or full. */
export type ChoiceState = 'none' | 'some' | 'all';

/**
 * Whether this column has anything to filter by. Whether the **table** offers
 * filters at all is one property on the table (`columnFilters`), following
 * 2026-09-13's ruling on `sortable`: an array-item boolean has nowhere honest
 * to keep a default, since the page builder's array editor seeds every one to
 * `false`. An action column draws a button and holds no value.
 */
export const hasFilterableValues = (col: RecordListColumn): boolean => !!col.key;

/** The cell as the reader sees it — what a filter ticks. */
const drawn = (row: RecordListRow, col: RecordListColumn): string =>
  drawCell(row[col.key as string], col.type, col.format, resolveCurrency(col.currency, row));

/**
 * The distinct drawn values of one column, in the order the column would sort
 * — by the **underlying** value and the column's type, so dates read
 * chronologically and `—` lands last with the other blanks. Two values that
 * draw the same are one choice; the first row to draw it speaks for the rest.
 *
 * Computed over **every delivered row**, not the rows the other filters left: a
 * choice that vanished because of a tick elsewhere is a dead end the reader
 * cannot undo from inside the popup. No paging (§4.4), so every row is here.
 */
export function choices(rows: readonly RecordListRow[], col: RecordListColumn): string[] {
  if (!col.key) return [];
  const first = new Map<string, unknown>();
  for (const row of rows) {
    const label = drawn(row, col);
    if (!first.has(label)) first.set(label, row[col.key]);
  }
  return [...first.keys()].sort((a, b) => compareValues(first.get(a), first.get(b), col.type));
}

/** The choices containing the term. An empty term keeps every one. */
export const narrowChoices = (all: readonly string[], term: string): string[] => {
  const needle = term.trim().toLowerCase();
  return needle ? all.filter((c) => c.toLowerCase().includes(needle)) : [...all];
};

/** The columns currently narrowing the rows — an empty list among them (see the header). */
export const filteredColumns = (filters: ColumnFilters): string[] => Object.keys(filters);

/** How many columns are filtering — what the toolbar says when the controls are hidden. */
export const filterCount = (filters: ColumnFilters): number => filteredColumns(filters).length;

/** Is this value one the column keeps? An unfiltered column keeps them all. */
export const isTicked = (filters: ColumnFilters, key: string, choice: string): boolean => {
  const kept = filters[key];
  return !kept || kept.includes(choice);
};

/** Does this row pass every column's filter? Filters combine with AND, and with the search box. */
export function matchesFilters(
  row: RecordListRow,
  columns: readonly RecordListColumn[],
  filters: ColumnFilters,
): boolean {
  return columns.every((col) => !col.key || !filters[col.key] || isTicked(filters, col.key, drawn(row, col)));
}

/** The rows every filter keeps. No filters keeps every one. */
export const filterRows = (
  rows: readonly RecordListRow[],
  columns: readonly RecordListColumn[],
  filters: ColumnFilters,
): RecordListRow[] =>
  filterCount(filters) ? rows.filter((row) => matchesFilters(row, columns, filters)) : [...rows];

/** A column back to unfiltered. */
export function clearColumn(filters: ColumnFilters, key: string): ColumnFilters {
  const next = { ...filters };
  delete next[key];
  return next;
}

/** Every column back to unfiltered — what the toolbar's clear does. */
export const clearAll = (): ColumnFilters => ({});

/**
 * One column's ticked set replaced. Keeping **every** value is the unfiltered
 * state, not a filter that happens to keep everything, so it drops the column.
 */
export const setColumn = (
  filters: ColumnFilters,
  key: string,
  values: readonly string[],
  all: readonly string[],
): ColumnFilters =>
  values.length >= all.length ? clearColumn(filters, key) : { ...filters, [key]: [...values] };

/**
 * Tick or untick one value. An unfiltered column starts from **everything
 * ticked**, so the first click excludes one value rather than keeping only it —
 * which is why `all` has to be passed in.
 */
export const toggleChoice = (
  filters: ColumnFilters,
  key: string,
  choice: string,
  all: readonly string[],
): ColumnFilters => {
  const kept = filters[key] ?? all;
  const next = kept.includes(choice) ? kept.filter((v) => v !== choice) : [...kept, choice];
  return setColumn(filters, key, next, all);
};

/**
 * The state of the box above the list. An unfiltered column reads `all`,
 * because that is exactly what everything passing looks like.
 */
export function choiceState(filters: ColumnFilters, key: string, listed: readonly string[]): ChoiceState {
  const ticked = listed.filter((c) => isTicked(filters, key, c)).length;
  if (ticked === 0) return 'none';
  return ticked === listed.length ? 'all' : 'some';
}

/**
 * The box above the list ticks or unticks **what is listed**, over whatever is
 * already ticked — one rule whether or not the contains box has narrowed the
 * list, since typing has already applied itself (see `keepMatching`). With
 * every choice listed and everything ticked, that is the plain "untick the
 * lot", which leaves a column showing no rows at all: a state the reader asked
 * for, and the button says `None` rather than pretending otherwise.
 */
export const toggleAll = (
  filters: ColumnFilters,
  key: string,
  listed: readonly string[],
  all: readonly string[],
): ColumnFilters => {
  const kept = filters[key] ?? all;
  const next = choiceState(filters, key, listed) === 'all'
    ? kept.filter((v) => !listed.includes(v))
    : [...kept, ...listed.filter((v) => !kept.includes(v))];
  return setColumn(filters, key, next, all);
};

/**
 * What typing in the contains box does: the column keeps the values the term
 * matches, and an empty term puts it back to unfiltered. It **replaces** what
 * was ticked rather than narrowing it — a term is the stronger statement, and
 * an AND of the two would mean the reader could type a value that is plainly
 * in the column and be shown nothing.
 */
export const keepMatching = (
  filters: ColumnFilters,
  key: string,
  term: string,
  all: readonly string[],
): ColumnFilters =>
  term.trim() ? setColumn(filters, key, narrowChoices(all, term), all) : clearColumn(filters, key);
