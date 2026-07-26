// Console solutions admin (CONSOLE_RUNTIME_SPEC §3, M6): list solutions and
// create new ones. A solution is the design-artifact container (SDM + pages +
// role defs, §1) — no data/users/menu of its own.
//
// **Open** here is the design door: authoring a model needs no data (ruled
// 2026-07-26), so a solution with no operations still opens — you just build
// blind until one exists. The records, when there are any, come from the
// remembered or first operation, switchable in the header. Opening from a row
// in the *Operations* list is the other door, and names the data explicitly.

import { useEffect, useState } from 'react';
import { consoleClient, currentOperationId, openSolution, solutionOperations } from '../../sdm-runtime/engine';
import { enterSolutionScope } from '../shell/store';

/** Kebab an id from a display name (org-scoped id is the user's to refine). */
function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function SolutionsAdmin() {
  const [solutions, setSolutions] = useState<{ id: string; name: string }[] | null>(null);
  const [operations, setOperations] = useState<{ id: string; solutionId: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Create form.
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
      await openSolution(sol.id);
      enterSolutionScope(sol.id, sol.name, { operationId: currentOperationId, operations: solutionOperations });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setOpening(null);
    }
  }

  /** How many operations run this solution — its data lives in one of them. */
  function opCount(solutionId: string): string {
    const n = operations.filter((o) => o.solutionId === solutionId).length;
    return n === 0 ? 'none yet' : `${n}`;
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2 className="admin-title">Solutions</h2>
        <p className="admin-sub">Design artifacts — SDM config, pages and role defs. No data, users or menus — <strong>Open</strong> to build one. Open from the Operations list instead to build against that operation's records.</p>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <div className="admin-section">
        {solutions === null ? (
          <p className="admin-muted">Loading…</p>
        ) : solutions.length === 0 ? (
          <p className="admin-muted">No solutions yet — create one below.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr><th>Name</th><th>Id</th><th>Operations</th><th /></tr>
            </thead>
            <tbody>
              {solutions.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="admin-mono">{s.id}</td>
                  {/* Where its data lives, and where you open it from. */}
                  <td className="admin-muted">{opCount(s.id)}</td>
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

      <form className="admin-form" onSubmit={create}>
        <h3 className="admin-form-title">New solution</h3>
        <label className="admin-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Field Services" />
        </label>
        <label className="admin-field">
          <span>Id</span>
          <input
            value={idEdited ? id : slug(name)}
            onChange={(e) => { setIdEdited(true); setId(e.target.value); }}
            placeholder="field-services"
            className="admin-mono"
          />
        </label>
        <button type="submit" className="admin-btn" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create solution'}
        </button>
      </form>
    </div>
  );
}
