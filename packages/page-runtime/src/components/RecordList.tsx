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
// Deliberately not the workbench grid. That one is the generic face of a whole
// model (every record type, every activity, import/export, schema navigation)
// and belongs inside the workbench. A page wants one list, the columns its
// author chose, and the two or three acts that page is about.

import { createElement, useState } from 'react';
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
import { isSortable, nextSort, searchRows, sortRows, type Sort } from './searchSort';

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
  /** Sorting by this heading. On unless said otherwise; an action column never sorts. */
  sortable?: boolean;
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
  /** Label for the create control. */
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
const headingClass = (col: RecordListColumn): string | undefined =>
  [isRightAligned(col.type) ? 'rl-num' : '', isSortable(col) ? 'rl-sortable' : ''].join(' ').trim() || undefined;

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
  newLabel = 'New',
  emptyMessage = 'Nothing here yet.',
  selection,
  bulkActions = [],
  search = false,
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

  // Searched, then sorted, then drawn — in that order, because sorting what
  // the search kept is cheaper than searching what the sort ordered, and the
  // answer is the same.
  const visible = sortRows(searchRows(rows, columns, term), columns, sort);

  const allIds = rows.map((row) => row.id);
  const visibleIds = visible.map((row) => row.id);
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
        {/* Shown whether or not the page wired it — whether a control is
            visible is the model's business, not the wiring's. */}
        <button className="rl-new" onClick={() => onNew?.(null)}>{newLabel}</button>
      </div>

      {rows.length === 0 ? (
        <p className="rl-empty">{emptyMessage}</p>
      ) : visible.length === 0 ? (
        // Told apart from an empty list on purpose: "nothing here" and "nothing
        // matches what you typed" are different facts, and only one of them is
        // undone by clearing the box.
        <p className="rl-empty">No rows match “{term.trim()}”.</p>
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
                  className={headingClass(col)}
                  style={{ width: columnWidth(col.width) }}
                  onClick={isSortable(col) ? () => setSort(nextSort(sort, col.key as string)) : undefined}
                >
                  {/* An action column's label belongs on its button, not here. */}
                  {isAction(col) ? '' : col.label ?? col.key}
                  {sort && sort.key === col.key && <span className="rl-sort">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
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
                  <td key={columnKey(col, i)} className={isRightAligned(col.type) ? 'rl-num' : undefined}>{cell(row, col)}</td>
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
  .rl-root { font-family: system-ui, sans-serif; padding: 1rem; height: 100%; box-sizing: border-box; overflow: auto; }
  .rl-head { display: flex; align-items: center; margin-bottom: 0.75rem; gap: 1rem; }
  .rl-title { font-size: 1rem; margin: 0; }
  .rl-count { font-size: 0.75rem; color: #64748b; }
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
  .rl-row:hover td { background: #f8fafc; }
  .rl-row--inert:hover td { background: transparent; }
  .rl-check { width: 1%; white-space: nowrap; padding-right: 10px; }
  .rl-check input { cursor: pointer; margin: 0; }
  .rl-row--selected td { background: #eff6ff; }
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
  { name: 'sortable', kind: 'static-config', type: 'boolean', required: false, description: 'Clicking the heading sorts by this column — on unless set false' },
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
  { name: 'newLabel',     kind: 'static-config', type: 'string',   required: false, description: 'Label on the create control' },
  { name: 'emptyMessage', kind: 'static-config', type: 'string',   required: false, description: 'Shown when there are no rows' },
  { name: 'selection',    kind: 'static-config', type: 'string',   required: false, description: 'one (default), many for checkboxes and select-all, or none' },
  { name: 'bulkActions',  kind: 'static-config', type: 'array',    required: false, description: 'Acts on the checked records — one run, ids in the named attribute. Shown once something is checked; needs selection: many', items: bulkActionItems },
  { name: 'search',       kind: 'static-config', type: 'boolean',  required: false, description: 'A search box in the heading, filtering the rows across every column' },
  { name: 'onSelect',     kind: 'callback',      type: 'function', required: false, description: 'Selection changed — always emits the list of selected records' },
  { name: 'onNew',        kind: 'callback',      type: 'function', required: false, description: 'Create — emits (null), since a CREATE has no anchor' },
];

export const RecordList = Object.assign(RecordListComponent, { css, schema });
