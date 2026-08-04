// UNMOUNTED since 2026-08-04: its organisation nav item was removed (ruled) —
// who builds a solution is a question about that solution, not about the org,
// and it does not belong in the org menu. Kept because it is the only surface
// that grants design-plane access at all; it needs a home inside the open
// solution (`Solution → Users`) before that grant is reachable again.
//
// Console sol users (CONSOLE_RUNTIME_SPEC §3, RBAC_COMPACT): who builds a
// solution, per solution, over the governance store. The design-plane layer of
// the three — org users → sol users → op users.
//
// Two grades: `read` looks at the model, `write` builds it. There is no third —
// 'admin' collapsed into 'write' (2026-08-02) once the admin tiers took over
// everything it guarded. Enforced from RBAC stage 2 (M5).
//
// Keyed on EMAIL and ORG-ADMIN gated server-side: appointing who builds a
// solution is the org tier's work, and the design plane governs no people.

import { useEffect, useState } from 'react';
import { consoleClient } from '../../sdm-runtime/engine';

const LEVELS = ['read', 'write'] as const;
type Level = (typeof LEVELS)[number];

export function SolUsersAdmin() {
  const [solutions, setSolutions] = useState<{ id: string; name: string }[]>([]);
  const [solutionId, setSolutionId] = useState('');
  const [levels, setLevels] = useState<{ email: string; level: Level }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [level, setLevel] = useState<Level>('write');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    consoleClient.listSolutions().then((sols) => {
      setSolutions(sols);
      if (sols.length > 0) setSolutionId((cur) => cur || sols[0].id);
    }).catch((e) => setError(String(e)));
  }, []);

  async function loadFor(sol: string) {
    if (!sol) return;
    setError(null);
    try {
      setLevels(await consoleClient.listSolUsers(sol));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { void loadFor(solutionId); }, [solutionId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !solutionId) return;
    setBusy(true);
    setError(null);
    try {
      await consoleClient.putSolUser(solutionId, email.trim(), level);
      setEmail('');
      await loadFor(solutionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2 className="admin-title">Solution users</h2>
        <p className="admin-sub">Who builds a solution: read (view the model), write (edit config + pages). Appointing them is org-admin work. Enforced from M5.</p>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <label className="admin-field" style={{ maxWidth: 320, marginBottom: 18 }}>
        <span>Solution</span>
        <select value={solutionId} onChange={(e) => setSolutionId(e.target.value)}>
          {solutions.length === 0 && <option value="">No solutions</option>}
          {solutions.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
        </select>
      </label>

      <div className="admin-section">
        {levels.length === 0 ? (
          <p className="admin-muted">No solution users set — everyone may build this solution until one is set (M5 posture).</p>
        ) : (
          <table className="admin-table">
            <thead><tr><th>Email</th><th>Level</th><th></th></tr></thead>
            <tbody>
              {levels.map((l) => (
                <tr key={l.email}>
                  <td className="admin-mono">{l.email}</td>
                  <td>{l.level}</td>
                  <td><button className="admin-link" onClick={() => { setEmail(l.email); setLevel(l.level); }}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form className="admin-form" onSubmit={save}>
        <h3 className="admin-form-title">Set level</h3>
        <label className="admin-field">
          <span>Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@example.com" className="admin-mono" />
        </label>
        <label className="admin-field">
          <span>Level</span>
          <select value={level} onChange={(e) => setLevel(e.target.value as Level)}>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <button type="submit" className="admin-btn" disabled={busy || !email.trim()}>
          {busy ? 'Saving…' : 'Set level'}
        </button>
      </form>
    </div>
  );
}
