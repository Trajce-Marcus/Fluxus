// Operation → Users → **Op users**: who may enter, and what they may do.
//
// The two gates stay independent, and the table shows both because they are read
// together: entry is this list, roles are a column of it. Someone here with no
// roles enters and sees nothing — valid, and said so in words rather than left
// as a blank cell.
//
// The op admin's screen. They cannot browse the organisation's people, so Add
// user takes a typed address and the server answers for the pool.

import { useState } from 'react';
import type { Grant, User } from '@fluxus/client';
import { consoleClient } from '../../../sdm-runtime/engine';
import { AppointDialog } from '../dialogs/AppointDialog';
import { EditRolesDialog } from '../dialogs/EditRolesDialog';
import { EmptyList, ListHead } from '../shared/UserTabs';

export interface RoleDef { id: string; name: string }

export function OpUsersTable({ operationId, users, roles, assignments, pool, canEdit, busyRow, act, onChanged }: {
  operationId: string;
  users: Grant[];
  /** Role definitions from the linked solution. */
  roles: RoleDef[];
  assignments: { email: string; roleIds: string[] }[];
  /** The organisation's people when the caller may read them (an org admin),
   *  null for an op admin — who types an address instead. */
  pool: User[] | null;
  canEdit: boolean;
  busyRow: string | null;
  act: (email: string, fn: () => Promise<unknown>) => Promise<void>;
  onChanged: () => void;
}) {
  const [add, setAdd] = useState(false);
  const [editRoles, setEditRoles] = useState<string | null>(null);

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  const heldBy = (email: string) => assignments.find((a) => a.email === email)?.roleIds ?? [];

  return (
    <>
      <ListHead
        title="Op users"
        sub={<>
          Who may open this operation, and what they see once inside. Being listed here lets them in;
          roles decide the rest. The two are separate on purpose.
        </>}
        action={canEdit ? <button className="admin-btn" onClick={() => setAdd(true)}>Add user</button> : undefined}
      />

      {users.length === 0 ? (
        <EmptyList>
          Nobody may enter this operation. That is a real answer, not a missing setting — an operation with
          no users admits no one, including its own solution's builders.
        </EmptyList>
      ) : (
        <table className="admin-table">
          <thead>
            <tr><th>Email</th><th>Roles</th><th /></tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const held = heldBy(u.email);
              return (
                <tr key={u.email}>
                  <td className="admin-mono">{u.email}</td>
                  <td>
                    {held.length === 0
                      ? <span className="admin-muted">No roles — enters and sees nothing</span>
                      : held.map(roleName).join(', ')}
                  </td>
                  <td>
                    {canEdit && (
                      <div className="admin-row">
                        <button className="admin-link" onClick={() => setEditRoles(u.email)}>Roles</button>
                        <button
                          className="admin-link is-danger"
                          disabled={busyRow === u.email}
                          onClick={() => void act(u.email, () => consoleClient.removeOpUser(operationId, u.email))}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {!canEdit && (
        <p className="users-note">
          Adding people to this operation and assigning their roles is its op admin's — an org admin who
          needs to do it appoints themselves one first, so the grant is explicit.
        </p>
      )}

      {add && (
        <AppointDialog
          title="Add user to this operation"
          sub="They will be able to open it. What they can see is decided separately, by their roles."
          submitLabel="Add user"
          candidates={pool ? pool.filter((p) => !users.some((u) => u.email === p.email)) : null}
          onSubmit={(email) => consoleClient.addOpUser(operationId, email)}
          onClose={() => setAdd(false)}
          onDone={() => { setAdd(false); onChanged(); }}
        />
      )}

      {editRoles && (
        <EditRolesDialog
          operationId={operationId}
          email={editRoles}
          roles={roles}
          held={heldBy(editRoles)}
          onClose={() => setEditRoles(null)}
          onDone={() => { setEditRoles(null); onChanged(); }}
        />
      )}
    </>
  );
}
