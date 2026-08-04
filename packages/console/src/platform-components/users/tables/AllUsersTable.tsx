// Organisation → Users → **All users**: everyone the organisation knows.
//
// Lifecycle only. There is no admin column and no appointment control here —
// this list answers "does this person exist to us" and no other question, so
// what someone may do is read in the tab that governs it. Suspend and expire are
// the two acts that are genuinely about the person rather than about a grant.
//
// **Nobody is ever deleted.** Record history names its author by auth id, and a
// person's row is the only thing that can turn that id back into a name, so
// expiry — grants dropped, row kept — is the terminal state. There is no other.

import { useState } from 'react';
import type { User } from '@fluxus/client';
import { consoleClient } from '../../../sdm-runtime/engine';
import { Dialog } from '../dialogs/Dialog';
import { EmptyList, ListHead, StatusPill } from '../shared/UserTabs';

const STATUS_COPY: Record<User['status'], string> = {
  invited: 'Invited, never signed in',
  active: 'Has signed in',
  suspended: 'Paused everywhere; every grant survives',
  expired: 'Relationship ended; grants dropped, the person kept',
};

/** Dates are for reading, not sorting — the day is what an admin wants. */
function formatDate(value: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

export function AllUsersTable({ users, busyRow, act, onInvite }: {
  users: User[];
  busyRow: string | null;
  act: (email: string, fn: () => Promise<unknown>) => Promise<void>;
  onInvite: () => void;
}) {
  const [confirm, setConfirm] = useState<User | null>(null);

  /** Suspension is reversible, so reinstating restores the state they were in:
   *  someone who never signed in goes back to *invited*, not to *active*, which
   *  would claim a sign-in that never happened. */
  function suspend(u: User) {
    const next = u.status === 'suspended' ? (u.authUserId ? 'active' : 'invited') : 'suspended';
    void act(u.email, () => consoleClient.setUserStatus(u.email, next));
  }

  return (
    <>
      <ListHead
        title="All users"
        sub="Everyone this organisation knows. Entry is by invitation — there is no signup — and being here
             admits nobody to anything on its own."
        action={<button className="admin-btn" onClick={onInvite}>Invite user</button>}
      />

      {users.length === 0 ? (
        <EmptyList>
          Nobody has been invited yet. Until someone is, there is nobody to add to an operation or appoint
          to anything — <strong>Invite user</strong> is where that starts.
        </EmptyList>
      ) : (
        <table className="admin-table">
          <thead>
            <tr><th>Email</th><th>Name</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email} className={u.status === 'expired' ? 'users-row-expired' : undefined}>
                <td className="admin-mono">{u.email}</td>
                <td>{u.name ?? <span className="admin-muted">—</span>}</td>
                <td>
                  <StatusPill status={u.status} title={STATUS_COPY[u.status]} />
                  {u.status === 'expired' && u.expiredAt && (
                    <span className="admin-muted users-since"> {formatDate(u.expiredAt)}</span>
                  )}
                </td>
                <td>
                  <div className="admin-row">
                    {u.status === 'expired' ? (
                      // Back as a plain member: expiry dropped every grant and
                      // kept nothing to restore, so this is not an "undo".
                      <button
                        className="admin-link"
                        disabled={busyRow === u.email}
                        onClick={() => void act(u.email, () => consoleClient.unexpireUser(u.email))}
                      >
                        Unexpire
                      </button>
                    ) : (
                      <>
                        <button className="admin-link" disabled={busyRow === u.email} onClick={() => suspend(u)}>
                          {u.status === 'suspended' ? 'Reinstate' : 'Suspend'}
                        </button>
                        <button className="admin-link is-danger" disabled={busyRow === u.email} onClick={() => setConfirm(u)}>
                          Expire
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {confirm && (
        <Dialog
          title={`Expire ${confirm.email}`}
          sub={<>
            This ends their relationship with the organisation. Every grant is dropped — every operation
            they could enter, every solution they could build, every admin appointment and every role.
            <br /><br />
            <strong>They are not deleted.</strong> Everything they did stays attributed to them, which is
            why there is no delete: the record history names its author, and this row is the only thing
            that can say who that was. They can be unexpired later, but they come back with nothing and
            are appointed again from scratch. To pause them while keeping every grant,
            {' '}<strong>Suspend</strong> instead.
          </>}
          onClose={() => setConfirm(null)}
        >
          <div className="admin-row admin-modal-actions">
            <button
              className="admin-btn is-danger"
              disabled={busyRow === confirm.email}
              onClick={() => void act(confirm.email, async () => {
                await consoleClient.expireUser(confirm.email);
                setConfirm(null);
              })}
            >
              {busyRow === confirm.email ? 'Expiring…' : 'Expire user'}
            </button>
            <button className="admin-link" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
