// SDM Workflows editor: the solution's workflows (ConfigRaw.workflows) and the
// activities nested under each. A record type binds one workflow; activities
// are the mutation verbs users run against its records.
//
// Slice 2 (lean): id/name/description/sort_order/record_map/show_condition per
// activity, plus a lean attribute-usage composer — pick a pool attribute,
// toggle required, insert section headings, reorder. FluxScript overrides
// (show_condition/validation/can_waive on a usage) stay hand-edited; hooks and
// the activity show_condition are plain textareas (no DSL tooling yet).

import { useState } from 'react';
import type {
  ActivityRawDef,
  AttributeUsageDef,
  ConfigRaw,
  SectionMarkerDef,
  WorkflowRawDef,
} from '@fluxus/engine';
import { readConfig, commitConfig } from './useSolutionConfig';

type UsageItem = AttributeUsageDef | SectionMarkerDef;
const isUsage = (it: UsageItem): it is AttributeUsageDef => 'attribute_ref' in it;

const RECORD_MAPS = ['', 'CREATE', 'UPDATE', 'DELETE'] as const;

/** before_hook/after_hook may be stored as joined lines; show as text. */
function hookText(h: string | string[] | null | undefined): string {
  return Array.isArray(h) ? h.join('\n') : (h ?? '');
}

export function WorkflowsEditor() {
  const [draft, setDraft] = useState<ConfigRaw>(() => readConfig());
  const [selWf, setSelWf] = useState(0);
  const [selAct, setSelAct] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const wfs = draft.workflows;
  const pool = draft.attributes;
  const wf: WorkflowRawDef | undefined = wfs[selWf];
  const acts = wf?.activities ?? [];
  const act: ActivityRawDef | undefined = acts[selAct];

  function setWfs(next: WorkflowRawDef[]) {
    setDraft((d) => ({ ...d, workflows: next }));
    setDirty(true);
  }
  function editWf(patch: Partial<WorkflowRawDef>) {
    setWfs(wfs.map((w, i) => (i === selWf ? { ...w, ...patch } : w)));
  }
  function addWf() {
    setWfs([...wfs, { id: 'wf_', name: '', description: '', activities: [] }]);
    setSelWf(wfs.length);
    setSelAct(0);
  }
  function removeWf() {
    setWfs(wfs.filter((_, i) => i !== selWf));
    setSelWf((s) => Math.max(0, s > selWf ? s - 1 : s));
    setSelAct(0);
  }

  function setActs(next: ActivityRawDef[]) {
    editWf({ activities: next });
  }
  function editAct(patch: Partial<ActivityRawDef>) {
    setActs(acts.map((a, i) => (i === selAct ? { ...a, ...patch } : a)));
  }
  function addAct() {
    const next: ActivityRawDef = {
      id: 'act_',
      name: '',
      description: '',
      sort_order: acts.length,
      attributes: [],
      before_hook: null,
      after_hook: null,
    };
    setActs([...acts, next]);
    setSelAct(acts.length);
  }
  function removeAct() {
    setActs(acts.filter((_, i) => i !== selAct));
    setSelAct((s) => Math.max(0, s > selAct ? s - 1 : s));
  }

  // ── attribute-usage composer ──
  const items = (act?.attributes ?? []) as UsageItem[];
  function setItems(next: UsageItem[]) {
    editAct({ attributes: next as ActivityRawDef['attributes'] });
  }
  function editItem(i: number, it: UsageItem) {
    setItems(items.map((x, j) => (j === i ? it : x)));
  }
  function moveItem(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  }
  function addUsage() {
    setItems([...items, { attribute_ref: pool[0]?.key ?? '' }]);
  }
  function addSection() {
    setItems([...items, { section: '' }]);
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
        <h2 className="admin-title">Workflows</h2>
        <p className="admin-sub">A workflow bundles the activities that mutate a record type's records. Record types bind one workflow each.</p>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <div className="sdm-split">
        <div className="sdm-list">
          {wfs.map((w, i) => (
            <button key={i} className={`sdm-list-item${i === selWf ? ' active' : ''}`} onClick={() => { setSelWf(i); setSelAct(0); }}>
              <span className="admin-mono">{w.id || '(new)'}</span>
              <span className="sdm-list-sub">{w.name}</span>
            </button>
          ))}
          <button className="admin-btn admin-btn-ghost" onClick={addWf}>+ Add workflow</button>
        </div>

        {wf && (
          <div className="sdm-detail">
            <label className="admin-field"><span>Id</span>
              <input className="admin-mono" value={wf.id} onChange={(e) => editWf({ id: e.target.value })} placeholder="wf_assets" /></label>
            <label className="admin-field"><span>Name</span>
              <input value={wf.name} onChange={(e) => editWf({ name: e.target.value })} placeholder="Assets" /></label>
            <label className="admin-field"><span>Description</span>
              <input value={wf.description} onChange={(e) => editWf({ description: e.target.value })} /></label>

            <div className="sdm-fields">
              <div className="sdm-fields-head">Activities</div>
              <div className="sdm-subsplit">
                <div className="sdm-sublist">
                  {acts.map((a, i) => (
                    <button key={i} className={`sdm-list-item${i === selAct ? ' active' : ''}`} onClick={() => setSelAct(i)}>
                      <span className="admin-mono">{a.id || '(new)'}</span>
                      <span className="sdm-list-sub">{a.name}</span>
                    </button>
                  ))}
                  <button className="admin-btn admin-btn-ghost" onClick={addAct}>+ Add activity</button>
                </div>

                {act && (
                  <div className="sdm-detail">
                    <label className="admin-field"><span>Id</span>
                      <input className="admin-mono" value={act.id} onChange={(e) => editAct({ id: e.target.value })} placeholder="act_create_assets" /></label>
                    <label className="admin-field"><span>Name</span>
                      <input value={act.name} onChange={(e) => editAct({ name: e.target.value })} placeholder="Create asset" /></label>
                    <label className="admin-field"><span>Description</span>
                      <input value={act.description} onChange={(e) => editAct({ description: e.target.value })} /></label>
                    <label className="admin-field"><span>Sort order</span>
                      <input type="number" value={act.sort_order} onChange={(e) => editAct({ sort_order: Number(e.target.value) })} /></label>
                    <label className="admin-field"><span>Record map</span>
                      <select value={act.record_map ?? ''} onChange={(e) => editAct({ record_map: (e.target.value || undefined) as ActivityRawDef['record_map'] })}>
                        {RECORD_MAPS.map((m) => <option key={m} value={m}>{m || '(none)'}</option>)}
                      </select></label>
                    <label className="admin-field"><span>Show condition (FluxScript)</span>
                      <textarea className="sdm-code" value={act.show_condition ?? ''} onChange={(e) => editAct({ show_condition: e.target.value || undefined })} placeholder="context.record.status == 'open'" /></label>

                    <div className="sdm-fields">
                      <div className="sdm-fields-head">Attributes captured</div>
                      {items.map((it, i) => (
                        <div key={i} className="sdm-usage-row">
                          <div className="sdm-usage-move">
                            <button onClick={() => moveItem(i, -1)} disabled={i === 0}>▲</button>
                            <button onClick={() => moveItem(i, 1)} disabled={i === items.length - 1}>▼</button>
                          </div>
                          {isUsage(it) ? (
                            <>
                              <select value={it.attribute_ref} onChange={(e) => editItem(i, { ...it, attribute_ref: e.target.value })}>
                                {pool.map((p) => <option key={p.key} value={p.key}>{p.key}{p.label ? ` — ${p.label}` : ''}</option>)}
                              </select>
                              <label className="admin-check"><input type="checkbox" checked={!!it.required} onChange={(e) => editItem(i, { ...it, required: e.target.checked || undefined })} /> Req</label>
                            </>
                          ) : (
                            <>
                              <span className="sdm-usage-section">§</span>
                              <input type="text" value={it.section} onChange={(e) => editItem(i, { ...it, section: e.target.value })} placeholder="Section heading" />
                            </>
                          )}
                          <button className="admin-btn admin-btn-ghost" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>
                        </div>
                      ))}
                      <div className="sdm-usage-row">
                        <button className="admin-btn admin-btn-ghost" onClick={addUsage} disabled={pool.length === 0}>+ Attribute</button>
                        <button className="admin-btn admin-btn-ghost" onClick={addSection}>+ Section</button>
                      </div>
                      {pool.length === 0 && <p className="admin-muted">Define pool attributes first (Attributes tab).</p>}
                    </div>

                    <label className="admin-field"><span>Before hook (FluxScript — validate)</span>
                      <textarea className="sdm-code" value={hookText(act.before_hook)} onChange={(e) => editAct({ before_hook: e.target.value || null })} /></label>
                    <label className="admin-field"><span>After hook (FluxScript — effects)</span>
                      <textarea className="sdm-code" value={hookText(act.after_hook)} onChange={(e) => editAct({ after_hook: e.target.value || null })} /></label>

                    <button className="admin-btn admin-btn-ghost" onClick={removeAct}>Remove activity</button>
                  </div>
                )}
              </div>
            </div>

            <button className="admin-btn admin-btn-ghost" onClick={removeWf}>Remove workflow</button>
          </div>
        )}
      </div>

      <div className="admin-actions">
        <button className="admin-btn" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save workflows'}</button>
      </div>
    </div>
  );
}
