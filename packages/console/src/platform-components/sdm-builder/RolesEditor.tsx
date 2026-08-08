// SDM Roles editor (CONSOLE_RUNTIME_SPEC §1, RBAC_COMPACT): edits the
// solution's `access.roles` — the role defs pages/record-types reference and
// operations assign. Id `role_<plural>`, display name plural.
//
// A table in the main area, like Solutions (2026-08-01): no inner panel, one
// row per role with Edit and Delete, and create/edit in a modal. The id is
// generated from the name when the role is created and is read-only after
// that: assignments, menu items and page access lists all store the id, so a
// rename must not change it.

import { useState } from 'react';
import type { SolutionConfig, RoleDef } from '@fluxus/engine';
import { readConfig, idProblems, refreshSolutionViews, saveRoles, useDirty, useLoadedConfig } from './useSolutionConfig';

/** `role_dispatchers` from "Dispatchers" — the §1 id convention. */
function roleId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug ? `role_${slug}` : '';
}

interface Draft {
  /** The role being edited, or null when the modal is creating a new one. */
  original: RoleDef | null;
  id: string;
  name: string;
  description: string;
}

export function RolesEditor() {
  const loaded = useLoadedConfig();
  const [draft, setDraft] = useState<SolutionConfig>(() => readConfig());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useDirty();

  const [dialog, setDialog] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RoleDef | null>(null);

  const roles: RoleDef[] = draft.access?.roles ?? [];
  const idErr = idProblems(roles.map((r) => r.id));

  function setRoles(next: RoleDef[]) {
    setDraft((d) => ({ ...d, access: { ...d.access, roles: next } }));
    setDirty(true);
  }

  function openNew() {
    setDialog({ original: null, id: '', name: '', description: '' });
  }

  function openEdit(role: RoleDef) {
    setDialog({ original: role, id: role.id, name: role.name, description: role.description ?? '' });
  }

  function commitDialog() {
    if (!dialog) return;
    const name = dialog.name.trim();
    const id = (dialog.original ? dialog.id : dialog.id.trim() || roleId(name)).trim();
    if (!name || !id) return;
    const next: RoleDef = { id, name, ...(dialog.description.trim() ? { description: dialog.description.trim() } : {}) };
    setRoles(dialog.original
      ? roles.map((r) => (r.id === dialog.original!.id ? next : r))
      : [...roles, next]);
    setDialog(null);
  }

  function remove(role: RoleDef) {
    setRoles(roles.filter((r) => r.id !== role.id));
    setConfirmDelete(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveRoles(loaded.access?.roles ?? [], roles);
      setDirty(false);
      await refreshSolutionViews();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Creating: the id follows the name until the user types one.
  const dialogId = dialog && !dialog.original && !dialog.id ? roleId(dialog.name) : dialog?.id ?? '';
  const duplicateId = !!dialog && !dialog.original && roles.some((r) => r.id === dialogId);

  return (
    <div className="admin-panel">
      <div className="admin-head-row">
        <div className="admin-panel-head">
          <h2 className="admin-title">Roles</h2>
          <p className="admin-sub">
            Role definitions for this solution — pages and menu items reference them; operations assign them to users.
          </p>
        </div>
        <button className="admin-btn" onClick={openNew}>New role</button>
      </div>

      {error && <div className="admin-error">{error}</div>}
      {idErr && <div className="admin-error">{idErr}</div>}

      {roles.length === 0 ? (
        <p className="admin-muted">No roles yet. Without roles, record types and pages are open to everyone.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr><th>Name</th><th>Id</th><th>Description</th><th></th></tr>
          </thead>
          <tbody>
            {roles.map((r) => (
              <tr key={r.id}>
                <td>{r.name || '(unnamed)'}</td>
                <td className="admin-mono">{r.id}</td>
                <td className="admin-muted">{r.description ?? '—'}</td>
                <td className="admin-row-actions">
                  <button className="admin-link" onClick={() => openEdit(r)}>Edit</button>
                  <button className="admin-link" onClick={() => setConfirmDelete(r)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="admin-actions">
        <button className="admin-btn" onClick={save} disabled={busy || !dirty || !!idErr}>
          {busy ? 'Saving…' : 'Save roles'}
        </button>
      </div>

      {dialog && (
        <div className="admin-overlay" onClick={() => setDialog(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-title">{dialog.original ? 'Edit role' : 'New role'}</h3>
            <p className="admin-sub">
              {dialog.original
                ? 'The id is permanent — assignments, menu items and page access lists are stored against it.'
                : 'The id is generated from the name and cannot be changed afterwards.'}
            </p>
            <div className="admin-modal-form">
              <label className="admin-field">
                <span>Name</span>
                <input
                  value={dialog.name}
                  onChange={(e) => setDialog({ ...dialog, name: e.target.value })}
                  placeholder="Dispatchers"
                  autoFocus
                />
              </label>
              <label className="admin-field">
                <span>Id</span>
                <input
                  className="admin-mono"
                  value={dialogId}
                  onChange={(e) => setDialog({ ...dialog, id: e.target.value })}
                  placeholder="role_dispatchers"
                  disabled={!!dialog.original}
                />
              </label>
              <label className="admin-field">
                <span>Description</span>
                <input
                  value={dialog.description}
                  onChange={(e) => setDialog({ ...dialog, description: e.target.value })}
                  placeholder="Schedules work and assigns crews"
                />
              </label>
              {duplicateId && <p className="admin-hint">A role with this id already exists.</p>}
              <div className="admin-row admin-modal-actions">
                <button
                  className="admin-btn"
                  onClick={commitDialog}
                  disabled={!dialog.name.trim() || !dialogId || duplicateId}
                >
                  {dialog.original ? 'Save role' : 'Add role'}
                </button>
                <button className="admin-link" onClick={() => setDialog(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="admin-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-title">Delete {confirmDelete.name || confirmDelete.id}</h3>
            <p className="admin-sub">
              Menu items and page access lists naming <span className="admin-mono">{confirmDelete.id}</span> become
              invalid, and users holding it in any operation lose it. Takes effect when you save.
            </p>
            <div className="admin-row admin-modal-actions">
              <button className="danger-btn" onClick={() => remove(confirmDelete)}>Delete role</button>
              <button className="admin-link" onClick={() => setConfirmDelete(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const css = `
  .admin-row-actions { display: flex; gap: 12px; justify-content: flex-end; white-space: nowrap; }
`;
