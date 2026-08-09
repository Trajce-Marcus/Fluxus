// Who runs an operation — used twice, read-only in one of them.
//
//   Solution → Users → Op admins    editable, grouped by operation. An org
//                                   admin stands operations up inside the
//                                   solution they run, so this is where they
//                                   name who will run them.
//   Operation → Users → Op admins   read-only: the tier above, shown so an op
//                                   admin can see who else administers with
//                                   them and where the appointment comes from.
//
// **No op admin may appoint another** — the downward-only rule at its sharpest.
// The controls here are rendered for org admins alone.

import { useState } from 'react';
import type { OpAdminRow, User } from '@fluxus/client';
import { consoleClient } from '../../../sdm-runtime/engine';
import { AppointDialog } from '../dialogs/AppointDialog';
import { EmptyList, ListHead } from '../shared/UserTabs';

export interface OperationRef {
  id: string;
  name: string;
}

export function OpAdminsTable({ rows, operations, users, readOnly, busyRow, act, onChanged }: {
  rows: OpAdminRow[];
  operations: OperationRef[];
  /** The pool to pick from, or null when the caller cannot read it — which the
   *  dialog turns into its typed-address mode, never an empty picker. */
  users: User[] | null;
  readOnly?: boolean;
  busyRow: string | null;
  act: (email: string, fn: () => Promise<unknown>) => Promise<void>;
  onChanged: () => void;
}) {
  const [appointTo, setAppointTo] = useState<OperationRef | null>(null);
  const single = operations.length === 1;

  return (
    <>
      <ListHead
        title="Op admins"
        sub={<>
          They run the operation: add its users, assign their roles, set its menu. Administering it admits
          them to it — no separate entry is needed. An op admin can never appoint another.
        </>}
      />

      {operations.length === 0 ? (
        <EmptyList>This solution has no operations yet, so there is nobody to appoint.</EmptyList>
      ) : (
        <div className="users-stack">
          {operations.map((op) => {
            const held = rows.filter((r) => r.operationId === op.id);
            return (
              <div key={op.id}>
                {!single && (
                  <div className="admin-head-row users-list-head">
                    <h4 className="users-group-title">
                      {op.name} <span className="admin-mono admin-muted">{op.id}</span>
                    </h4>
                    {!readOnly && <button className="admin-link" onClick={() => setAppointTo(op)}>Appoint</button>}
                  </div>
                )}
                {single && !readOnly && (
                  <div className="admin-head-row users-list-head">
                    <span />
                    <button className="admin-btn" onClick={() => setAppointTo(op)}>Appoint op admin</button>
                  </div>
                )}
                {held.length === 0 ? (
                  <EmptyList>
                    Nobody runs this operation. Until somebody does, no users can be added to it and no
                    roles assigned — an org admin appoints the first.
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
                                onClick={() => void act(r.email, () => consoleClient.removeOpAdmin(op.id, r.email))}
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
          Appointed by an org admin, from the solution this operation runs. An op admin cannot appoint
          another — authority comes from the tier above, never sideways.
        </p>
      )}

      {appointTo && (
        <AppointDialog
          title={`Appoint an admin of ${appointTo.name}`}
          sub="They must already be in the organisation. They will run this operation — its users, their
               roles, and its menu — and can enter it without being added separately."
          submitLabel="Appoint"
          candidates={users && users.filter((u) => !rows.some((r) => r.operationId === appointTo.id && r.email === u.email))}
          onSubmit={(email) => consoleClient.appointOpAdmin(appointTo.id, email)}
          onClose={() => setAppointTo(null)}
          onDone={() => { setAppointTo(null); onChanged(); }}
        />
      )}
    </>
  );
}
