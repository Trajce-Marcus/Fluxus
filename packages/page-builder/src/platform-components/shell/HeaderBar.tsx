// Breadcrumb header (M16): `Fluxus · <org>` always; in solution scope
// ` / <solution> ▾` — the crumb is a dropdown listing the org's solutions
// (switch from anywhere) plus "All solutions" back to workspace. The Data
// picker (M9) keeps the header's right in solution scope.

import { useEffect, useRef, useState } from 'react';
import { useShellState } from './useShellState';
import { shellStore } from './store';
import { exitToWorkspace, openSolutionScoped } from './router';
import { consoleClient, openSolution } from '../../sdm-runtime/engine';

function SolutionCrumb({ solutionId, solutionName }: { solutionId: string; solutionName: string | null }) {
  const [open, setOpen] = useState(false);
  const [solutions, setSolutions] = useState<{ id: string; name: string }[] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (!solutions) {
      void consoleClient.listSolutions().then(setSolutions).catch(() => setSolutions([]));
    }
    function onDocClick(e: MouseEvent) {
      // The shell lives in a shadow root: document-level events retarget to the
      // host, so read the real target off the composed path.
      const target = e.composedPath()[0] as Node;
      if (!wrapRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open, solutions]);

  function pick(sol: { id: string; name: string }) {
    setOpen(false);
    if (sol.id !== solutionId) void openSolutionScoped(sol.id, sol.name);
  }

  return (
    <div className="crumb-wrap" ref={wrapRef}>
      <span className="crumb-sep">/</span>
      <button className="crumb-btn" onClick={() => setOpen((v) => !v)}>
        <span className="crumb-name">{solutionName ?? solutionId}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
      </button>
      {open && (
        <div className="crumb-menu">
          <button
            className="crumb-menu-item crumb-menu-all"
            onClick={() => { setOpen(false); exitToWorkspace(); }}
          >
            ← All solutions
          </button>
          {solutions === null && <div className="crumb-menu-empty">Loading…</div>}
          {solutions?.map((sol) => (
            <button
              key={sol.id}
              className={`crumb-menu-item${sol.id === solutionId ? ' current' : ''}`}
              onClick={() => pick(sol)}
            >
              {sol.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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
      {/* The wordmark is the way home: back out of any solution to the
          organisation (M17). */}
      <button className="header-logo" onClick={() => exitToWorkspace()} title="Back to the organisation">
        Fluxus
      </button>
      {orgName && <span className="header-org" title="Organisation">{orgName}</span>}
      {solutionId && <SolutionCrumb solutionId={solutionId} solutionName={solutionName} />}
      <div className="header-spacer" />
      {solutionId && (
        /* Which operation's records the SDM editor and page preview show.
           Always visible in solution scope: the data you build against is a
           deliberate, named choice, never an invisible difference between
           Console and Runtime. */
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
      )}
    </div>
  );
}

export const css = `
  .header-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 1rem;
    height: 100%;
    background: var(--color-header);
    border-bottom: 1px solid var(--color-border);
  }
  .header-logo {
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text);
    white-space: nowrap;
    flex-shrink: 0;
    padding: 3px 6px;
  }
  .header-logo:hover { background: rgba(255,255,255,0.06); border-color: var(--color-border); }
  .header-org {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--color-text);
    white-space: nowrap;
    padding-left: 12px;
    border-left: 1px solid var(--color-border);
    flex-shrink: 0;
  }
  .header-spacer { flex: 1; }
  .crumb-wrap { position: relative; display: flex; align-items: center; gap: 10px; }
  .crumb-sep { color: var(--color-text-muted); }
  .crumb-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--color-text);
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
    font-family: inherit;
    padding: 3px 8px;
  }
  .crumb-btn:hover { background: rgba(255,255,255,0.06); border-color: var(--color-border); }
  .crumb-btn svg { color: var(--color-text-muted); }
  .crumb-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 14px;
    min-width: 220px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--color-sidebar);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.45);
    padding: 4px;
    z-index: 100;
  }
  .crumb-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-radius: 4px;
    color: var(--color-text);
    cursor: pointer;
    font-size: 0.82rem;
    font-family: inherit;
    padding: 6px 10px;
  }
  .crumb-menu-item:hover { background: rgba(255,255,255,0.06); }
  .crumb-menu-item.current { color: var(--color-accent); }
  .crumb-menu-all {
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
    border-radius: 4px 4px 0 0;
    margin-bottom: 4px;
  }
  .crumb-menu-empty { padding: 6px 10px; font-size: 0.8rem; color: var(--color-text-muted); }
  .header-data { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
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
