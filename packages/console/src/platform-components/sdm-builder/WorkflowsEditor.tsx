// SDM Workflows editor: the solution's workflows (SolutionConfig.workflows). A
// record type binds one workflow; a workflow is a named, ordered list of
// activities from the solution's pool (APPS_AND_INSTANCES §1.6).
//
// Here an author picks and orders: add an existing pool activity, remove one
// from the workflow (it stays in the pool), reorder. Activities themselves are
// edited in the Activities tab. "New activity" is the shortcut that creates one
// in the pool and adds it here in one step; its details are then filled in
// there.

import { useMemo, useState } from 'react';
import type { SolutionConfig, WorkflowRawDef } from '@fluxus/engine';
import { readConfig, idProblems, refreshSolutionViews, saveActivities, saveWorkflows, useDirty, useLoadedConfig } from './useSolutionConfig';
import { InnerPanel, PanelItem } from '../shell/InnerPanel';
import { initialSelection, useItemGuard } from './useItemGuard';

export function WorkflowsEditor() {
  const loaded = useLoadedConfig();
  const [draft, setDraft] = useState<SolutionConfig>(() => readConfig());
  const [selWf, setSelWf] = useState(() => initialSelection('workflows', draft.workflows, (w) => w.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useDirty();
  const [armed, setArmed] = useState(false);
  const [pick, setPick] = useState('');

  const wfs = draft.workflows;
  const wf: WorkflowRawDef | undefined = wfs[selWf];
  const refs = wf?.activities ?? [];
  const byId = useMemo(() => new Map(draft.activities.map((a) => [a.id, a])), [draft]);
  const savedActivities = useMemo(() => new Set(loaded.activities.map((a) => a.id)), [loaded]);
  const listed = new Set(refs.map((r) => r.activity_ref));
  const addable = draft.activities.filter((a) => !listed.has(a.id));

  function setWfs(next: WorkflowRawDef[]) {
    setDraft((d) => ({ ...d, workflows: next }));
    setDirty(true);
  }
  function editWf(patch: Partial<WorkflowRawDef>) {
    setWfs(wfs.map((w, i) => (i === selWf ? { ...w, ...patch } : w)));
  }
  /** `discarded`: the draft was just reset, so build on what is stored. */
  function addWf(discarded = false) {
    const base = discarded ? loaded.workflows : wfs;
    setWfs([...base, { id: 'wf_', name: '', description: '', activities: [] }]);
    selectWf(base.length);
  }
  function selectWf(i: number) {
    setSelWf(i);
    setArmed(false);
    setPick('');
  }
  function removeWf() {
    setWfs(wfs.filter((_, i) => i !== selWf));
    setSelWf((s) => Math.max(0, s > selWf ? s - 1 : s));
    setArmed(false);
  }

  function setRefs(next: WorkflowRawDef['activities']) {
    editWf({ activities: next });
  }
  function moveRef(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= refs.length) return;
    const next = [...refs];
    [next[i], next[j]] = [next[j], next[i]];
    setRefs(next);
  }
  function addExisting() {
    const id = pick || addable[0]?.id;
    if (!id) return;
    setRefs([...refs, { activity_ref: id }]);
    setPick('');
  }
  /** The shortcut: a new pool activity, listed here at once. Its id and name
   *  are set here; everything else in the Activities tab. */
  function addNew() {
    let n = 1;
    while (byId.has(`act_new_${n}`)) n++;
    const id = `act_new_${n}`;
    setDraft((d) => ({
      ...d,
      activities: [...d.activities, { id, name: '', description: '', attributes: [], before_hook: null, after_hook: null }],
      workflows: d.workflows.map((w, i) => (i === selWf ? { ...w, activities: [...w.activities, { activity_ref: id }] } : w)),
    }));
    setDirty(true);
  }
  /** A new (unsaved) activity can still be renamed — id and reference together. */
  function renameNew(oldId: string, patch: { id?: string; name?: string }) {
    setDraft((d) => ({
      ...d,
      activities: d.activities.map((a) => (a.id === oldId ? { ...a, ...patch } : a)),
      workflows: patch.id === undefined
        ? d.workflows
        : d.workflows.map((w) => ({
            ...w,
            activities: w.activities.map((r) => (r.activity_ref === oldId ? { activity_ref: patch.id! } : r)),
          })),
    }));
    setDirty(true);
  }

  async function save(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      // New pool activities before the workflows that list them; nothing is
      // deleted from the pool here — removing one from a workflow leaves it
      // there (§1.6, save order).
      const added = draft.activities.filter((a) => !savedActivities.has(a.id));
      await saveActivities(loaded.activities, [...loaded.activities, ...added]);
      await saveWorkflows(loaded.workflows, draft.workflows);
      setDirty(false);
      await refreshSolutionViews();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const wfIdErr = idProblems(wfs.map((w) => w.id));
  const newIdErr = idProblems(draft.activities.map((a) => a.id));
  const idErr = [wfIdErr && `Workflows — ${wfIdErr}`, newIdErr && `Activities — ${newIdErr}`].filter(Boolean).join(' · ');

  // One workflow at a time: moving off one with unsaved changes asks first.
  // (A new activity made with the shortcut saves with its workflow.)
  const { guard, prompt } = useItemGuard('workflows', {
    dirty,
    canSave: !idErr,
    save,
    discard: () => {
      setDraft(structuredClone(loaded));
      setDirty(false);
      setArmed(false);
      setPick('');
    },
  });
  function requestSelect(i: number) {
    if (i === selWf) return;
    const id = wfs[i].id;
    guard(id, (discarded) => selectWf(discarded ? Math.max(0, loaded.workflows.findIndex((w) => w.id === id)) : i));
  }

  return (
    <>
      {prompt}
      <InnerPanel title="Workflows" actions={<button className="panel-btn" onClick={() => guard(null, addWf)}>New</button>}>
        {wfs.length === 0 && <p className="panel-empty">None yet — New adds one.</p>}
        {wfs.map((w, i) => (
          <PanelItem key={i} name={w.name || '(unnamed)'} sub={w.id || '(new)'} active={i === selWf} onClick={() => requestSelect(i)} />
        ))}
      </InnerPanel>

      <div className="admin-panel">
        <div className="admin-panel-head">
          <h2 className="admin-title">Workflows</h2>
          <p className="admin-sub">A workflow lists, in order, the activities that can happen to a record type's records. Record types bind one workflow each; activities are defined in the Activities tab.</p>
        </div>

        {error && <div className="admin-error">{error}</div>}
        {idErr && <div className="admin-error">{idErr}</div>}

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
              {refs.length === 0 && <p className="admin-muted">None yet.</p>}
              {refs.map((r, i) => {
                const act = byId.get(r.activity_ref);
                const isNew = !savedActivities.has(r.activity_ref);
                return (
                  <div key={r.activity_ref} className="sdm-usage-row">
                    <div className="sdm-usage-move">
                      <button onClick={() => moveRef(i, -1)} disabled={i === 0}>▲</button>
                      <button onClick={() => moveRef(i, 1)} disabled={i === refs.length - 1}>▼</button>
                    </div>
                    {isNew && act ? (
                      <>
                        <input type="text" className="admin-mono" value={act.id} onChange={(e) => renameNew(act.id, { id: e.target.value })} placeholder="act_create_assets" />
                        <input type="text" value={act.name} onChange={(e) => renameNew(act.id, { name: e.target.value })} placeholder="Name" />
                      </>
                    ) : (
                      <span className="sdm-ref">
                        <span className="admin-mono">{r.activity_ref}</span>
                        <span className="sdm-list-sub">{act ? `${act.name}${act.record_map ? ` · ${act.record_map}` : ''}` : 'not in the pool'}</span>
                      </span>
                    )}
                    <button className="admin-btn admin-btn-ghost" title="Remove from this workflow — it stays in the pool" onClick={() => setRefs(refs.filter((_, j) => j !== i))}>✕</button>
                  </div>
                );
              })}
              <div className="sdm-usage-row">
                <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={addable.length === 0}>
                  {addable.length === 0 && <option value="">Every pool activity is listed</option>}
                  {addable.map((a) => <option key={a.id} value={a.id}>{a.id}{a.name ? ` — ${a.name}` : ''}</option>)}
                </select>
                <button className="admin-btn admin-btn-ghost" onClick={addExisting} disabled={addable.length === 0}>+ Add</button>
                <button className="admin-btn admin-btn-ghost" onClick={addNew}>+ New activity</button>
              </div>
            </div>

            <button className="admin-btn admin-btn-ghost" onClick={() => (armed ? removeWf() : setArmed(true))}>
              {armed ? 'Really delete?' : 'Delete workflow'}</button>
          </div>
        )}

        <div className="admin-actions">
          <button className="admin-btn" onClick={save} disabled={busy || !dirty || !!idErr}>{busy ? 'Saving…' : 'Save workflows'}</button>
        </div>
      </div>
    </>
  );
}
