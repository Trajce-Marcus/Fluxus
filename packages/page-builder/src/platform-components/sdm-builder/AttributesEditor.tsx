// SDM Attributes editor: the solution's attribute pool (ConfigRaw.attributes) —
// the reusable capture fields activities compose. Slice 1: key/label/
// description/type plus the common type_config knobs (fk target, list values,
// multi, multiline). Composite/section/DSL-driven configs stay hand-edited.

import { useState } from 'react';
import type { AttributeDef, ConfigRaw } from '@fluxus/engine';
import { readConfig, commitConfig } from './useSolutionConfig';

const TYPES = ['text', 'int', 'decimal', 'bool', 'date', 'reference', 'list', 'photo', 'file'];

export function AttributesEditor() {
  const [draft, setDraft] = useState<ConfigRaw>(() => readConfig());
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const attrs = draft.attributes;
  const cur: AttributeDef | undefined = attrs[sel];

  function setAttrs(next: AttributeDef[]) {
    setDraft((d) => ({ ...d, attributes: next }));
    setDirty(true);
  }
  function edit(patch: Partial<AttributeDef>) {
    setAttrs(attrs.map((a, i) => (i === sel ? { ...a, ...patch } : a)));
  }
  function editCfg(patch: Record<string, unknown>) {
    edit({ type_config: { ...cur!.type_config, ...patch } });
  }
  function add() {
    setAttrs([...attrs, { key: '', label: '', description: '', type: 'text' }]);
    setSel(attrs.length);
  }
  function remove(i: number) {
    setAttrs(attrs.filter((_, j) => j !== i));
    setSel((s) => Math.max(0, s > i ? s - 1 : s));
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

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2 className="admin-title">Attributes</h2>
        <p className="admin-sub">The reusable capture fields activities compose from.</p>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <div className="sdm-split">
        <div className="sdm-list">
          {attrs.map((a, i) => (
            <button key={i} className={`sdm-list-item${i === sel ? ' active' : ''}`} onClick={() => setSel(i)}>
              <span className="admin-mono">{a.key || '(new)'}</span>
              <span className="sdm-list-sub">{a.type}</span>
            </button>
          ))}
          <button className="admin-btn admin-btn-ghost" onClick={add}>+ Add attribute</button>
        </div>

        {cur && (
          <div className="sdm-detail">
            <label className="admin-field"><span>Key</span>
              <input className="admin-mono" value={cur.key} onChange={(e) => edit({ key: e.target.value })} /></label>
            <label className="admin-field"><span>Label</span>
              <input value={cur.label} onChange={(e) => edit({ label: e.target.value })} /></label>
            <label className="admin-field"><span>Description</span>
              <input value={cur.description} onChange={(e) => edit({ description: e.target.value })} /></label>
            <label className="admin-field"><span>Type</span>
              <select value={cur.type} onChange={(e) => edit({ type: e.target.value })}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select></label>

            <label className="admin-check"><input type="checkbox" checked={!!cur.type_config?.multi} onChange={(e) => editCfg({ multi: e.target.checked })} /> Multi (captures a list)</label>

            {cur.type === 'text' && (
              <label className="admin-check"><input type="checkbox" checked={!!cur.type_config?.multiline} onChange={(e) => editCfg({ multiline: e.target.checked })} /> Multiline</label>
            )}
            {cur.type === 'reference' && (
              <label className="admin-field"><span>FK record type</span>
                <input className="admin-mono" value={cur.type_config?.fk_record_type ?? ''} onChange={(e) => editCfg({ fk_record_type: e.target.value })} placeholder="rt_assets" /></label>
            )}
            {cur.type === 'list' && (
              <label className="admin-field"><span>Values (comma-separated)</span>
                <input value={(cur.type_config?.values ?? []).join(', ')} onChange={(e) => editCfg({ values: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label>
            )}

            <button className="admin-btn admin-btn-ghost" onClick={() => remove(sel)}>Remove attribute</button>
          </div>
        )}
      </div>

      <div className="admin-actions">
        <button className="admin-btn" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save attributes'}</button>
      </div>
    </div>
  );
}
