// Organisation → Users → **Org admins**: who administers the organisation.
//
// Visible to any org admin — they work alongside these people — but **editable
// by the owner alone**. That is the rule the tier exists to express: no
// administrator appoints another at their own level, so an org admin looking at
// this list sees their peers and no controls. The owner is named above the
// table, so "why can't I edit this" has an answer on the screen.

import { useState } from 'react';
import type { Grant, User } from '@fluxus/client';
import { consoleClient } from '../../../sdm-runtime/engine';
import { AppointDialog } from '../dialogs/AppointDialog';
import { EmptyList, ListHead } from '../shared/UserTabs';

export function OrgAdminsTable({ admins, users, owner, isOwner, busyRow, act, onChanged }: {
  admins: Grant[];
  /** The pool to choose from, or **null when the caller cannot read it**. Only
   *  an org admin may read the pool, and the owner is deliberately not one, so
   *  the caller who acts here is precisely the one who may be unable to browse:
   *  null gives them the typed-address dialog instead of an empty picker. */
  users: User[] | null;
  owner: string | null;
  isOwner: boolean;
  busyRow: string | null;
  act: (email: string, fn: () => Promise<unknown>) => Promise<void>;
  onChanged: () => void;
}) {
  const [appoint, setAppoint] = useState(false);
  const held = new Set(admins.map((a) => a.email));

  return (
    <>
      <ListHead
        title="Org admins"
        sub={<>
          They invite people, suspend and remove them, create solutions and operations, and appoint who
          builds and who runs them. They do <strong>not</strong> assign roles inside an operation — that is
          its op admin's.
        </>}
        action={isOwner ? <button className="admin-btn" onClick={() => setAppoint(true)}>Appoint org admin</button> : undefined}
      />

      {admins.length === 0 ? (
        <EmptyList>
          Nobody administers this organisation yet. Until somebody does, no solutions or operations can be
          created and nobody can be invited — the owner appoints the first.
        </EmptyList>
      ) : (
        <table className="admin-table">
          <thead>
            <tr><th>Email</th><th /></tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.email}>
                <td className="admin-mono">
                  {a.email}
                  {a.email === owner && <span className="admin-chip" style={{ marginLeft: 8 }}>owner</span>}
                </td>
                <td>
                  {isOwner && (
                    <button
                      className="admin-link is-danger"
                      disabled={busyRow === a.email}
                      onClick={() => void act(a.email, () => consoleClient.removeOrgAdmin(a.email))}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="users-note">
        {isOwner
          ? <>You are the owner of this organisation, so appointing org admins is yours alone. Being the
             owner does not make you one — appoint yourself if you mean to do org-admin work.</>
          : <>Only the organisation's owner{owner ? <> — <span className="admin-mono">{owner}</span></> : null} may
             appoint or remove org admins. No tier appoints its own tier.</>}
      </p>

      {appoint && (
        <AppointDialog
          title="Appoint org admin"
          sub="They must already be in the organisation. This hands them authority over its people, its
               solutions and its operations."
          submitLabel="Appoint"
          candidates={users && users.filter((u) => !held.has(u.email))}
          onSubmit={(email) => consoleClient.appointOrgAdmin(email)}
          onClose={() => setAppoint(false)}
          onDone={() => { setAppoint(false); onChanged(); }}
        />
      )}
    </>
  );
}
