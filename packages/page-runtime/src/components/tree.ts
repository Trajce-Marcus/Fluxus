// Rows that point at one another (RECORD_LIST_DESIGN §4.11, step 6). Pure —
// rows in, rows out — beside `columnFormat`, `searchSort`, `columnFilters` and
// `selection`, for the same reasons they are.
//
// **Hierarchy is row order, nothing more.** That is the whole of the 2026-09-13
// ruling that there is one table component and not two: a tree is this table
// with its rows in a different order and one column indented, so it is a pure
// function of the rows exactly as searching and sorting are — while everything
// a hierarchy screen actually needs (column types, action columns, selection,
// bulk actions, search, sort, filters) is already built once, here. `RecordTree`
// was the same table built again with none of it.
//
// Rows stay flat on the wire because that is what a GET answers with; the
// nesting is rebuilt for display. Two safeguards, both carried over from
// `RecordTree` because a screen depends on them:
//
//   - **A row whose parent is missing from the answer is a root**, so a partial
//     or narrowed answer still draws instead of vanishing.
//   - **A cycle is broken, never hung** — a row already placed is not placed
//     again, and anything a walk from the roots never reaches is drawn at the
//     top rather than dropped.

import type { RecordListRow } from './RecordList';

/** One row as the table draws it: how deep it sits, and whether it can open. */
export interface TreeRow {
  row: RecordListRow;
  /** 0 for a root. Only the indent depends on it. */
  depth: number;
  /** Whether this row has children **in hand** — what decides if it gets an expander. */
  hasChildren: boolean;
  /** Whether those children are hidden right now. */
  collapsed: boolean;
}

/** A flat table is a tree of roots: every row at depth 0, nothing to expand. */
export const flatRows = (rows: readonly RecordListRow[]): TreeRow[] =>
  rows.map((row) => ({ row, depth: 0, hasChildren: false, collapsed: false }));

/** The id in a row's parent field, or null where it names none. */
const parentOf = (row: RecordListRow, parentKey: string): string | null => {
  const raw = row[parentKey];
  return raw === null || raw === undefined || raw === '' ? null : String(raw);
};

/**
 * Every row on the path from a root down to one of these — the ancestors, not
 * the rows themselves. Two things need it: drawing the path to a hit, and
 * **opening the way to one**, since a hit hidden under a closed row makes a
 * search look broken.
 */
export function ancestorIds(
  kept: readonly RecordListRow[],
  all: readonly RecordListRow[],
  parentKey: string,
): Set<string> {
  const byId = new Map(all.map((row) => [row.id, row]));
  const found = new Set<string>();
  for (const row of kept) {
    let parent = parentOf(row, parentKey);
    // The seen set is the cycle guard: a parent chain that loops would walk for
    // ever otherwise.
    const seen = new Set<string>([row.id]);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      found.add(parent);
      const above = byId.get(parent);
      parent = above ? parentOf(above, parentKey) : null;
    }
  }
  return found;
}

/**
 * The rows a narrowing kept, **plus the ancestors that lead to them** — drawn
 * as context though they match nothing themselves. Without this the path to a
 * hit disappears and a deep row reads as a root, which is a lie about the data.
 *
 * It obeys step 4's rule rather than bending it: narrowing changes what is
 * **shown**, and an ancestor is part of showing a row that is nested.
 */
export function withAncestors(
  kept: readonly RecordListRow[],
  all: readonly RecordListRow[],
  parentKey: string,
): RecordListRow[] {
  const wanted = new Set(kept.map((row) => row.id));
  for (const id of ancestorIds(kept, all, parentKey)) wanted.add(id);
  // In the order the rows were delivered, so what is drawn keeps the answer's
  // own order until a sort says otherwise.
  return all.filter((row) => wanted.has(row.id));
}

/**
 * The closed rows that stay closed while something is being looked for. A row
 * on the path to a hit is opened — a search that finds a row and then leaves it
 * hidden behind a twisty is a search that has failed. Everything else the
 * reader closed stays closed, so narrowing does not throw the shape away.
 */
export const openedForHits = (
  collapsed: readonly string[],
  ancestors: ReadonlySet<string>,
): string[] => collapsed.filter((id) => !ancestors.has(id));

/**
 * The rows in tree order: each parent followed by its children, depth-first,
 * with the subtree under a collapsed row left out.
 *
 * `compare` orders **siblings under their parent** — never the whole table,
 * which would take the tree apart. It is the flat table's own comparison,
 * handed in rather than rebuilt (see `rowComparator`).
 */
export function treeRows(
  rows: readonly RecordListRow[],
  parentKey: string,
  collapsed: readonly string[],
  compare?: ((a: RecordListRow, b: RecordListRow) => number) | null,
): TreeRow[] {
  const present = new Set(rows.map((row) => row.id));
  const children = new Map<string, RecordListRow[]>();
  const roots: RecordListRow[] = [];

  for (const row of rows) {
    const parent = parentOf(row, parentKey);
    // A parent that is absent from the answer — or a row naming itself — is a
    // root, so the row is still drawn.
    if (parent && parent !== row.id && present.has(parent)) {
      children.set(parent, [...(children.get(parent) ?? []), row]);
    } else {
      roots.push(row);
    }
  }

  const order = (group: RecordListRow[]) => (compare ? [...group].sort(compare) : group);
  const hidden = new Set(collapsed);
  const placed = new Set<string>();
  const out: TreeRow[] = [];

  // A subtree under a closed row is *placed but not drawn*. Marking it matters:
  // the sweep below rescues rows a walk never reached, and without this it
  // would rescue every row the reader had simply closed, drawing the whole
  // subtree again at the top.
  const bury = (group: readonly RecordListRow[]) => {
    for (const row of group) {
      if (placed.has(row.id)) continue;
      placed.add(row.id);
      bury(children.get(row.id) ?? []);
    }
  };

  const walk = (group: readonly RecordListRow[], depth: number) => {
    for (const row of group) {
      if (placed.has(row.id)) continue; // a cycle, or a row reached twice
      placed.add(row.id);
      const kids = order(children.get(row.id) ?? []);
      const isCollapsed = hidden.has(row.id);
      out.push({ row, depth, hasChildren: kids.length > 0, collapsed: isCollapsed });
      if (isCollapsed) bury(kids);
      else walk(kids, depth + 1);
    }
  };
  walk(order(roots), 0);

  // Anything a walk from the roots never reached is in a cycle. Drawn at the
  // top rather than dropped: a row the reader can see and fix beats a row that
  // silently is not there.
  for (const row of rows) {
    if (!placed.has(row.id)) out.push({ row, depth: 0, hasChildren: false, collapsed: false });
  }
  return out;
}

/** Open a closed row, or close an open one. */
export const toggleCollapsed = (collapsed: readonly string[], id: string): string[] =>
  collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id];
