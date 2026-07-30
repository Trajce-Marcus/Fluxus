// SDM Roles editor (CONSOLE_RUNTIME_SPEC §1, RBAC_COMPACT): edits the
// solution's `access.roles` — the role defs pages/record-types reference and
// operations assign. Plain list; id `role_<plural>`, display name plural.

import { useState } from 'react';
import type { ConfigRaw, RoleDef } from '@fluxus/engine';
import { readConfig, commitConfig, idProblems, useDirty } from './useSolutionConfig';
import { InnerPanel, PanelItem } from '../shell/InnerPanel';

export function RolesEditor() {
  const [draft, setDraft] = useState<ConfigRaw>(() => readConfig());
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useDirty();

  const roles: RoleDef[] = draft.access?.roles ?? [];
  const idErr = idProblems(roles.map((r) => r.id));

  function setRoles(next: RoleDef[]) {
    setDraft((d) => ({ ...d, access: { ...d.access, roles: next } }));
    setDirty(true);
  }

  function edit(i: number, patch: Partial<RoleDef>) {
    setRoles(roles.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function add() {
    setRoles([...roles, { id: 'role_', name: '' }]);
    setSel(roles.length);
  }

  function remove(i: number) {
    setRoles(roles.filter((_, j) => j !== i));
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

  const cur: RoleDef | undefined = roles[sel];

  return (
    <>
      <InnerPanel title="Roles" actions={<button className="panel-btn" onClick={add}>New</button>}>
        {roles.length === 0 && <p className="panel-empty">None yet — New adds one.</p>}
        {roles.map((r, i) => (
          <PanelItem key={i} name={r.name || '(unnamed)'} sub={r.id || '(new)'} active={i === sel} onClick={() => setSel(i)} />
        ))}
      </InnerPanel>

      <div className="admin-panel">
        <div className="admin-panel-head">
          <h2 className="admin-title">Roles</h2>
          <p className="admin-sub">Role defs for this solution — pages and record types reference them; operations assign them.</p>
        </div>

        {error && <div className="admin-error">{error}</div>}
        {idErr && <div className="admin-error">{idErr}</div>}

        {cur ? (
          <div className="sdm-detail">
            <label className="admin-field"><span>Id</span>
              <input className="admin-mono" value={cur.id} onChange={(e) => edit(sel, { id: e.target.value })} placeholder="role_dispatchers" /></label>
            <label className="admin-field"><span>Name</span>
              <input value={cur.name} onChange={(e) => edit(sel, { name: e.target.value })} placeholder="Dispatchers" /></label>
            <button className="admin-btn admin-btn-ghost" onClick={() => remove(sel)}>Remove role</button>
          </div>
        ) : (
          <p className="admin-muted">No roles yet — New adds one.</p>
        )}

        <div className="admin-actions">
          <button className="admin-btn" onClick={save} disabled={busy || !dirty || !!idErr}>{busy ? 'Saving…' : 'Save roles'}</button>
        </div>
      </div>
    </>
  );
}
