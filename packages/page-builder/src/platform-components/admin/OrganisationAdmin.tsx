// Console organisation settings (CONSOLE_RUNTIME_SPEC §1a, M14): the org is a
// real thing with a profile and a plan, and solutions/operations hang under it.
// This is the surface that shows it.
//
// Reads and profile edits only. There is no **create** — registering a new org
// needs the auth tier to resolve user → org, which it does not do yet (single
// implicit 'default' org, §1) — and `plan`/`status` are ours to set, never the
// org's, so they render read-only.

import { useEffect, useState } from 'react';
import { consoleClient } from '../../sdm-runtime/engine';
import type { OrgProfile } from '@fluxus/client';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export function OrganisationAdmin() {
  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // Draft profile fields — the only two the org owns about itself.
  const [name, setName] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  async function reload() {
    setError(null);
    try {
      const o = await consoleClient.getOrg();
      setOrg(o);
      setName(o.name);
      setContactEmail(o.contactEmail ?? '');
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
      await consoleClient.putOrgProfile({
        name: name.trim(),
        contactEmail: contactEmail.trim() || null,
      });
      await reload();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const dirty = org !== null && (name !== org.name || contactEmail !== (org.contactEmail ?? ''));

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2 className="admin-title">Organisation</h2>
        <p className="admin-sub">Your organisation's profile and plan. Solutions and operations all belong to it.</p>
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
            <label className="admin-field">
              <span>Contact email</span>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => { setContactEmail(e.target.value); setSaved(false); }}
                placeholder="admin@northwind.example"
              />
            </label>
            <div className="admin-row">
              <button type="submit" className="admin-btn" disabled={busy || !dirty || !name.trim()}>
                {busy ? 'Saving…' : 'Save profile'}
              </button>
              {saved && !dirty && <span className="admin-muted">Saved</span>}
            </div>
          </form>

          {/* Set by us, not by the org — billing itself is later. */}
          <div className="admin-section">
            <h3 className="admin-form-title">Plan</h3>
            <table className="admin-table">
              <tbody>
                <tr><th>Plan</th><td>{org.plan}</td></tr>
                <tr><th>Status</th><td>{org.status}</td></tr>
                <tr><th>Registered</th><td className="admin-muted">{formatDate(org.createdAt)}</td></tr>
                <tr><th>Id</th><td className="admin-mono">{org.id}</td></tr>
              </tbody>
            </table>
            <p className="admin-sub">Changing plan isn't self-serve yet.</p>
          </div>
        </>
      )}
    </div>
  );
}

export const css = `
  .admin-row { display: flex; align-items: center; gap: 10px; }
`;
