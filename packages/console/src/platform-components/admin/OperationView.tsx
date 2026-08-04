// The operation view (CONSOLE_RUNTIME_SPEC §3) — everything about one running
// operation, behind a tab strip. M11 stacked Overview/Menu/Assignments down one
// scrolling page; the surfaces an operation needs (identity, its users, its
// menu, data administration) no longer fit that way, so they become tabs and
// the header — name, id, linked solution, Open in Runtime — stays put above
// them.
//
// Only **Users** and **Menu** are built (they are the M10/M11 surfaces moved
// under tabs unchanged). Overview, Data and Settings are placeholders that say
// plainly what will live there — the M17 convention, not fake empty data. What
// each one becomes is still to be specified.

import { useState } from 'react';
import type { OperationRow } from '@fluxus/client';
import { OperationMenuSection } from './OperationMenuSection';
import { OperationUsersScreen } from '../users';
import { PlaceholderCard } from './Placeholder';

type OpTab = 'overview' | 'users' | 'menu' | 'data' | 'settings';

const TABS: { id: OpTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'menu', label: 'Menu' },
  { id: 'data', label: 'Data' },
  { id: 'settings', label: 'Settings' },
];

export function OperationView({ operation, solutionName, onOpenRuntime }: {
  operation: OperationRow;
  /** Display name of the solution this operation runs (id is the fallback). */
  solutionName: string;
  onOpenRuntime: (op: OperationRow) => void;
}) {
  const [tab, setTab] = useState<OpTab>('overview');

  return (
    <div className="op-view">
      <div className="op-head">
        <div className="admin-head-row">
          <div>
            <h2 className="admin-title">{operation.name}</h2>
            <p className="admin-sub">
              <span className="admin-mono">{operation.id}</span>
              {' · runs '}<strong>{solutionName}</strong>
            </p>
          </div>
          <button className="admin-btn" onClick={() => onOpenRuntime(operation)} title="Run this operation in the Runtime app">
            Open in Runtime app
          </button>
        </div>
        <div className="op-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === tab}
              className={`op-tab${t.id === tab ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="op-body">
        {tab === 'overview' && <OverviewTab operation={operation} solutionName={solutionName} />}
        {tab === 'users' && <OperationUsersScreen operationId={operation.id} operationName={operation.name} />}
        {tab === 'menu' && <OperationMenuSection operationId={operation.id} solutionId={operation.solutionId} />}
        {tab === 'data' && <DataTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}

/** Identity as it is stored today, plus what the profile is still missing.
 *  Status and owner are **not modelled** — `operations` carries id, org,
 *  solution, name and config and nothing else — so they read as unset rather
 *  than being invented here. */
function OverviewTab({ operation, solutionName }: { operation: OperationRow; solutionName: string }) {
  return (
    <div className="admin-section">
      <h3 className="admin-section-title">Profile</h3>
      <p className="admin-sub">What this operation is. The link to its solution is permanent — there is no re-point path.</p>
      <table className="admin-table" style={{ maxWidth: 560, marginTop: 12 }}>
        <tbody>
          <tr><th>Name</th><td>{operation.name}</td></tr>
          <tr><th>Id</th><td className="admin-mono">{operation.id}</td></tr>
          <tr><th>Runs solution</th><td>{solutionName} <span className="admin-muted admin-mono">{operation.solutionId}</span></td></tr>
          <tr><th>Organisation</th><td className="admin-mono">{operation.orgId}</td></tr>
          <tr><th>Status</th><td className="admin-muted">Not stored yet</td></tr>
          <tr><th>Owner</th><td className="admin-muted">Not stored yet</td></tr>
        </tbody>
      </table>
      <div style={{ marginTop: 16 }}>
        <PlaceholderCard items={[
          'Status — active / suspended / archived, and what each means at runtime',
          'Owner — the accountable user, once the auth tier resolves user → org',
          'Created and last-run timestamps',
          'Record and activity-run counts',
        ]} />
      </div>
    </div>
  );
}


function DataTab() {
  return (
    <div className="admin-section">
      <h3 className="admin-section-title">Data</h3>
      <p className="admin-sub">This operation's own records — it owns a partition of its own, keyed on the operation.</p>
      <div style={{ marginTop: 12 }}>
        <PlaceholderCard items={[
          'Archiving — move closed records out of the working set',
          'Retention rules, per record type',
          "Export a snapshot of the operation's data",
          'Import / seed from a snapshot',
          'Purge, with the same confirm-by-typing as a solution delete',
        ]} />
      </div>
    </div>
  );
}

function SettingsTab() {
  return (
    <div className="admin-section">
      <h3 className="admin-section-title">Settings</h3>
      <p className="admin-sub">The writable half of the profile, and the danger zone.</p>
      <div style={{ marginTop: 12 }}>
        <PlaceholderCard items={[
          'Rename the operation (the id stays permanent)',
          'Set status — suspend or reactivate',
          'Assign the owner',
          'Delete the operation and its records',
        ]} />
      </div>
    </div>
  );
}

export const css = `
  .op-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    color: var(--color-text);
  }
  .op-head { flex-shrink: 0; padding: 20px 24px 0; }
  .op-tabs {
    display: flex;
    gap: 2px;
    margin-top: 14px;
    border-bottom: 1px solid var(--color-border);
  }
  .op-tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.82rem;
    padding: 7px 12px;
  }
  .op-tab:hover { color: var(--color-text); }
  .op-tab.active { color: var(--color-text); border-bottom-color: var(--color-accent); }
  .op-body { flex: 1; overflow-y: auto; padding: 4px 24px 24px; min-height: 0; }
  /* The first section in a tab body sits right under the strip — its title
     border would double the strip's. */
  .op-body > .admin-section:first-child > .admin-section-title {
    border-top: none;
    padding-top: 4px;
  }
`;
