// Organisation → Users.
//
// Three tabs, three questions: who exists (All users), who administers the
// organisation (Org admins), who builds its solutions (Sol admins). The pattern
// every Users screen follows — the tier above read-only, the lists this screen
// governs editable, and Invite, which grants nothing anywhere.
//
// Org-admin gated server-side on every call. `me()` here decides only what to
// RENDER; a non-admin is shown the explanation rather than an empty table,
// because a refusal is not what "no users" looks like.

import { useState } from 'react';
import type { Grant, SolAdminRow, User } from '@fluxus/client';
import { consoleClient } from '../../sdm-runtime/engine';
import { InviteUserDialog } from './dialogs/InviteUserDialog';
import { AllUsersTable } from './tables/AllUsersTable';
import { OrgAdminsTable } from './tables/OrgAdminsTable';
import { SolAdminsTable, type SolutionRef } from './tables/SolAdminsTable';
import { UserTabs, type UserTab } from './shared/UserTabs';
import { useUserScreen } from './shared/useUserScreen';

interface OrgUsersData {
  orgAdmin: boolean;
  orgOwner: boolean;
  users: User[];
  admins: Grant[];
  solAdmins: SolAdminRow[];
  solutions: SolutionRef[];
  owner: string | null;
}

export function OrgUsersScreen() {
  const [tab, setTab] = useState('all');
  const [invite, setInvite] = useState(false);

  const { data, error, busyRow, act, reload } = useUserScreen<OrgUsersData>(async () => {
    const me = await consoleClient.me();
    if (!me.orgAdmin && !me.orgOwner) {
      return { orgAdmin: false, orgOwner: false, users: [], admins: [], solAdmins: [], solutions: [], owner: null };
    }
    // The owner may not be an org admin, so the pool and the sol-admin list are
    // fetched only when someone may actually read them. An owner with no grants
    // still gets this screen — it is where they appoint the first org admin.
    const [users, admins, solAdmins, solutions, owner] = await Promise.all([
      me.orgAdmin ? consoleClient.listUsers() : Promise.resolve([]),
      me.orgAdmin ? consoleClient.listOrgAdmins() : Promise.resolve([]),
      me.orgAdmin ? consoleClient.listSolAdminsByOrg() : Promise.resolve([]),
      me.orgAdmin ? consoleClient.listSolutions() : Promise.resolve([]),
      consoleClient.orgOwner(),
    ]);
    return {
      orgAdmin: me.orgAdmin,
      orgOwner: me.orgOwner,
      users,
      admins,
      solAdmins,
      solutions: solutions.map((s) => ({ id: s.id, name: s.name })),
      owner: owner.email,
    };
  }, []);

  const tabs: UserTab[] = data && (data.orgAdmin || data.orgOwner) ? [
    {
      id: 'all',
      label: 'All users',
      render: () => (
        <AllUsersTable users={data.users} busyRow={busyRow} act={act} onInvite={() => setInvite(true)} />
      ),
    },
    {
      id: 'org-admins',
      label: 'Org admins',
      render: () => (
        <OrgAdminsTable
          admins={data.admins}
          users={data.users}
          owner={data.owner}
          isOwner={data.orgOwner}
          busyRow={busyRow}
          act={act}
          onChanged={() => void reload()}
        />
      ),
    },
    {
      id: 'sol-admins',
      label: 'Sol admins',
      render: () => (
        <SolAdminsTable
          rows={data.solAdmins}
          solutions={data.solutions}
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
        <div className="admin-panel-head">
          <h2 className="admin-title">Users</h2>
          <p className="admin-sub">
            One population of people, then grants laid on top. Being in the organisation admits nobody to
            anything — each tab below is a separate, deliberate appointment.
          </p>
        </div>

        {error && <div className="admin-error">{error}</div>}

        <div className="admin-section">
          {data === null ? (
            <p className="admin-muted">Loading…</p>
          ) : !data.orgAdmin && !data.orgOwner ? (
            <p className="admin-muted">
              Only org admins manage users. Ask one of yours to invite someone or to change what a person
              may do.
            </p>
          ) : !data.orgAdmin && data.orgOwner ? (
            // A fresh organisation: the owner holds no grants yet, and this is
            // the screen that exists so they can make the first appointment.
            <>
              <UserTabs tabs={tabs.filter((t) => t.id === 'org-admins')} active="org-admins" onSelect={() => {}} />
              <OrgAdminsTable
                admins={data.admins}
                users={data.users}
                owner={data.owner}
                isOwner
                busyRow={busyRow}
                act={act}
                onChanged={() => void reload()}
              />
              <p className="users-note">
                You own this organisation but administer nothing in it yet. Appoint yourself an org admin to
                invite people and create solutions.
              </p>
            </>
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
