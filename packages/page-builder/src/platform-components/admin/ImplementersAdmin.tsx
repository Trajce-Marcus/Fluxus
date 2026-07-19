// Console implementer levels (CONSOLE_RUNTIME_SPEC §3, RBAC_COMPACT): per
// solution, over the governance store. Design-plane levels (read/write/admin)
// gating config + page edits — enforced from RBAC stage 2 (M5); this surface
// authors them now. Admin-gated server-side.

import { useEffect, useState } from 'react';
import { consoleClient } from '../../sdm-runtime/engine';

const LEVELS = ['read', 'write', 'admin'] as const;
type Level = (typeof LEVELS)[number];

export function ImplementersAdmin() {
  const [solutions, setSolutions] = useState<{ id: string; name: string }[]>([]);
  const [solutionId, setSolutionId] = useState('');
  const [levels, setLevels] = useState<{ userId: string; level: Level }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState('');
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
      setLevels(await consoleClient.listImplementers(sol));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { void loadFor(solutionId); }, [solutionId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim() || !solutionId) return;
    setBusy(true);
    setError(null);
    try {
      await consoleClient.putImplementer(solutionId, userId.trim(), level);
      setUserId('');
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
        <h2 className="admin-title">Implementer levels</h2>
        <p className="admin-sub">Design-time access to a solution: read (view), write (edit config + pages), admin (+ manage people). Enforced from M5.</p>
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
          <p className="admin-muted">No implementer levels set — everyone is treated as admin until one is set (M5 posture).</p>
        ) : (
          <table className="admin-table">
            <thead><tr><th>User id</th><th>Level</th><th></th></tr></thead>
            <tbody>
              {levels.map((l) => (
                <tr key={l.userId}>
                  <td className="admin-mono">{l.userId}</td>
                  <td>{l.level}</td>
                  <td><button className="admin-link" onClick={() => { setUserId(l.userId); setLevel(l.level); }}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form className="admin-form" onSubmit={save}>
        <h3 className="admin-form-title">Set level</h3>
        <label className="admin-field">
          <span>User id</span>
          <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="auth user id" className="admin-mono" />
        </label>
        <label className="admin-field">
          <span>Level</span>
          <select value={level} onChange={(e) => setLevel(e.target.value as Level)}>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <button type="submit" className="admin-btn" disabled={busy || !userId.trim()}>
          {busy ? 'Saving…' : 'Set level'}
        </button>
      </form>
    </div>
  );
}
