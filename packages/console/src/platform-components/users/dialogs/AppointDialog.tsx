// Appointing somebody to a list — the second act, always. Invite puts a person
// in the organisation; this names them in one list, and it is the same shape at
// every tier: pick a person, confirm.
//
// Two modes, because two callers see different things:
//
//   candidates given  — an org admin, who may read the organisation's people
//                       and so picks from them.
//   candidates null   — an op admin, who may NOT. They type an address and the
//                       server answers for the pool, refusing with "not in this
//                       organisation" when nobody has invited that person yet.
//                       The refusal is the feature: it is how someone who
//                       cannot browse the pool still finds out where they stand.

import { useState } from 'react';
import { message } from '../shared/useUserScreen';
import { Dialog } from './Dialog';

export function AppointDialog({ title, sub, submitLabel, candidates, onSubmit, onClose, onDone }: {
  title: string;
  sub: React.ReactNode;
  submitLabel: string;
  /** The organisation's people to choose from, or null when the caller cannot
   *  read them and must type an address instead. */
  candidates: { email: string; name: string | null }[] | null;
  onSubmit: (email: string) => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setFailed(null);
    try {
      await onSubmit(email.trim());
      onDone();
    } catch (err) {
      setFailed(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} sub={sub} error={failed} onClose={onClose}>
      <form className="admin-modal-form" onSubmit={submit}>
        <label className="admin-field">
          <span>{candidates ? 'Person' : 'Email'}</span>
          {candidates ? (
            <select value={email} onChange={(e) => setEmail(e.target.value)} autoFocus>
              <option value="">Choose someone…</option>
              {candidates.map((c) => (
                <option key={c.email} value={c.email}>
                  {c.name ? `${c.name} — ${c.email}` : c.email}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@example.com"
              className="admin-mono"
              autoFocus
            />
          )}
        </label>
        {candidates?.length === 0 && (
          <p className="admin-hint">
            Nobody has been invited yet. <strong>Invite user</strong> first — appointment always names
            somebody the organisation already knows.
          </p>
        )}
        {!candidates && (
          <p className="admin-hint">
            They must already be in the organisation. If they are not, an org admin has to invite them.
          </p>
        )}
        <div className="admin-row admin-modal-actions">
          <button type="submit" className="admin-btn" disabled={busy || !email.trim()}>
            {busy ? 'Saving…' : submitLabel}
          </button>
          <button type="button" className="admin-link" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}
