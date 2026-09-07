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
// Deliberately not the workbench grid. That one is the generic face of a whole
// model (every record type, every activity, import/export, schema navigation)
// and belongs inside the workbench. A page wants one list, the columns its
// author chose, and the two or three acts that page is about.

import { createElement, useState } from 'react';
import type { PropSchema } from '../manifest';
import type { PageServiceHandlers } from '../pageHost';
import { actionComponents } from './actionComponents';
import { columnWidth, drawCell, isRightAligned, resolveCurrency } from './columnFormat';

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
  /** Named callback: selection changed. Emits (record). */
  onSelect?: (record: string) => void;
  /** Named callback: create. Emits (null) — a CREATE has no anchor. */
  onNew?: (record: null) => void;
  /** Supplied by the host: the verbs an action column's button calls. */
  services?: PageServiceHandlers;
}

const cell = (row: RecordListRow, col: RecordListColumn): string =>
  drawCell(col.key ? row[col.key] : undefined, col.type, col.format, resolveCurrency(col.currency, row));

/** A column that draws a button rather than a value (§1.3 / §2.5). */
const isAction = (col: RecordListColumn): boolean => !!col.component;

// Columns are keyed by position: an action column has no key to key on, and two
// of them on one row is the ordinary case.
const columnKey = (col: RecordListColumn, index: number): string => `${index}:${col.key ?? col.component ?? ''}`;

// The named component draws the button; the row supplies the record it acts on.
// An unknown name says so in place of the button rather than drawing nothing —
// a blank cell would look like a column that simply had no action for this row.
function renderAction(col: RecordListColumn, row: RecordListRow, services: PageServiceHandlers | undefined) {
  const component = col.component ? actionComponents[col.component] : undefined;
  if (!component) return <span className="rl-unknown">?{col.component}</span>;
  return createElement(component, { label: col.label, target: col.target, record: row.id, services });
}

function RecordListComponent({
  title,
  rows = [],
  columns = [],
  newLabel = 'New',
  emptyMessage = 'Nothing here yet.',
  onSelect,
  onNew,
  services,
}: RecordListProps) {
  // Clicking a row selects it and nothing more. Acts are the buttons at the end
  // — a click that silently starts an edit is a click nobody asked for.
  const [selected, setSelected] = useState<string | null>(null);
  const select = (id: string) => { setSelected(id); onSelect?.(id); };

  return (
    <div className="rl-root">
      <div className="rl-head">
        {title && <h2 className="rl-title">{title}</h2>}
        {/* Shown whether or not the page wired it — whether a control is
            visible is the model's business, not the wiring's. */}
        <button className="rl-new" onClick={() => onNew?.(null)}>{newLabel}</button>
      </div>

      {rows.length === 0 ? (
        <p className="rl-empty">{emptyMessage}</p>
      ) : (
        <table className="rl-table">
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th
                  key={columnKey(col, i)}
                  className={isRightAligned(col.type) ? 'rl-num' : undefined}
                  style={{ width: columnWidth(col.width) }}
                >
                  {/* An action column's label belongs on its button, not here. */}
                  {isAction(col) ? '' : col.label ?? col.key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={row.id === selected ? 'rl-row rl-row--selected' : 'rl-row'}
                onClick={() => select(row.id)}
              >
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
  .rl-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; gap: 1rem; }
  .rl-title { font-size: 1rem; margin: 0; }
  .rl-new { padding: 4px 12px; border: none; border-radius: 4px; background: #2563eb; color: #fff; cursor: pointer; font-size: 0.75rem; }
  .rl-empty { color: #94a3b8; font-size: 0.8rem; }
  .rl-table { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
  .rl-table th { box-sizing: border-box; text-align: left; color: #64748b; font-weight: 600; padding: 4px 10px 4px 0; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
  .rl-table td { padding: 6px 10px 6px 0; border-bottom: 1px solid #f1f5f9; }
  .rl-row { cursor: pointer; }
  .rl-row:hover td { background: #f8fafc; }
  .rl-row--selected td { background: #eff6ff; }
  .rl-num { text-align: right; font-variant-numeric: tabular-nums; }
  .rl-action { white-space: nowrap; text-align: right; width: 1%; }
  .rl-unknown { color: #b45309; font-size: 0.7rem; }
`;

// One column, described the way any property is, so the page builder can edit
// the list without knowing what a column is. Mirrors RecordListColumn above.
// Only `key` is required: a column must work with nothing but the field it
// names, so a plain list of records needs no more than the field names.
const columnItems: PropSchema[] = [
  { name: 'key',      kind: 'static-config', type: 'string', required: true,  description: 'Field in the row' },
  { name: 'label',    kind: 'static-config', type: 'string', required: false, description: 'Heading — the key if left empty' },
  { name: 'width',    kind: 'static-config', type: 'number', required: false, description: 'Width hint in pixels — blank for auto' },
  { name: 'type',     kind: 'static-config', type: 'string', required: false, description: 'text (default), int, decimal, datetime, time, boolean, photo, file' },
  { name: 'format',   kind: 'static-config', type: 'string', required: false, description: 'N2, F2, C2, P1, dd/MM/yyyy, HH:mm — blank for the type default' },
  { name: 'currency',  kind: 'static-config', type: 'string', required: false, description: 'Code for a C format: AUD, or row.<field> for one per row' },
  { name: 'component', kind: 'static-config', type: 'string', required: false, description: 'Action column: RunActivity or OpenPage — leave blank for a data column' },
  { name: 'target',    kind: 'static-config', type: 'string', required: false, description: 'What the action acts on: an activity id, or a page path' },
];

const schema: PropSchema[] = [
  { name: 'title',        kind: 'static-config', type: 'string',   required: false, description: 'Heading above the list' },
  { name: 'rows',         kind: 'dynamic-data',  type: 'array',    required: true,  description: 'Rows to list — each needs an id, plus whatever the columns name' },
  { name: 'columns',      kind: 'static-config', type: 'array',    required: true,  description: 'Columns, in display order', items: columnItems },
  { name: 'newLabel',     kind: 'static-config', type: 'string',   required: false, description: 'Label on the create control' },
  { name: 'emptyMessage', kind: 'static-config', type: 'string',   required: false, description: 'Shown when there are no rows' },
  { name: 'onSelect',     kind: 'callback',      type: 'function', required: false, description: 'Selection changed — emits (record)' },
  { name: 'onNew',        kind: 'callback',      type: 'function', required: false, description: 'Create — emits (null), since a CREATE has no anchor' },
];

export const RecordList = Object.assign(RecordListComponent, { css, schema });
