// The platform plane's one screen (first cut, 2026-08-03): every org, and the
// form that registers a new one with its owner.
//
// Bare bones by intent. Usage, billing and plan changes belong to this app
// eventually, but usage should fall out of the unified log rather than a
// counter table, so nothing is invented here ahead of that.

import { useEffect, useState, type FormEvent } from 'react';
import type { PlatformClient, PlatformOrg } from '@fluxus/client';

const CONSOLE_URL = import.meta.env.VITE_FLUXUS_CONSOLE_URL ?? 'http://localhost:5174';

const card: React.CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: 20,
  background: '#fff',
};
const field: React.CSSProperties = {
  display: 'block',
  width: '100%',
  margin: '4px 0 14px',
  padding: '8px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  font: 'inherit',
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '1px solid #e2e8f0',
  color: '#64748b',
  fontWeight: 600,
  fontSize: 13,
};
const td: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid #f1f5f9' };
const mono: React.CSSProperties = { ...td, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 };

export default function App({ client, who, onSignOut }: {
  client: PlatformClient;
  /** Always a real signed-in address: this app has no demo posture, so main.tsx
   *  never reaches here without a session. */
  who: string;
  onSignOut: () => void;
}) {
  const [orgs, setOrgs] = useState<PlatformOrg[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setOrgs(await client.listOrgs());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: '#f8fafc', minHeight: '100vh' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 28px',
          borderBottom: '1px solid #e2e8f0',
          background: '#fff',
        }}
      >
        <strong>Fluxus Platform</strong>
        <span style={{ color: '#64748b', fontSize: 14 }}>
          {who}
          <button
            onClick={onSignOut}
            style={{ marginLeft: 12, border: 'none', background: 'none', color: '#2563eb', font: 'inherit', cursor: 'pointer' }}
          >
            Sign out
          </button>
        </span>
      </header>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '28px 20px', display: 'grid', gap: 24 }}>
        {error && (
          <div style={{ ...card, borderColor: '#fecaca', background: '#fef2f2', color: '#b91c1c' }}>{error}</div>
        )}

        <section style={card}>
          <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Organisations</h2>
          <p style={{ color: '#64748b', margin: '0 0 16px', fontSize: 14 }}>
            Every org on this deployment. The Console link opens that org's workspace.
          </p>
          {orgs === null ? (
            <p style={{ color: '#94a3b8' }}>Loading…</p>
          ) : orgs.length === 0 ? (
            <p style={{ color: '#94a3b8' }}>No organisations yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={th}>Id</th>
                    <th style={th}>Name</th>
                    <th style={th}>Owner</th>
                    <th style={th}>Plan</th>
                    <th style={th}>Status</th>
                    <th style={th}>Registered</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((o) => (
                    <tr key={o.id}>
                      <td style={mono}>{o.id}</td>
                      <td style={td}>{o.name}</td>
                      <td style={td}>{o.ownerEmail ?? <span style={{ color: '#94a3b8' }}>—</span>}</td>
                      <td style={td}>{o.plan}</td>
                      <td style={td}>{o.status}</td>
                      <td style={td}>{o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '—'}</td>
                      <td style={td}>
                        <a href={`${CONSOLE_URL}/o/${o.id}/`} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>
                          Console
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <RegisterOrg client={client} onRegistered={refresh} />
      </main>
    </div>
  );
}

function RegisterOrg({ client, onRegistered }: { client: PlatformClient; onRegistered: () => Promise<void> }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await client.registerOrg({ id, name, ownerEmail, ownerName: ownerName || null });
      await onRegistered();
      setDone(`Registered '${id}'. Tell ${ownerEmail} to sign in — nothing was emailed.`);
      setId('');
      setName('');
      setOwnerEmail('');
      setOwnerName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={card}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Register an organisation</h2>
      <p style={{ color: '#64748b', margin: '0 0 16px', fontSize: 14 }}>
        The owner becomes the org's first admin and can invite the rest from the Console. No mail is sent —
        tell them out of band that they can sign in.
      </p>
      <form onSubmit={submit} style={{ maxWidth: 420 }}>
        <label>
          Id
          <input
            style={field}
            value={id}
            onChange={(e) => setId(e.target.value)}
            required
            pattern="[a-z0-9][a-z0-9-]*"
            placeholder="acme"
          />
        </label>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '-10px 0 14px' }}>
          Permanent, and it is the URL: <code>/o/{id || 'acme'}/</code>. Lower-case letters, digits and hyphens.
        </p>
        <label>
          Name
          <input style={field} value={name} onChange={(e) => setName(e.target.value)} required placeholder="Acme Corp" />
        </label>
        <label>
          Owner email
          <input
            style={field}
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            required
            placeholder="owner@acme.com"
          />
        </label>
        <label>
          Owner name <span style={{ color: '#94a3b8' }}>(optional)</span>
          <input style={field} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Ada Owner" />
        </label>
        {error && <p style={{ color: '#dc2626', margin: '0 0 12px' }}>{error}</p>}
        {done && <p style={{ color: '#15803d', margin: '0 0 12px' }}>{done}</p>}
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: '8px 16px',
            border: 'none',
            borderRadius: 6,
            background: '#0f172a',
            color: '#fff',
            font: 'inherit',
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? 'Registering…' : 'Register'}
        </button>
      </form>
    </section>
  );
}
