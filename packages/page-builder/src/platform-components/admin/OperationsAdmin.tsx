// Console operations admin (CONSOLE_RUNTIME_SPEC §3): the org's operations in
// the inner panel (M17), the selected one's view in the main area — Overview +
// the operation-scoped admin (menu override, role assignments) that M11
// consolidated here out of separate picker-driven panels. **Open** launches the
// **Runtime app** on the operation (ruled 2026-07-26), not a Console design
// scope: the two Opens follow the two planes — a solution opens the Console
// (author the model), an operation opens the app (run it).
// Runtime host URL comes from VITE_FLUXUS_RUNTIME_URL,
// localhost:5173 in dev. Plain functional form over the ConsoleClient's
// operations/solutions CRUD — no SDM, no activities. RBAC stage-2 gates
// operations.create on implementer `admin`; until then it's open per the env
// stub, and a FORBIDDEN surfaces here as the error line.

import { useEffect, useState } from 'react';
import type { OperationRow } from '@fluxus/client';
import { consoleClient } from '../../sdm-runtime/engine';
import { OperationMenuSection } from './OperationMenuSection';
import { AssignmentsSection } from './AssignmentsSection';
import { InnerPanel, PanelItem } from '../shell/InnerPanel';

/** The Runtime app's address; `?operation=<id>` selects what it runs. */
const RUNTIME_URL = import.meta.env.VITE_FLUXUS_RUNTIME_URL ?? 'http://localhost:5173';

/** Kebab an id from a display name (org-scoped id is the user's to refine). */
function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Scoped to one solution (M17): the Console administers operations from
 *  inside the solution they run, so the list is filtered and the create form
 *  has no solution picker — the link is fixed by where you are. */
export function OperationsAdmin({ solutionId: scopeSolutionId }: { solutionId: string }) {
  const [operations, setOperations] = useState<OperationRow[] | null>(null);
  const [solutionName, setSolutionName] = useState(scopeSolutionId);
  const [error, setError] = useState<string | null>(null);
  /** The operation view (M11): which operation the main area shows. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Create form.
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idEdited, setIdEdited] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setError(null);
    try {
      const [allOps, sols] = await Promise.all([consoleClient.listOperations(), consoleClient.listSolutions()]);
      const ops = allOps.filter((o) => o.solutionId === scopeSolutionId);
      setOperations(ops);
      setSolutionName(sols.find((s) => s.id === scopeSolutionId)?.name ?? scopeSolutionId);
      if (ops.length > 0) setSelectedId((cur) => cur ?? ops[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(); }, [scopeSolutionId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const opId = idEdited ? id.trim() : slug(name);
    if (!name.trim() || !opId) return;
    setBusy(true);
    setError(null);
    try {
      await consoleClient.createOperation({ id: opId, solutionId: scopeSolutionId, name: name.trim() });
      setName(''); setId(''); setIdEdited(false);
      await reload();
      setCreating(false);
      setSelectedId(opId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Launch the Runtime app on this operation — a new tab: Console is a
   *  workbench you keep open while the app runs beside it. */
  function open(op: OperationRow) {
    window.open(`${RUNTIME_URL}/?operation=${encodeURIComponent(op.id)}`, '_blank', 'noopener');
  }

  const selected = operations?.find((op) => op.id === selectedId) ?? null;

  return (
    <>
      <InnerPanel
        title="Operations"
        actions={<button className="panel-btn" onClick={() => { setCreating(true); setSelectedId(null); }}>New</button>}
      >
        {operations === null && <p className="panel-empty">Loading…</p>}
        {operations?.length === 0 && <p className="panel-empty">None yet — New creates one.</p>}
        {operations?.map((op) => (
          <PanelItem
            key={op.id}
            name={op.name}
            sub={op.id}
            active={!creating && op.id === selectedId}
            onClick={() => { setCreating(false); setSelectedId(op.id); }}
          />
        ))}
      </InnerPanel>

      <div className="admin-panel">
        {error && <div className="admin-error">{error}</div>}

        {creating ? (
          <>
            <div className="admin-panel-head">
              <h2 className="admin-title">New operation</h2>
              <p className="admin-sub">
                A runtime unit of <strong>{solutionName}</strong>: its own data, users and menu.
                The link to this solution is permanent.
              </p>
            </div>
            <form className="admin-form" onSubmit={create}>
              <label className="admin-field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="North depot" autoFocus />
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
              <div className="admin-row">
                <button type="submit" className="admin-btn" disabled={busy || !name.trim()}>
                  {busy ? 'Creating…' : 'Create operation'}
                </button>
                <button type="button" className="admin-link" onClick={() => setCreating(false)}>Cancel</button>
              </div>
            </form>
          </>
        ) : selected ? (
          <>
            <div className="admin-panel-head">
              <h2 className="admin-title">{selected.name}</h2>
              <p className="admin-sub">
                <span className="admin-mono">{selected.id}</span>
                {' · runs '}<strong>{solutionName}</strong>
              </p>
            </div>
            <div className="admin-section">
              <button className="admin-btn" onClick={() => open(selected)} title="Run this operation in the Runtime app">
                Open in Runtime app
              </button>
            </div>
            <OperationMenuSection operationId={selected.id} solutionId={selected.solutionId} />
            <AssignmentsSection operationId={selected.id} />
          </>
        ) : (
          <div className="admin-panel-head">
            <h2 className="admin-title">Operations</h2>
            <p className="admin-sub">
              What runs <strong>{solutionName}</strong> — each owns its own records, users and menu.
              Pick one from the list, or create a new one.
            </p>
          </div>
        )}
      </div>
    </>
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
  .admin-head-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .admin-head-row .admin-btn { margin-top: 0; }

  /* Modal dialogs over an admin list (same shape as the publish dialog). */
  .admin-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center; z-index: 1000;
  }
  .admin-modal {
    background: var(--color-sidebar); border: 1px solid var(--color-border);
    border-radius: 6px; padding: 18px 20px; width: 420px; max-width: 90vw;
    max-height: 80vh; overflow-y: auto; color: var(--color-text);
  }
  .admin-modal-title { margin: 0 0 4px; font-size: 0.95rem; }
  .admin-modal-form { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
  .admin-modal-actions { margin-top: 4px; }
`;
