// A model-blind listing: rows in, columns declared, a row click out. Nothing
// here knows what a project or a work order is — the page names the GET that
// fills `rows`, and says what its columns hold.
//
// Row actions are columns (step 2). An **unbound** column reads nothing from
// the row; it names a small action component instead, and RecordList draws it
// once per row with that row's record. So the table has no action machinery of
// its own — no per-row buttons in its schema, no callback per act — and the
// same buttons work anywhere else a component can be placed. The `>` at the row
// end is not a special control either: it is one more action column.
//
// Selection is `one` unless the page says otherwise (step 3). `many` draws a
// checkbox per row and a select-all in the heading, and `onSelect` emits the
// selection as a **list** in every mode — one id or twenty — so no script has
// to know which mode the page was built in. The arithmetic of it lives in
// `selection.ts`, pure, for the same reasons the drawing of a cell does.
//
// Acts come in two kinds, and the split is what they act on. A **row action**
// is a column: one row, one record, and it is a component so the same button
// works anywhere. A **bulk action** is the table's own control over its own
// selection: it appears above the table once something is checked. It cannot be
// a component placed elsewhere, because there is no selection anywhere else.
//
// A bulk action runs its activity **exactly once**, with the ticked ids landing
// in an attribute it nominates — the crew is asked for once, not forty times,
// and the hook does the forty pieces of work. That is the platform's own shape:
// an activity guards the way in, a hook writes in bulk once inside. The run is
// about the page's own record, not about any row: a dispatch app lists work
// orders, it is not one.
//
// `parentKey` makes the same table a **tree** (step 6): rows nest under their
// parent, indented, with an expander on the first column that holds a value.
// Hierarchy is row order and nothing more, which is why there is one table
// component and not two — a tree needs the same columns, the same acts, the
// same selection and the same narrowing, and `RecordTree` was all of that built
// a second time. The order lives in `tree.ts`, pure, like the rest.
//
// A filter per column is two switches with two audiences (step 5): the author
// says whether this table offers them at all, and the reader presses a toolbar
// toggle to see them. Neither is on by default — a table full of filter boxes
// nobody asked for is a worse table. Like the search box it narrows the rows
// already delivered and fetches nothing; the arithmetic is in `columnFilters.ts`.
//
// Deliberately not the workbench grid. That one is the generic face of a whole
// model (every record type, every activity, import/export, schema navigation)
// and belongs inside the workbench. A page wants one list, the columns its
// author chose, and the two or three acts that page is about.

import { createElement, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { PropSchema } from '../manifest';
import type { PageServiceHandlers } from '../pageHost';
import { actionComponents, actionCss } from './actionComponents';
import { columnWidth, drawCell, isRightAligned, resolveCurrency } from './columnFormat';
import {
  emitted,
  headerState,
  hiddenCount,
  inRowOrder,
  nextSelection,
  selectAll,
  selectionMode,
  type SelectionMode,
} from './selection';
import { hasSortableValue, nextSort, rowComparator, searchRows, sortRows, type Sort } from './searchSort';
import { ancestorIds, flatRows, openedForHits, toggleCollapsed, treeRows, withAncestors, type TreeRow } from './tree';
import {
  choiceState,
  choices,
  clearAll,
  keepMatching,
  clearColumn,
  filterCount,
  isTicked,
  filterRows,
  hasFilterableValues,
  narrowChoices,
  toggleAll,
  toggleChoice,
  type ColumnFilters,
} from './columnFilters';

export interface RecordListColumn {
  /** Key into the row object. Absent on an action column, which reads nothing. */
  key?: string;
  /** Column heading. Falls back to the key. */
  label?: string;
  /** Width hint in pixels. Blank means auto. */
  width?: number;
  /**
   * How the value is drawn — one of the model's own attribute types
   * (`text`, `int`, `decimal`, `datetime`, `time`, `photo`, `file`) plus
   * `boolean`. Blank or unknown draws as text. Alignment follows from this;
   * there is no separate property, and the old `numeric` flag is gone.
   */
  type?: string;
  /** Format string for the type — `N2`, `C2`, `dd/MM/yyyy`. Blank is the type's default. */
  format?: string;
  /** Currency code for a `C` format: `AUD`, or `row.<field>` for one per row. */
  currency?: string;
  /**
   * Names an action component — `RunActivity` or `OpenPage` — making this an
   * **unbound** column: it reads nothing from the row and draws a button once
   * per row instead of a value. `label` is then the button's text and the
   * heading is blank, since a column of buttons has nothing to head.
   */
  component?: string;
  /** What the action component acts on: an activity id, or a page path. */
  target?: string;
  /**
   * `RunActivity` only: the activity attribute this row's record fills, rather
   * than anchoring the run. What lets a row action open a CREATE — "add a
   * child here" — carrying the row as the parent.
   */
  attribute?: string;
}

/** A bulk action: one activity, run once, over the records that are ticked. */
export interface RecordListAction {
  /** What the button says. */
  label?: string;
  /** The activity to run — once, whatever the number of ticks. */
  target?: string;
  /**
   * The activity attribute the ticked ids fill. Without it the run would carry
   * no record at all, so it is what makes a bulk action a bulk action.
   */
  attribute?: string;
}

export interface RecordListRow {
  id: string;
  [key: string]: unknown;
}

interface RecordListProps {
  title?: string;
  rows: RecordListRow[];
  columns: RecordListColumn[];
  /**
   * What the create control says — and whether there is one. Blank means the
   * table has no create act, so no button is drawn.
   */
  newLabel?: string;
  emptyMessage?: string;
  /**
   * How many rows may be selected: `none`, `one` (the default, and what the
   * table always did) or `many`, which adds a checkbox per row and a
   * select-all in the heading.
   */
  selection?: string;
  /**
   * Acts on the checked records, drawn above the table. Shown only once
   * something is checked, since a bulk act with nothing selected has nothing
   * to act on. Needs `selection: 'many'` — without checkboxes there is nothing
   * to reveal them.
   */
  bulkActions?: RecordListAction[];
  /** A search box in the heading, filtering the delivered rows across every column. */
  search?: boolean;
  /** Clicking a heading sorts by it. One switch for the table, not per column. */
  sortable?: boolean;
  /**
   * The field holding a row's parent, making the table a **tree**: rows nest
   * under their parent, indented, with an expander on the first column that
   * holds a value. Blank is the flat table, unchanged. Rows still arrive flat —
   * that is what a GET answers with — and the nesting is rebuilt for display.
   */
  parentKey?: string;
  /**
   * Whether this table offers a filter per column at all — the **author's**
   * switch. The reader's is the toolbar toggle it reveals, itself off until
   * pressed: a table full of filter boxes nobody asked for is a worse table.
   */
  columnFilters?: boolean;
  /**
   * Named callback: selection changed. Always emits the selection as a list —
   * one id or twenty — so a script never has to know the mode.
   */
  onSelect?: (records: string[]) => void;
  /** Named callback: create. Emits (null) — a CREATE has no anchor. */
  onNew?: (record: null) => void;
  /** Supplied by the host: the verbs an action column's button calls. */
  services?: PageServiceHandlers;
}

const cell = (row: RecordListRow, col: RecordListColumn): string =>
  drawCell(col.key ? row[col.key] : undefined, col.type, col.format, resolveCurrency(col.currency, row));

/** A column that draws a button rather than a value (§1.3 / §2.5). */
const isAction = (col: RecordListColumn): boolean => !!col.component;

// A heading says what its column holds and, where the column can be sorted,
// that clicking it does something.
const headingClass = (col: RecordListColumn, sorts: boolean): string | undefined =>
  [isRightAligned(col.type) ? 'rl-num' : '', sorts ? 'rl-sortable' : ''].join(' ').trim() || undefined;

// A row is only clickable where a click means something: with selection off it
// is inert, so it neither highlights nor offers a pointer.
const rowClass = (mode: SelectionMode, isSelected: boolean): string =>
  [mode === 'none' ? 'rl-row rl-row--inert' : 'rl-row', isSelected ? 'rl-row--selected' : ''].join(' ').trim();

// Columns are keyed by position: an action column has no key to key on, and two
// of them on one row is the ordinary case.
const columnKey = (col: RecordListColumn, index: number): string => `${index}:${col.key ?? col.component ?? ''}`;

// The named component draws the button; the row supplies the record it acts on.
// An unknown name says so in place of the button rather than drawing nothing —
// a blank cell would look like a column that simply had no action for this row.
function renderAction(col: RecordListColumn, row: RecordListRow, services: PageServiceHandlers | undefined) {
  const component = col.component ? actionComponents[col.component] : undefined;
  if (!component) return <span className="rl-unknown">?{col.component}</span>;
  return createElement(component, { label: col.label, target: col.target, attribute: col.attribute, record: row.id, services });
}

// Which kind of empty this is. "Nothing here yet" is the author's message and a
// fact about the data; these are facts about what the reader asked for, and
// each names the half that has to be undone to see rows again.
function noMatchMessage(term: string, filtering: number): string {
  const typed = term.trim();
  const columnsWord = `${filtering} column${filtering === 1 ? '' : 's'}`;
  if (typed && filtering) return `No rows match \u201c${typed}\u201d and the filters on ${columnsWord}.`;
  if (typed) return `No rows match \u201c${typed}\u201d.`;
  return `No rows match the filters on ${columnsWord}.`;
}

// What a column's filter button says. An unfiltered column says `All`; a column
// with everything unticked says `None` rather than `0 selected`, because that
// state is the reason the table is empty and it has to read as a statement.
const filterLabel = (kept: readonly string[] | undefined): string => {
  if (!kept) return 'All';
  return kept.length === 0 ? 'None' : `${kept.length} selected`;
};

// Where the popup goes. It is **fixed to the viewport**, not placed inside the
// heading (2026-09-13): the table scrolls inside the component's own box, so a
// popup positioned within it is clipped by that box — and a short component
// clips it to almost nothing, exactly when the reader has filtered every row
// away and needs the list back. Fixed escapes the clip; the price is that the
// position has to be worked out rather than declared.
//
// It opens below the button and flips above when there is no room, and its
// height is what is left to the edge of the window, so the choice list scrolls
// inside rather than the popup running off the screen.
const POP_GAP = 2;
const POP_EDGE = 8;
const POP_MAX_WIDTH = 288;
const POP_MIN_HEIGHT = 160;

function usePopupPlacement(anchor: HTMLElement): { left: number; top?: number; bottom?: number; maxHeight: number } {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    // Any scroll between the button and the viewport moves the button while
    // the viewport holds the popup still, so it is measured again rather than
    // left drifting. Capture, because a panel's scroll does not bubble.
    window.addEventListener('scroll', redraw, true);
    window.addEventListener('resize', redraw);
    return () => {
      window.removeEventListener('scroll', redraw, true);
      window.removeEventListener('resize', redraw);
    };
  }, []);

  const r = anchor.getBoundingClientRect();
  const left = Math.max(POP_EDGE, Math.min(r.left, window.innerWidth - POP_MAX_WIDTH - POP_EDGE));
  const below = window.innerHeight - r.bottom - POP_GAP - POP_EDGE;
  const above = r.top - POP_GAP - POP_EDGE;
  return below < POP_MIN_HEIGHT && above > below
    ? { left, bottom: window.innerHeight - r.top + POP_GAP, maxHeight: above }
    : { left, top: r.bottom + POP_GAP, maxHeight: below };
}

/**
 * A click anywhere else closes the popup, and so does Escape from anywhere —
 * the ordinary manners of a dropdown.
 *
 * Two details earn the hand-written listener. It reads `composedPath()`, not
 * `event.target`, because the Console mounts its shell in a **shadow root**: a
 * document-level listener is handed the host element and would think every
 * click was outside. And it ignores clicks on the **button that opened it**,
 * which closes the popup by toggling — without that, this would close it first
 * and the button would immediately open it again.
 */
function useCloseWhenAway(popup: React.RefObject<HTMLElement | null>, anchor: HTMLElement, onClose: () => void) {
  useEffect(() => {
    const away = (e: Event) => {
      const path = e.composedPath();
      if (anchor && path.includes(anchor)) return;
      if (popup.current && path.includes(popup.current)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [popup, anchor, onClose]);
}

/**
 * One column's filter: a contains box, the tri-state box over the list, and the
 * column's distinct **drawn** values. Its own state, so opening another column
 * starts with a clean contains box.
 *
 * An unfiltered column shows every box ticked, which is what a reader expects
 * of a column that is showing everything — and why unticking one excludes that
 * value rather than keeping only it. `columnFilters.ts` holds that arithmetic.
 */
function ColumnFilterPopup({
  col,
  rows,
  filters,
  anchor,
  onChange,
  onClose,
}: {
  col: RecordListColumn;
  rows: RecordListRow[];
  filters: ColumnFilters;
  anchor: HTMLElement;
  onChange: (next: ColumnFilters) => void;
  onClose: () => void;
}) {
  const [find, setFind] = useState('');
  const popup = useRef<HTMLDivElement>(null);
  const place = usePopupPlacement(anchor);
  useCloseWhenAway(popup, anchor, onClose);
  const key = col.key as string;
  const all = choices(rows, col);
  const listed = narrowChoices(all, find);
  const state = choiceState(filters, key, listed);

  return (
    <div ref={popup} className="rl-pop" style={place} onClick={(e) => e.stopPropagation()}>
      {/* Typing filters the rows on the keystroke, not on a further click: the
          term keeps the values it matches, so the contains filter is made out
          of the one mechanism there is. It replaces what was ticked, since a
          typed term is the stronger statement of the two. */}
      <input
        className="rl-pop-find"
        type="search"
        value={find}
        autoFocus
        placeholder="Contains"
        aria-label={`Keep values containing, in ${col.label ?? key}`}
        onChange={(e) => { setFind(e.target.value); onChange(keepMatching(filters, key, e.target.value, all)); }}
      />
      <label className="rl-pop-all">
        <input
          type="checkbox"
          checked={state === 'all'}
          ref={(el) => { if (el) el.indeterminate = state === 'some'; }}
          onChange={() => onChange(toggleAll(filters, key, listed, all))}
        />
        Select all
      </label>
      <div className="rl-pop-list">
        {listed.length === 0 ? (
          <p className="rl-pop-none">No values match “{find.trim()}”.</p>
        ) : (
          listed.map((choice) => (
            <label key={choice} className="rl-pop-choice">
              <input
                type="checkbox"
                checked={isTicked(filters, key, choice)}
                onChange={() => onChange(toggleChoice(filters, key, choice, all))}
              />
              <span className="rl-pop-text">{choice}</span>
            </label>
          ))
        )}
      </div>
      <div className="rl-pop-foot">
        {filters[key] && (
          <button
            className="rl-pop-clear"
            onClick={() => { setFind(''); onChange(clearColumn(filters, key)); }}
          >
            Clear
          </button>
        )}
        <button className="rl-pop-done" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

/** The heading's select-all box. `indeterminate` is a property, not an attribute. */
function SelectAllBox({ state, onToggle }: { state: 'none' | 'some' | 'all'; onToggle: () => void }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      checked={state === 'all'}
      ref={(el) => { if (el) el.indeterminate = state === 'some'; }}
      onChange={onToggle}
    />
  );
}

function RecordListComponent({
  title,
  rows = [],
  columns = [],
  newLabel,
  emptyMessage = 'Nothing here yet.',
  selection,
  bulkActions = [],
  search = false,
  sortable = false,
  columnFilters = false,
  parentKey,
  onSelect,
  onNew,
  services,
}: RecordListProps) {
  // Clicking a row selects it and nothing more. Acts are the buttons at the end
  // — a click that silently starts an edit is a click nobody asked for. In
  // `many` the click toggles rather than replaces, so the row works as its own
  // checkbox and the boxes are the visible half of the same thing.
  const mode: SelectionMode = selectionMode(selection);
  const [selected, setSelected] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort | null>(null);
  const [term, setTerm] = useState('');
  // Two switches, two audiences (§4.10): `columnFilters` is the author saying
  // this table offers filters; `showFilters` is the reader asking to see them.
  // Turning the reader's switch off hides the controls and clears **nothing**,
  // or the toggle would be a second, invisible filter — so the toolbar says
  // how many columns are filtering whenever the row is hidden.
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<ColumnFilters>({});
  // The open column, and the button it hangs off — the popup is fixed to the
  // viewport, so it needs the button's place on screen rather than a parent.
  const [open, setOpen] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const closeFilter = useCallback(() => setOpen(null), []);

  // Filtered, then searched, then sorted, then drawn — narrowing before
  // ordering, because ordering what was kept is cheaper than keeping what was
  // ordered, and the answer is the same. The three narrow together (AND).
  const filtering = columnFilters ? filterCount(filters) : 0;
  const kept = columnFilters ? filterRows(rows, columns, filters) : rows;
  const found = searchRows(kept, columns, term);

  // Nesting is the last of the row-order steps, and it agrees with the others
  // rather than overriding them: a narrowing keeps the ancestors that lead to
  // what it kept, so the path to a hit is still on screen, and the sort orders
  // **siblings under their parent** with the flat table's own comparison.
  const nested = !!parentKey?.trim();
  const shownRows: TreeRow[] = nested
    ? treeRows(
        withAncestors(found, rows, parentKey as string),
        parentKey as string,
        // A row on the path to a hit is opened: a search that finds a row and
        // leaves it behind a closed twisty has failed. Everything else the
        // reader closed stays closed.
        found.length < rows.length
          ? openedForHits(collapsed, ancestorIds(found, rows, parentKey as string))
          : collapsed,
        rowComparator(columns, sort),
      )
    : flatRows(sortRows(found, columns, sort));

  // The first column holding a value: where the indent and the expander go.
  const labelColumn = columns.findIndex((col) => !isAction(col));

  const allIds = rows.map((row) => row.id);
  // What is on screen — and under a closed row, nothing is. Collapsing narrows
  // like a search does: it changes what is shown, never what is ticked.
  const visibleIds = shownRows.map(({ row }) => row.id);
  // Read off every delivered row, not the visible ones: a row a search hid is
  // still ticked, and a row that has gone since the last click stops being
  // drawn as selected.
  const shown = inRowOrder(allIds, selected);
  const offscreen = hiddenCount(visibleIds, selected);
  const boxes = mode === 'many';

  const apply = (next: string[]) => {
    setSelected(next);
    onSelect?.(emitted(next));
  };

  // Exactly one run, with the ticked ids in the attribute the action names
  // (ruled 2026-09-08). The form is therefore asked once — "dispatch these
  // forty to which crew?" — and the hook does the forty.
  //
  // It names no record, and that is the point: the ticked rows are what the
  // run *carries*, while what it is *about* is the page's own record — the app
  // record, which the host fills in. A dispatch app lists work orders; it is
  // not one.
  const runBulk = (action: RecordListAction) => {
    if (!action.target) return;
    const seed = action.attribute ? { attribute: action.attribute, records: shown } : undefined;
    services?.runActivity(action.target, null, seed);
  };
  const clickRow = (id: string) => {
    if (mode !== 'none') apply(nextSelection(mode, allIds, selected, id));
  };

  return (
    <div className="rl-root">
      <div className="rl-head">
        {title && <h2 className="rl-title">{title}</h2>}
        {boxes && shown.length > 0 && (
          <>
            <span className="rl-count">
              {shown.length} selected{offscreen > 0 ? ` (${offscreen} not shown)` : ''}
            </span>
            {/* Hidden with nothing checked — not a wiring question (a bulk act
                is shown whether or not its target is set), but an "act on
                what?" one: there is nothing for it to act on. */}
            {bulkActions.map((action, i) => (
              <button
                key={`${i}:${action.target ?? ''}`}
                className="fx-action-btn"
                title={action.target}
                onClick={() => runBulk(action)}
              >
                {action.label ?? 'Run'}
              </button>
            ))}
          </>
        )}
        {columnFilters && (
          // The reader's switch. It says how many columns are filtering, so
          // turning the row off hides the controls without hiding the fact —
          // the one thing a toggle over filters must never do.
          <button
            className={showFilters ? 'rl-filters rl-filters--on' : 'rl-filters'}
            aria-pressed={showFilters}
            onClick={() => { setShowFilters(!showFilters); setOpen(null); }}
          >
            Filters{filtering > 0 ? ` (${filtering})` : ''}
          </button>
        )}
        {columnFilters && filtering > 0 && (
          <button
            className="rl-filters-clear"
            onClick={() => { setFilters(clearAll()); setOpen(null); }}
          >
            Clear
          </button>
        )}
        {search && (
          <input
            className="rl-search"
            type="search"
            value={term}
            placeholder="Search"
            aria-label="Search"
            onChange={(e) => setTerm(e.target.value)}
          />
        )}
        {/* A blank label is the author saying this table has no create act —
            a statement, not an omission. Distinct from the 2026-08-26 ruling,
            which is about a control that would vanish because nobody *wired*
            it: a named button is still shown whether or not `onNew` is. */}
        {newLabel?.trim() && (
          <button className="rl-new" onClick={() => onNew?.(null)}>{newLabel}</button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rl-empty">{emptyMessage}</p>
      ) : (
        <table className="rl-table">
          <thead>
            <tr>
              {boxes && (
                <th className="rl-check">
                  <SelectAllBox
                    state={headerState(visibleIds, selected)}
                    onToggle={() => apply(selectAll(visibleIds, allIds, selected))}
                  />
                </th>
              )}
              {columns.map((col, i) => (
                <th
                  key={columnKey(col, i)}
                  className={headingClass(col, sortable && hasSortableValue(col))}
                  // An action column is as wide as its button and no wider.
                  // The `<td>` already says `width: 1%` — the shrink-to-content
                  // trick — but a column takes its width from the widest cell
                  // that states one, and an unconstrained heading let the
                  // leftover space land here instead of on the columns that
                  // could use it.
                  style={{ width: columnWidth(col.width) ?? (isAction(col) ? '1%' : undefined) }}
                  onClick={sortable && hasSortableValue(col)
                    ? () => setSort(nextSort(sort, col.key as string))
                    : undefined}
                >
                  {/* An action column's label belongs on its button, not here. */}
                  {isAction(col) ? '' : col.label ?? col.key}
                  {sort && sort.key === col.key && <span className="rl-sort">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
            {columnFilters && showFilters && (
              // A second heading row rather than controls inside the headings:
              // a heading is a sort control already, and two live things in one
              // cell is a click nobody can predict.
              <tr className="rl-filter-row">
                {boxes && <th className="rl-check" />}
                {columns.map((col, i) => (
                  <th key={columnKey(col, i)}>
                    {hasFilterableValues(col) && (
                      <div className="rl-filter-cell">
                        <button
                          className={filters[col.key as string] ? 'rl-filter rl-filter--on' : 'rl-filter'}
                          aria-label={`Filter ${col.label ?? col.key}`}
                          aria-expanded={open?.key === col.key}
                          onClick={(e) => setOpen(open?.key === col.key
                            ? null
                            : { key: col.key as string, anchor: e.currentTarget })}
                        >
                          {filterLabel(filters[col.key as string])} ▾
                        </button>
                        {open && open.key === col.key && (
                          <ColumnFilterPopup
                            col={col}
                            rows={rows}
                            filters={filters}
                            anchor={open.anchor}
                            onChange={setFilters}
                            onClose={closeFilter}
                          />
                        )}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {/* Told apart from an empty list on purpose: "nothing here" and
                "nothing matches what you asked for" are different facts, and
                only one of them is undone by clearing a control. It sits
                **inside** the table (2026-09-13) rather than replacing it, so
                the search box, the headings and the filter row stay on screen:
                a filter that hides every row must not also hide the control
                that would bring them back. */}
            {shownRows.length === 0 && (
              <tr>
                <td className="rl-nomatch" colSpan={columns.length + (boxes ? 1 : 0)}>
                  {noMatchMessage(term, filtering)}
                </td>
              </tr>
            )}
            {shownRows.map(({ row, depth, hasChildren, collapsed: shut }) => (
              <tr
                key={row.id}
                className={rowClass(mode, shown.includes(row.id))}
                onClick={() => clickRow(row.id)}
              >
                {boxes && (
                  // The box does the toggling; the row underneath must not do
                  // it a second time on the way up.
                  <td className="rl-check" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.id}`}
                      checked={shown.includes(row.id)}
                      onChange={() => clickRow(row.id)}
                    />
                  </td>
                )}
                {columns.map((col, i) => (isAction(col) ? (
                  // The click acts; it does not also select the row underneath.
                  <td key={columnKey(col, i)} className="rl-action" onClick={(e) => e.stopPropagation()}>
                    {renderAction(col, row, services)}
                  </td>
                ) : (
                  <td key={columnKey(col, i)} className={isRightAligned(col.type) ? 'rl-num' : undefined}>
                    {/* The indent and the expander go on the first column that
                        holds a value — an action column draws a button and has
                        nothing to indent. A row with no children keeps the same
                        indent and no control, so the values stay in line. */}
                    {nested && i === labelColumn && (
                      <span className="rl-twist" style={{ paddingLeft: depth * 14 }}>
                        {hasChildren ? (
                          <button
                            className="rl-expander"
                            aria-label={shut ? `Expand ${row.id}` : `Collapse ${row.id}`}
                            aria-expanded={!shut}
                            onClick={(e) => { e.stopPropagation(); setCollapsed(toggleCollapsed(collapsed, row.id)); }}
                          >
                            {shut ? '▸' : '▾'}
                          </button>
                        ) : (
                          <span className="rl-expander rl-expander--none" />
                        )}
                      </span>
                    )}
                    {cell(row, col)}
                  </td>
                )))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const css = `
  .rl-root { font-family: system-ui, sans-serif; height: 100%; box-sizing: border-box; overflow: auto; }
  .rl-head { display: flex; align-items: center; margin-bottom: 0.75rem; gap: 1rem; }
  .rl-title { font-size: 1rem; margin: 0; }
  .rl-count { font-size: 0.75rem; color: #64748b; }
  .rl-filters { margin-left: auto; padding: 4px 10px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; color: #475569; cursor: pointer; font-size: 0.75rem; font-family: inherit; }
  .rl-filters:hover { background: #f1f5f9; }
  .rl-filters--on { background: #e0e7ff; border-color: #a5b4fc; color: #3730a3; }
  .rl-filters-clear { padding: 4px 8px; border: none; background: none; color: #2563eb; cursor: pointer; font-size: 0.75rem; font-family: inherit; }
  .rl-filters ~ .rl-search, .rl-filters ~ .rl-new { margin-left: 0; }
  .rl-search { margin-left: auto; padding: 4px 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.75rem; font-family: inherit; min-width: 0; width: 12rem; }
  .rl-search:focus { outline: 2px solid #bfdbfe; outline-offset: -1px; }
  .rl-search ~ .rl-new { margin-left: 0; }
  .rl-new { margin-left: auto; padding: 4px 12px; border: none; border-radius: 4px; background: #2563eb; color: #fff; cursor: pointer; font-size: 0.75rem; }
  .rl-empty { color: #94a3b8; font-size: 0.8rem; }
  .rl-table { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
  .rl-table th { box-sizing: border-box; text-align: left; color: #64748b; font-weight: 600; padding: 4px 10px 4px 0; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
  .rl-sortable { cursor: pointer; user-select: none; }
  .rl-sortable:hover { color: #334155; }
  .rl-sort { margin-left: 4px; font-size: 0.6rem; }
  .rl-table td { padding: 6px 10px 6px 0; border-bottom: 1px solid #f1f5f9; }
  .rl-row { cursor: pointer; }
  .rl-row--inert { cursor: default; }
  .rl-row:hover td { background: #eef2f6; }
  .rl-row--inert:hover td { background: transparent; }
  .rl-check { width: 1%; white-space: nowrap; padding-right: 10px; }
  .rl-check input { cursor: pointer; margin: 0; }
  .rl-row--selected td { background: #dbeafe; }
  .rl-row--selected:hover td { background: #bfdbfe; }
  .rl-filter-row th { padding: 4px 10px 6px 0; border-bottom: 1px solid #e2e8f0; font-weight: 400; }
  .rl-filter-cell { min-width: 0; }
  .rl-filter { width: 100%; padding: 2px 6px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; color: #64748b; cursor: pointer; font-size: 0.7rem; font-family: inherit; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rl-filter:hover { background: #f1f5f9; }
  .rl-filter--on { background: #e0e7ff; border-color: #a5b4fc; color: #3730a3; }
  /* Fixed, so the component's own overflow cannot clip it — see usePopupPlacement. */
  .rl-pop { position: fixed; z-index: 20; display: flex; flex-direction: column; min-width: 12rem; max-width: 18rem; padding: 8px; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.15); font-weight: 400; cursor: default; }
  .rl-pop-find { flex: none; width: 100%; box-sizing: border-box; padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.7rem; font-family: inherit; }
  .rl-pop-all, .rl-pop-choice { flex: none; display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: 0.7rem; color: #334155; cursor: pointer; }
  .rl-pop-all { margin: 6px 0 4px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0; color: #64748b; }
  .rl-pop-list { flex: 1; min-height: 2rem; overflow: auto; }
  .rl-pop-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rl-pop-none { margin: 4px 0; font-size: 0.7rem; color: #94a3b8; }
  .rl-pop-foot { flex: none; display: flex; justify-content: flex-end; gap: 4px; margin-top: 6px; }
  .rl-pop-clear { padding: 2px 8px; border: none; background: none; color: #2563eb; cursor: pointer; font-size: 0.7rem; font-family: inherit; }
  .rl-pop-done { padding: 2px 10px; border: none; border-radius: 4px; background: #2563eb; color: #fff; cursor: pointer; font-size: 0.7rem; font-family: inherit; }
  .rl-nomatch { color: #94a3b8; font-size: 0.8rem; padding: 10px 0; }
  .rl-twist { display: inline-flex; align-items: center; }
  .rl-expander { width: 1.1rem; padding: 0; border: none; background: none; color: #64748b; cursor: pointer; font-size: 0.65rem; line-height: 1; font-family: inherit; }
  .rl-expander:hover { color: #1e293b; }
  .rl-expander--none { display: inline-block; cursor: default; }
  .rl-num { text-align: right; font-variant-numeric: tabular-nums; }
  .rl-action { white-space: nowrap; text-align: right; width: 1%; }
  .rl-unknown { color: #b45309; font-size: 0.7rem; }
${actionCss}`;

// One column, described the way any property is, so the page builder can edit
// the list without knowing what a column is. Mirrors RecordListColumn above.
//
// **Nothing is required**, and that is not laziness: a data column needs only
// the field it names, while an action column names no field at all — it has a
// `component` instead. One of the two must be filled for the column to do
// anything, and "either this or that" is a rule `PropSchema` cannot state, so
// the array editor asks for neither rather than blocking a legitimate action
// column. A column with neither is inert (see the SPEC's accepted costs).
const columnItems: PropSchema[] = [
  { name: 'key',      kind: 'static-config', type: 'string', required: false, description: 'Field in the row — leave blank on an action column' },
  { name: 'label',    kind: 'static-config', type: 'string', required: false, description: 'Heading — the key if left empty' },
  { name: 'width',    kind: 'static-config', type: 'number', required: false, description: 'Width hint in pixels — blank for auto' },
  { name: 'type',     kind: 'static-config', type: 'string', required: false, description: 'text (default), int, decimal, datetime, time, boolean, photo, file' },
  { name: 'format',   kind: 'static-config', type: 'string', required: false, description: 'N2, F2, C2, P1, dd/MM/yyyy, HH:mm — blank for the type default' },
  { name: 'currency',  kind: 'static-config', type: 'string', required: false, description: 'Code for a C format: AUD, or row.<field> for one per row' },
  { name: 'component', kind: 'static-config', type: 'string', required: false, description: 'Action column: RunActivity or OpenPage — leave blank for a data column' },
  { name: 'target',    kind: 'static-config', type: 'string', required: false, description: 'What the action acts on: an activity id, or a page path' },
  { name: 'attribute', kind: 'static-config', type: 'string', required: false, description: 'RunActivity only: activity attribute this row fills instead of anchoring the run' },
];

// A bulk action, described the way any property is, so the builder's array
// editor draws it with no knowledge of what an action is.
const bulkActionItems: PropSchema[] = [
  { name: 'label',     kind: 'static-config', type: 'string', required: false, description: 'What the button says' },
  { name: 'target',    kind: 'static-config', type: 'string', required: true,  description: 'Activity to run — once, whatever the number of ticks' },
  { name: 'attribute', kind: 'static-config', type: 'string', required: true,  description: 'Activity attribute the ticked ids fill' },
];

const schema: PropSchema[] = [
  { name: 'title',        kind: 'static-config', type: 'string',   required: false, description: 'Heading above the list' },
  { name: 'rows',         kind: 'dynamic-data',  type: 'array',    required: true,  description: 'Rows to list — each needs an id, plus whatever the columns name' },
  { name: 'columns',      kind: 'static-config', type: 'array',    required: true,  description: 'Columns, in display order', items: columnItems },
  { name: 'newLabel',     kind: 'static-config', type: 'string',   required: false, description: 'Label on the create control — blank for no create button' },
  { name: 'emptyMessage', kind: 'static-config', type: 'string',   required: false, description: 'Shown when there are no rows' },
  { name: 'selection',    kind: 'static-config', type: 'string',   required: false, description: 'How many rows may be selected', choices: ['one', 'many', 'none'] },
  { name: 'bulkActions',  kind: 'static-config', type: 'array',    required: false, description: 'Acts on the checked records — one run, ids in the named attribute. Shown once something is checked; needs selection: many', items: bulkActionItems },
  { name: 'search',       kind: 'static-config', type: 'boolean',  required: false, description: 'A search box in the heading, filtering the rows across every column' },
  { name: 'sortable',     kind: 'static-config', type: 'boolean',  required: false, description: 'Clicking a heading sorts by it' },
  { name: 'parentKey',    kind: 'static-config', type: 'string',   required: false, description: "Field holding a row's parent — set it to nest the rows; blank for a flat table" },
  { name: 'columnFilters', kind: 'static-config', type: 'boolean', required: false, description: 'Offer a filter per column — a toolbar toggle reveals them, off until pressed' },
  { name: 'onSelect',     kind: 'callback',      type: 'function', required: false, description: 'Selection changed — always emits the list of selected records' },
  { name: 'onNew',        kind: 'callback',      type: 'function', required: false, description: 'Create — emits (null), since a CREATE has no anchor' },
];

export const RecordList = Object.assign(RecordListComponent, { css, schema });
