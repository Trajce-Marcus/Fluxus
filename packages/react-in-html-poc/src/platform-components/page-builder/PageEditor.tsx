import { useState, useEffect, useRef } from 'react';
import { SESSION_COMPONENTS } from './sessionComponents';
import { loadPageLayout } from './persistence';
import type { Panel } from './layout-editor/types';
import {
  selectComponent,
  selectSlot,
  assignComponent,
  unassignSlot,
  toggleCol1,
  setMode,
  addPageComponent,
  removePageComponent,
  usePageEditorStore,
  type SlotAssignment,
  type PageComponentEntry,
} from './pageEditorStore';
import { LayoutEditor, css as layoutEditorCss } from './layout-editor/LayoutEditor';

// ── Slot extraction ──────────────────────────────────────────────────────────

function collectLeafPanels(panel: Panel): Panel[] {
  if (panel.children.length === 0) return [panel];
  return panel.children.flatMap(collectLeafPanels);
}

// ── Column 1: Components ─────────────────────────────────────────────────────

interface Col1Props {
  pageComponents: PageComponentEntry[];
  selectedComponentName: string | null;
  pagePath: string;
}

function ComponentsColumn({ pageComponents, selectedComponentName, pagePath }: Col1Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const available = SESSION_COMPONENTS.filter(
    (s) => !pageComponents.some((p) => p.name === s.name)
  );

  useEffect(() => {
    if (!pickerOpen) return;
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  return (
    <div className="pe-col pe-col-components">
      <div className="pe-col-header">
        <span>Components</span>
        <div className="pe-add-wrap" ref={pickerRef}>
          <button
            className="pe-add-btn"
            title="Add component to page"
            onClick={() => setPickerOpen((v) => !v)}
            disabled={available.length === 0}
          >
            +
          </button>
          {pickerOpen && available.length > 0 && (
            <ul className="pe-picker">
              {available.map(({ name, version }) => (
                <li
                  key={name}
                  className="pe-picker-item"
                  onMouseDown={() => {
                    addPageComponent(pagePath, { name, version });
                    setPickerOpen(false);
                  }}
                >
                  <span className="pe-comp-name">{name}</span>
                  <span className="pe-comp-version">v{version}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {pageComponents.length === 0 ? (
        <p className="pe-empty">No components added yet. Click + to add.</p>
      ) : (
        <ul className="pe-comp-list">
          {pageComponents.map(({ name, version }) => (
            <li
              key={name}
              className={`pe-comp-item${selectedComponentName === name ? ' selected' : ''}`}
              onClick={() => selectComponent(pagePath, selectedComponentName === name ? null : name)}
            >
              <span className="pe-comp-name">{name}</span>
              <span className="pe-comp-version">v{version}</span>
              <button
                className="pe-comp-remove"
                title="Remove from page"
                onClick={(e) => { e.stopPropagation(); removePageComponent(pagePath, name); }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Column 2: Slots ──────────────────────────────────────────────────────────

interface Col2Props {
  slots: Panel[];
  selectedSlotId: string | null;
  selectedComponentName: string | null;
  assignments: Record<string, SlotAssignment | null>;
  pagePath: string;
}

function SlotsColumn({ slots, selectedSlotId, selectedComponentName, assignments, pagePath }: Col2Props) {
  return (
    <div className="pe-col pe-col-slots">
      <div className="pe-col-header">
        <span>Slots</span>
        <button className="pe-edit-layout-btn" onClick={() => setMode(pagePath, 'layout')}>Edit Layout</button>
      </div>
      {slots.length === 0 ? (
        <p className="pe-empty">No layout defined. Open the layout editor to create panels.</p>
      ) : (
        <ul className="pe-slot-list">
          {slots.map((slot) => {
            const assignment = assignments[slot.id] ?? null;
            const label = slot.name || slot.id;
            return (
              <li
                key={slot.id}
                className={`pe-slot-item${selectedSlotId === slot.id ? ' selected' : ''}`}
                onClick={() => selectSlot(pagePath, selectedSlotId === slot.id ? null : slot.id)}
              >
                <div className="pe-slot-info">
                  <span className="pe-slot-name">{label}</span>
                  {assignment ? (
                    <span className="pe-slot-assigned">{assignment.componentName}</span>
                  ) : (
                    <span className="pe-slot-empty">Empty</span>
                  )}
                </div>
                <div className="pe-slot-actions">
                  {selectedComponentName && (
                    <button
                      className="pe-assign-btn"
                      onClick={(e) => { e.stopPropagation(); assignComponent(pagePath, slot.id, selectedComponentName); }}
                    >
                      Assign
                    </button>
                  )}
                  {assignment && (
                    <button
                      className="pe-unassign-btn"
                      title="Remove component"
                      onClick={(e) => { e.stopPropagation(); unassignSlot(pagePath, slot.id); }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Column 3: Config ─────────────────────────────────────────────────────────

interface Col3Props {
  selectedComponentName: string | null;
  selectedSlotId: string | null;
  assignments: Record<string, SlotAssignment | null>;
}

function ConfigColumn({ selectedComponentName, selectedSlotId, assignments }: Col3Props) {
  const slotAssignment = selectedSlotId ? (assignments[selectedSlotId] ?? null) : null;

  if (selectedSlotId && slotAssignment) {
    return (
      <div className="pe-col pe-col-config">
        <div className="pe-col-header">Configuration</div>
        <div className="pe-config-section">
          <p className="pe-config-label">Slot</p>
          <p className="pe-config-value">{selectedSlotId}</p>
        </div>
        <div className="pe-config-section">
          <p className="pe-config-label">Component</p>
          <p className="pe-config-value">{slotAssignment.componentName}</p>
        </div>
        <div className="pe-config-section">
          <p className="pe-config-label">Props</p>
          <p className="pe-config-hint">Prop configuration coming soon.</p>
        </div>
      </div>
    );
  }

  if (selectedComponentName) {
    return (
      <div className="pe-col pe-col-config">
        <div className="pe-col-header">Component Info</div>
        <div className="pe-config-section">
          <p className="pe-config-label">Name</p>
          <p className="pe-config-value">{selectedComponentName}</p>
        </div>
        <div className="pe-config-section">
          <p className="pe-config-label">Version</p>
          <p className="pe-config-value">1.0.0</p>
        </div>
        <div className="pe-config-section">
          <p className="pe-config-hint">Select a slot and click Assign to place this component.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pe-col pe-col-config">
      <div className="pe-col-header">Configuration</div>
      <p className="pe-empty">Select a component or a slot to see details.</p>
    </div>
  );
}

// ── Column 4: Preview ────────────────────────────────────────────────────────

function PreviewColumn() {
  return (
    <div className="pe-col pe-col-preview">
      <div className="pe-col-header">Preview</div>
      <div className="pe-preview-placeholder">
        <p className="pe-empty">Page preview coming soon.</p>
      </div>
    </div>
  );
}

// ── PageEditor root ──────────────────────────────────────────────────────────

interface Props {
  pagePath: string;
}

function PageEditorComponent({ pagePath }: Props) {
  const store = usePageEditorStore(pagePath);
  const [state, setState] = useState(() => ({ ...store.get() }));

  useEffect(() => {
    setState({ ...store.get() });
    return store.subscribe((s) => setState({ ...s }));
  }, [store]);

  const layout = loadPageLayout(pagePath);
  const slots = layout ? collectLeafPanels(layout.root) : [];

  const { mode, pageComponents, selectedComponentName, selectedSlotId, col1Collapsed, assignments } = state;

  if (mode === 'layout') {
    return (
      <div className="pe-editor">
        <div className="pe-toolbar">
          <button className="pe-back-btn" onClick={() => setMode(pagePath, 'builder')}>← Builder</button>
          <span className="pe-toolbar-title">Layout Editor</span>
        </div>
        <LayoutEditor pagePath={pagePath} />
      </div>
    );
  }

  return (
    <div className="pe-editor">
      <div className="pe-toolbar">
        <button
          className={`pe-toggle-col1${col1Collapsed ? ' collapsed' : ''}`}
          title={col1Collapsed ? 'Show components' : 'Hide components'}
          onClick={() => toggleCol1(pagePath)}
        >
          {col1Collapsed ? '›' : '‹'}
        </button>
        <span className="pe-toolbar-title">Page Builder</span>
      </div>
      <div className="pe-columns">
        {!col1Collapsed && (
          <ComponentsColumn
            pageComponents={pageComponents}
            selectedComponentName={selectedComponentName}
            pagePath={pagePath}
          />
        )}
        <SlotsColumn
          slots={slots}
          selectedSlotId={selectedSlotId}
          selectedComponentName={selectedComponentName}
          assignments={assignments}
          pagePath={pagePath}
        />
        <ConfigColumn
          selectedComponentName={selectedComponentName}
          selectedSlotId={selectedSlotId}
          assignments={assignments}
        />
        <PreviewColumn />
      </div>
    </div>
  );
}

export const css = `
  ${layoutEditorCss}

  .pe-editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--color-bg);
  }

  .pe-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    height: 32px;
    flex-shrink: 0;
    background: var(--color-sidebar);
    border-bottom: 1px solid var(--color-border);
  }

  .pe-toolbar-title {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
  }

  .pe-toggle-col1 {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0 4px;
    line-height: 1;
  }
  .pe-toggle-col1:hover { color: var(--color-text); }

  .pe-back-btn {
    background: none;
    border: none;
    color: var(--color-accent);
    cursor: pointer;
    font-size: 0.8rem;
    padding: 0 4px;
  }
  .pe-back-btn:hover { opacity: 0.8; }

  .pe-columns {
    flex: 1;
    display: flex;
    flex-direction: row;
    overflow: hidden;
  }

  .pe-col {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid var(--color-border);
  }
  .pe-col:last-child { border-right: none; }

  .pe-col-components { width: 180px; flex-shrink: 0; }
  .pe-col-slots      { width: 220px; flex-shrink: 0; }
  .pe-col-config     { width: 220px; flex-shrink: 0; }
  .pe-col-preview    { flex: 1; }

  .pe-col-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
    padding: 6px 10px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-border);
  }
  .pe-edit-layout-btn {
    font-size: 0.68rem;
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    padding: 2px 6px;
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    color: var(--color-text-muted);
    cursor: pointer;
  }
  .pe-edit-layout-btn:hover {
    color: var(--color-text);
    border-color: var(--color-text-muted);
  }

  .pe-empty {
    margin: 12px 10px;
    font-size: 0.775rem;
    color: var(--color-text-muted);
    font-style: italic;
  }

  /* Components column */
  .pe-add-wrap {
    position: relative;
  }
  .pe-add-btn {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
  }
  .pe-add-btn:hover:not(:disabled) { color: var(--color-text); border-color: var(--color-text-muted); }
  .pe-add-btn:disabled { opacity: 0.3; cursor: default; }
  .pe-picker {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 160px;
    background: var(--color-sidebar);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    list-style: none;
    margin: 0;
    padding: 4px 0;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  .pe-picker-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 10px;
    cursor: pointer;
    gap: 8px;
  }
  .pe-picker-item:hover { background: rgba(255,255,255,0.07); }
  .pe-comp-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    overflow-y: auto;
    flex: 1;
  }
  .pe-comp-item {
    display: flex;
    align-items: center;
    padding: 5px 10px;
    cursor: pointer;
    border-left: 2px solid transparent;
    gap: 6px;
  }
  .pe-comp-item:hover { background: rgba(255,255,255,0.05); }
  .pe-comp-item.selected {
    background: rgba(0,120,212,0.12);
    border-left-color: var(--color-accent);
  }
  .pe-comp-name {
    font-size: 0.825rem;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .pe-comp-version {
    font-size: 0.7rem;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }
  .pe-comp-remove {
    background: none;
    border: none;
    color: transparent;
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0 2px;
    flex-shrink: 0;
  }
  .pe-comp-item:hover .pe-comp-remove { color: var(--color-text-muted); }
  .pe-comp-remove:hover { color: #f48771 !important; }

  /* Slots column */
  .pe-slot-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    overflow-y: auto;
    flex: 1;
  }
  .pe-slot-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    cursor: pointer;
    border-left: 2px solid transparent;
    gap: 6px;
  }
  .pe-slot-item:hover { background: rgba(255,255,255,0.05); }
  .pe-slot-item.selected {
    background: rgba(0,120,212,0.12);
    border-left-color: var(--color-accent);
  }
  .pe-slot-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .pe-slot-name {
    font-size: 0.825rem;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pe-slot-assigned {
    font-size: 0.72rem;
    color: var(--color-accent);
  }
  .pe-slot-empty {
    font-size: 0.72rem;
    color: var(--color-text-muted);
    font-style: italic;
  }
  .pe-slot-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .pe-assign-btn {
    font-size: 0.7rem;
    padding: 2px 6px;
    background: var(--color-accent);
    color: #fff;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    white-space: nowrap;
  }
  .pe-assign-btn:hover { opacity: 0.85; }
  .pe-unassign-btn {
    font-size: 0.7rem;
    padding: 2px 5px;
    background: none;
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    cursor: pointer;
  }
  .pe-unassign-btn:hover { color: #f48771; border-color: #f48771; }

  /* Config column */
  .pe-config-section {
    padding: 8px 10px 0;
  }
  .pe-config-label {
    margin: 0 0 2px;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
  }
  .pe-config-value {
    margin: 0;
    font-size: 0.825rem;
    color: var(--color-text);
  }
  .pe-config-hint {
    margin: 4px 0 0;
    font-size: 0.775rem;
    color: var(--color-text-muted);
    font-style: italic;
  }

  /* Preview column */
  .pe-preview-placeholder {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
`;

export const PageEditor = PageEditorComponent;
