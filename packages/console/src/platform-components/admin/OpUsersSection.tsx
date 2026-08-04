// Operation → Users → Op users (USERS_UI_BRIEF §8): who may enter this
// operation at all. The middle layer — the org pool says a person exists, this
// says they get in, roles say what they see once inside. The three never merge,
// and this list and the Roles list below it stay two tables for that reason.
//
// Strict, with no adoption default: an operation with no op users admits
// nobody. An empty list is an answer, not a missing setup step.
//
// Two tiers reach this screen and they see different controls (brief §9):
// an op admin may add plain users to their own operation but may **never** mint
// an op admin, so that control renders for org admins only. An op admin also
// cannot read the org pool, so they type an address and the server checks it.

import { useEffect, useState } from 'react';
import type { OpUser, OrgUser } from '@fluxus/client';
import { consoleClient } from '../../sdm-runtime/engine';

export function OpUsersSection({ operationId }: { operationId: string }) {
  const [users, setUsers] = useState<OpUser[] | null>(null);
  const [orgAdmin, setOrgAdmin] = useState(false);
  /** The pool, for the org admin's picker. Never fetched for an op admin. */
  const [pool, setPool] = useState<OrgUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);

  async function load() {
    setError(null);
    try {
      const me = await consoleClient.me(operationId);
      setOrgAdmin(me.orgAdmin);
      const list = await consoleClient.listOpUsers(operationId);
      setUsers(list);
      setPool(me.orgAdmin ? await consoleClient.listOrgUsers() : []);
    } catch (e) {
      setUsers([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { void load(); }, [operationId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(email: string, fn: () => Promise<unknown>) {
    setBusyRow(email);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyRow(null);
    }
  }

  return (
    <div className="admin-section">
      <div className="admin-head-row">
        <div>
          <h3 className="admin-section-title">Op users</h3>
          <p className="admin-sub">
            Who may enter this operation at all — a separate question from what their roles let them see.
            Everyone here comes from the organisation's users.
          </p>
        </div>
        <button className="admin-btn" style={{ marginTop: 14 }} onClick={() => setDialog(true)}>Add user</button>
      </div>

      {error && <div className="admin-error" style={{ marginTop: 12 }}>{error}</div>}

      <div style={{ marginTop: 12 }}>
        {users === null ? (
          <p className="admin-muted">Loading…</p>
        ) : users.length === 0 ? (
          <p className="admin-muted">
            No users — so nobody can enter this operation, including whoever built it. Adding someone here
            is what opens it.
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr><th>Email</th>{orgAdmin && <th>Op admin</th>}<th /></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email}>
                  <td className="admin-mono">{u.email}</td>
                  {orgAdmin && (
                    <td>
                      {/* Org admins only: appointing an op admin is the org
                          tier's act, and offering an op admin a click the
                          server refuses would teach the wrong model. */}
                      <label className="admin-check">
                        <input
                          type="checkbox"
                          checked={u.level === 'admin'}
                          disabled={busyRow === u.email}
                          onChange={(e) => act(u.email, () =>
                            consoleClient.addOpUser(operationId, u.email, e.target.checked ? 'admin' : 'user'))}
                        />
                        <span className="admin-muted">{u.level === 'admin' ? 'admin' : 'user'}</span>
                      </label>
                    </td>
                  )}
                  <td>
                    <button
                      className="admin-link is-danger"
                      disabled={busyRow === u.email}
                      onClick={() => act(u.email, () => consoleClient.removeOpUser(operationId, u.email))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {dialog && (
        <AddOpUserDialog
          operationId={operationId}
          orgAdmin={orgAdmin}
          /* The pool minus who is already in — re-adding is a no-op that reads
             as a mistake. */
          candidates={pool.filter((p) => !(users ?? []).some((u) => u.email === p.email))}
          onClose={() => setDialog(false)}
          onDone={() => { setDialog(false); void load(); }}
        />
      )}
    </div>
  );
}

/** One control with two affordances, not two widgets: the question is always
 *  "which of the organisation's users", and only the tier's reach differs —
 *  an org admin picks from the pool they can read, an op admin names one. */
function AddOpUserDialog({ operationId, orgAdmin, candidates, onClose, onDone }: {
  operationId: string;
  orgAdmin: boolean;
  candidates: OrgUser[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState('');
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setFailed(null);
    try {
      await consoleClient.addOpUser(operationId, email.trim(), admin ? 'admin' : 'user');
      onDone();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="admin-modal-title">Add user to this operation</h3>
        <p className="admin-sub">
          They will be able to enter it. What they can see once inside is roles, below — someone with
          none enters and sees nothing.
        </p>
        {failed && <div className="admin-error" style={{ marginTop: 12 }}>{failed}</div>}
        <form className="admin-modal-form" onSubmit={submit}>
          {orgAdmin ? (
            <label className="admin-field">
              <span>User</span>
              <select value={email} onChange={(e) => setEmail(e.target.value)} autoFocus>
                <option value="">Choose a user…</option>
                {candidates.map((c) => (
                  <option key={c.email} value={c.email}>
                    {c.name ? `${c.name} — ${c.email}` : c.email}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="admin-field">
              <span>Email</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="person@example.com"
                className="admin-mono"
                autoFocus
              />
            </label>
          )}

          {orgAdmin ? (
            candidates.length === 0 && (
              <p className="admin-hint">
                Everyone in the organisation is already here. Invite someone new under Organisation → Users.
              </p>
            )
          ) : (
            <p className="admin-hint">
              They must already be one of the organisation's users. If they are not, an org admin has to
              invite them first.
            </p>
          )}

          {orgAdmin && (
            <label className="admin-check">
              <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
              <span>Make op admin</span>
            </label>
          )}
          {orgAdmin && (
            <p className="admin-hint">
              Op admins manage this operation's users, roles and menu. They cannot appoint other op admins.
            </p>
          )}

          <div className="admin-row admin-modal-actions">
            <button type="submit" className="admin-btn" disabled={busy || !email.trim()}>
              {busy ? 'Adding…' : 'Add user'}
            </button>
            <button type="button" className="admin-link" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
