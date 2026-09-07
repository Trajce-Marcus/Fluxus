// A model-blind listing: rows in, columns declared, a row click and a new-item
// click out. Nothing here knows what a project or a work order is — the page
// names the GET that fills `rows` and wires the callbacks to activities.
//
// Deliberately not the workbench grid. That one is the generic face of a whole
// model (every record type, every activity, import/export, schema navigation)
// and belongs inside the workbench. A page wants one list, the columns its
// author chose, and the two or three acts that page is about.

import { useState } from 'react';
import type { PropSchema } from '../manifest';
import { columnWidth, drawCell, isRightAligned, resolveCurrency } from './columnFormat';

export interface RecordListColumn {
  /** Key into the row object. The only thing a column needs. */
  key: string;
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
  /** Label on the per-row edit control. */
  editLabel?: string;
  /** Label on the per-row open control — the page it opens is the page's business. */
  openLabel?: string;
  emptyMessage?: string;
  /** Named callback: selection changed. Emits (record). */
  onSelect?: (record: string) => void;
  /** Named callback: edit this row. Emits (record). */
  onEdit?: (record: string) => void;
  /** Named callback: open this row elsewhere. Emits (record). */
  onOpen?: (record: string) => void;
  /** Named callback: create. Emits (null) — a CREATE has no anchor. */
  onNew?: (record: null) => void;
}

const cell = (row: RecordListRow, col: RecordListColumn): string =>
  drawCell(row[col.key], col.type, col.format, resolveCurrency(col.currency, row));

function RecordListComponent({
  title,
  rows = [],
  columns = [],
  newLabel = 'New',
  editLabel = 'Edit',
  openLabel = 'Open',
  emptyMessage = 'Nothing here yet.',
  onSelect,
  onEdit,
  onOpen,
  onNew,
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
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={isRightAligned(col.type) ? 'rl-num' : undefined}
                  style={{ width: columnWidth(col.width) }}
                >
                  {col.label ?? col.key}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={row.id === selected ? 'rl-row rl-row--selected' : 'rl-row'}
                onClick={() => select(row.id)}
              >
                {columns.map((col) => (
                  <td key={col.key} className={isRightAligned(col.type) ? 'rl-num' : undefined}>{cell(row, col)}</td>
                ))}
                {/* Shown whether or not the page wired them — whether a control
                    is visible is the model's business, not the wiring's. */}
                <td className="rl-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="rl-btn" onClick={() => onEdit?.(row.id)}>{editLabel}</button>
                  <button className="rl-btn" onClick={() => onOpen?.(row.id)}>{openLabel}</button>
                </td>
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
  .rl-actions { white-space: nowrap; text-align: right; }
  .rl-btn { padding: 2px 10px; margin-left: 4px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; color: #334155; cursor: pointer; font-size: 0.7rem; }
  .rl-btn:hover { background: #f1f5f9; }
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
  { name: 'currency', kind: 'static-config', type: 'string', required: false, description: 'Code for a C format: AUD, or row.<field> for one per row' },
];

const schema: PropSchema[] = [
  { name: 'title',        kind: 'static-config', type: 'string',   required: false, description: 'Heading above the list' },
  { name: 'rows',         kind: 'dynamic-data',  type: 'array',    required: true,  description: 'Rows to list — each needs an id, plus whatever the columns name' },
  { name: 'columns',      kind: 'static-config', type: 'array',    required: true,  description: 'Columns, in display order', items: columnItems },
  { name: 'newLabel',     kind: 'static-config', type: 'string',   required: false, description: 'Label on the create control' },
  { name: 'editLabel',    kind: 'static-config', type: 'string',   required: false, description: 'Label on the per-row edit control' },
  { name: 'openLabel',    kind: 'static-config', type: 'string',   required: false, description: 'Label on the per-row open control' },
  { name: 'emptyMessage', kind: 'static-config', type: 'string',   required: false, description: 'Shown when there are no rows' },
  { name: 'onSelect',     kind: 'callback',      type: 'function', required: false, description: 'Selection changed — emits (record)' },
  { name: 'onEdit',       kind: 'callback',      type: 'function', required: false, description: 'Edit a row — emits (record)' },
  { name: 'onOpen',       kind: 'callback',      type: 'function', required: false, description: 'Open a row elsewhere — emits (record)' },
  { name: 'onNew',        kind: 'callback',      type: 'function', required: false, description: 'Create — emits (null), since a CREATE has no anchor' },
];

export const RecordList = Object.assign(RecordListComponent, { css, schema });
