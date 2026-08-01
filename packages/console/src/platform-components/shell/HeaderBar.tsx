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

  const { solutionId, solutionName } = useShellState(['solutionId', 'solutionName']);

  return (
    <div className="header-bar">
      {/* The wordmark is the way home: back out of any solution to the
          organisation (M17). */}
      <button className="header-logo" onClick={() => exitToWorkspace()} title="Back to the organisation">
        Fluxus
      </button>
      {orgName && <span className="header-org" title="Organisation">{orgName}</span>}
      {solutionId && <SolutionCrumb solutionId={solutionId} solutionName={solutionName} />}
      {/* The operation picker left the header (ruled 2026-07-31): it governs
          record data, so it lives in the workbench side menu, next to the data
          it governs. The choice is still solution-wide — the page preview
          reads it too. */}
      <div className="header-spacer" />
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
`;

export const HeaderBar = HeaderBarComponent;
