// Console user→role assignments (CONSOLE_RUNTIME_SPEC §3, RBAC_COMPACT):
// per-operation, over the governance store. Role *definitions* come from the
// linked solution's config; *assignments* live in role_assignments. Admin-gated
// server-side. Plain form: pick an operation, add a user id + role checkboxes.

import { useEffect, useState } from 'react';
import type { OperationRow } from '@fluxus/client';
import { consoleClient } from '../../sdm-runtime/engine';

export function AssignmentsAdmin() {
  const [operations, setOperations] = useState<OperationRow[]>([]);
  const [operationId, setOperationId] = useState('');
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [assignments, setAssignments] = useState<{ userId: string; roleIds: string[] }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    consoleClient.listOperations().then((ops) => {
      setOperations(ops);
      if (ops.length > 0) setOperationId((cur) => cur || ops[0].id);
    }).catch((e) => setError(String(e)));
  }, []);

  async function loadFor(op: string) {
    if (!op) return;
    setError(null);
    try {
      const [r, a] = await Promise.all([consoleClient.operationRoles(op), consoleClient.listAssignments(op)]);
      setRoles(r);
      setAssignments(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { void loadFor(operationId); }, [operationId]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(roleId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(roleId) ? next.delete(roleId) : next.add(roleId);
      return next;
    });
  }

  function edit(a: { userId: string; roleIds: string[] }) {
    setUserId(a.userId);
    setPicked(new Set(a.roleIds));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim() || !operationId) return;
    setBusy(true);
    setError(null);
    try {
      await consoleClient.putAssignment(operationId, userId.trim(), [...picked]);
      setUserId(''); setPicked(new Set());
      await loadFor(operationId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2 className="admin-title">Role assignments</h2>
        <p className="admin-sub">Grant users roles in an operation. Roles are declared in the linked solution.</p>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <label className="admin-field" style={{ maxWidth: 320, marginBottom: 18 }}>
        <span>Operation</span>
        <select value={operationId} onChange={(e) => setOperationId(e.target.value)}>
          {operations.length === 0 && <option value="">No operations</option>}
          {operations.map((op) => <option key={op.id} value={op.id}>{op.name} ({op.id})</option>)}
        </select>
      </label>

      {roles.length === 0 ? (
        <p className="admin-muted">This operation's solution declares no roles yet — add an <code>access.roles</code> block to its config.</p>
      ) : (
        <>
          <div className="admin-section">
            {assignments.length === 0 ? (
              <p className="admin-muted">No assignments yet.</p>
            ) : (
              <table className="admin-table">
                <thead><tr><th>User id</th><th>Roles</th><th></th></tr></thead>
                <tbody>
                  {assignments.map((a) => (
                    <tr key={a.userId}>
                      <td className="admin-mono">{a.userId}</td>
                      <td>{a.roleIds.map(roleName).join(', ') || '—'}</td>
                      <td><button className="admin-link" onClick={() => edit(a)}>Edit</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <form className="admin-form" onSubmit={save}>
            <h3 className="admin-form-title">Assign roles</h3>
            <label className="admin-field">
              <span>User id</span>
              <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="auth user id" className="admin-mono" />
            </label>
            <div className="admin-checks">
              {roles.map((r) => (
                <label key={r.id} className="admin-check">
                  <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                  <span>{r.name} <span className="admin-muted admin-mono">{r.id}</span></span>
                </label>
              ))}
            </div>
            <button type="submit" className="admin-btn" disabled={busy || !userId.trim()}>
              {busy ? 'Saving…' : 'Save assignment'}
            </button>
            <p className="admin-hint">Saving with no roles checked clears the user's assignment.</p>
          </form>
        </>
      )}
    </div>
  );
}
