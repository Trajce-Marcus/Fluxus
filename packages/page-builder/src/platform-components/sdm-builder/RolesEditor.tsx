// SDM Roles editor (CONSOLE_RUNTIME_SPEC §1, RBAC_COMPACT): edits the
// solution's `access.roles` — the role defs pages/record-types reference and
// operations assign. Plain list; id `role_<plural>`, display name plural.

import { useState } from 'react';
import type { ConfigRaw, RoleDef } from '@fluxus/engine';
import { readConfig, commitConfig } from './useSolutionConfig';

export function RolesEditor() {
  const [draft, setDraft] = useState<ConfigRaw>(() => readConfig());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const roles: RoleDef[] = draft.access?.roles ?? [];

  function setRoles(next: RoleDef[]) {
    setDraft((d) => ({ ...d, access: { ...d.access, roles: next } }));
    setDirty(true);
  }

  function edit(i: number, patch: Partial<RoleDef>) {
    setRoles(roles.map((r, j) => (j === i ? { ...r, ...patch } : r)));
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
        <h2 className="admin-title">Roles</h2>
        <p className="admin-sub">Role defs for this solution — pages and record types reference them; operations assign them.</p>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <div className="admin-section">
        {roles.length === 0 ? (
          <p className="admin-muted">No roles yet — add one below.</p>
        ) : (
          <table className="admin-table">
            <thead><tr><th>Id</th><th>Name</th><th /></tr></thead>
            <tbody>
              {roles.map((r, i) => (
                <tr key={i}>
                  <td><input className="admin-mono" value={r.id} onChange={(e) => edit(i, { id: e.target.value })} /></td>
                  <td><input value={r.name} onChange={(e) => edit(i, { name: e.target.value })} /></td>
                  <td><button className="admin-btn admin-btn-ghost" onClick={() => setRoles(roles.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button className="admin-btn admin-btn-ghost" onClick={() => setRoles([...roles, { id: 'role_', name: '' }])}>+ Add role</button>
      </div>

      <div className="admin-actions">
        <button className="admin-btn" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save roles'}</button>
      </div>
    </div>
  );
}
