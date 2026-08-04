// Organisation → Users (USERS_UI_BRIEF §7): the org pool — who exists to this
// organisation at all. The first of the three layers; being here admits you to
// nothing on its own, which is why this screen grants no access to anything.
//
// A plain list in the main area — no inner panel (ruled 2026-08-04) — with
// every data entry in a dialog over it (ruled 2026-08-04): the underlying
// content stays visible and the screen stays a list, not a form.
//
// Org-admin gated server-side on every call; `me().orgAdmin` here decides only
// what to RENDER. Invited users who have never signed in are the expected case,
// not a degraded one — email is the key and the auth id binds on first sign-in.

import { useEffect, useState } from 'react';
import type { AdminLevel, OrgUser } from '@fluxus/client';
import { consoleClient } from '../../sdm-runtime/engine';

const STATUS_COPY: Record<OrgUser['status'], string> = {
  invited: 'Invited, never signed in',
  active: 'Has signed in',
  suspended: 'Locked out everywhere; grants survive',
};

export function OrgUsersSection() {
  const [users, setUsers] = useState<OrgUser[] | null>(null);
  const [orgAdmin, setOrgAdmin] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Email whose row is mid-call — one row's action disables that row only. */
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const [invite, setInvite] = useState(false);
  const [confirm, setConfirm] = useState<OrgUser | null>(null);

  async function load() {
    setError(null);
    try {
      const me = await consoleClient.me();
      setOrgAdmin(me.orgAdmin);
      // Non-admins are shown the explanation, not an empty table: the list call
      // would be refused, and a refusal is not what "no users" looks like.
      setUsers(me.orgAdmin ? await consoleClient.listOrgUsers() : []);
    } catch (e) {
      setOrgAdmin(false);
      setUsers([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { void load(); }, []);

  /** Run a mutation for one row, then refetch — the server owns the truth here
   *  (a level change can bounce off the tier rules), so nothing is optimistic. */
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

  function setLevel(u: OrgUser, level: AdminLevel) {
    void act(u.email, () => consoleClient.setOrgUserLevel(u.email, level));
  }

  /** Suspension is reversible, so reinstating has to restore the state they
   *  were in — someone who never signed in goes back to *invited*, not to
   *  *active*, which would claim a sign-in that never happened. */
  function suspend(u: OrgUser) {
    const next = u.status === 'suspended' ? (u.authUserId ? 'active' : 'invited') : 'suspended';
    void act(u.email, () => consoleClient.setOrgUserStatus(u.email, next));
  }

  function remove(u: OrgUser) {
    void act(u.email, async () => {
      await consoleClient.removeOrgUser(u.email);
      setConfirm(null);
    });
  }

  return (
    <>
      <div className="admin-panel">
        <div className="admin-panel-head admin-head-row">
          <div>
            <h2 className="admin-title">Users</h2>
            <p className="admin-sub">
              Everyone this organisation knows. Entry is by invitation — there is no signup — and being
              here admits nobody to anything: an operation's own user list is what lets someone in.
            </p>
          </div>
          {orgAdmin && <button className="admin-btn" onClick={() => setInvite(true)}>Invite user</button>}
        </div>

        {error && <div className="admin-error">{error}</div>}

        <div className="admin-section">
          {users === null ? (
            <p className="admin-muted">Loading…</p>
          ) : orgAdmin === false ? (
            <p className="admin-muted">
              Only org admins manage users. Ask one of yours to invite someone or change what a user may do.
            </p>
          ) : users.length === 0 ? (
            <p className="admin-muted">
              Nobody has been invited yet. Until someone is, this organisation has no users to add to an
              operation — <strong>Invite user</strong> is where that starts.
            </p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr><th>Email</th><th>Name</th><th>Status</th><th>Org admin</th><th /></tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.email}>
                    <td className="admin-mono">{u.email}</td>
                    <td>{u.name ?? <span className="admin-muted">—</span>}</td>
                    <td>
                      <span className={`admin-chip is-${u.status}`} title={STATUS_COPY[u.status]}>{u.status}</span>
                    </td>
                    <td>
                      {/* The one control that hands out authority. It is the org
                          tier's alone: no other tier may appoint its own. */}
                      <label className="admin-check">
                        <input
                          type="checkbox"
                          checked={u.level === 'admin'}
                          disabled={busyRow === u.email}
                          onChange={(e) => setLevel(u, e.target.checked ? 'admin' : 'user')}
                        />
                        <span className="admin-muted">{u.level === 'admin' ? 'admin' : 'user'}</span>
                      </label>
                    </td>
                    <td>
                      <div className="admin-row">
                        <button className="admin-link" disabled={busyRow === u.email} onClick={() => suspend(u)}>
                          {u.status === 'suspended' ? 'Reinstate' : 'Suspend'}
                        </button>
                        <button className="admin-link is-danger" disabled={busyRow === u.email} onClick={() => setConfirm(u)}>
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {invite && (
        <InviteDialog
          onClose={() => setInvite(false)}
          onDone={() => { setInvite(false); void load(); }}
          onError={setError}
        />
      )}

      {confirm && (
        <div className="admin-overlay" onClick={() => setConfirm(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-title">Remove {confirm.email}</h3>
            <p className="admin-sub">
              This deletes them from the organisation, from every operation they were added to, and from
              every solution they could build. It cannot be undone, and re-inviting them starts over with
              nothing. To stop them signing in while keeping all of that, <strong>Suspend</strong> instead.
            </p>
            <div className="admin-row admin-modal-actions">
              <button className="admin-btn is-danger" disabled={busyRow === confirm.email} onClick={() => remove(confirm)}>
                {busyRow === confirm.email ? 'Removing…' : 'Remove user'}
              </button>
              <button className="admin-link" onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Invite: the only way into the pool. Its own component so the fields reset
 *  with the dialog rather than outliving it. */
function InviteDialog({ onClose, onDone, onError }: {
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setFailed(null);
    try {
      await consoleClient.inviteOrgUser({
        email: email.trim(),
        name: name.trim() || null,
        level: admin ? 'admin' : 'user',
      });
      onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Shown in the dialog, where the input that caused it still is; the panel
      // band would sit behind the overlay.
      setFailed(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="admin-modal-title">Invite user</h3>
        <p className="admin-sub">
          They join the organisation and nothing more — add them to an operation to let them in anywhere.
          The invitation is by email address, and it works before they have an account: signing in binds it.
        </p>
        {failed && <div className="admin-error" style={{ marginTop: 12 }}>{failed}</div>}
        <form className="admin-modal-form" onSubmit={submit}>
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
          <label className="admin-field">
            <span>Name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam Rivera" />
          </label>
          <label className="admin-check">
            <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
            <span>Make org admin</span>
          </label>
          <p className="admin-hint">
            Org admins invite and remove users, appoint other admins, and create solutions and operations.
          </p>
          <div className="admin-row admin-modal-actions">
            <button type="submit" className="admin-btn" disabled={busy || !email.trim()}>
              {busy ? 'Inviting…' : 'Send invitation'}
            </button>
            <button type="button" className="admin-link" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// New shared `admin-*` classes (2026-08-04), all additive:
//   .admin-row      — a row of controls. Already used by SolutionsAdmin and
//                     SolutionSettingsSection, which were relying on a rule
//                     that was never written.
//   .admin-chip     — the status word as a chip. Status is the one value here
//                     that is scanned rather than read.
//   .is-danger      — destructive variant of .admin-btn / .admin-link. Reuses
//                     the .admin-error reds; no new palette (brief §5).
export const css = `
  .admin-row { display: flex; align-items: center; gap: 12px; }

  .admin-chip {
    display: inline-block;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 1px 8px;
    font-size: 0.72rem;
    color: var(--color-text-muted);
    text-transform: lowercase;
  }
  .admin-chip.is-active { color: var(--color-text); }
  .admin-chip.is-suspended { border-color: #7a2a2a; background: #5a1d1d; color: #f4d0d0; }

  .admin-btn.is-danger { background: #7a2a2a; }
  .admin-link.is-danger { color: #e08585; }
  .admin-link:disabled { opacity: 0.5; cursor: default; }
`;
