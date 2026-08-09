// SDM Record types editor: the solution's record types (SolutionConfig.recordTypes)
// — id, name, workflow binding, custom fields, and the RBAC read surface.
// Slice 1: plain forms; workflow/activity authoring stays hand-edited.

import { useState } from 'react';
import type { SolutionConfig, CustomFieldDef, RecordTypeDef } from '@fluxus/engine';
import { readConfig, idProblems, refreshSolutionViews, saveRecordTypes, useDirty, useLoadedConfig } from './useSolutionConfig';
import { InnerPanel, PanelItem } from '../shell/InnerPanel';

const FIELD_TYPES = ['text', 'int', 'decimal', 'bool', 'date', 'fk_ref'];

/** `rt_assets` from "Assets" — the §1 id convention, entities plural. */
function recordTypeId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug ? `rt_${slug}` : '';
}

/** The New dialog's own state — a record type is only appended to the draft
 *  once it has an id, a name and a workflow, so a half-typed one never sits in
 *  the list waiting to fail the save. */
interface NewDraft { id: string; name: string; description: string; workflow_ref: string }

export function RecordTypesEditor() {
  const loaded = useLoadedConfig();
  const [draft, setDraft] = useState<SolutionConfig>(() => readConfig());
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useDirty();
  // Which remove is armed — the button asks once before it bites.
  const [armed, setArmed] = useState(false);
  // Panel filter — a mature solution has too many types to scan by eye.
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState<NewDraft | null>(null);

  const rts = draft.recordTypes;
  const cur: RecordTypeDef | undefined = rts[sel];
  const workflows = draft.workflows;
  const roles = draft.access?.roles ?? [];

  function setRts(next: RecordTypeDef[]) {
    setDraft((d) => ({ ...d, recordTypes: next }));
    setDirty(true);
  }
  function edit(patch: Partial<RecordTypeDef>) {
    setRts(rts.map((r, i) => (i === sel ? { ...r, ...patch } : r)));
  }
  function editFields(next: CustomFieldDef[]) {
    edit({ custom_fields: next });
  }
  function openNew() {
    setDialog({ id: '', name: '', description: '', workflow_ref: workflows[0]?.id ?? '' });
  }
  /** Append the dialog's record type, then show it — clearing the filter, or
   *  the thing just created could land outside the visible list. */
  function commitDialog() {
    if (!dialog) return;
    const name = dialog.name.trim();
    const id = (dialog.id.trim() || recordTypeId(name)).trim();
    if (!name || !id || !dialog.workflow_ref) return;
    setRts([...rts, { id, name, description: dialog.description.trim(), workflow_ref: dialog.workflow_ref, custom_fields: [] }]);
    setFilter('');
    select(rts.length);
    setDialog(null);
  }
  /** Selection moves disarm a pending remove. */
  function select(i: number) {
    setSel(i);
    setArmed(false);
  }
  function removeRt() {
    setRts(rts.filter((_, j) => j !== sel));
    setSel((s) => Math.max(0, s > sel ? s - 1 : s));
    setArmed(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveRecordTypes(loaded.recordTypes, draft.recordTypes);
      setDirty(false);
      await refreshSolutionViews();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const fields = cur?.custom_fields ?? [];
  function editField(i: number, patch: Partial<CustomFieldDef>) {
    editFields(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }

  const idErr = idProblems(rts.map((r) => r.id));

  // The dialog's id follows the name until the user types one of their own.
  const dialogId = dialog && !dialog.id ? recordTypeId(dialog.name) : dialog?.id ?? '';
  const duplicateId = !!dialogId && rts.some((r) => r.id === dialogId);

  // Filtering keeps each type's real index: `sel` indexes the draft, not the
  // visible subset, so hiding a row must not renumber the selection.
  const q = filter.trim().toLowerCase();
  const shown = rts
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !q || `${r.name} ${r.id} ${r.description ?? ''}`.toLowerCase().includes(q));

  return (
    <>
      {/* The list is the shell's inner panel (M17); it lists the *draft*, so a
          rename or an addition shows before it is saved. */}
      <InnerPanel title="Record types" actions={<button className="panel-btn" onClick={openNew}>New</button>}>
        {rts.length > 0 && (
          <input className="panel-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search record types…" />
        )}
        {rts.length === 0 && <p className="panel-empty">None yet — New adds one.</p>}
        {rts.length > 0 && shown.length === 0 && <p className="panel-empty">No match for “{filter.trim()}”.</p>}
        {shown.map(({ r, i }) => (
          <PanelItem key={i} name={r.name || '(unnamed)'} sub={r.id || '(new)'} active={i === sel} onClick={() => select(i)} />
        ))}
      </InnerPanel>

      <div className="admin-panel">
        <div className="admin-panel-head">
          <h2 className="admin-title">Record types</h2>
          <p className="admin-sub">The entities this solution's model tracks. Records mutate only through activities.</p>
        </div>

        {error && <div className="admin-error">{error}</div>}
        {idErr && <div className="admin-error">{idErr}</div>}

        {cur && (
          <div className="sdm-detail">
            <label className="admin-field"><span>Id</span>
              <input className="admin-mono" value={cur.id} onChange={(e) => edit({ id: e.target.value })} placeholder="rt_assets" /></label>
            <label className="admin-field"><span>Name</span>
              <input value={cur.name} onChange={(e) => edit({ name: e.target.value })} placeholder="Assets" /></label>
            <label className="admin-field"><span>Description</span>
              <input value={cur.description} onChange={(e) => edit({ description: e.target.value })} /></label>
            {/* Every record type must resolve a workflow — the engine rejects
                a dangling workflow_ref at save (MemoryAdapter resolution), so
                no "(none)": an unset ref only shows as a disabled placeholder. */}
            <label className="admin-field"><span>Workflow</span>
              <select value={cur.workflow_ref} onChange={(e) => edit({ workflow_ref: e.target.value })}>
                {!cur.workflow_ref && <option value="" disabled>(select a workflow)</option>}
                {workflows.map((w) => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}
              </select></label>

            {roles.length > 0 && (
              <div className="admin-field"><span>Readable by roles</span>
                <div className="sdm-checks">
                  {roles.map((role) => {
                    const on = (cur.access?.read ?? []).includes(role.id);
                    return (
                      <label key={role.id} className="admin-check">
                        <input type="checkbox" checked={on} onChange={(e) => {
                          const set = new Set(cur.access?.read ?? []);
                          e.target.checked ? set.add(role.id) : set.delete(role.id);
                          edit({ access: { read: [...set] } });
                        }} /> {role.name}
                      </label>
                    );
                  })}
                </div>
                <p className="admin-muted">None checked ⇒ nobody reads this type. Reads are default-deny once roles exist.</p>
              </div>
            )}

            <div className="sdm-fields">
              <div className="sdm-fields-head">Custom fields</div>
              <table className="admin-table">
                <thead><tr><th>Key</th><th>Label</th><th>Type</th><th>Req</th><th>Uniq</th><th>FK type</th><th>FK display</th><th /></tr></thead>
                <tbody>
                  {fields.map((f, i) => {
                    // An fk_ref points at another record type in this draft, so
                    // both sides are pickable: the target's id, then one of its
                    // own field keys (or `id`) as the label to display.
                    const target = f.type === 'fk_ref' ? rts.find((r) => r.id === f.fk_record_type) : undefined;
                    return (
                      <tr key={i}>
                        <td><input className="admin-mono" value={f.key} onChange={(e) => editField(i, { key: e.target.value })} /></td>
                        {/* What a person sees wherever the field appears. Blank
                            ⇒ the key stands in (`fieldLabel`), which is what
                            every field authored before labels existed does. */}
                        <td><input value={f.label ?? ''} placeholder={f.key} onChange={(e) => editField(i, { label: e.target.value || undefined })} /></td>
                        <td><select value={f.type} onChange={(e) => editField(i, { type: e.target.value })}>{FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></td>
                        <td><input type="checkbox" checked={!!f.required} onChange={(e) => editField(i, { required: e.target.checked })} /></td>
                        <td><input type="checkbox" checked={!!f.unique} onChange={(e) => editField(i, { unique: e.target.checked })} /></td>
                        <td>{f.type === 'fk_ref' && (
                          <select className="admin-mono" value={f.fk_record_type ?? ''} onChange={(e) => editField(i, { fk_record_type: e.target.value })}>
                            {!f.fk_record_type && <option value="" disabled>(select)</option>}
                            {rts.map((r, j) => <option key={j} value={r.id}>{r.id}</option>)}
                          </select>
                        )}</td>
                        <td>{f.type === 'fk_ref' && (
                          <select className="admin-mono" value={f.fk_display_field ?? ''} disabled={!target}
                            onChange={(e) => editField(i, { fk_display_field: e.target.value || undefined })}>
                            <option value="">(default)</option>
                            {['id', ...(target?.custom_fields ?? []).map((c) => c.key)].map((k, j) => <option key={j} value={k}>{k}</option>)}
                          </select>
                        )}</td>
                        <td><button className="admin-btn admin-btn-ghost" onClick={() => editFields(fields.filter((_, j) => j !== i))}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button className="admin-btn admin-btn-ghost" onClick={() => editFields([...fields, { key: '', type: 'text' }])}>+ Add field</button>
            </div>

            <button className="admin-btn admin-btn-ghost" onClick={() => (armed ? removeRt() : setArmed(true))}>
              {armed ? 'Really delete?' : 'Delete record type'}</button>
          </div>
        )}

        <div className="admin-actions">
          <button className="admin-btn" onClick={save} disabled={busy || !dirty || !!idErr}>{busy ? 'Saving…' : 'Save record types'}</button>
        </div>
      </div>

      {/* Creation is a popup over the list, never an inline blank row (ruled
          2026-08-04) — and it collects the fields the engine requires up front
          rather than appending an invalid type and hoping. */}
      {dialog && (
        <div className="admin-overlay" onClick={() => setDialog(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-title">New record type</h3>
            <p className="admin-sub">
              An entity this solution's model tracks. Custom fields are added afterwards, on the type itself.
            </p>
            <div className="admin-modal-form">
              <label className="admin-field"><span>Name</span>
                <input value={dialog.name} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} placeholder="Assets" autoFocus /></label>
              <label className="admin-field"><span>Id</span>
                <input className="admin-mono" value={dialogId} onChange={(e) => setDialog({ ...dialog, id: e.target.value })} placeholder="rt_assets" />
                <span className="admin-muted">Records store the id — renaming it later is blocked once records exist.</span></label>
              <label className="admin-field"><span>Description</span>
                <input value={dialog.description} onChange={(e) => setDialog({ ...dialog, description: e.target.value })} /></label>
              <label className="admin-field"><span>Workflow</span>
                <select value={dialog.workflow_ref} onChange={(e) => setDialog({ ...dialog, workflow_ref: e.target.value })}>
                  {!dialog.workflow_ref && <option value="" disabled>(select a workflow)</option>}
                  {workflows.map((w) => <option key={w.id} value={w.id}>{w.name || w.id}</option>)}
                </select></label>
              {duplicateId && <div className="admin-error">A record type with id ‘{dialogId}’ already exists.</div>}
              {workflows.length === 0 && <div className="admin-error">Define a workflow first — every record type must resolve one.</div>}
              <div className="admin-row admin-modal-actions">
                <button className="admin-btn" onClick={commitDialog}
                  disabled={!dialog.name.trim() || !dialogId || !dialog.workflow_ref || duplicateId}>Add record type</button>
                <button className="admin-link" onClick={() => setDialog(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
