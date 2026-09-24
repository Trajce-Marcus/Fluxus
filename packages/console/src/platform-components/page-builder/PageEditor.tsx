import { useState, useEffect, useRef } from 'react';
import { SESSION_COMPONENTS } from './sessionComponents';
import { loadPageLayout, solutionRoles, solutionRecordTypes } from './persistence';
import type { Panel } from './layout-editor/types';
import type { SlotConfig } from './persistence';
import {
  selectComponent,
  selectSlot,
  assignComponent,
  unassignSlot,
  toggleCol1,
  setMode,
  addPageComponent,
  removePageComponent,
  addContextKey,
  removeContextKey,
  togglePageAccess,
  setPageRecord,
  setStaticConfig,
  setDynamicProp,
  setCallback,
  setTabName,
  usePageEditorStore,
  type PageComponentEntry,
  type ContextKeyDef,
  type PageRecordDef,
} from './pageEditorStore';
import { componentManifests, PageRenderer, pageRendererCss, type PropSchema } from '@fluxus/page-runtime';
import { pageRuntime } from '../../sdm-runtime/engine';
import { useShellState } from '../shell/useShellState';
import { LayoutEditor, css as layoutEditorCss } from './layout-editor/LayoutEditor';
import { ExpressionDialog, css as expressionDialogCss } from './ExpressionDialog';
import { ArrayPropertyEditor, summariseItems, css as arrayPropertyEditorCss } from './ArrayPropertyEditor';
import { PublishControl, css as publishControlCss } from './PublishControl';

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
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  return (
    <div className="pe-col pe-col-components">
      <div className="pe-col-header">
        <span>Components</span>
        <div className="pe-add-wrap" ref={pickerRef}>
          <button className="pe-add-btn" title="Add component" onClick={() => setPickerOpen((v) => !v)} disabled={available.length === 0}>+</button>
          {pickerOpen && available.length > 0 && (
            <ul className="pe-picker">
              {available.map(({ name, version }) => (
                <li key={name} className="pe-picker-item" onMouseDown={() => { addPageComponent(pagePath, { name, version }); setPickerOpen(false); }}>
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
            <li key={name} className={`pe-comp-item${selectedComponentName === name ? ' selected' : ''}`} onClick={() => selectComponent(pagePath, selectedComponentName === name ? null : name)}>
              <span className="pe-comp-name">{name}</span>
              <span className="pe-comp-version">v{version}</span>
              <button className="pe-comp-remove" title="Remove" onClick={(e) => { e.stopPropagation(); removePageComponent(pagePath, name); }}>✕</button>
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
  slotConfigs: Record<string, SlotConfig | null>;
  pagePath: string;
}

function SlotsColumn({ slots, selectedSlotId, selectedComponentName, slotConfigs, pagePath }: Col2Props) {
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
            const config = slotConfigs[slot.id] ?? null;
            const label = slot.name || slot.id;
            return (
              <li key={slot.id} className={`pe-slot-item${selectedSlotId === slot.id ? ' selected' : ''}`} onClick={() => selectSlot(pagePath, selectedSlotId === slot.id ? null : slot.id)}>
                <div className="pe-slot-info">
                  <span className="pe-slot-name">{label}</span>
                  {config ? <span className="pe-slot-assigned">{config.componentName}</span> : <span className="pe-slot-empty">Empty</span>}
                </div>
                <div className="pe-slot-actions">
                  {selectedComponentName && (
                    <button className="pe-assign-btn" onClick={(e) => { e.stopPropagation(); assignComponent(pagePath, slot.id, selectedComponentName); }}>Assign</button>
                  )}
                  {config && (
                    <button className="pe-unassign-btn" title="Remove" onClick={(e) => { e.stopPropagation(); unassignSlot(pagePath, slot.id); }}>✕</button>
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

// ── Column 3: Configuration ──────────────────────────────────────────────────

const CONTEXT_KEY_TYPES = ['string', 'number', 'boolean', 'object'] as const;

function PageContextSection({ contextSchema, pagePath }: { contextSchema: ContextKeyDef[]; pagePath: string }) {
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newType, setNewType] = useState<ContextKeyDef['type']>('string');
  const [error, setError] = useState('');

  function submit() {
    const key = newKey.trim();
    if (!key) { setError('Key name required'); return; }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) { setError('Letters, numbers, _ only'); return; }
    addContextKey(pagePath, { key, type: newType });
    setNewKey(''); setNewType('string'); setAdding(false); setError('');
  }

  return (
    <div className="pe-config-section">
      <div className="pe-config-section-header">
        <p className="pe-config-label">Page Context</p>
        <button className="pe-ctx-add-btn" onClick={() => setAdding((v) => !v)}>+</button>
      </div>
      {contextSchema.length === 0 && !adding && <p className="pe-config-hint">No context keys defined.</p>}
      <ul className="pe-ctx-list">
        {contextSchema.map((def) => (
          <li key={def.key} className="pe-ctx-item">
            <span className="pe-ctx-key">{def.key}</span>
            <span className="pe-ctx-type">{def.type}</span>
            <button className="pe-ctx-remove" onClick={() => removeContextKey(pagePath, def.key)}>✕</button>
          </li>
        ))}
      </ul>
      {adding && (
        <div className="pe-ctx-form">
          <input className="pe-ctx-input" placeholder="keyName" value={newKey}
            onChange={(e) => { setNewKey(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setAdding(false); }}
            autoFocus />
          <select className="pe-ctx-select" value={newType} onChange={(e) => setNewType(e.target.value as ContextKeyDef['type'])}>
            {CONTEXT_KEY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="pe-ctx-confirm" onClick={submit}>Add</button>
          {error && <p className="pe-ctx-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

// ── Static config inspector ──────────────────────────────────────────────────

function StaticConfigSection({ slotId, config, pagePath }: { slotId: string; config: SlotConfig; pagePath: string }) {
  // The list editor is a modal, like the expression dialog: one property at a
  // time, opened from its summary row.
  const [editingList, setEditingList] = useState<PropSchema | null>(null);
  const manifest = componentManifests[config.componentName];
  if (!manifest) return null;
  const staticProps = manifest.schema.filter((p) => p.kind === 'static-config');
  if (staticProps.length === 0) return null;

  return (
    <div className="pe-config-section pe-config-divider">
      <p className="pe-config-label">Properties</p>
      <ul className="pe-bindings-list">
        {staticProps.map((prop) => {
          const value = config.staticConfig[prop.name] ?? '';
          return (
            <li key={prop.name} className="pe-binding-row">
              <div className="pe-binding-prop">
                <span className="pe-binding-name">{prop.name}</span>
                <span className={`pe-binding-type pe-binding-type--${prop.type}`}>{prop.type}</span>
                {prop.required && <span className="pe-binding-required">*</span>}
              </div>
              {prop.type === 'boolean' ? (
                <input type="checkbox" checked={!!value}
                  onChange={(e) => setStaticConfig(pagePath, slotId, prop.name, e.target.checked)} />
              ) : prop.type === 'array' ? (
                // A list the component described opens in the list dialog; one
                // it didn't stays read-only, because a text box here would
                // replace the whole list with the browser's rendering of it.
                prop.items ? (
                  <ArrayPropertyButton prop={prop} value={config.staticConfig[prop.name]}
                    onEdit={() => setEditingList(prop)} />
                ) : (
                  <p className="pe-config-hint">
                    {Array.isArray(value) ? `${value.length} item(s)` : 'Empty'} — this property has no editor
                    because {config.componentName} doesn't describe what one item holds.
                  </p>
                )
              ) : prop.choices ? (
                // A fixed set is **chosen**, not typed (2026-09-13): a spelling
                // mistake in a free box fails silently — the component falls
                // back to its default and nothing says why. Buttons up to four,
                // the way a spreadsheet draws its alignment group; a longer set
                // would be a list, and none exists yet.
                <ChoiceGroup
                  choices={prop.choices}
                  value={String(value)}
                  onChange={(next) => setStaticConfig(pagePath, slotId, prop.name, next)} />
              ) : prop.type === 'number' ? (
                <input className="pe-binding-input"
                  type="number"
                  value={String(value)}
                  placeholder={prop.description ?? `Enter ${prop.name}…`}
                  onChange={(e) => setStaticConfig(pagePath, slotId, prop.name, Number(e.target.value))} />
              ) : (
                // A box that grows, for **every** string property (2026-09-13).
                // It was a one-line input, so a newline could not be typed at
                // all and a paragraph was authored through a slot — and nothing
                // in the schema says which strings are paragraphs. A textarea
                // that starts one line high and grows with its content looks
                // the same as an input for a label and works for a page of
                // prose, so the distinction never has to be declared. Nothing
                // here was bound to Enter, so the key is free to insert a line.
                <GrowingInput
                  value={String(value)}
                  placeholder={prop.description ?? `Enter ${prop.name}…`}
                  onChange={(next) => setStaticConfig(pagePath, slotId, prop.name, next)} />
              )}
            </li>
          );
        })}
      </ul>
      {editingList && (
        <ArrayPropertyEditor
          title={`${config.componentName}.${editingList.name}`}
          prop={editingList}
          value={config.staticConfig[editingList.name]}
          onSave={(next) => { setStaticConfig(pagePath, slotId, editingList.name, next); setEditingList(null); }}
          onClose={() => setEditingList(null)}
        />
      )}
    </div>
  );
}

/** The panel's stand-in for a list: what's in it, and a way in. Mirrors the binding preview. */
/**
 * The values a property accepts, as a row of buttons — one pressed. Clicking
 * the pressed one clears the property back to the component's own default,
 * which is the only way to say "I did not choose" once something is chosen.
 */
function ChoiceGroup({ choices, value, onChange }: {
  choices: readonly string[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="pe-choices">
      {choices.map((choice) => (
        <button
          key={choice}
          type="button"
          className={choice === value ? 'pe-choice pe-choice--on' : 'pe-choice'}
          aria-pressed={choice === value}
          onClick={() => onChange(choice === value ? '' : choice)}
        >
          {choice}
        </button>
      ))}
    </div>
  );
}

/**
 * A text box the height of its content. One line until the text needs two, so
 * a label and a paragraph are the same control and neither has to be declared.
 */
function GrowingInput({ value, placeholder, onChange }: {
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
}) {
  // Measured, not counted: wrapping means the number of lines is not the number
  // of newlines. Reset to auto first or the box can only ever grow.
  const size = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  return (
    <textarea
      className="pe-binding-input pe-binding-input--grow"
      rows={1}
      ref={size}
      value={value}
      placeholder={placeholder}
      onChange={(e) => { size(e.currentTarget); onChange(e.target.value); }}
    />
  );
}

function ArrayPropertyButton({ prop, value, onEdit }: { prop: PropSchema; value: unknown; onEdit: () => void }) {
  const summary = summariseItems(prop, value);
  return (
    <button className={`pe-expr${summary ? '' : ' pe-expr--empty'}`} title={summary || 'Empty'} onClick={onEdit}>
      {summary || `— no ${prop.name} —`}
    </button>
  );
}

// ── Page record ──────────────────────────────────────────────────────────────
// What the page is about (DATA_THROUGH_ACTIVITIES step 3). Every run is about
// exactly one record, so this is where a page gets one: an app record type,
// held as one instance per operation (found or created when the page opens) or
// as many (the id comes in the URL). Left as a pure view, the page still
// renders — its reads simply land nowhere, which the hint says out loud.

function PageRecordSection({ pageRecord, pagePath }: { pageRecord: PageRecordDef | null; pagePath: string }) {
  const recordTypes = solutionRecordTypes();

  return (
    <div className="pe-config-section pe-config-divider">
      <p className="pe-config-label">Page Record</p>
      <div className="pe-ctx-form">
        <select
          className="pe-ctx-select"
          value={pageRecord?.type ?? ''}
          onChange={(e) =>
            setPageRecord(pagePath, e.target.value
              ? { type: e.target.value, instances: pageRecord?.instances ?? 'one' }
              : null)}
        >
          <option value="">(pure view — no record)</option>
          {recordTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
        </select>
        {pageRecord && (
          <select
            className="pe-ctx-select"
            value={pageRecord.instances}
            onChange={(e) => setPageRecord(pagePath, { ...pageRecord, instances: e.target.value as PageRecordDef['instances'] })}
          >
            <option value="one">one instance</option>
            <option value="many">many — id in the URL</option>
          </select>
        )}
      </div>
      <p className="pe-config-hint">
        {!pageRecord
          ? 'No record — activities and GETs fired from this page have nothing to anchor on.'
          : pageRecord.instances === 'one'
            ? 'One per operation: found, or created through its create activity, when the page opens.'
            : 'One of many: opened at ?record=<id>; nothing is created.'}
      </p>
    </div>
  );
}

// ── Page access ──────────────────────────────────────────────────────────────
// Who may open the page (CONSOLE_RUNTIME_SPEC §6). Deny by default once the
// solution declares roles: a published page naming none is filtered out of the
// snapshot server-side and the Runtime reports it missing, which is a puzzling
// way to learn about a permission — hence the warning rather than a silent
// empty list. A solution with no roles has RBAC dormant, so the section says
// that instead of showing an empty box.

function PageAccessSection({ accessOpen, pagePath }: { accessOpen: string[]; pagePath: string }) {
  const roles = solutionRoles();

  return (
    <div className="pe-config-section pe-config-divider">
      <p className="pe-config-label">Page Access</p>
      {roles.length === 0 ? (
        <p className="pe-config-hint">No roles declared — every signed-in user may open this page.</p>
      ) : (
        <>
          <ul className="pe-ctx-list">
            {roles.map((role) => (
              <li key={role.id} className="pe-ctx-item">
                <label className="pe-access-role">
                  <input type="checkbox" checked={accessOpen.includes(role.id)}
                    onChange={() => togglePageAccess(pagePath, role.id)} />
                  <span className="pe-ctx-key">{role.name}</span>
                </label>
                <span className="pe-ctx-type">{role.id}</span>
              </li>
            ))}
          </ul>
          {accessOpen.length === 0 && (
            <p className="pe-ctx-error">No role may open this page — it will not reach the Runtime.</p>
          )}
        </>
      )}
    </div>
  );
}

// ── FluxScript bindings (dynamic props + callbacks) ──────────────────────────
// One expression per dynamic prop, one script per callback — the stored
// artifact is the source text; this UI merely writes it (decision 2/6). The
// button opens the Monaco expression dialog.

interface EditingBinding {
  kind: 'expression' | 'callback';
  name: string;
  hint?: string;
}

function BindingRow({ name, typeLabel, typeClass, required, source, onEdit }: {
  name: string;
  typeLabel: string;
  typeClass: string;
  required?: boolean;
  source: string | undefined;
  onEdit: () => void;
}) {
  return (
    <li className="pe-binding-row">
      <div className="pe-binding-prop">
        <span className="pe-binding-name">{name}</span>
        <span className={`pe-binding-type pe-binding-type--${typeClass}`}>{typeLabel}</span>
        {required && <span className="pe-binding-required">*</span>}
      </div>
      <button className={`pe-expr${source ? '' : ' pe-expr--empty'}`} title={source ?? 'Not bound'} onClick={onEdit}>
        {source ?? '— not bound —'}
      </button>
    </li>
  );
}

function DynamicDataSection({ slotId, config, pagePath }: { slotId: string; config: SlotConfig; pagePath: string }) {
  const [editing, setEditing] = useState<EditingBinding | null>(null);
  const manifest = componentManifests[config.componentName];
  if (!manifest) return null;
  const dynamicProps = manifest.schema.filter((p) => p.kind === 'dynamic-data');
  if (dynamicProps.length === 0) return null;

  return (
    <div className="pe-config-section pe-config-divider">
      <p className="pe-config-label">Data</p>
      <ul className="pe-bindings-list">
        {dynamicProps.map((prop) => (
          <BindingRow
            key={prop.name}
            name={prop.name}
            typeLabel={prop.type}
            typeClass={prop.type}
            required={prop.required}
            source={config.dynamicProps[prop.name]}
            onEdit={() => setEditing({ kind: 'expression', name: prop.name, hint: prop.description })}
          />
        ))}
      </ul>
      {editing && (
        <ExpressionDialog
          title={`${config.componentName}.${editing.name} — expression`}
          hint={editing.hint}
          kind="expression"
          initialSource={config.dynamicProps[editing.name] ?? ''}
          onSave={(source) => { setDynamicProp(pagePath, slotId, editing.name, source); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CallbacksSection({ slotId, config, pagePath }: { slotId: string; config: SlotConfig; pagePath: string }) {
  const [editing, setEditing] = useState<EditingBinding | null>(null);
  const manifest = componentManifests[config.componentName];
  if (!manifest) return null;
  const callbacks = manifest.schema.filter((p) => p.kind === 'callback');
  if (callbacks.length === 0) return null;

  return (
    <div className="pe-config-section pe-config-divider">
      <p className="pe-config-label">Callbacks</p>
      <ul className="pe-bindings-list">
        {callbacks.map((prop) => (
          <BindingRow
            key={prop.name}
            name={prop.name}
            typeLabel="callback"
            typeClass="function"
            source={config.callbacks[prop.name]}
            onEdit={() => setEditing({
              kind: 'callback',
              name: prop.name,
              hint: `${prop.description ?? ''} — the emitted value arrives as callbackData.value`.replace(/^ — /, ''),
            })}
          />
        ))}
      </ul>
      {editing && (
        <ExpressionDialog
          title={`${config.componentName}.${editing.name} — callback script`}
          hint={editing.hint}
          kind="callback"
          initialSource={config.callbacks[editing.name] ?? ''}
          onSave={(source) => { setCallback(pagePath, slotId, editing.name, source); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ── Config column root ───────────────────────────────────────────────────────

interface Col3Props {
  selectedSlotId: string | null;
  slotConfigs: Record<string, SlotConfig | null>;
  contextSchema: ContextKeyDef[];
  accessOpen: string[];
  pageRecord: PageRecordDef | null;
  pagePath: string;
}

function ConfigColumn({ selectedSlotId, slotConfigs, contextSchema, accessOpen, pageRecord, pagePath }: Col3Props) {
  const config = selectedSlotId ? (slotConfigs[selectedSlotId] ?? null) : null;

  return (
    <div className="pe-col pe-col-config">
      <div className="pe-col-header">Configuration</div>
      <div className="pe-col-scroll">
        <PageContextSection contextSchema={contextSchema} pagePath={pagePath} />
        <PageRecordSection pageRecord={pageRecord} pagePath={pagePath} />
        <PageAccessSection accessOpen={accessOpen} pagePath={pagePath} />

        {selectedSlotId && config && (
          <>
            <div className="pe-config-section pe-config-divider">
              <p className="pe-config-label">Component</p>
              <p className="pe-config-value">{config.componentName}</p>
            </div>
            {/* Tab name — this slot's label in a Tabs strip, and where
                clicking it scrolls to (2026-09-24). */}
            <div className="pe-config-section">
              <p className="pe-config-label">Tab name</p>
              <input className="pe-binding-input" placeholder="No tab"
                title="Shown as a tab by the Tabs component; clicking it scrolls here"
                value={config.tabName ?? ''}
                onChange={(e) => setTabName(pagePath, selectedSlotId, e.target.value)} />
            </div>
            <StaticConfigSection slotId={selectedSlotId} config={config} pagePath={pagePath} />
            <DynamicDataSection slotId={selectedSlotId} config={config} pagePath={pagePath} />
            <CallbacksSection slotId={selectedSlotId} config={config} pagePath={pagePath} />
          </>
        )}

        {selectedSlotId && !config && (
          <p className="pe-empty">Assign a component to this slot to configure it.</p>
        )}
        {!selectedSlotId && (
          <p className="pe-config-hint" style={{ padding: '8px 10px' }}>Select a slot to configure it.</p>
        )}
      </div>
    </div>
  );
}

// ── Column 4: Preview ────────────────────────────────────────────────────────

function PreviewColumn({ pagePath, slotConfigs, contextSchema }: { pagePath: string; slotConfigs: Record<string, SlotConfig | null>; contextSchema: ContextKeyDef[] }) {
  // The preview renders against the same operation the workbench shows, and
  // nothing is auto-picked (ruled 2026-07-31) — so an empty preview says which
  // it is, rather than reading as a broken page.
  const { dataOperationId } = useShellState(['dataOperationId']);
  return (
    <div className="pe-col pe-col-preview">
      <div className="pe-col-header">Preview</div>
      {!dataOperationId && (
        <div className="pe-preview-nodata">
          No operation selected — the preview has no records. Pick one in Workbench.
        </div>
      )}
      <div className="pe-preview-content">
        <PageRenderer
          runtime={pageRuntime}
          pagePath={pagePath}
          slotConfigs={slotConfigs}
          contextSchema={contextSchema}
          debug={import.meta.env.DEV}
        />
      </div>
    </div>
  );
}

// ── PageEditor root ──────────────────────────────────────────────────────────

interface Props { pagePath: string; }

function PageEditorComponent({ pagePath }: Props) {
  const store = usePageEditorStore(pagePath);
  const [state, setState] = useState(() => ({ ...store.get() }));

  useEffect(() => {
    setState({ ...store.get() });
    return store.subscribe((s) => setState({ ...s }));
  }, [store]);

  const layout = loadPageLayout(pagePath);
  const slots = layout ? collectLeafPanels(layout.root) : [];
  const { mode, pageComponents, contextSchema, accessOpen, pageRecord, selectedComponentName, selectedSlotId, col1Collapsed, slotConfigs } = state;

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
        <button className={`pe-toggle-col1${col1Collapsed ? ' collapsed' : ''}`} title={col1Collapsed ? 'Show components' : 'Hide components'} onClick={() => toggleCol1(pagePath)}>
          {col1Collapsed ? '›' : '‹'}
        </button>
        <span className="pe-toolbar-title">Page Builder</span>
        <PublishControl pagePath={pagePath} />
      </div>
      <div className="pe-columns">
        {!col1Collapsed && (
          <ComponentsColumn pageComponents={pageComponents} selectedComponentName={selectedComponentName} pagePath={pagePath} />
        )}
        <SlotsColumn slots={slots} selectedSlotId={selectedSlotId} selectedComponentName={selectedComponentName} slotConfigs={slotConfigs} pagePath={pagePath} />
        <ConfigColumn selectedSlotId={selectedSlotId} slotConfigs={slotConfigs} contextSchema={contextSchema} accessOpen={accessOpen} pageRecord={pageRecord} pagePath={pagePath} />
        <PreviewColumn pagePath={pagePath} slotConfigs={slotConfigs} contextSchema={contextSchema} />
      </div>
    </div>
  );
}

export const css = `
  ${layoutEditorCss}
  ${pageRendererCss}
  ${expressionDialogCss}
  ${publishControlCss}
  ${arrayPropertyEditorCss}

  .pe-editor { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--color-bg); }
  .pe-toolbar { display: flex; align-items: center; gap: 8px; padding: 0 8px; height: 32px; flex-shrink: 0; background: var(--color-sidebar); border-bottom: 1px solid var(--color-border); }
  .pe-toolbar-title { font-size: 0.75rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
  .pe-toggle-col1 { background: none; border: none; color: var(--color-text-muted); cursor: pointer; font-size: 1rem; padding: 0 4px; line-height: 1; }
  .pe-toggle-col1:hover { color: var(--color-text); }
  .pe-back-btn { background: none; border: none; color: var(--color-accent); cursor: pointer; font-size: 0.8rem; padding: 0 4px; }
  .pe-back-btn:hover { opacity: 0.8; }

  .pe-columns { flex: 1; display: flex; flex-direction: row; overflow: hidden; }
  .pe-col { display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid var(--color-border); }
  .pe-col:last-child { border-right: none; }
  .pe-col-components { width: 180px; flex-shrink: 0; }
  .pe-col-slots      { width: 220px; flex-shrink: 0; }
  .pe-col-config     { width: 240px; flex-shrink: 0; }
  .pe-col-preview    { flex: 1; }
  .pe-col-scroll     { flex: 1; overflow-y: auto; }

  .pe-col-header { display: flex; align-items: center; justify-content: space-between; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-text-muted); padding: 6px 10px; flex-shrink: 0; border-bottom: 1px solid var(--color-border); }
  .pe-edit-layout-btn { font-size: 0.68rem; font-weight: 400; text-transform: none; letter-spacing: 0; padding: 2px 6px; background: none; border: 1px solid var(--color-border); border-radius: 3px; color: var(--color-text-muted); cursor: pointer; }
  .pe-edit-layout-btn:hover { color: var(--color-text); border-color: var(--color-text-muted); }

  .pe-empty { margin: 12px 10px; font-size: 0.775rem; color: var(--color-text-muted); font-style: italic; }

  .pe-add-wrap { position: relative; }
  .pe-add-btn { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; background: none; border: 1px solid var(--color-border); border-radius: 3px; color: var(--color-text-muted); cursor: pointer; font-size: 14px; line-height: 1; }
  .pe-add-btn:hover:not(:disabled) { color: var(--color-text); border-color: var(--color-text-muted); }
  .pe-add-btn:disabled { opacity: 0.3; cursor: default; }
  .pe-picker { position: absolute; top: calc(100% + 4px); right: 0; min-width: 160px; background: var(--color-sidebar); border: 1px solid var(--color-border); border-radius: 4px; list-style: none; margin: 0; padding: 4px 0; z-index: 100; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
  .pe-picker-item { display: flex; align-items: center; justify-content: space-between; padding: 5px 10px; cursor: pointer; gap: 8px; }
  .pe-picker-item:hover { background: rgba(255,255,255,0.07); }

  .pe-comp-list { list-style: none; margin: 0; padding: 4px 0; overflow-y: auto; flex: 1; }
  .pe-comp-item { display: flex; align-items: center; padding: 5px 10px; cursor: pointer; border-left: 2px solid transparent; gap: 6px; }
  .pe-comp-item:hover { background: rgba(255,255,255,0.05); }
  .pe-comp-item.selected { background: rgba(0,120,212,0.12); border-left-color: var(--color-accent); }
  .pe-comp-name { font-size: 0.825rem; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .pe-comp-version { font-size: 0.7rem; color: var(--color-text-muted); flex-shrink: 0; }
  .pe-comp-remove { background: none; border: none; color: transparent; cursor: pointer; font-size: 0.7rem; padding: 0 2px; flex-shrink: 0; }
  .pe-comp-item:hover .pe-comp-remove { color: var(--color-text-muted); }
  .pe-comp-remove:hover { color: #f48771 !important; }

  .pe-slot-list { list-style: none; margin: 0; padding: 4px 0; overflow-y: auto; flex: 1; }
  .pe-slot-item { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; cursor: pointer; border-left: 2px solid transparent; gap: 6px; }
  .pe-slot-item:hover { background: rgba(255,255,255,0.05); }
  .pe-slot-item.selected { background: rgba(0,120,212,0.12); border-left-color: var(--color-accent); }
  .pe-slot-info { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .pe-slot-name { font-size: 0.825rem; color: var(--color-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pe-slot-assigned { font-size: 0.72rem; color: var(--color-accent); }
  .pe-slot-empty { font-size: 0.72rem; color: var(--color-text-muted); font-style: italic; }
  .pe-slot-actions { display: flex; gap: 4px; flex-shrink: 0; }
  .pe-assign-btn { font-size: 0.7rem; padding: 2px 6px; background: var(--color-accent); color: #fff; border: none; border-radius: 3px; cursor: pointer; white-space: nowrap; }
  .pe-assign-btn:hover { opacity: 0.85; }
  .pe-unassign-btn { font-size: 0.7rem; padding: 2px 5px; background: none; color: var(--color-text-muted); border: 1px solid var(--color-border); border-radius: 3px; cursor: pointer; }
  .pe-unassign-btn:hover { color: #f48771; border-color: #f48771; }

  .pe-config-section { padding: 8px 10px 0; }
  .pe-config-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  .pe-config-divider { border-top: 1px solid var(--color-border); margin-top: 8px; padding-top: 10px; }
  .pe-config-label { margin: 0 0 4px; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-muted); }
  .pe-config-value { margin: 0; font-size: 0.825rem; color: var(--color-text); }
  .pe-config-hint { margin: 4px 0 0; font-size: 0.775rem; color: var(--color-text-muted); font-style: italic; }

  .pe-ctx-add-btn { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; background: none; border: 1px solid var(--color-border); border-radius: 3px; color: var(--color-text-muted); cursor: pointer; font-size: 13px; }
  .pe-ctx-add-btn:hover { color: var(--color-text); border-color: var(--color-text-muted); }
  .pe-ctx-list { list-style: none; margin: 4px 0 0; padding: 0; }
  .pe-ctx-item { display: flex; align-items: center; gap: 4px; padding: 3px 0; font-size: 0.775rem; }
  .pe-ctx-key { color: var(--color-text); flex: 1; }
  .pe-ctx-type { color: var(--color-text-muted); font-size: 0.68rem; }
  .pe-ctx-remove { background: none; border: none; color: transparent; cursor: pointer; font-size: 0.65rem; padding: 0 2px; }
  .pe-ctx-item:hover .pe-ctx-remove { color: var(--color-text-muted); }
  .pe-ctx-remove:hover { color: #f48771 !important; }
  .pe-ctx-form { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .pe-ctx-input { flex: 1; min-width: 80px; background: var(--color-bg); border: 1px solid var(--color-accent); border-radius: 3px; color: var(--color-text); font-size: 0.775rem; padding: 2px 5px; outline: none; }
  .pe-ctx-select { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 3px; color: var(--color-text); font-size: 0.72rem; padding: 2px 4px; }
  .pe-ctx-confirm { background: var(--color-accent); border: none; border-radius: 3px; color: #fff; cursor: pointer; font-size: 0.72rem; padding: 2px 8px; }
  .pe-ctx-error { width: 100%; margin: 2px 0 0; font-size: 0.7rem; color: #f48771; }
  .pe-access-role { display: flex; align-items: center; gap: 5px; flex: 1; cursor: pointer; }
  .pe-access-role input { accent-color: var(--color-accent); margin: 0; }

  .pe-bindings-list { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .pe-binding-row { display: flex; flex-direction: column; gap: 3px; }
  .pe-binding-prop { display: flex; align-items: center; gap: 4px; }
  .pe-binding-name { font-size: 0.8rem; color: var(--color-text); }
  .pe-binding-type { font-size: 0.62rem; padding: 1px 4px; border-radius: 3px; }
  .pe-binding-type--string   { background: rgba(100,180,255,0.12); color: #7bc; }
  .pe-binding-type--number   { background: rgba(180,130,255,0.12); color: #b8a; }
  .pe-binding-type--boolean  { background: rgba(255,180,80,0.12);  color: #db7; }
  .pe-binding-type--object   { background: rgba(100,220,150,0.12); color: #7c9; }
  .pe-binding-type--array    { background: rgba(255,140,100,0.12); color: #d97; }
  .pe-binding-type--function { background: rgba(255,100,100,0.12); color: #d77; }
  .pe-binding-required { font-size: 0.75rem; color: #f48771; }
  .pe-binding-input { width: 100%; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 3px; color: var(--color-text); font-size: 0.775rem; padding: 2px 6px; font-family: inherit; }
  .pe-binding-input:focus { border-color: var(--color-accent); outline: none; }
  .pe-choices { display: flex; flex-wrap: wrap; gap: 2px; }
  .pe-choice { padding: 2px 7px; border: 1px solid var(--color-border); border-radius: 3px; background: var(--color-bg); color: var(--color-text-muted); font-size: 0.72rem; font-family: inherit; cursor: pointer; }
  .pe-choice:hover { color: var(--color-text); }
  .pe-choice--on { background: var(--color-accent); border-color: var(--color-accent); color: #fff; }
  .pe-binding-input--grow { display: block; resize: vertical; overflow: hidden; min-height: 1.4rem; line-height: 1.35; }
  .pe-binding-input--sm { width: auto; flex: 1; }

  .pe-expr { width: 100%; text-align: left; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 3px; color: var(--color-text); cursor: pointer; font-family: ui-monospace, monospace; font-size: 0.72rem; padding: 3px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pe-expr:hover { border-color: var(--color-accent); }
  .pe-expr--empty { color: var(--color-text-muted); font-style: italic; font-family: inherit; }

  .pe-preview-content { flex: 1; overflow: hidden; display: flex; flex-direction: column; background: #fff; }
  .pe-preview-nodata {
    flex-shrink: 0;
    padding: 6px 10px;
    font-size: 0.72rem;
    color: var(--color-text-muted);
    background: rgba(255,255,255,0.04);
    border-bottom: 1px solid var(--color-border);
  }
`;

export const PageEditor = PageEditorComponent;
