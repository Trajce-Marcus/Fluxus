// Edits a static-config property whose value is a list — one row per item, one
// input per declared field. It knows nothing about columns, or about any other
// component: the fields come from the property's own `items` declaration in the
// component manifest, so a component that declares a list of anything gets this
// editor without a line of code here.
//
// A modal, like the expression dialog next door, for the same reason: the
// properties panel is one narrow column, and a list of three-field rows does not
// belong in it. The panel shows a one-line summary and this opens over the top.
// Edits are held here until Save, so reordering or deleting a row and then
// changing your mind costs nothing.
//
// Order in the array is order on screen, which is what every list property has
// meant so far (RecordList draws its columns in array order), so the up/down
// controls are the whole of the reordering story. Arrows rather than dragging —
// dragging would cost a dependency for a list that is rarely longer than six.
//
// A property with no `items` never reaches this component: the panel leaves it
// read-only rather than guess what one item holds.

import { useState } from 'react';
import type { PropSchema } from '@fluxus/page-runtime';

export interface ArrayPropertyEditorProps {
  /** e.g. "RecordList.columns" — the panel's own title convention. */
  title: string;
  /** The array property being edited — its `items` describe one row. */
  prop: PropSchema;
  /** Value as stored. Anything that isn't a list of objects is treated as empty. */
  value: unknown;
  onSave: (next: Record<string, unknown>[]) => void;
  onClose: () => void;
}

type Item = Record<string, unknown>;

/** Only a list of plain objects can be edited row by row; anything else is not ours. */
export const asItems = (value: unknown): Item[] =>
  Array.isArray(value)
    ? value.filter((v): v is Item => typeof v === 'object' && v !== null && !Array.isArray(v))
    : [];

/** A blank row carries every declared field, so the inputs are controlled from the first keystroke. */
const blankItem = (fields: PropSchema[]): Item =>
  Object.fromEntries(fields.map((f) => [f.name, f.type === 'boolean' ? false : '']));

/** Singular of the property name, for the buttons: "columns" → "column". */
const itemLabel = (propName: string) => (propName.endsWith('s') ? propName.slice(0, -1) : 'item');

/** What the properties panel shows in place of the list: the first field of each item. */
export function summariseItems(prop: PropSchema, value: unknown): string {
  const items = asItems(value);
  if (items.length === 0) return '';
  const first = prop.items?.[0]?.name;
  return items
    .map((item, i) => {
      const label = first === undefined ? '' : String(item[first] ?? '');
      return label === '' ? `(${itemLabel(prop.name)} ${i + 1})` : label;
    })
    .join(', ');
}

export function ArrayPropertyEditor({ title, prop, value, onSave, onClose }: ArrayPropertyEditorProps) {
  const fields = prop.items ?? [];
  const [items, setItems] = useState<Item[]>(() => asItems(value).map((item) => ({ ...item })));

  const label = itemLabel(prop.name);

  const setField = (index: number, field: string, fieldValue: unknown) =>
    setItems(items.map((item, i) => (i === index ? { ...item, [field]: fieldValue } : item)));

  const move = (index: number, by: number) => {
    const to = index + by;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    [next[index], next[to]] = [next[to], next[index]];
    setItems(next);
  };

  const remove = (index: number) => setItems(items.filter((_, i) => i !== index));
  const add = () => setItems([...items, blankItem(fields)]);

  // A required field left empty is the one mistake worth blocking: a column
  // with no key names nothing in the row and would draw a dash for ever.
  const incomplete = items.some((item) =>
    fields.some((f) => f.required && (item[f.name] === undefined || item[f.name] === '')),
  );

  return (
    <div className="ape-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ape-dialog">
        <div className="ape-header">
          <span className="ape-title">{title}</span>
          <button className="ape-close" onClick={onClose}>✕</button>
        </div>
        {prop.description && <p className="ape-hint">{prop.description}</p>}

        <div className="ape-body">
          {items.length === 0 && <p className="ape-empty">No {prop.name} yet.</p>}

          {items.length > 0 && (
            <div className="ape-head-row">
              <span className="ape-head-order" />
              {fields.map((field) => (
                <span key={field.name} className="ape-head-field" title={field.description}>
                  {field.name}
                  {field.required && <span className="ape-required">*</span>}
                </span>
              ))}
              <span className="ape-head-remove" />
            </div>
          )}

          <ul className="ape-items">
            {items.map((item, index) => (
              <li key={index} className="ape-item">
                <div className="ape-order">
                  <button className="ape-move" title="Move up" disabled={index === 0}
                    onClick={() => move(index, -1)}>⌃</button>
                  <button className="ape-move" title="Move down" disabled={index === items.length - 1}
                    onClick={() => move(index, 1)}>⌄</button>
                </div>

                {fields.map((field) => (
                  <div key={field.name} className="ape-cell">
                    {field.type === 'boolean' ? (
                      <input type="checkbox" checked={item[field.name] === true}
                        onChange={(e) => setField(index, field.name, e.target.checked)} />
                    ) : (
                      <input
                        className="ape-input"
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={item[field.name] === undefined || item[field.name] === null ? '' : String(item[field.name])}
                        title={field.description}
                        placeholder={field.name}
                        onChange={(e) =>
                          setField(index, field.name, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                      />
                    )}
                  </div>
                ))}

                <button className="ape-remove" title={`Remove this ${label}`} onClick={() => remove(index)}>✕</button>
              </li>
            ))}
          </ul>

          <button className="ape-add" onClick={add}>+ Add {label}</button>
        </div>

        <div className="ape-footer">
          {incomplete && <span className="ape-error">Every {label} needs a {fields.find((f) => f.required)?.name}.</span>}
          <button className="ape-btn ape-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="ape-btn" disabled={incomplete} onClick={() => onSave(items)}>Save</button>
        </div>
      </div>
    </div>
  );
}

export const css = `
  .ape-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .ape-dialog { width: 560px; max-width: 92vw; background: var(--color-sidebar, #252526); border: 1px solid var(--color-border, #3c3c3c); border-radius: 6px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); display: flex; flex-direction: column; }
  .ape-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 6px; }
  .ape-title { font-size: 0.85rem; font-weight: 600; color: var(--color-text, #ccc); }
  .ape-close { background: none; border: none; color: var(--color-text-muted, #888); cursor: pointer; font-size: 0.8rem; }
  .ape-close:hover { color: var(--color-text, #ccc); }
  .ape-hint { margin: 0 14px 8px; font-size: 0.72rem; color: var(--color-text-muted, #888); }
  .ape-body { margin: 0 14px; max-height: 52vh; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
  .ape-empty { margin: 0; font-size: 0.75rem; color: var(--color-text-muted, #888); font-style: italic; }
  .ape-head-row, .ape-item { display: flex; align-items: center; gap: 6px; }
  .ape-head-row { font-size: 0.68rem; color: var(--color-text-muted, #888); }
  .ape-head-order { flex: 0 0 16px; }
  .ape-head-field { flex: 1; min-width: 0; }
  .ape-head-remove { flex: 0 0 14px; }
  .ape-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .ape-order { flex: 0 0 16px; display: flex; flex-direction: column; gap: 1px; }
  .ape-move { background: none; border: none; color: var(--color-text-muted, #888); cursor: pointer; font-size: 0.65rem; line-height: 1; padding: 0; }
  .ape-move:hover:not(:disabled) { color: var(--color-text, #ccc); }
  .ape-move:disabled { opacity: 0.25; cursor: default; }
  .ape-cell { flex: 1; min-width: 0; }
  .ape-input { width: 100%; box-sizing: border-box; background: var(--color-bg, #1e1e1e); border: 1px solid var(--color-border, #3c3c3c); border-radius: 3px; color: var(--color-text, #ccc); font-size: 0.75rem; padding: 3px 6px; font-family: inherit; }
  .ape-input:focus { border-color: var(--color-accent, #0e639c); outline: none; }
  .ape-required { color: #f48771; margin-left: 2px; }
  .ape-remove { flex: 0 0 14px; background: none; border: none; color: var(--color-text-muted, #888); cursor: pointer; font-size: 0.7rem; padding: 0; }
  .ape-remove:hover { color: #f48771; }
  .ape-add { align-self: flex-start; margin-top: 2px; background: none; border: 1px solid var(--color-border, #3c3c3c); border-radius: 3px; color: var(--color-text-muted, #aaa); cursor: pointer; font-size: 0.72rem; padding: 2px 8px; }
  .ape-add:hover { border-color: var(--color-accent, #0e639c); color: var(--color-text, #ccc); }
  .ape-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 10px 14px; }
  .ape-error { flex: 1; font-size: 0.7rem; color: #f48771; }
  .ape-btn { background: var(--color-accent, #0e639c); border: none; border-radius: 3px; color: #fff; cursor: pointer; font-size: 0.78rem; padding: 4px 14px; }
  .ape-btn:disabled { opacity: 0.4; cursor: default; }
  .ape-btn--ghost { background: none; border: 1px solid var(--color-border, #3c3c3c); color: var(--color-text-muted, #aaa); }
`;
