// Solution → Settings: the open solution's own profile, and the danger zone.
//
// Name is editable (`solutions.update`); the **id is permanent** — the config,
// pages, versions, implementer levels and every operation are keyed on it.
// Delete is wired end to end but the server refuses: the cascade to a
// solution's operations and their records is a TODO (see `deleteSolution`).

import { useEffect, useState } from 'react';
import { useShellState } from './useShellState';
import { shellStore } from './store';
import { exitToWorkspace } from './router';
import { consoleClient } from '../../sdm-runtime/engine';

export function SolutionSettingsSection() {
  const { solutionId, solutionName, dataOperations } = useShellState([
    'solutionId', 'solutionName', 'dataOperations',
  ]);

  const [name, setName] = useState(solutionName ?? '');
  const [origin, setOrigin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Confirm-by-typing, like the delete dialogs this pattern comes from.
  const [dialog, setDialog] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => { setName(solutionName ?? ''); }, [solutionName]);
  useEffect(() => {
    void consoleClient.listSolutions()
      .then((sols) => setOrigin(sols.find((s) => s.id === solutionId)?.origin ?? null))
      .catch(() => setOrigin(null));
  }, [solutionId]);

  const dirty = name.trim() !== (solutionName ?? '') && name.trim() !== '';

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!solutionId || !dirty) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      await consoleClient.updateSolution({ solutionId, name: name.trim() });
      // The header crumb and every screen showing the name read shell state.
      shellStore.set((prev) => ({ ...prev, solutionName: name.trim() }));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!solutionId) return;
    setBusy(true); setError(null);
    try {
      await consoleClient.deleteSolution(solutionId);
      setDialog(false);
      exitToWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDialog(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2 className="admin-title">Settings</h2>
        <p className="admin-sub">This solution's profile. Its id is permanent — everything designed and run against it is keyed on that.</p>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <form className="admin-form" onSubmit={save}>
        <h3 className="admin-form-title">Profile</h3>
        <label className="admin-field">
          <span>Name</span>
          <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} placeholder="Asset Maintenance" />
        </label>
        <div className="admin-row">
          <button type="submit" className="admin-btn" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</button>
          {saved && !dirty && <span className="admin-muted">Saved</span>}
        </div>
      </form>

      <div className="admin-section">
        <h3 className="admin-form-title">Identity</h3>
        <table className="admin-table">
          <tbody>
            <tr><th>Solution id</th><td className="admin-mono">{solutionId}</td></tr>
            <tr><th>Origin</th><td className="admin-muted">{origin ?? '—'}</td></tr>
            <tr><th>Operations</th><td>{dataOperations.length}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="danger-zone">
        <h3 className="danger-title">Delete solution</h3>
        <p className="danger-text">
          Permanently delete solution <strong>{solutionName ?? solutionId}</strong>, its model, its pages and
          the {dataOperations.length} operation{dataOperations.length === 1 ? '' : 's'} running it — with their records.
          This action is not reversible. Proceed with caution.
        </p>
        <button className="danger-btn" onClick={() => { setTyped(''); setDialog(true); }}>Delete solution</button>
      </div>

      {dialog && (
        <div className="admin-overlay" onClick={() => setDialog(false)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-title">Delete {solutionName ?? solutionId}</h3>
            <p className="admin-sub">
              This deletes the model, the pages, every published version, and the operations running it along with
              their records. There is no undo.
            </p>
            <div className="admin-modal-form">
              <label className="admin-field">
                <span>Type the solution name to confirm</span>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
              </label>
              <div className="admin-row admin-modal-actions">
                <button
                  className="danger-btn"
                  disabled={busy || typed !== (solutionName ?? solutionId)}
                  onClick={() => void remove()}
                >
                  {busy ? 'Deleting…' : 'Delete solution'}
                </button>
                <button className="admin-link" onClick={() => setDialog(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const css = `
  .danger-zone {
    max-width: 560px;
    border: 1px solid #7a2a2a;
    border-radius: 6px;
    padding: 14px 16px;
    margin-top: 8px;
  }
  .danger-title { margin: 0 0 4px; font-size: 0.9rem; font-weight: 600; color: #f0a0a0; }
  .danger-text { margin: 0 0 12px; font-size: 0.8rem; color: var(--color-text-muted); line-height: 1.5; }
  .danger-btn {
    background: #8b2f2f; color: #fff; border: none; border-radius: 4px;
    padding: 7px 14px; font-size: 0.82rem; font-family: inherit; cursor: pointer;
  }
  .danger-btn:hover { background: #a33636; }
  .danger-btn:disabled { opacity: 0.45; cursor: default; }
`;
