// Console solutions admin (CONSOLE_RUNTIME_SPEC §3, M6): a **plain list in the
// main area** — no inner panel (ruled 2026-07-31) — with create in a modal. A
// solution is the design-artifact container (SDM + pages + role defs, §1) — no
// data/users/menu of its own; its operations are administered inside it, once
// opened (M17).
//
// **Open** here is the design door: authoring a model needs no data (ruled
// 2026-07-26), so a solution with no operations still opens — you just build
// blind until one exists. The records, when there are any, come from the
// remembered or first operation, switchable in the header.

import { useEffect, useState } from 'react';
import { consoleClient } from '../../sdm-runtime/engine';
import { openSolutionScoped } from '../shell/router';

/** Kebab an id from a display name (org-scoped id is the user's to refine). */
function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function SolutionsAdmin() {
  const [solutions, setSolutions] = useState<{ id: string; name: string; origin: string }[] | null>(null);
  const [operations, setOperations] = useState<{ id: string; name: string; solutionId: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Create dialog — creating is a modal over the list, never an inline form.
  const [dialog, setDialog] = useState(false);
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idEdited, setIdEdited] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setError(null);
    try {
      const [sols, ops] = await Promise.all([consoleClient.listSolutions(), consoleClient.listOperations()]);
      setSolutions(sols);
      setOperations(ops);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const solId = idEdited ? id.trim() : slug(name);
    if (!name.trim() || !solId) return;
    setBusy(true);
    setError(null);
    try {
      await consoleClient.createSolution({ id: solId, name: name.trim() });
      setName(''); setId(''); setIdEdited(false);
      setDialog(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const [opening, setOpening] = useState<string | null>(null);
  async function open(sol: { id: string; name: string }) {
    setOpening(sol.id);
    setError(null);
    try {
      await openSolutionScoped(sol.id, sol.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setOpening(null);
    }
  }

  /** Which operations run this solution — its data lives in one of them. */
  function opsFor(solutionId: string) {
    return operations.filter((o) => o.solutionId === solutionId);
  }

  return (
    <>
      <div className="admin-panel">
        <div className="admin-panel-head admin-head-row">
          <div>
            <h2 className="admin-title">Solutions</h2>
            <p className="admin-sub">Design artifacts — SDM config, pages and role defs. <strong>Open</strong> one to design it and to manage the operations running it.</p>
          </div>
          <button className="admin-btn" onClick={() => setDialog(true)}>New solution</button>
        </div>

        {error && <div className="admin-error">{error}</div>}

        <div className="admin-section">
          {solutions === null ? (
            <p className="admin-muted">Loading…</p>
          ) : solutions.length === 0 ? (
            <p className="admin-muted">No solutions yet — <strong>New solution</strong> creates one.</p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr><th>Name</th><th>Id</th><th>Origin</th><th>Operations</th><th /></tr>
              </thead>
              <tbody>
                {solutions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td className="admin-mono">{s.id}</td>
                    {/* Provenance (M12): authored here vs installed from the
                        Catalogue — installed is unreachable until that exists. */}
                    <td className="admin-muted">{s.origin}</td>
                    <td className="admin-muted">
                      {opsFor(s.id).length === 0
                        ? 'none yet'
                        : opsFor(s.id).map((op) => <div key={op.id}>{op.name}</div>)}
                    </td>
                    <td>
                      <button className="admin-btn" disabled={opening === s.id} onClick={() => open(s)}>
                        {opening === s.id ? 'Opening…' : 'Open'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {dialog && (
        <div className="admin-overlay" onClick={() => setDialog(false)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-title">New solution</h3>
            <p className="admin-sub">A design artifact: model, pages and role defs. Link an operation to it later to run it with data and people.</p>
            <form className="admin-modal-form" onSubmit={create}>
              <label className="admin-field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Field Services" autoFocus />
              </label>
              <label className="admin-field">
                <span>Id</span>
                {/* Permanent once created: config, pages, operations and
                    implementer levels are all keyed on it. */}
                <input
                  value={idEdited ? id : slug(name)}
                  onChange={(e) => { setIdEdited(true); setId(e.target.value); }}
                  placeholder="field-services"
                  className="admin-mono"
                />
              </label>
              <div className="admin-row admin-modal-actions">
                <button type="submit" className="admin-btn" disabled={busy || !name.trim()}>
                  {busy ? 'Creating…' : 'Create solution'}
                </button>
                <button type="button" className="admin-link" onClick={() => setDialog(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
