// SDM Attributes editor: the solution's attribute pool (SolutionConfig.attributes) —
// the reusable capture fields activities compose. Slice 1: key/label/
// description/type plus the common type_config knobs (fk target, list
// datasource, multi, multiline). Composite/section configs stay hand-edited.
//
// The list branch wrote `type_config.values` until 2026-08-10 — a key nothing in
// the platform reads, while the capture form and `validateSubmission` both read
// `datasource` and fail closed without it. So every list attribute authored here
// was unusable. It now edits the datasource; `values` is surfaced read-only
// where an existing solution still carries one.

import { useMemo, useState } from 'react';
import type { AttributeDef, SolutionConfig } from '@fluxus/engine';
import { readConfig, idProblems, refreshSolutionViews, saveAttributes, useDirty, useLoadedConfig } from './useSolutionConfig';
import { InnerPanel, PanelItem } from '../shell/InnerPanel';

const TYPES = ['text', 'int', 'decimal', 'bool', 'date', 'geopoint', 'reference', 'list', 'photo', 'file'];

export function AttributesEditor() {
  const loaded = useLoadedConfig();
  const [draft, setDraft] = useState<SolutionConfig>(() => readConfig());
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useDirty();

  const attrs = draft.attributes;
  const cur: AttributeDef | undefined = attrs[sel];

  // An attribute earns its place by being composed somewhere: named by an
  // activity, or named as a sub-attribute of a composite. Anything else is
  // unused — a normal state while authoring, not a fault, so the panel says so
  // quietly rather than flagging it as an error. A composite's parts count as
  // used even where the composite itself is not, so its pieces don't all light
  // up beside it.
  const used = useMemo(() => {
    const keys = new Set<string>();
    for (const wf of draft.workflows) {
      for (const act of wf.activities) {
        for (const usage of act.attributes ?? []) {
          if ('attribute_ref' in usage) keys.add(usage.attribute_ref);
        }
      }
    }
    for (const a of draft.attributes) {
      for (const sub of a.type_config?.attributes ?? []) keys.add(sub.attribute_ref);
    }
    return keys;
  }, [draft]);

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

  // The key is the attribute's identity — a save addresses each attribute by
  // it, so empties and duplicates are gated here rather than sent.
  const idErr = idProblems(attrs.map((a) => a.key));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveAttributes(loaded.attributes, draft.attributes);
      setDirty(false);
      await refreshSolutionViews();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <InnerPanel title="Attributes" actions={<button className="panel-btn" onClick={add}>New</button>}>
        {attrs.length === 0 && <p className="panel-empty">None yet — New adds one.</p>}
        {attrs.map((a, i) => (
          <PanelItem
            key={i}
            name={a.key || '(new)'}
            sub={<>{a.type}{a.key && !used.has(a.key) && <span className="panel-item-flag"> · unused</span>}</>}
            active={i === sel}
            onClick={() => setSel(i)}
          />
        ))}
      </InnerPanel>

      <div className="admin-panel">
        <div className="admin-panel-head">
          <h2 className="admin-title">Attributes</h2>
          <p className="admin-sub">The reusable capture fields activities compose from.</p>
        </div>

        {error && <div className="admin-error">{error}</div>}
        {idErr && <div className="admin-error">{idErr}</div>}

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
            {/* A list attribute's choices come from its `datasource` — the declared
                producer the capture form renders and `validateSubmission` re-runs
                server-side to check what came back (DATA_THROUGH_ACTIVITIES §3).
                It is required: a list without one fails every submission closed. */}
            {cur.type === 'list' && (
              <>
                <label className="admin-field"><span>Datasource (FluxScript expression yielding a list)</span>
                  <textarea className="sdm-code" value={cur.type_config?.datasource ?? ''} onChange={(e) => editCfg({ datasource: e.target.value || undefined })}
                    placeholder="['Crew A', 'Crew B', 'Crew C']  —  or  records.crews.where(active).select(id, name)" /></label>
                {!cur.type_config?.datasource && (
                  <p className="admin-error">A list attribute without a datasource is rejected on every submission.</p>
                )}
                {/* `values` predates the datasource and is read nowhere in the
                    platform. Shown only where a solution still carries one, so
                    nothing disappears silently — and never written afresh. */}
                {(cur.type_config?.values?.length ?? 0) > 0 && (
                  <p className="admin-muted">
                    Legacy <code>values</code> ({cur.type_config?.values?.join(', ')}) — ignored by the platform.
                    Put them in the datasource above as a FluxScript list to make them real.
                  </p>
                )}
              </>
            )}

            <button className="admin-btn admin-btn-ghost" onClick={() => remove(sel)}>Delete attribute</button>
          </div>
        )}

        <div className="admin-actions">
          <button className="admin-btn" onClick={save} disabled={busy || !dirty || !!idErr}>{busy ? 'Saving…' : 'Save attributes'}</button>
        </div>
      </div>
    </>
  );
}
