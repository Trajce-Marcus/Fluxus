// Console operations admin (CONSOLE_RUNTIME_SPEC §3): list operations, create
// new ones against an existing solution, and **Open** one — which launches the
// **Runtime app** on it (ruled 2026-07-26), not a Console design scope. The two
// Opens follow the two planes: a solution opens the Console (author the model),
// an operation opens the app (run it). Since M11 this panel is master/detail:
// **Admin** on a row opens the operation view — Overview + the operation-scoped
// admin (menu override, role assignments) that used to be separate
// picker-driven panels. Runtime host URL comes from VITE_FLUXUS_RUNTIME_URL,
// localhost:5173 in dev. Plain functional form over the ConsoleClient's
// operations/solutions CRUD — no SDM, no activities. RBAC stage-2 gates
// operations.create on implementer `admin`; until then it's open per the env
// stub, and a FORBIDDEN surfaces here as the error line.

import { useEffect, useState } from 'react';
import type { OperationRow } from '@fluxus/client';
import { consoleClient } from '../../sdm-runtime/engine';
import { OperationMenuSection } from './OperationMenuSection';
import { AssignmentsSection } from './AssignmentsSection';

/** The Runtime app's address; `?operation=<id>` selects what it runs. */
const RUNTIME_URL = import.meta.env.VITE_FLUXUS_RUNTIME_URL ?? 'http://localhost:5173';

/** Kebab an id from a display name (org-scoped id is the user's to refine). */
function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function OperationsAdmin() {
  const [operations, setOperations] = useState<OperationRow[] | null>(null);
  const [solutions, setSolutions] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** The operation view (M11): the selected operation, or null for the list. */
  const [selected, setSelected] = useState<OperationRow | null>(null);

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

  /** Launch the Runtime app on this operation — a new tab: Console is a
   *  workbench you keep open while the app runs beside it. */
  function open(op: OperationRow) {
    window.open(`${RUNTIME_URL}/?operation=${encodeURIComponent(op.id)}`, '_blank', 'noopener');
  }

  // The operation view (M11): overview + the operation-scoped admin sections.
  if (selected) {
    return (
      <div className="admin-panel">
        <div className="admin-panel-head">
          <button className="admin-link" onClick={() => setSelected(null)}>← Operations</button>
          <h2 className="admin-title" style={{ marginTop: 6 }}>{selected.name}</h2>
          <p className="admin-sub">
            <span className="admin-mono">{selected.id}</span>
            {' · runs '}
            <strong>{solName(selected.solutionId)}</strong>{' '}
            <span className="admin-mono">({selected.solutionId})</span>
          </p>
        </div>
        <div className="admin-section">
          <button className="admin-btn" onClick={() => open(selected)} title="Run this operation in the Runtime app">
            Open in Runtime app
          </button>
        </div>
        <OperationMenuSection operationId={selected.id} solutionId={selected.solutionId} />
        <AssignmentsSection operationId={selected.id} />
      </div>
    );
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2 className="admin-title">Operations</h2>
        <p className="admin-sub">Runtime units. Each links to one solution and owns its own data, users and menu. <strong>Open</strong> runs it in the Runtime app; <strong>Admin</strong> manages its menu and role assignments.</p>
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
              <tr><th>Name</th><th>Id</th><th>Solution</th><th>Org</th><th /></tr>
            </thead>
            <tbody>
              {operations.map((op) => (
                <tr key={op.id}>
                  <td>{op.name}</td>
                  <td className="admin-mono">{op.id}</td>
                  <td>{solName(op.solutionId)}</td>
                  <td className="admin-mono">{op.orgId}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="admin-btn" onClick={() => open(op)} title="Run this operation in the Runtime app">Open</button>{' '}
                    <button className="admin-btn admin-btn-ghost" onClick={() => setSelected(op)} title="Menu and role assignments">Admin</button>
                  </td>
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
  .admin-section-title { margin: 0 0 2px; font-size: 0.95rem; font-weight: 600; padding-top: 14px; border-top: 1px solid var(--color-border); }
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
