// Which rows the table shows, and in what order (RECORD_LIST_DESIGN §4.1–4.2,
// step 4). Pure — rows in, rows out — beside `columnFormat` and `selection`
// for the same reasons: testable without a DOM, and usable by anything that
// wraps the table's guts (§6, the Gantt seam).
//
// Both work on **the rows already delivered**. There is no paging (§4.4), so
// every row is present and neither needs a round trip; the day paging exists,
// both become questions for the read path instead, and that is a change to the
// read path rather than to this file.
//
// The two halves deliberately disagree about what they look at:
//
//   - **Search matches what you can see** — the drawn cell, so searching
//     `12/03/2026` finds the date on the screen rather than the ISO string
//     behind it.
//   - **Sort orders what it means** — the underlying value, so `N2` grouping
//     and a currency symbol cannot decide that 1,000 comes before 9.
//
// Same value, two questions, and each answers the one the reader is asking.

import { columnType, drawCell, resolveCurrency } from './columnFormat';
import type { RecordListColumn, RecordListRow } from './RecordList';

export type SortDirection = 'asc' | 'desc';

/** Which column the table is sorted by, or null for the order it was given. */
export interface Sort {
  key: string;
  direction: SortDirection;
}

/**
 * Whether this column has anything to sort by. Whether the **table** sorts at
 * all is one property on the table (2026-09-13, the user's call): per-column
 * control was finer than any screen needed, and a boolean on each item of the
 * list also had nowhere honest to keep its default — the array editor seeds
 * every boolean `false`, so a column added in the dialog arrived unsortable
 * without anyone saying so.
 */
export const hasSortableValue = (col: RecordListColumn): boolean => !!col.key;

/**
 * Clicking a heading: ascending, then descending, then back to the order the
 * rows arrived in. The third state matters — a GET's own order can be the
 * meaningful one (a ranking, a tree walk), and without it a single click would
 * throw that away for good.
 */
export const nextSort = (current: Sort | null, key: string): Sort | null => {
  if (current?.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
};

const isBlank = (v: unknown): boolean => v === null || v === undefined || v === '';

/**
 * One value against another, by the column's type. Blanks sort last in **both**
 * directions: a missing value is not a small one, and burying it is what a
 * reader means by "worst last" either way.
 */
export function compareValues(a: unknown, b: unknown, type: string | undefined): number {
  if (isBlank(a) || isBlank(b)) return isBlank(a) && isBlank(b) ? 0 : isBlank(a) ? 1 : -1;
  switch (columnType(type)) {
    case 'int':
    case 'decimal': {
      const na = Number(a);
      const nb = Number(b);
      // An unreadable number falls back to text rather than sorting as NaN,
      // which compares false against everything and scrambles the rows.
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      break;
    }
    case 'boolean': {
      const ba = a === true || a === 'true' ? 1 : 0;
      const bb = b === true || b === 'true' ? 1 : 0;
      return ba - bb;
    }
    case 'datetime':
    case 'time': {
      const ta = Date.parse(String(a));
      const tb = Date.parse(String(b));
      if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
      break;
    }
    default:
      break;
  }
  // Locale-aware and case-blind, because 'apple' before 'Banana' is what a
  // reader means by alphabetical.
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

/** The rows in the asked-for order. Stable: equal rows keep the order given. */
export function sortRows(
  rows: readonly RecordListRow[],
  columns: readonly RecordListColumn[],
  sort: Sort | null,
): RecordListRow[] {
  if (!sort) return [...rows];
  const col = columns.find((c) => c.key === sort.key);
  if (!col?.key) return [...rows];
  const key = col.key;
  const sign = sort.direction === 'desc' ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      const by = compareValues(x.row[key], y.row[key], col.type);
      // Blanks stay last whichever way the column is pointing, so the sign is
      // applied to the comparison and not to them.
      if (by !== 0) {
        const bothPresent = !isBlank(x.row[key]) && !isBlank(y.row[key]);
        return bothPresent ? by * sign : by;
      }
      return x.i - y.i;
    })
    .map(({ row }) => row);
}

/** Does any drawn cell of this row contain the term? */
export function matchesSearch(
  row: RecordListRow,
  columns: readonly RecordListColumn[],
  term: string,
): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return columns.some((col) => {
    if (!col.key) return false; // an action column draws a button, not a value
    const drawn = drawCell(row[col.key], col.type, col.format, resolveCurrency(col.currency, row));
    return drawn.toLowerCase().includes(needle);
  });
}

/** The rows the term keeps. An empty term keeps every one. */
export const searchRows = (
  rows: readonly RecordListRow[],
  columns: readonly RecordListColumn[],
  term: string,
): RecordListRow[] => (term.trim() ? rows.filter((row) => matchesSearch(row, columns, term)) : [...rows]);
