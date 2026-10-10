// SDM Activities editor: the solution's activity pool (SolutionConfig.activities,
// APPS_AND_INSTANCES §1.6). Every activity is defined here once; workflows pick
// and order them (Workflows tab). An edit here changes every workflow that
// uses the activity, so each one says which those are.
//
// The editing is what the Workflows editor had while activities lived inside
// their workflow: id/name/description/record_map/show_condition, a lean
// attribute-usage composer — pick a pool attribute, toggle required, insert
// section headings, reorder — and hooks / `returns` as plain textareas. GET
// swaps the after hook for the `returns` expression (2026-08-10).
//
// An id is editable until the activity is saved. Renaming a saved one is
// deferred (APPS_AND_INSTANCES §1.8): history, page scripts and `invoke(...)`
// name activities by id.

import { useMemo, useState } from 'react';
import type {
  ActivityRawDef,
  AttributeUsageDef,
  SolutionConfig,
  SectionMarkerDef,
} from '@fluxus/engine';
import { readConfig, idProblems, refreshSolutionViews, saveActivities, useDirty, useLoadedConfig } from './useSolutionConfig';
import { InnerPanel, PanelItem } from '../shell/InnerPanel';

type UsageItem = AttributeUsageDef | SectionMarkerDef;
const isUsage = (it: UsageItem): it is AttributeUsageDef => 'attribute_ref' in it;

// GET is the read path (DSL_SPEC §5a): it answers with a `returns` expression
// instead of touching storage.
const RECORD_MAPS = ['', 'CREATE', 'UPDATE', 'DELETE', 'GET'] as const;

/** before_hook/after_hook and `returns` may be stored as joined lines; show as text. */
function hookText(h: string | string[] | null | undefined): string {
  return Array.isArray(h) ? h.join('\n') : (h ?? '');
}

/** Activity id → the workflows that list it, in config order. */
export function workflowsUsing(config: SolutionConfig): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const wf of config.workflows) {
    for (const usage of wf.activities) {
      out.set(usage.activity_ref, [...(out.get(usage.activity_ref) ?? []), wf.id]);
    }
  }
  return out;
}

export function ActivitiesEditor() {
  const loaded = useLoadedConfig();
  const [draft, setDraft] = useState<SolutionConfig>(() => readConfig());
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useDirty();
  const [armed, setArmed] = useState(false);

  const acts = draft.activities;
  const pool = draft.attributes;
  const act: ActivityRawDef | undefined = acts[sel];
  const usedBy = useMemo(() => workflowsUsing(draft), [draft]);
  const saved = useMemo(() => new Set(loaded.activities.map((a) => a.id)), [loaded]);
  const users = act ? usedBy.get(act.id) ?? [] : [];

  function setActs(next: ActivityRawDef[]) {
    setDraft((d) => ({ ...d, activities: next }));
    setDirty(true);
  }
  function editAct(patch: Partial<ActivityRawDef>) {
    setActs(acts.map((a, i) => (i === sel ? { ...a, ...patch } : a)));
  }
  function select(i: number) {
    setSel(i);
    setArmed(false);
  }
  /**
   * Changing the record map moves the fields that are legal with it, so the
   * draft doesn't carry a combination `validateConfig` will reject on save: a
   * GET needs `returns` and cannot have an after hook, and `returns` belongs to
   * nothing else.
   */
  function setRecordMap(value: string) {
    const record_map = (value || undefined) as ActivityRawDef['record_map'];
    editAct(
      record_map === 'GET'
        ? { record_map, after_hook: null }
        : { record_map, returns: undefined },
    );
  }
  function addAct() {
    setActs([...acts, { id: 'act_', name: '', description: '', attributes: [], before_hook: null, after_hook: null }]);
    select(acts.length);
  }
  function removeAct() {
    setActs(acts.filter((_, i) => i !== sel));
    setSel((s) => Math.max(0, s > sel ? s - 1 : s));
    setArmed(false);
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

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveActivities(loaded.activities, draft.activities);
      setDirty(false);
      await refreshSolutionViews();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const idErr = idProblems(acts.map((a) => a.id));

  return (
    <>
      <InnerPanel title="Activities" actions={<button className="panel-btn" onClick={addAct}>New</button>}>
        {acts.length === 0 && <p className="panel-empty">None yet — New adds one.</p>}
        {acts.map((a, i) => (
          <PanelItem key={i} name={a.name || '(unnamed)'} sub={a.id || '(new)'} active={i === sel} onClick={() => select(i)} />
        ))}
      </InnerPanel>

      <div className="admin-panel">
        <div className="admin-panel-head">
          <h2 className="admin-title">Activities</h2>
          <p className="admin-sub">The solution's activities, each defined once. Workflows pick the ones they use; an edit here changes every workflow that uses it.</p>
        </div>

        {error && <div className="admin-error">{error}</div>}
        {idErr && <div className="admin-error">Activities — {idErr}</div>}

        {act && (
          <div className="sdm-detail">
            <p className="admin-muted">
              {users.length === 0
                ? 'No workflow uses this activity yet, so it cannot run.'
                : `Used by ${users.join(', ')}.`}
            </p>
            <label className="admin-field"><span>Id</span>
              <input className="admin-mono" value={act.id} readOnly={saved.has(act.id)} onChange={(e) => editAct({ id: e.target.value })} placeholder="act_create_assets" /></label>
            <label className="admin-field"><span>Name</span>
              <input value={act.name} onChange={(e) => editAct({ name: e.target.value })} placeholder="Create asset" /></label>
            <label className="admin-field"><span>Description</span>
              <input value={act.description} onChange={(e) => editAct({ description: e.target.value })} /></label>
            <label className="admin-field"><span>Record map</span>
              <select value={act.record_map ?? ''} onChange={(e) => setRecordMap(e.target.value)}>
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
                <button className="admin-btn admin-btn-ghost" onClick={() => setItems([...items, { attribute_ref: pool[0]?.key ?? '' }])} disabled={pool.length === 0}>+ Attribute</button>
                <button className="admin-btn admin-btn-ghost" onClick={() => setItems([...items, { section: '' }])}>+ Section</button>
              </div>
              {pool.length === 0 && <p className="admin-muted">Define pool attributes first (Attributes tab).</p>}
            </div>

            {/* A GET's `returns` IS the activity — the query an app names
                instead of carrying it in the page. Its attributes above are
                its parameters. */}
            {act.record_map === 'GET' && (
              <label className="admin-field"><span>Returns (FluxScript expression — what it answers with)</span>
                <textarea className="sdm-code" value={hookText(act.returns)} onChange={(e) => editAct({ returns: e.target.value || undefined })}
                  placeholder="records.work_orders.where(status = attributes.status).select(id, location, status)" /></label>
            )}

            <label className="admin-field"><span>Before hook (FluxScript — validate)</span>
              <textarea className="sdm-code" value={hookText(act.before_hook)} onChange={(e) => editAct({ before_hook: e.target.value || null })} /></label>
            {act.record_map === 'GET' ? (
              <p className="admin-muted">A GET has no after hook — nothing persists, so there is nothing to react to.</p>
            ) : (
              <label className="admin-field"><span>After hook (FluxScript — effects)</span>
                <textarea className="sdm-code" value={hookText(act.after_hook)} onChange={(e) => editAct({ after_hook: e.target.value || null })} /></label>
            )}

            {/* Refused while any workflow lists it — the server would refuse the
                save anyway, and naming the workflows here says what to do. */}
            {users.length > 0 ? (
              <p className="admin-muted">To delete it, remove it from {users.join(', ')} first (Workflows tab).</p>
            ) : (
              <button className="admin-btn admin-btn-ghost" onClick={() => (armed ? removeAct() : setArmed(true))}>
                {armed ? 'Really delete?' : 'Delete activity'}</button>
            )}
          </div>
        )}

        <div className="admin-actions">
          <button className="admin-btn" onClick={save} disabled={busy || !dirty || !!idErr}>{busy ? 'Saving…' : 'Save activities'}</button>
        </div>
      </div>
    </>
  );
}
