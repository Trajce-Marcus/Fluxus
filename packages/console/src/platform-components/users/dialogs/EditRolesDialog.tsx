// Roles for one person in one operation — what they may do once inside.
//
// Role *definitions* come from the linked solution; who holds them is the op
// admin's to decide. Saving with nothing checked clears the assignment, which is
// a real state: someone in the operation with no roles enters and sees nothing.

import { useState } from 'react';
import { consoleClient } from '../../../sdm-runtime/engine';
import { message } from '../shared/useUserScreen';
import { Dialog } from './Dialog';

export function EditRolesDialog({ operationId, email, roles, held, onClose, onDone }: {
  operationId: string;
  email: string;
  roles: { id: string; name: string }[];
  held: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(held));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  function toggle(roleId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId); else next.add(roleId);
      return next;
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailed(null);
    try {
      await consoleClient.putUserRoles(operationId, email, [...picked]);
      onDone();
    } catch (err) {
      setFailed(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={`Roles for ${email}`}
      sub="What they may do inside this operation. Roles are declared by the solution it runs."
      error={failed}
      onClose={onClose}
    >
      <form className="admin-modal-form" onSubmit={save}>
        {roles.length === 0 ? (
          <p className="admin-muted">
            This operation's solution declares no roles yet — add them in the solution's
            <strong> Roles</strong> screen.
          </p>
        ) : (
          <div className="admin-checks">
            {roles.map((r) => (
              <label key={r.id} className="admin-check">
                <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                <span>{r.name} <span className="admin-muted admin-mono">{r.id}</span></span>
              </label>
            ))}
          </div>
        )}
        <p className="admin-hint">
          Saving with nothing checked clears their roles. They can still enter the operation and will see
          nothing — a valid state, not a broken one.
        </p>
        <div className="admin-row admin-modal-actions">
          <button type="submit" className="admin-btn" disabled={busy || roles.length === 0}>
            {busy ? 'Saving…' : 'Save roles'}
          </button>
          <button type="button" className="admin-link" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}
