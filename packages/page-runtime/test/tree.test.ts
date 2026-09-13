// Rows that point at one another (RECORD_LIST_DESIGN §7 step 6). The rule under
// test throughout: hierarchy is row order, nothing more — and it agrees with
// the narrowing steps rather than overriding them.

import { describe, expect, it } from 'vitest';
import type { RecordListColumn, RecordListRow } from '../src/components/RecordList';
import { rowComparator } from '../src/components/searchSort';
import { searchRows } from '../src/components/searchSort';
import {
  ancestorIds,
  flatRows,
  openedForHits,
  toggleCollapsed,
  treeRows,
  withAncestors,
} from '../src/components/tree';

const columns: RecordListColumn[] = [
  { key: 'name', label: 'Name' },
  { key: 'cost', label: 'Cost', type: 'decimal' },
];

// A cost breakdown: two roots, one of them three deep.
const rows: RecordListRow[] = [
  { id: 'a', parent: null, name: 'Structure', cost: 900 },
  { id: 'b', parent: 'a', name: 'Piling', cost: 400 },
  { id: 'c', parent: 'a', name: 'Abutments', cost: 500 },
  { id: 'd', parent: 'c', name: 'Formwork', cost: 200 },
  { id: 'e', parent: null, name: 'Roadworks', cost: 100 },
];

const shape = (ts: ReturnType<typeof treeRows>) => ts.map((t) => `${'  '.repeat(t.depth)}${t.row.id}`);
const ids = (ts: ReturnType<typeof treeRows>) => ts.map((t) => t.row.id);

describe('the order rows are drawn in', () => {
  it('puts each parent before its children, depth first', () => {
    expect(shape(treeRows(rows, 'parent', []))).toEqual(['a', '  b', '  c', '    d', 'e']);
  });

  it('says which rows can be opened, so only they get a control', () => {
    const byId = Object.fromEntries(treeRows(rows, 'parent', []).map((t) => [t.row.id, t.hasChildren]));
    expect(byId).toEqual({ a: true, b: false, c: true, d: false, e: false });
  });

  it('leaves out what is under a closed row, and keeps the row itself', () => {
    expect(shape(treeRows(rows, 'parent', ['c']))).toEqual(['a', '  b', '  c', 'e']);
  });

  // The rescue at the end of the walk is for rows in a cycle. A row the reader
  // merely closed must not be rescued back onto the screen as a root.
  it('does not redraw a closed row\u2019s children at the top', () => {
    expect(shape(treeRows(rows, 'parent', ['a']))).toEqual(['a', 'e']);
  });

  it('is every row at the top when the table is flat', () => {
    expect(flatRows(rows).every((t) => t.depth === 0 && !t.hasChildren)).toBe(true);
  });
});

describe('an answer that does not hold every row', () => {
  it('draws a row whose parent is missing as a root, rather than losing it', () => {
    const orphan = rows.filter((r) => r.id !== 'c'); // d's parent is gone
    // A root in the order it was delivered, not shuffled to the end.
    expect(shape(treeRows(orphan, 'parent', []))).toEqual(['a', '  b', 'd', 'e']);
  });

  it('breaks a cycle instead of hanging, and still draws the rows in it', () => {
    const loop: RecordListRow[] = [
      { id: 'x', parent: 'y', name: 'X' },
      { id: 'y', parent: 'x', name: 'Y' },
      { id: 'z', parent: null, name: 'Z' },
    ];
    expect(ids(treeRows(loop, 'parent', [])).sort()).toEqual(['x', 'y', 'z']);
  });

  it('treats a row naming itself as a root', () => {
    expect(ids(treeRows([{ id: 'self', parent: 'self', name: 'S' }], 'parent', []))).toEqual(['self']);
  });
});

describe('sorting a tree', () => {
  const byCostDesc = rowComparator(columns, { key: 'cost', direction: 'desc' });

  it('orders siblings under their parent, never the whole table', () => {
    // c (500) before b (400) under a; roots ordered a (900) before e (100).
    expect(shape(treeRows(rows, 'parent', [], byCostDesc))).toEqual(['a', '  c', '    d', '  b', 'e']);
  });

  it('leaves the delivered order alone when nothing is sorted', () => {
    expect(shape(treeRows(rows, 'parent', [], null))).toEqual(['a', '  b', '  c', '    d', 'e']);
  });
});

describe('narrowing a tree', () => {
  it('keeps the ancestors that lead to a hit, so the path is still drawn', () => {
    const found = searchRows(rows, columns, 'formwork');
    expect(found.map((r) => r.id)).toEqual(['d']);
    expect(withAncestors(found, rows, 'parent').map((r) => r.id)).toEqual(['a', 'c', 'd']);
  });

  it('names the ancestors and not the hits themselves', () => {
    expect([...ancestorIds([rows[3]], rows, 'parent')].sort()).toEqual(['a', 'c']);
  });

  it('opens the way to a hit, and leaves every other closed row closed', () => {
    const ancestors = ancestorIds([rows[3]], rows, 'parent');
    expect(openedForHits(['a', 'c', 'e'], ancestors)).toEqual(['e']);
  });

  it('draws the path as context, with the hit still nested under it', () => {
    const found = searchRows(rows, columns, 'formwork');
    const kept = withAncestors(found, rows, 'parent');
    expect(shape(treeRows(kept, 'parent', []))).toEqual(['a', '  c', '    d']);
  });

  it('keeps a hit visible even under a row the reader had closed', () => {
    const found = searchRows(rows, columns, 'formwork');
    const kept = withAncestors(found, rows, 'parent');
    const open = openedForHits(['c'], ancestorIds(found, rows, 'parent'));
    expect(shape(treeRows(kept, 'parent', open))).toEqual(['a', '  c', '    d']);
  });
});

describe('opening and closing', () => {
  it('closes an open row and opens a closed one', () => {
    expect(toggleCollapsed([], 'a')).toEqual(['a']);
    expect(toggleCollapsed(['a', 'c'], 'a')).toEqual(['c']);
  });
});
