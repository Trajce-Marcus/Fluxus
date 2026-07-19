// Console operations admin (CONSOLE_RUNTIME_SPEC §3): list operations and
// create new ones against an existing solution. Plain functional form over the
// ConsoleClient's operations/solutions CRUD — no SDM, no activities. RBAC
// stage-2 gates operations.create on implementer `admin`; until then it's open
// per the env stub, and a FORBIDDEN surfaces here as the error line.

import { useEffect, useState } from 'react';
import type { OperationRow } from '@fluxus/client';
import { consoleClient } from '../../sdm-runtime/engine';

/** Kebab an id from a display name (org-scoped id is the user's to refine). */
function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function OperationsAdmin() {
  const [operations, setOperations] = useState<OperationRow[] | null>(null);
  const [solutions, setSolutions] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Create form.
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idEdited, setIdEdited] = useState(false);
  const [solutionId, setSolutionId] = useState('');
  const [busy, setBusy] = useState(false);

  async function reload() {
    setError(null);
    try {
      const [ops, sols] = await Promise.all([consoleClient.listOperations(), consoleClient.listSolutions()]);
      setOperations(ops);
      setSolutions(sols);
      if (!solutionId && sols.length > 0) setSolutionId(sols[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const opId = idEdited ? id.trim() : slug(name);
    if (!name.trim() || !opId || !solutionId) return;
    setBusy(true);
    setError(null);
    try {
      await consoleClient.createOperation({ id: opId, solutionId, name: name.trim() });
      setName(''); setId(''); setIdEdited(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const solName = (sid: string) => solutions.find((s) => s.id === sid)?.name ?? sid;

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2 className="admin-title">Operations</h2>
        <p className="admin-sub">Runtime units. Each links to one solution and owns its own data, users and menu.</p>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <div className="admin-section">
        {operations === null ? (
          <p className="admin-muted">Loading…</p>
        ) : operations.length === 0 ? (
          <p className="admin-muted">No operations yet — create one below.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr><th>Name</th><th>Id</th><th>Solution</th><th>Org</th></tr>
            </thead>
            <tbody>
              {operations.map((op) => (
                <tr key={op.id}>
                  <td>{op.name}</td>
                  <td className="admin-mono">{op.id}</td>
                  <td>{solName(op.solutionId)}</td>
                  <td className="admin-mono">{op.orgId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form className="admin-form" onSubmit={create}>
        <h3 className="admin-form-title">New operation</h3>
        <label className="admin-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="North depot" />
        </label>
        <label className="admin-field">
          <span>Id</span>
          <input
            value={idEdited ? id : slug(name)}
            onChange={(e) => { setIdEdited(true); setId(e.target.value); }}
            placeholder="north-depot"
            className="admin-mono"
          />
        </label>
        <label className="admin-field">
          <span>Solution</span>
          <select value={solutionId} onChange={(e) => setSolutionId(e.target.value)}>
            {solutions.length === 0 && <option value="">No solutions</option>}
            {solutions.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.id})</option>)}
          </select>
        </label>
        <button type="submit" className="admin-btn" disabled={busy || !name.trim() || solutions.length === 0}>
          {busy ? 'Creating…' : 'Create operation'}
        </button>
      </form>
    </div>
  );
}

export const css = `
  .admin-panel {
    height: 100%;
    overflow-y: auto;
    padding: 20px 24px;
    color: var(--color-text);
  }
  .admin-panel-head { margin-bottom: 16px; }
  .admin-title { margin: 0; font-size: 1.1rem; font-weight: 600; }
  .admin-sub { margin: 4px 0 0; color: var(--color-text-muted); font-size: 0.8rem; }
  .admin-muted { color: var(--color-text-muted); font-size: 0.85rem; }
  .admin-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem; }
  .admin-error {
    background: #5a1d1d; color: #f4d0d0; border: 1px solid #7a2a2a;
    padding: 8px 12px; border-radius: 4px; font-size: 0.8rem; margin-bottom: 14px;
    white-space: pre-wrap;
  }
  .admin-section { margin-bottom: 24px; }
  .admin-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  .admin-table th, .admin-table td {
    text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--color-border);
  }
  .admin-table th { color: var(--color-text-muted); font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .admin-form {
    max-width: 420px; display: flex; flex-direction: column; gap: 10px;
    background: var(--color-sidebar); border: 1px solid var(--color-border);
    border-radius: 6px; padding: 16px;
  }
  .admin-form-title { margin: 0 0 4px; font-size: 0.9rem; font-weight: 600; }
  .admin-field { display: flex; flex-direction: column; gap: 4px; font-size: 0.78rem; color: var(--color-text-muted); }
  .admin-field input, .admin-field select {
    background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 4px;
    color: var(--color-text); padding: 6px 8px; font-size: 0.85rem; font-family: inherit;
  }
  .admin-field input:focus, .admin-field select:focus { outline: 1px solid var(--color-accent); border-color: var(--color-accent); }
  .admin-btn {
    align-self: flex-start; margin-top: 4px;
    background: var(--color-accent); color: #fff; border: none; border-radius: 4px;
    padding: 7px 14px; font-size: 0.82rem; cursor: pointer;
  }
  .admin-btn:disabled { opacity: 0.5; cursor: default; }
  .admin-link {
    background: none; border: none; color: var(--color-accent); cursor: pointer;
    font-size: 0.78rem; padding: 0;
  }
  .admin-checks { display: flex; flex-direction: column; gap: 6px; margin: 2px 0; }
  .admin-check { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: var(--color-text); cursor: pointer; }
  .admin-check input { width: 14px; height: 14px; }
  .admin-hint { margin: 2px 0 0; font-size: 0.72rem; color: var(--color-text-muted); }
`;
