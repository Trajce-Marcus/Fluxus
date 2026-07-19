// The workbench's sign-in gate (RBAC_DESIGN §0): a minimal embedded
// email+password form shown before connect() when Neon Auth is configured
// (VITE_NEON_AUTH_URL set). Signup stays open for MVP — once RBAC stage 1
// engages deny-by-default, a fresh signup sees nothing, which is intended.

import { useState, type FormEvent } from 'react';
import type { HostAuth } from '@fluxus/client';

const field: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  margin: '4px 0 12px',
  padding: '8px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  font: 'inherit',
};

export function SignIn({ auth, onSignedIn }: { auth: HostAuth; onSignedIn: () => void }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } =
      mode === 'sign-in' ? await auth.signIn(email, password) : await auth.signUp(name, email, password);
    setBusy(false);
    if (err) setError(err);
    else onSignedIn();
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 360, margin: '10vh auto 0' }}>
      <h2 style={{ margin: '0 0 4px' }}>Fluxus Runtime</h2>
      <p style={{ color: '#64748b', margin: '0 0 20px' }}>
        {mode === 'sign-in' ? 'Sign in to continue' : 'Create an account'}
      </p>
      <form onSubmit={submit}>
        {mode === 'sign-up' && (
          <label>
            Name
            <input style={field} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </label>
        )}
        <label>
          Email
          <input
            style={field}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus={mode === 'sign-in'}
          />
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
          {busy ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <button
        type="button"
        onClick={() => {
          setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
          setError(null);
        }}
        style={{ marginTop: 12, border: 'none', background: 'none', color: '#2563eb', font: 'inherit', cursor: 'pointer', padding: 0 }}
      >
        {mode === 'sign-in' ? 'New here? Create an account' : 'Have an account? Sign in'}
      </button>
    </div>
  );
}
