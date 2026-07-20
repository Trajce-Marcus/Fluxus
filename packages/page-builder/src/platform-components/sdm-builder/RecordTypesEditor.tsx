// SDM Record types editor: the solution's record types (ConfigRaw.recordTypes)
// — id, name, workflow binding, custom fields, and the RBAC read surface.
// Slice 1: plain forms; workflow/activity authoring stays hand-edited.

import { useState } from 'react';
import type { ConfigRaw, CustomFieldDef, RecordTypeDef } from '@fluxus/engine';
import { readConfig, commitConfig } from './useSolutionConfig';

const FIELD_TYPES = ['text', 'int', 'decimal', 'bool', 'date', 'fk_ref'];

export function RecordTypesEditor() {
  const [draft, setDraft] = useState<ConfigRaw>(() => readConfig());
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

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
  function add() {
    setRts([...rts, { id: 'rt_', name: '', description: '', workflow_ref: workflows[0]?.id ?? '', custom_fields: [] }]);
    setSel(rts.length);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await commitConfig(draft);
      setDirty(false);
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

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2 className="admin-title">Record types</h2>
        <p className="admin-sub">The entities this solution's model tracks. Records mutate only through activities.</p>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <div className="sdm-split">
        <div className="sdm-list">
          {rts.map((r, i) => (
            <button key={i} className={`sdm-list-item${i === sel ? ' active' : ''}`} onClick={() => setSel(i)}>
              <span className="admin-mono">{r.id || '(new)'}</span>
              <span className="sdm-list-sub">{r.name}</span>
            </button>
          ))}
          <button className="admin-btn admin-btn-ghost" onClick={add}>+ Add record type</button>
        </div>

        {cur && (
          <div className="sdm-detail">
            <label className="admin-field"><span>Id</span>
              <input className="admin-mono" value={cur.id} onChange={(e) => edit({ id: e.target.value })} placeholder="rt_assets" /></label>
            <label className="admin-field"><span>Name</span>
              <input value={cur.name} onChange={(e) => edit({ name: e.target.value })} placeholder="Assets" /></label>
            <label className="admin-field"><span>Description</span>
              <input value={cur.description} onChange={(e) => edit({ description: e.target.value })} /></label>
            <label className="admin-field"><span>Workflow</span>
              <select value={cur.workflow_ref} onChange={(e) => edit({ workflow_ref: e.target.value })}>
                <option value="">(none)</option>
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
                <p className="admin-muted">None checked ⇒ open (no read restriction).</p>
              </div>
            )}

            <div className="sdm-fields">
              <div className="sdm-fields-head">Custom fields</div>
              <table className="admin-table">
                <thead><tr><th>Key</th><th>Type</th><th>Req</th><th>Uniq</th><th>FK type</th><th>FK display</th><th /></tr></thead>
                <tbody>
                  {fields.map((f, i) => (
                    <tr key={i}>
                      <td><input className="admin-mono" value={f.key} onChange={(e) => editField(i, { key: e.target.value })} /></td>
                      <td><select value={f.type} onChange={(e) => editField(i, { type: e.target.value })}>{FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></td>
                      <td><input type="checkbox" checked={!!f.required} onChange={(e) => editField(i, { required: e.target.checked })} /></td>
                      <td><input type="checkbox" checked={!!f.unique} onChange={(e) => editField(i, { unique: e.target.checked })} /></td>
                      <td>{f.type === 'fk_ref' && <input className="admin-mono" value={f.fk_record_type ?? ''} onChange={(e) => editField(i, { fk_record_type: e.target.value })} />}</td>
                      <td>{f.type === 'fk_ref' && <input className="admin-mono" value={f.fk_display_field ?? ''} onChange={(e) => editField(i, { fk_display_field: e.target.value })} />}</td>
                      <td><button className="admin-btn admin-btn-ghost" onClick={() => editFields(fields.filter((_, j) => j !== i))}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="admin-btn admin-btn-ghost" onClick={() => editFields([...fields, { key: '', type: 'text' }])}>+ Add field</button>
            </div>

            <button className="admin-btn admin-btn-ghost" onClick={() => { setRts(rts.filter((_, j) => j !== sel)); setSel((s) => Math.max(0, s > sel ? s - 1 : s)); }}>Remove record type</button>
          </div>
        )}
      </div>

      <div className="admin-actions">
        <button className="admin-btn" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save record types'}</button>
      </div>
    </div>
  );
}
