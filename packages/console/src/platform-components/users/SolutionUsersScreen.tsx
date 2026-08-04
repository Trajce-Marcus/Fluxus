// Solution → Users.
//
// Two tabs: who builds this solution (read-only — appointed at the organisation,
// because that is an exercise of org authority), and who runs the operations it
// powers (editable here, because an org admin stands operations up from inside
// the solution they run).
//
// Not rendered for sol admins: they see no user list anywhere, including this
// one and including their own.

import { useState } from 'react';
import type { OpAdminRow, SolAdminRow, User } from '@fluxus/client';
import { consoleClient } from '../../sdm-runtime/engine';
import { useShellState } from '../shell/useShellState';
import { InviteUserDialog } from './dialogs/InviteUserDialog';
import { OpAdminsTable, type OperationRef } from './tables/OpAdminsTable';
import { SolAdminsTable } from './tables/SolAdminsTable';
import { UserTabs, type UserTab } from './shared/UserTabs';
import { useUserScreen } from './shared/useUserScreen';

interface SolutionUsersData {
  orgAdmin: boolean;
  name: string;
  users: User[];
  solAdmins: SolAdminRow[];
  opAdmins: OpAdminRow[];
  operations: OperationRef[];
}

export function SolutionUsersScreen() {
  const { solutionId } = useShellState(['solutionId']);
  if (!solutionId) return <div className="admin-panel"><p className="admin-muted">No solution open.</p></div>;
  return <Screen key={solutionId} solutionId={solutionId} />;
}

function Screen({ solutionId }: { solutionId: string }) {
  const [tab, setTab] = useState('sol-admins');
  const [invite, setInvite] = useState(false);

  const { data, error, busyRow, act, reload } = useUserScreen<SolutionUsersData>(async () => {
    const me = await consoleClient.me();
    if (!me.orgAdmin) {
      return { orgAdmin: false, name: solutionId, users: [], solAdmins: [], opAdmins: [], operations: [] };
    }
    const [users, solAdmins, opAdmins, operations, solutions] = await Promise.all([
      consoleClient.listUsers(),
      consoleClient.listSolAdmins(solutionId),
      consoleClient.listOpAdminsBySolution(solutionId),
      consoleClient.listOperations(),
      consoleClient.listSolutions(),
    ]);
    return {
      orgAdmin: true,
      name: solutions.find((s) => s.id === solutionId)?.name ?? solutionId,
      users,
      solAdmins: solAdmins.map((a) => ({ solutionId, email: a.email })),
      opAdmins,
      operations: operations
        .filter((o) => o.solutionId === solutionId)
        .map((o) => ({ id: o.id, name: o.name })),
    };
  }, [solutionId]);

  const tabs: UserTab[] = data && data.orgAdmin ? [
    {
      id: 'sol-admins',
      label: 'Sol admins',
      render: () => (
        <SolAdminsTable
          rows={data.solAdmins}
          solutions={[{ id: solutionId, name: data.name }]}
          users={null}
          readOnly
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
          rows={data.opAdmins}
          operations={data.operations}
          users={data.users}
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
      <div className="admin-panel">
        <div className="admin-panel-head admin-head-row">
          <div>
            <h2 className="admin-title">Users</h2>
            <p className="admin-sub">
              Who builds this solution, and who runs the operations it powers.
            </p>
          </div>
          {data?.orgAdmin && <button className="admin-btn" onClick={() => setInvite(true)}>Invite user</button>}
        </div>

        {error && <div className="admin-error">{error}</div>}

        <div className="admin-section">
          {data === null ? (
            <p className="admin-muted">Loading…</p>
          ) : !data.orgAdmin ? (
            <p className="admin-muted">
              Only org admins see who builds a solution or who runs its operations. Building a solution
              grants no visibility of people at all.
            </p>
          ) : (
            <>
              <UserTabs tabs={tabs} active={active.id} onSelect={setTab} />
              {active.render()}
            </>
          )}
        </div>
      </div>

      {invite && (
        <InviteUserDialog onClose={() => setInvite(false)} onDone={() => { setInvite(false); void reload(); }} />
      )}
    </>
  );
}
