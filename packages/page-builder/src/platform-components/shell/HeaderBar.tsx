import { useEffect, useState } from 'react';
import { useShellState } from './useShellState';
import { exitSolutionScope, shellStore } from './store';
import { consoleClient, openSolution } from '../../sdm-runtime/engine';

function HeaderBarComponent() {
  // The org you are acting as — pinned at both IA levels (workspace and
  // solution-open), because solutions and operations all belong to it (M14).
  const [orgName, setOrgName] = useState<string | null>(null);
  useEffect(() => {
    void consoleClient.getOrg().then((o) => setOrgName(o.name)).catch(() => setOrgName(null));
  }, []);

  const { solutionId, solutionName, dataOperationId, dataOperations } = useShellState([
    'solutionId', 'solutionName', 'dataOperationId', 'dataOperations',
  ]);

  // Switching the data operation re-opens the solution against that operation's
  // records and bumps scopeVersion, so every design view remounts on the new
  // data. The model and draft pages are unaffected — they are solution-scoped.
  async function switchOperation(operationId: string) {
    if (!solutionId) return;
    await openSolution(solutionId, operationId);
    shellStore.set((prev) => ({ ...prev, dataOperationId: operationId, scopeVersion: prev.scopeVersion + 1 }));
  }

  return (
    <div className="header-bar">
      <span className="header-logo">Fluxus</span>
      {orgName && <span className="header-org" title="Organisation">{orgName}</span>}
      {solutionId ? (
        <div className="header-solution">
          <button className="header-back" title="Back to Solutions" onClick={exitSolutionScope}>← Solutions</button>
          <span className="header-solution-name">{solutionName}</span>
          <span className="header-solution-id admin-mono">{solutionId}</span>
          {/* Which operation's records the SDM editor and page preview show.
              Always visible in solution scope: the data you build against is a
              deliberate, named choice, never an invisible difference between
              Console and Runtime. */}
          <label className="header-data">
            <span className="header-data-label">Data</span>
            {dataOperations.length > 0 ? (
              <select
                className="header-data-select"
                value={dataOperationId ?? ''}
                onChange={(e) => void switchOperation(e.target.value)}
              >
                {dataOperations.map((op) => (
                  <option key={op.id} value={op.id}>{op.name}</option>
                ))}
              </select>
            ) : (
              <span className="header-data-empty" title="Create an operation running this solution to build against real records">
                no operation
              </span>
            )}
          </label>
        </div>
      ) : (
        <div className="header-search">
          <svg className="header-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <input
            className="header-search-input"
            type="text"
            placeholder="Search"
            spellCheck={false}
          />
        </div>
      )}
      <div className="header-actions" />
    </div>
  );
}

export const css = `
  .header-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0 1rem;
    height: 100%;
    background: var(--color-header);
    border-bottom: 1px solid var(--color-border);
  }
  .header-logo {
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text);
    white-space: nowrap;
    width: 80px;
    flex-shrink: 0;
  }
  .header-org {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-text);
    white-space: nowrap;
    padding-left: 12px;
    border-left: 1px solid var(--color-border);
    flex-shrink: 0;
  }
  .header-search {
    flex: 1;
    max-width: 480px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(0,0,0,0.25);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 0 10px;
    height: 26px;
  }
  .header-search-icon {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }
  .header-search-input {
    background: none;
    border: none;
    outline: none;
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: inherit;
    width: 100%;
  }
  .header-search-input::placeholder {
    color: var(--color-text-muted);
  }
  .header-actions {
    width: 80px;
    flex-shrink: 0;
  }
  .header-solution {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .header-back {
    background: rgba(0,0,0,0.25);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-text);
    cursor: pointer;
    font-size: 0.78rem;
    padding: 3px 10px;
  }
  .header-back:hover { background: rgba(255,255,255,0.06); }
  .header-solution-name { font-size: 0.85rem; font-weight: 600; color: var(--color-text); }
  .header-solution-id { font-size: 0.72rem; color: var(--color-text-muted); }
  .header-data { display: flex; align-items: center; gap: 6px; margin-left: auto; }
  .header-data-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
  }
  .header-data-select {
    background: rgba(0,0,0,0.25);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-text);
    font-family: inherit;
    font-size: 0.78rem;
    padding: 2px 6px;
  }
  .header-data-empty { font-size: 0.78rem; color: var(--color-text-muted); font-style: italic; }
`;

export const HeaderBar = HeaderBarComponent;
