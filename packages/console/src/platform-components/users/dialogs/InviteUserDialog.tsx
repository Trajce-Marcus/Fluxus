// Invite — the only way anyone enters the organisation, and it carries no admin
// connotation whatever (agreed 2026-08-04). It adds a person to the
// organisation's people and grants them nothing, anywhere. Every appointment is
// a separate act in the list it belongs to, which is why this dialog has no
// checkbox, no solution, no operation, no level.
//
// It appears on all three Users screens because the act is the same one each
// time. `operationId` is passed when an op admin is the caller: they have no
// org-wide standing to invite from, so the server checks the operation they
// administer instead.

import { useState } from 'react';
import { consoleClient } from '../../../sdm-runtime/engine';
import { message } from '../shared/useUserScreen';
import { Dialog } from './Dialog';

export function InviteUserDialog({ operationId, onClose, onDone }: {
  /** Set when an op admin may be the caller — their standing to invite. */
  operationId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setFailed(null);
    try {
      await consoleClient.inviteUser({ email: email.trim(), name: name.trim() || null, operationId });
      onDone();
    } catch (err) {
      setFailed(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Invite user"
      sub={<>
        They join the organisation and nothing more — no access to anything until someone adds them to an
        operation or appoints them. The invitation is by email address and works before they have an
        account: signing in binds it.
      </>}
      error={failed}
      onClose={onClose}
    >
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
        <div className="admin-row admin-modal-actions">
          <button type="submit" className="admin-btn" disabled={busy || !email.trim()}>
            {busy ? 'Inviting…' : 'Send invitation'}
          </button>
          <button type="button" className="admin-link" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}
