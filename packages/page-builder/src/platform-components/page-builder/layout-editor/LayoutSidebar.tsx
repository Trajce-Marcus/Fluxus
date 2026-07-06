import { useState, useRef, useEffect } from 'react';
import type { Panel, BorderSide, LayoutDefinition } from './types';
import { findPanel, findParent, findSibling } from './store';
import type { createLayoutActions } from './store';

type Actions = ReturnType<typeof createLayoutActions>;

// ── Color palette ─────────────────────────────────────────────────────────────

const PALETTE = [
  '#ffffff', '#d4d4d4', '#a3a3a3', '#737373', '#404040', '#0a0a0a',
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
];

function ColorPicker({
  value,
  onChange,
  allowClear = false,
  disabled = false,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  allowClear?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  function toggle() {
    if (disabled) return;
    if (!open) {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen((v) => !v);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!triggerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        className={`le-color-trigger${!value ? ' le-color-trigger--empty' : ''}`}
        style={value ? { background: value } : undefined}
        onClick={toggle}
        disabled={disabled}
        title={value ?? 'None'}
      />
      {open && (
        <div
          className="le-color-popup"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 1000 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {allowClear && (
            <button
              className={`le-swatch le-swatch--clear${!value ? ' le-swatch--active' : ''}`}
              onClick={() => { onChange(undefined); setOpen(false); }}
              title="None"
            >✕</button>
          )}
          {PALETTE.map((c) => (
            <button
              key={c}
              className={`le-swatch${value === c ? ' le-swatch--active' : ''}`}
              style={{ background: c }}
              onClick={() => { onChange(c); setOpen(false); }}
              title={c}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ── Splitter helpers ──────────────────────────────────────────────────────────

function getSplitterOptions(
  panel: Panel,
  parent: Panel | null,
): ('top' | 'bottom' | 'left' | 'right')[] {
  if (!parent || panel.size.type !== 'fixed' || parent.children.length <= 1) return [];
  const idx = parent.children.findIndex((c) => c.id === panel.id);
  if (parent.direction === 'vertical') {
    const opts: ('top' | 'bottom')[] = [];
    if (idx > 0) opts.push('top');
    if (idx < parent.children.length - 1) opts.push('bottom');
    return opts;
  } else {
    const opts: ('left' | 'right')[] = [];
    if (idx > 0) opts.push('left');
    if (idx < parent.children.length - 1) opts.push('right');
    return opts;
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="le-prop-row">
      <span className="le-prop-label">{label}</span>
      <div className="le-prop-control">{children}</div>
    </div>
  );
}

function NumInput({
  value,
  onChange,
  placeholder = '—',
  min = 0,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  min?: number;
}) {
  return (
    <input
      className="le-input le-input-num"
      type="number"
      min={min}
      step={1}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '' ? undefined : Math.max(min, parseInt(v, 10)));
      }}
    />
  );
}

function BorderSideRow({
  label,
  side,
  onChange,
}: {
  label: string;
  side: BorderSide | undefined;
  onChange: (s: BorderSide) => void;
}) {
  const current = side ?? { style: 'none' as const, width: 1, color: '#414141' };
  const inactive = current.style === 'none';
  return (
    <div className="le-border-side-row">
      <span className="le-border-side-label">{label}</span>
      <select
        className="le-select le-border-style"
        value={current.style}
        onChange={(e) => onChange({ ...current, style: e.target.value as BorderSide['style'] })}
      >
        <option value="none">none</option>
        <option value="solid">solid</option>
        <option value="dashed">dashed</option>
        <option value="dotted">dotted</option>
      </select>
      <input
        className="le-input le-input-num le-border-width"
        type="number"
        min={0}
        step={1}
        value={current.width}
        disabled={inactive}
        onChange={(e) => onChange({ ...current, width: parseInt(e.target.value, 10) || 0 })}
      />
      <ColorPicker
        value={current.color}
        onChange={(c) => onChange({ ...current, color: c ?? current.color })}
        disabled={inactive}
      />
    </div>
  );
}

// ── Main sidebar ──────────────────────────────────────────────────────────────

interface Props {
  layout: LayoutDefinition;
  selectedPanelId: string;
  canUndo: boolean;
  canRedo: boolean;
  actions: Actions;
}

export function LayoutSidebar({ layout, selectedPanelId, canUndo, canRedo, actions }: Props) {
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [resetPending, setResetPending] = useState(false);
  const [clearPending, setClearPending] = useState(false);

  const selected = findPanel(layout.root, selectedPanelId);
  const parent = findParent(layout.root, selectedPanelId);
  const isRoot = parent === null;
  const isLeaf = selected?.children.length === 0;

  if (!selected) return <div className="le-sidebar" />;

  const siblingIdx = parent ? parent.children.findIndex((c) => c.id === selected.id) : -1;
  const hasPrev = siblingIdx > 0;
  const hasNext = parent !== null && siblingIdx < parent.children.length - 1;

  const splitterOptions = getSplitterOptions(selected, parent);
  const isFixed = selected.size.type === 'fixed';

  function updatePanel(changes: Partial<Omit<Panel, 'id' | 'children'>>) {
    actions.updatePanel(selected!.id, changes);
  }

  function updateBorder(side: 'top' | 'right' | 'bottom' | 'left', value: BorderSide) {
    updatePanel({ border: { ...selected!.border, [side]: value } });
  }

  function handleImport() {
    try {
      const parsed = JSON.parse(importText) as LayoutDefinition;
      if (!parsed?.root?.id) throw new Error('Invalid layout: missing root.id');
      actions.importLayout(parsed);
      setShowImport(false);
      setImportText('');
      setImportError('');
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }

  function handleReset() {
    if (!resetPending) { setResetPending(true); return; }
    actions.reset();
    setResetPending(false);
  }

  function handleClear() {
    if (!clearPending) { setClearPending(true); return; }
    actions.clearPanel();
    setClearPending(false);
  }

  return (
    <div className="le-sidebar">

      {/* ── Actions ── */}
      <div className="le-section">
        <div className="le-section-title">Actions</div>

        <button className="le-action-btn" onClick={() => actions.addPanel()}>
          + Add Panel
        </button>
        <button className="le-action-btn" disabled={isRoot} onClick={() => actions.deletePanel()}>
          ✕ Delete Panel
        </button>
        <div className="le-action-row">
          <button
            className={`le-action-btn${resetPending ? ' le-action-btn--danger' : ''}`}
            onClick={handleReset}
            onBlur={() => setResetPending(false)}
          >
            {resetPending ? 'Confirm?' : '↺ Reset'}
          </button>
          <button
            className={`le-action-btn${clearPending ? ' le-action-btn--danger' : ''}`}
            disabled={isLeaf}
            onClick={handleClear}
            onBlur={() => setClearPending(false)}
          >
            {clearPending ? 'Confirm?' : '✕ Clear'}
          </button>
        </div>
        <div className="le-action-row">
          <button className="le-action-btn" disabled={!canUndo} onClick={() => actions.undo()}>⎌ Undo</button>
          <button className="le-action-btn" disabled={!canRedo} onClick={() => actions.redo()}>⎌ Redo</button>
        </div>
        <button className="le-action-btn" onClick={() => { setShowImport((v) => !v); setImportError(''); }}>
          ↑ Import Layout
        </button>

        {/* Navigate */}
        <div className="le-nav-wrap">
          <span className="le-nav-label">Navigate</span>
          <div className="le-nav-pad">
            <div className="le-nav-col">
              <button className="le-nav-btn" disabled={!hasPrev} title="Prev sibling (←)" onClick={() => actions.navigate('left')}>←</button>
            </div>
            <div className="le-nav-mid">
              <button className="le-nav-btn" disabled={isRoot} title="Parent (↑)" onClick={() => actions.navigate('up')}>↑</button>
              <button className="le-nav-btn" disabled={isLeaf} title="First child (↓)" onClick={() => actions.navigate('down')}>↓</button>
            </div>
            <div className="le-nav-col">
              <button className="le-nav-btn" disabled={!hasNext} title="Next sibling (→)" onClick={() => actions.navigate('right')}>→</button>
            </div>
          </div>
        </div>

        {showImport && (
          <div className="le-import-area">
            <textarea
              className="le-import-textarea"
              placeholder="Paste LayoutDefinition JSON…"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            {importError && <div className="le-import-error">{importError}</div>}
            <div className="le-import-actions">
              <button className="le-action-btn le-action-btn--primary" onClick={handleImport}>Apply</button>
              <button className="le-action-btn" onClick={() => { setShowImport(false); setImportError(''); setImportText(''); }}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Properties ── */}
      <div className="le-section">
        <div className="le-section-title">Properties{isRoot ? ' — Root' : ''}</div>

        {/* Name */}
        <PropRow label="Name">
          <input
            className="le-input le-input-name"
            type="text"
            placeholder={isRoot ? 'Root' : 'Panel name…'}
            value={selected.name ?? ''}
            onChange={(e) => updatePanel({ name: e.target.value || undefined })}
          />
        </PropRow>

        {/* Direction */}
        <PropRow label="Direction">
          <div className="le-dir-toggle">
            <button
              className={`le-dir-btn${selected.direction === 'vertical' ? ' le-dir-btn--active' : ''}`}
              onClick={() => updatePanel({ direction: 'vertical' })}
            >Vertical</button>
            <button
              className={`le-dir-btn${selected.direction === 'horizontal' ? ' le-dir-btn--active' : ''}`}
              onClick={() => updatePanel({ direction: 'horizontal' })}
            >Horizontal</button>
          </div>
        </PropRow>

        {/* Size — hidden for root */}
        {!isRoot && (
          <div className="le-prop-group">
            <div className="le-prop-group-label">Size</div>
            <div className="le-size-row">
              <label className="le-radio-label">
                <input
                  type="radio"
                  name={`size-${selected.id}`}
                  checked={selected.size.type === 'flex'}
                  onChange={() => updatePanel({ size: { type: 'flex', value: selected.size.value || 1 } })}
                />
                Flex
              </label>
              <input
                className="le-input le-input-num"
                type="number"
                min={0}
                step={1}
                disabled={selected.size.type !== 'flex'}
                value={selected.size.type === 'flex' ? selected.size.value : ''}
                onChange={(e) => updatePanel({ size: { type: 'flex', value: parseFloat(e.target.value) || 1 } })}
              />
            </div>
            <div className="le-size-row">
              <label className="le-radio-label">
                <input
                  type="radio"
                  name={`size-${selected.id}`}
                  checked={selected.size.type === 'fixed'}
                  onChange={() => updatePanel({ size: { type: 'fixed', value: selected.size.value || 50 } })}
                />
                Fixed
              </label>
              <input
                className="le-input le-input-num"
                type="number"
                min={0}
                step={1}
                disabled={selected.size.type !== 'fixed'}
                value={selected.size.type === 'fixed' ? selected.size.value : ''}
                onChange={(e) => updatePanel({ size: { type: 'fixed', value: parseInt(e.target.value, 10) || 0 } })}
              />
              <span className="le-unit">px</span>
            </div>
          </div>
        )}

        {/* Min / Max */}
        <div className="le-minmax-row">
          <span className="le-prop-label">Min</span>
          <NumInput value={selected.minSize} onChange={(v) => updatePanel({ minSize: v })} />
          <span className="le-unit">px</span>
          <span className="le-prop-label le-prop-label--gap">Max</span>
          <NumInput value={selected.maxSize} onChange={(v) => updatePanel({ maxSize: v })} />
          <span className="le-unit">px</span>
        </div>

        {/* Gap */}
        <PropRow label="Gap">
          <NumInput value={selected.gap} onChange={(v) => updatePanel({ gap: v })} />
          <span className="le-unit">px</span>
        </PropRow>

        {/* Padding */}
        <div className="le-prop-group">
          <div className="le-prop-group-label">Padding (px)</div>
          <div className="le-padding-grid">
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <div key={side} className="le-padding-cell">
                <span className="le-padding-side-label">{side[0].toUpperCase()}</span>
                <NumInput
                  value={selected.padding?.[side]}
                  onChange={(v) =>
                    updatePanel({ padding: { top: 0, right: 0, bottom: 0, left: 0, ...selected.padding, [side]: v ?? 0 } })
                  }
                />
              </div>
            ))}
          </div>
        </div>

        {/* Background */}
        <PropRow label="Background">
          <ColorPicker value={selected.background} onChange={(c) => updatePanel({ background: c })} allowClear />
        </PropRow>

        {/* Border */}
        <div className="le-prop-group">
          <div className="le-prop-group-label">Border</div>
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <BorderSideRow
              key={side}
              label={side[0].toUpperCase() + side.slice(1)}
              side={selected.border?.[side]}
              onChange={(v) => updateBorder(side, v)}
            />
          ))}
        </div>

        {/* Border Radius */}
        <PropRow label="Radius">
          <NumInput value={selected.borderRadius} onChange={(v) => updatePanel({ borderRadius: v })} />
          <span className="le-unit">px</span>
        </PropRow>

        {/* Splitter */}
        <div className="le-prop-group">
          <div className="le-prop-group-label">Splitter</div>
          {splitterOptions.length === 0 ? (
            <div className="le-splitter-none">
              {isRoot ? 'Not available on root' : !isFixed ? 'Requires fixed size' : 'No adjacent sibling'}
            </div>
          ) : (
            <div className="le-splitter-options">
              {splitterOptions.map((pos) => (
                <label key={pos} className="le-radio-label">
                  <input
                    type="radio"
                    name={`splitter-${selected.id}`}
                    checked={selected.splitter === pos}
                    onChange={() => updatePanel({ splitter: selected.splitter === pos ? undefined : pos })}
                  />
                  {pos[0].toUpperCase() + pos.slice(1)}
                </label>
              ))}
              {selected.splitter && (
                <button className="le-clear-btn" onClick={() => updatePanel({ splitter: undefined })}>Clear</button>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export const css = `
  .le-sidebar {
    width: 220px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    border-right: 1px solid var(--color-border);
    background: var(--color-sidebar);
  }
  .le-section {
    padding: 10px 12px;
    border-bottom: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .le-section-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
    margin-bottom: 6px;
    font-weight: 600;
  }
  .le-action-btn {
    background: none;
    border: 1px solid var(--color-border);
    color: var(--color-text);
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 3px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    transition: background 0.1s;
  }
  .le-action-btn:hover:not(:disabled) { background: rgba(255,255,255,0.06); }
  .le-action-btn:disabled { opacity: 0.35; cursor: default; }
  .le-action-btn--danger { border-color: #c75450; color: #f48771; }
  .le-action-btn--primary { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }
  .le-action-btn--primary:hover:not(:disabled) { background: #006cbf; }
  .le-action-row { display: flex; gap: 4px; }
  .le-action-row .le-action-btn { flex: 1; }

  .le-nav-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 0 0;
  }
  .le-nav-label {
    font-size: 10px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }
  .le-nav-pad { display: flex; gap: 2px; align-items: center; }
  .le-nav-col { display: flex; align-items: center; justify-content: center; }
  .le-nav-mid { display: flex; flex-direction: column; gap: 2px; }
  .le-nav-btn {
    width: 28px;
    height: 24px;
    background: none;
    border: 1px solid var(--color-border);
    color: var(--color-text);
    border-radius: 3px;
    cursor: pointer;
    font-size: 13px;
    font-family: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background 0.1s;
  }
  .le-nav-btn:hover:not(:disabled) { background: rgba(255,255,255,0.06); }
  .le-nav-btn:disabled { opacity: 0.35; cursor: default; }

  .le-import-area { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
  .le-import-textarea {
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    font-size: 11px;
    font-family: monospace;
    padding: 6px;
    border-radius: 3px;
    resize: vertical;
    min-height: 80px;
  }
  .le-import-error { font-size: 11px; color: #f48771; }
  .le-import-actions { display: flex; gap: 4px; }

  .le-prop-row { display: flex; align-items: center; gap: 6px; min-height: 22px; }
  .le-prop-label { font-size: 11px; color: var(--color-text-muted); width: 56px; flex-shrink: 0; }
  .le-prop-label--gap { margin-left: 4px; }
  .le-prop-control { display: flex; align-items: center; gap: 4px; flex: 1; }
  .le-prop-group { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
  .le-prop-group-label {
    font-size: 10px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 2px;
  }

  .le-input {
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 3px;
    min-width: 0;
    font-family: inherit;
  }
  .le-input:focus { outline: none; border-color: var(--color-accent); }
  .le-input:disabled { opacity: 0.35; }
  .le-input-num {
    width: 48px;
    text-align: right;
    -moz-appearance: textfield;
  }
  .le-input-num::-webkit-inner-spin-button,
  .le-input-num::-webkit-outer-spin-button { display: none; }
  .le-input-name { flex: 1; min-width: 0; }

  .le-select {
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 3px;
    flex: 1;
    font-family: inherit;
  }
  .le-select:focus { outline: none; border-color: var(--color-accent); }

  .le-dir-toggle { display: flex; gap: 4px; }
  .le-dir-btn {
    background: none;
    border: 1px solid var(--color-border);
    color: var(--color-text);
    font-size: 12px;
    font-family: inherit;
    padding: 4px 8px;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .le-dir-btn:hover, .le-dir-btn--active { background: rgba(255,255,255,0.06); }

  .le-unit { font-size: 10px; color: var(--color-text-muted); }
  .le-size-row { display: flex; align-items: center; gap: 6px; }
  .le-radio-label { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--color-text); cursor: pointer; }
  .le-minmax-row { display: flex; align-items: center; gap: 4px; margin-top: 2px; }

  .le-padding-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  .le-padding-cell { display: flex; align-items: center; gap: 4px; }
  .le-padding-side-label { font-size: 10px; color: var(--color-text-muted); width: 14px; flex-shrink: 0; }

  .le-color-trigger {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    border: 1px solid rgba(255,255,255,0.2);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    margin-left: 6px;
    transition: border-color 0.1s;
  }
  .le-color-trigger:hover:not(:disabled) { border-color: rgba(255,255,255,0.5); }
  .le-color-trigger:disabled { opacity: 0.35; cursor: default; }
  .le-color-trigger--empty {
    background: repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 0 0 / 6px 6px;
  }
  .le-color-popup {
    background: var(--color-sidebar);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 6px;
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    width: 122px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  }
  .le-swatch {
    width: 14px;
    height: 14px;
    border-radius: 2px;
    border: 1px solid rgba(255,255,255,0.2);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }
  .le-swatch:hover { border-color: rgba(255,255,255,0.6); }
  .le-swatch--active {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }
  .le-swatch--clear {
    background: repeating-conic-gradient(#555 0% 25%, #333 0% 50%) 0 0 / 6px 6px;
    color: var(--color-text-muted);
    font-size: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .le-clear-btn {
    background: none;
    border: none;
    color: var(--color-text-muted);
    font-size: 10px;
    cursor: pointer;
    padding: 0 2px;
    line-height: 1;
    font-family: inherit;
  }
  .le-clear-btn:hover { color: var(--color-text); }

  .le-border-side-row { display: flex; align-items: center; gap: 4px; }
  .le-border-side-label { font-size: 10px; color: var(--color-text-muted); width: 36px; flex-shrink: 0; }
  .le-border-style { flex: 1; min-width: 0; }
  .le-border-width { width: 36px; }

  .le-splitter-none { font-size: 11px; color: var(--color-text-muted); font-style: italic; }
  .le-splitter-options { display: flex; flex-direction: column; gap: 4px; }
`;
