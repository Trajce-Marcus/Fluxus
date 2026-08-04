// Console organisation settings (CONSOLE_RUNTIME_SPEC §1a, M14): the org is a
// real thing with a profile and a plan, and solutions/operations hang under it.
// This is the surface that shows it.
//
// Reads and profile edits only. There is no **create** — registering a new org
// needs the auth tier to resolve user → org, which it does not do yet (single
// implicit 'default' org, §1). `plan`/`status` are ours to set, never the
// org's; since M17 they read on **Billing**, leaving this the settings surface.
//
// **The name is the only editable field** (2026-08-04). *Contact email* was
// dropped with the column (migration 0018): it was born identical to the owner's
// address and nothing read it. The **owner** replaces it and reads **read-only**
// — changing it is ownership transfer, and this screen is org-admin work, so an
// editable field here would let an org admin promote themselves to the root that
// appoints org admins. Transfer stays deliberately unbuilt (USERS.md §7).

import { useEffect, useState } from 'react';
import { consoleClient } from '../../sdm-runtime/engine';
import type { OrgProfile } from '@fluxus/client';

export function OrganisationAdmin() {
  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // The one field the org edits about itself.
  const [name, setName] = useState('');

  async function reload() {
    setError(null);
    try {
      const o = await consoleClient.getOrg();
      setOrg(o);
      setName(o.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await consoleClient.putOrgProfile({ name: name.trim() });
      await reload();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const dirty = org !== null && name !== org.name;

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2 className="admin-title">Settings</h2>
        <p className="admin-sub">Your organisation's profile. Solutions and operations all belong to it; the plan it is on reads under Billing.</p>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {org === null ? (
        <p className="admin-muted">Loading…</p>
      ) : (
        <>
          <form className="admin-form" onSubmit={save}>
            <h3 className="admin-form-title">Profile</h3>
            <label className="admin-field">
              <span>Name</span>
              <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} placeholder="Northwind Utilities" />
            </label>
            <div className="admin-row">
              <button type="submit" className="admin-btn" disabled={busy || !dirty || !name.trim()}>
                {busy ? 'Saving…' : 'Save profile'}
              </button>
              {saved && !dirty && <span className="admin-muted">Saved</span>}
            </div>
          </form>

          <div className="admin-section">
            <h3 className="admin-form-title">Identity</h3>
            <table className="admin-table">
              <tbody>
                <tr><th>Organisation id</th><td className="admin-mono">{org.id}</td></tr>
                <tr>
                  <th>Owner</th>
                  <td>
                    {org.ownerEmail
                      ? <span className="admin-mono">{org.ownerEmail}</span>
                      : <span className="admin-muted">Not set — this org predates the owner tier</span>}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="admin-hint">
              The owner is this organisation's contact address and the root of its authority — they appoint
              its org admins. Read-only: changing it is a transfer of ownership, not a profile edit, and it
              is not built yet.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export const css = `
  .admin-row { display: flex; align-items: center; gap: 10px; }
`;
