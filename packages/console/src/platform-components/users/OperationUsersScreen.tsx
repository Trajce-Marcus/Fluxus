// Operation → Users (the operation view's Users tab).
//
// Two tabs: who administers this operation (read-only — an org admin appoints
// them, from the solution it runs) and who may enter it, with their roles
// (the op admin's, and the reason this screen exists).
//
// The op admin cannot read the organisation's people, so Add user takes a typed
// address; an org admin looking at the same screen gets a picker instead.

import { useState } from 'react';
import type { Grant, OpAdminRow, User } from '@fluxus/client';
import { consoleClient } from '../../sdm-runtime/engine';
import { InviteUserDialog } from './dialogs/InviteUserDialog';
import { OpAdminsTable } from './tables/OpAdminsTable';
import { OpUsersTable, type RoleDef } from './tables/OpUsersTable';
import { UserTabs, type UserTab } from './shared/UserTabs';
import { useUserScreen } from './shared/useUserScreen';

interface OperationUsersData {
  opAdmin: boolean;
  orgAdmin: boolean;
  users: Grant[];
  admins: OpAdminRow[];
  roles: RoleDef[];
  assignments: { email: string; roleIds: string[] }[];
  /** The organisation's people, when the caller may read them. */
  pool: User[] | null;
}

export function OperationUsersScreen({ operationId, operationName }: {
  operationId: string;
  operationName: string;
}) {
  const [tab, setTab] = useState('op-users');
  const [invite, setInvite] = useState(false);

  const { data, error, busyRow, act, reload } = useUserScreen<OperationUsersData>(async () => {
    const me = await consoleClient.me(operationId).catch(() => null);
    // `me` scoped to an operation passes its entry gate, so a caller who is not
    // in it gets null — which is the honest answer here, not an error state.
    const opAdmin = me?.opAdmin ?? false;
    const orgAdmin = me?.orgAdmin ?? false;
    if (!opAdmin && !orgAdmin) {
      return { opAdmin, orgAdmin, users: [], admins: [], roles: [], assignments: [], pool: null };
    }
    const [users, admins, roles, assignments, pool] = await Promise.all([
      consoleClient.listOpUsers(operationId),
      consoleClient.listOpAdmins(operationId),
      consoleClient.operationRoles(operationId),
      // Roles are the op admin's; an org admin who is not one sees the list
      // without them rather than a failed screen.
      opAdmin ? consoleClient.listUserRoles(operationId) : Promise.resolve([]),
      orgAdmin ? consoleClient.listUsers() : Promise.resolve(null),
    ]);
    return {
      opAdmin,
      orgAdmin,
      users,
      admins: admins.map((a) => ({ operationId, email: a.email })),
      roles,
      assignments,
      pool,
    };
  }, [operationId]);

  const tabs: UserTab[] = data && (data.opAdmin || data.orgAdmin) ? [
    {
      id: 'op-users',
      label: 'Op users',
      render: () => (
        <OpUsersTable
          operationId={operationId}
          users={data.users}
          roles={data.roles}
          assignments={data.assignments}
          pool={data.pool}
          canEdit={data.opAdmin}
          busyRow={busyRow}
          act={act}
          onChanged={() => void reload()}
        />
      ),
    },
    {
      id: 'op-admins',
      label: 'Op admins',
      render: () => (
        <OpAdminsTable
          rows={data.admins}
          operations={[{ id: operationId, name: operationName }]}
          users={null}
          readOnly
          busyRow={busyRow}
          act={act}
          onChanged={() => void reload()}
        />
      ),
    },
  ] : [];

  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <>
      {error && <div className="admin-error">{error}</div>}

      {data === null ? (
        <p className="admin-muted">Loading…</p>
      ) : !data.opAdmin && !data.orgAdmin ? (
        <p className="admin-muted">
          Only this operation's admins manage its users. An org admin can appoint one from the solution
          this operation runs.
        </p>
      ) : (
        <>
          <div className="admin-head-row">
            <UserTabs tabs={tabs} active={active.id} onSelect={setTab} />
            {data.opAdmin && (
              <button className="admin-btn" onClick={() => setInvite(true)}>Invite user</button>
            )}
          </div>
          {active.render()}
        </>
      )}

      {invite && (
        <InviteUserDialog
          // The op admin's standing to invite: they have none org-wide, so the
          // server checks the operation they administer.
          operationId={operationId}
          onClose={() => setInvite(false)}
          onDone={() => { setInvite(false); void reload(); }}
        />
      )}
    </>
  );
}
