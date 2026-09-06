// A model-blind hierarchy: flat rows in, a tree out. Any record type with a
// self-reference works — the page says which field points at the parent, which
// columns to show, and which activities the acts run.
//
// The rows stay flat on the wire because that is what a GET answers with; the
// nesting is presentation, rebuilt here. A node whose parent is missing from
// the answer is treated as a root, so a filtered or partial list still renders
// rather than vanishing.

import { useMemo, useState } from 'react';
import type { PropSchema } from '../manifest';

export interface RecordTreeColumn {
  key: string;
  label?: string;
  numeric?: boolean;
}

export interface RecordTreeRow {
  id: string;
  [key: string]: unknown;
}

interface RecordTreeProps {
  title?: string;
  nodes: RecordTreeRow[];
  /** Field on a row holding its parent's id. */
  parentKey?: string;
  /** Field shown as the node's own label, beside the expander. */
  labelKey?: string;
  columns?: RecordTreeColumn[];
  newLabel?: string;
  emptyMessage?: string;
  /** Named callback: add at the root. Emits (null). */
  onAddRoot?: (record: null) => void;
  /** Named callback: add beneath a node. Emits (record) — the node clicked. */
  onAddChild?: (record: string) => void;
  /** Named callback: modify a node. Emits (record). */
  onModify?: (record: string) => void;
  /** Named callback: re-parent a node. Emits (record). */
  onMove?: (record: string) => void;
  /** Named callback: delete a node. Emits (record). */
  onDelete?: (record: string) => void;
  /** Named callback: selection changed. Emits (record). */
  onSelect?: (record: string) => void;
}

interface TreeNode {
  row: RecordTreeRow;
  children: TreeNode[];
  depth: number;
}

const format = (raw: unknown, numeric?: boolean): string => {
  if (raw === null || raw === undefined || raw === '') return '—';
  if (numeric) {
    const n = Number(raw);
    return Number.isNaN(n) ? String(raw) : n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  return String(raw);
};

/** Flat rows → roots. A row pointing at an id not present is a root, so a
 *  partial answer still renders. Cycles are broken by the visited set. */
function buildTree(rows: RecordTreeRow[], parentKey: string): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const row of rows) byId.set(row.id, { row, children: [], depth: 0 });

  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.row[parentKey];
    const parent = parentId ? byId.get(String(parentId)) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  const setDepth = (nodes: TreeNode[], depth: number, seen: Set<string>) => {
    for (const node of nodes) {
      if (seen.has(node.row.id)) { node.children = []; continue; }
      seen.add(node.row.id);
      node.depth = depth;
      setDepth(node.children, depth + 1, seen);
    }
  };
  setDepth(roots, 0, new Set());
  return roots;
}

const flatten = (nodes: TreeNode[], collapsed: Set<string>): TreeNode[] =>
  nodes.flatMap((node) =>
    collapsed.has(node.row.id) ? [node] : [node, ...flatten(node.children, collapsed)],
  );

function RecordTreeComponent({
  title,
  nodes = [],
  parentKey = 'parent_id',
  labelKey = 'name',
  columns = [],
  newLabel = 'New',
  emptyMessage = 'Nothing here yet.',
  onAddRoot,
  onAddChild,
  onModify,
  onMove,
  onDelete,
  onSelect,
}: RecordTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);

  const roots = useMemo(() => buildTree(nodes, parentKey), [nodes, parentKey]);
  const visible = useMemo(() => flatten(roots, collapsed), [roots, collapsed]);

  const toggle = (id: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const select = (id: string) => { setSelected(id); onSelect?.(id); };

  return (
    <div className="rt-root">
      <div className="rt-head">
        {title && <h2 className="rt-title">{title}</h2>}
        <button className="rt-btn rt-btn--primary" onClick={() => onAddRoot?.(null)}>{newLabel}</button>
      </div>

      {visible.length === 0 ? (
        <p className="rt-empty">{emptyMessage}</p>
      ) : (
        <table className="rt-table">
          <thead>
            <tr>
              <th>Name</th>
              {columns.map((col) => (
                <th key={col.key} className={col.numeric ? 'rt-num' : undefined}>{col.label ?? col.key}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((node) => {
              const hasChildren = node.children.length > 0;
              const isCollapsed = collapsed.has(node.row.id);
              return (
                <tr
                  key={node.row.id}
                  className={node.row.id === selected ? 'rt-row rt-row--selected' : 'rt-row'}
                  onClick={() => select(node.row.id)}
                >
                  <td>
                    <span className="rt-label" style={{ paddingLeft: `${node.depth * 18}px` }}>
                      <button
                        className={hasChildren ? 'rt-twisty' : 'rt-twisty rt-twisty--leaf'}
                        onClick={(e) => { e.stopPropagation(); if (hasChildren) toggle(node.row.id); }}
                        aria-label={hasChildren ? (isCollapsed ? 'Expand' : 'Collapse') : undefined}
                      >
                        {hasChildren ? (isCollapsed ? '▸' : '▾') : '·'}
                      </button>
                      {format(node.row[labelKey])}
                    </span>
                  </td>
                  {columns.map((col) => (
                    <td key={col.key} className={col.numeric ? 'rt-num' : undefined}>
                      {format(node.row[col.key], col.numeric)}
                    </td>
                  ))}
                  <td className="rt-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="rt-btn" onClick={() => onAddChild?.(node.row.id)}>Add child</button>
                    <button className="rt-btn" onClick={() => onModify?.(node.row.id)}>Modify</button>
                    <button className="rt-btn" onClick={() => onMove?.(node.row.id)}>Move</button>
                    <button className="rt-btn rt-btn--danger" onClick={() => onDelete?.(node.row.id)}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const css = `
  .rt-root { font-family: system-ui, sans-serif; padding: 1rem; height: 100%; box-sizing: border-box; overflow: auto; }
  .rt-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; gap: 1rem; }
  .rt-title { font-size: 1rem; margin: 0; }
  .rt-empty { color: #94a3b8; font-size: 0.8rem; }
  .rt-table { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
  .rt-table th { text-align: left; color: #64748b; font-weight: 600; padding: 4px 10px 4px 0; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
  .rt-table td { padding: 4px 10px 4px 0; border-bottom: 1px solid #f1f5f9; }
  .rt-row { cursor: pointer; }
  .rt-row:hover td { background: #f8fafc; }
  .rt-row--selected td { background: #eff6ff; }
  .rt-label { display: inline-flex; align-items: center; gap: 4px; }
  .rt-twisty { border: none; background: none; cursor: pointer; color: #64748b; font-size: 0.7rem; padding: 0 2px; width: 16px; }
  .rt-twisty--leaf { cursor: default; color: #cbd5e1; }
  .rt-num { text-align: right; font-variant-numeric: tabular-nums; }
  .rt-actions { white-space: nowrap; text-align: right; }
  .rt-btn { padding: 2px 8px; margin-left: 4px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; color: #334155; cursor: pointer; font-size: 0.7rem; }
  .rt-btn:hover { background: #f1f5f9; }
  .rt-btn--primary { background: #2563eb; color: #fff; border-color: #2563eb; padding: 4px 12px; font-size: 0.75rem; }
  .rt-btn--danger { color: #b91c1c; border-color: #fecaca; }
`;

// One column, described the way any property is, so the page builder can edit
// the list without knowing what a column is. Mirrors RecordTreeColumn above.
const columnItems: PropSchema[] = [
  { name: 'key',     kind: 'static-config', type: 'string',  required: true,  description: 'Field in the node' },
  { name: 'label',   kind: 'static-config', type: 'string',  required: false, description: 'Heading — the key if left empty' },
  { name: 'numeric', kind: 'static-config', type: 'boolean', required: false, description: 'Right-align and format as a number' },
];

const schema: PropSchema[] = [
  { name: 'title',        kind: 'static-config', type: 'string',   required: false, description: 'Heading above the tree' },
  { name: 'nodes',        kind: 'dynamic-data',  type: 'array',    required: true,  description: 'Flat rows — each needs an id and a parent field' },
  { name: 'parentKey',    kind: 'static-config', type: 'string',   required: false, description: "Field holding the parent's id (default 'parent_id')" },
  { name: 'labelKey',     kind: 'static-config', type: 'string',   required: false, description: "Field shown as the node's label (default 'name')" },
  { name: 'columns',      kind: 'static-config', type: 'array',    required: false, description: 'Extra columns beside the label, in display order', items: columnItems },
  { name: 'newLabel',     kind: 'static-config', type: 'string',   required: false, description: 'Label on the add-at-root control' },
  { name: 'emptyMessage', kind: 'static-config', type: 'string',   required: false, description: 'Shown when there are no nodes' },
  { name: 'onAddRoot',    kind: 'callback',      type: 'function', required: false, description: 'Add at the root — emits (null)' },
  { name: 'onAddChild',   kind: 'callback',      type: 'function', required: false, description: 'Add beneath a node — emits (record)' },
  { name: 'onModify',     kind: 'callback',      type: 'function', required: false, description: 'Modify a node — emits (record)' },
  { name: 'onMove',       kind: 'callback',      type: 'function', required: false, description: 'Re-parent a node — emits (record)' },
  { name: 'onDelete',     kind: 'callback',      type: 'function', required: false, description: 'Delete a node — emits (record)' },
  { name: 'onSelect',     kind: 'callback',      type: 'function', required: false, description: 'Selection changed — emits (record)' },
];

export const RecordTree = Object.assign(RecordTreeComponent, { css, schema });
