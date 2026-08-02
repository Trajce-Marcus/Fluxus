// The platform plane's sign-in gate. Deliberately sign-in ONLY — no sign-up
// link, unlike the Runtime's form: this app admits a handful of our own people
// named in FLUXUS_PLATFORM_ADMINS, and an account created here would land
// outside that list anyway. Offering the button would only promise something
// the server refuses.

import { useState, type FormEvent } from 'react';
import type { HostAuth } from '@fluxus/client';

const field: React.CSSProperties = {
  display: 'block',
  width: '100%',
  margin: '4px 0 12px',
  padding: '8px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  font: 'inherit',
};

export function SignIn({ auth, onSignedIn }: { auth: HostAuth; onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await auth.signIn(email, password);
    setBusy(false);
    if (err) setError(err);
    else onSignedIn();
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 360, margin: '10vh auto 0' }}>
      <h2 style={{ margin: '0 0 4px' }}>Fluxus Platform</h2>
      <p style={{ color: '#64748b', margin: '0 0 20px' }}>Sign in to continue</p>
      <form onSubmit={submit}>
        <label>
          Email
          <input style={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input
            style={field}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        {error && <p style={{ color: '#dc2626', margin: '0 0 12px' }}>{error}</p>}
        <button
          type="submit"
          disabled={busy}
          style={{
            width: '100%',
            padding: '8px 10px',
            border: 'none',
            borderRadius: 6,
            background: '#0f172a',
            color: '#fff',
            font: 'inherit',
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? 'Working…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
