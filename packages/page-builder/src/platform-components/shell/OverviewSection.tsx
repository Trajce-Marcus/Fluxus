// Solution Overview (M16) — the lean landing page for a freshly opened
// solution: identity, its operations (and which one supplies the design data),
// and where to go next. Arrival, not teleportation into an editor.

import { useEffect, useState } from 'react';
import { useShellState } from './useShellState';
import { navigateSection } from './router';
import { consoleClient } from '../../sdm-runtime/engine';

const LINKS = [
  { id: 'pages', label: 'Pages', hint: 'Build and publish the app’s pages' },
  { id: 'record-types', label: 'Shared Data Model', hint: 'Record types, attributes, workflows, roles, menu' },
  { id: 'workbench', label: 'Workbench', hint: 'Raw records and activity runs against the data operation' },
];

function OverviewSectionComponent() {
  const { solutionId, solutionName, dataOperationId, dataOperations } = useShellState([
    'solutionId', 'solutionName', 'dataOperationId', 'dataOperations',
  ]);
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    void consoleClient.listSolutions()
      .then((sols) => setOrigin(sols.find((s) => s.id === solutionId)?.origin ?? null))
      .catch(() => setOrigin(null));
  }, [solutionId]);

  return (
    <div className="admin-panel overview">
      <div className="admin-panel-head">
        <h2 className="admin-title">{solutionName ?? solutionId}</h2>
        <span className="admin-mono overview-id">{solutionId}</span>
        {origin && <span className="overview-origin">{origin}</span>}
      </div>

      <div className="admin-section">
        <h3 className="admin-section-title">Operations</h3>
        {dataOperations.length === 0 ? (
          <p className="admin-muted">
            None yet — create one under Operations to run this solution and to build against real records.
          </p>
        ) : (
          <ul className="overview-ops">
            {dataOperations.map((op) => (
              <li key={op.id} className="overview-op">
                <span>{op.name}</span>
                <span className="admin-mono overview-id">{op.id}</span>
                {op.id === dataOperationId && <span className="overview-data-badge">design data</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="admin-section">
        <h3 className="admin-section-title">Design</h3>
        <div className="overview-links">
          {LINKS.map((l) => (
            <button key={l.id} className="overview-link" onClick={() => navigateSection(l.id)}>
              <span className="overview-link-label">{l.label}</span>
              <span className="overview-link-hint">{l.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export const css = `
  .overview { max-width: 720px; }
  .overview-id { font-size: 0.72rem; color: var(--color-text-muted); }
  .overview-origin {
    font-size: 0.7rem;
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
    border-radius: 10px;
    padding: 1px 8px;
  }
  .overview-ops { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .overview-op { display: flex; align-items: center; gap: 10px; font-size: 0.84rem; }
  .overview-data-badge {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-accent);
    border: 1px solid var(--color-accent);
    border-radius: 10px;
    padding: 0 7px;
  }
  .overview-links { display: flex; flex-direction: column; gap: 8px; }
  .overview-link {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    text-align: left;
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    cursor: pointer;
    color: var(--color-text);
    font-family: inherit;
    padding: 10px 14px;
  }
  .overview-link:hover { background: rgba(255,255,255,0.06); }
  .overview-link-label { font-size: 0.86rem; font-weight: 600; }
  .overview-link-hint { font-size: 0.76rem; color: var(--color-text-muted); }
`;

export const OverviewSection = OverviewSectionComponent;
