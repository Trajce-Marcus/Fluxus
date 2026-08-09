// Who builds a solution — used twice, read-only in one of them.
//
//   Organisation → Users → Sol admins   editable. Appointing somebody to build
//                                       is an act of the org admin's authority,
//                                       so it is made where that authority is
//                                       exercised: grouped by solution, all in
//                                       one place.
//   Solution → Users → Sol admins       read-only, so the open solution can
//                                       answer "who builds this" without
//                                       leaving. Says where it is edited.
//
// One grade: you build it or you do not.

import { useState } from 'react';
import type { SolAdminRow, User } from '@fluxus/client';
import { consoleClient } from '../../../sdm-runtime/engine';
import { AppointDialog } from '../dialogs/AppointDialog';
import { EmptyList, ListHead } from '../shared/UserTabs';

export interface SolutionRef {
  id: string;
  name: string;
}

export function SolAdminsTable({ rows, solutions, users, readOnly, busyRow, act, onChanged }: {
  rows: SolAdminRow[];
  /** The solutions to group by — one entry when a single solution's screen is
   *  showing this, the org's whole catalogue when the organisation's is. */
  solutions: SolutionRef[];
  /** The pool to pick from, or **null when the caller cannot read it** — in
   *  read-only mode nobody is choosing anyone, and where they are, null hands
   *  the dialog its typed-address mode rather than an empty picker. */
  users: User[] | null;
  readOnly?: boolean;
  busyRow: string | null;
  act: (email: string, fn: () => Promise<unknown>) => Promise<void>;
  onChanged: () => void;
}) {
  const [appointTo, setAppointTo] = useState<SolutionRef | null>(null);

  return (
    <>
      <ListHead
        title="Sol admins"
        sub={<>
          They model, build pages and set the default menu. They appoint nobody, invite nobody and see no
          user list anywhere. Building a solution does <strong>not</strong> admit them to an operation
          running it — they are added to one like anyone else.
        </>}
      />

      {solutions.length === 0 ? (
        <EmptyList>There are no solutions yet, so there is nobody to appoint.</EmptyList>
      ) : (
        <div className="users-stack">
          {solutions.map((sol) => {
            const held = rows.filter((r) => r.solutionId === sol.id);
            return (
              <div key={sol.id}>
                <div className="admin-head-row users-list-head">
                  <h4 className="users-group-title">
                    {sol.name} <span className="admin-mono admin-muted">{sol.id}</span>
                  </h4>
                  {!readOnly && (
                    <button className="admin-link" onClick={() => setAppointTo(sol)}>Appoint</button>
                  )}
                </div>
                {held.length === 0 ? (
                  <EmptyList>
                    Nobody builds this solution. Its model and pages cannot be edited by anyone until
                    somebody is appointed.
                  </EmptyList>
                ) : (
                  <table className="admin-table">
                    <thead><tr><th>Email</th><th /></tr></thead>
                    <tbody>
                      {held.map((r) => (
                        <tr key={r.email}>
                          <td className="admin-mono">{r.email}</td>
                          <td>
                            {!readOnly && (
                              <button
                                className="admin-link is-danger"
                                disabled={busyRow === r.email}
                                onClick={() => void act(r.email, () => consoleClient.removeSolAdmin(sol.id, r.email))}
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
              </div>
            );
          })}
        </div>
      )}

      {readOnly && (
        <p className="users-note">
          Appointed by an org admin, on the organisation's <strong>Users</strong> screen — who builds a
          solution is an exercise of org authority, so it is granted where that authority lives.
        </p>
      )}

      {appointTo && (
        <AppointDialog
          title={`Appoint a builder of ${appointTo.name}`}
          sub="They must already be in the organisation. They will be able to change this solution's model
               and pages — and will still need adding to an operation to see any live data."
          submitLabel="Appoint"
          candidates={users && users.filter((u) => !rows.some((r) => r.solutionId === appointTo.id && r.email === u.email))}
          onSubmit={(email) => consoleClient.appointSolAdmin(appointTo.id, email)}
          onClose={() => setAppointTo(null)}
          onDone={() => { setAppointTo(null); onChanged(); }}
        />
      )}
    </>
  );
}

export const css = `
  .users-group-title { margin: 0; font-size: 0.88rem; font-weight: 600; }
  .users-group-title .admin-mono { margin-left: 8px; font-weight: 400; font-size: 0.78rem; }
`;
