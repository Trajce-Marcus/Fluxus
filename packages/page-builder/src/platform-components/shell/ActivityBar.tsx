import { openTab, shellStore, WORKBENCH_TAB, type ActivityItem } from './store';
import { useShellState } from './useShellState';

const ICON = {
  workspace: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm6.5-9.5l1.5-1.5-1.4-1.4-1.5 1.5c-.3-.2-.64-.36-1-.48V1h-2v1.62c-.36.12-.7.28-1 .48L11.1 1.6 9.7 3l1.5 1.5c-.2.3-.36.64-.48 1H9v.02A6 6 0 0 1 18.98 8H21V6h-1.62c-.12-.36-.28-.7-.48-1z',
  explorer: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z',
  search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  components: 'M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5A2.5 2.5 0 0 0 10.5 1 2.5 2.5 0 0 0 8 3.5V5H4c-1.1 0-2 .9-2 2v3.8h1.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5a2.5 2.5 0 0 0 2.5-2.5 2.5 2.5 0 0 0-2.5-2.5z',
  sdm: 'M20 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 2v3H5V5h15zm-5 14h-5v-9h5v9zm-7 0H5v-9h3v9zm12 0h-3v-9h3v9z',
  workbench: 'M3 3h18a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm1 4v3h6V7H4zm8 0v3h8V7h-8zM4 12v3h6v-3H4zm8 0v3h8v-3h-8zM4 17v2h6v-2H4zm8 0v2h8v-2h-8z',
} as const;

// Most items open a sidebar panel; a `tab` item is a shortcut that opens its
// content tab directly — the workbench is a surface, not a browser, so there
// is nothing to list beside it (M15).
type BarItem =
  | { kind: 'panel'; id: ActivityItem; label: string; path: string }
  | { kind: 'tab'; tab: string; label: string; path: string };

const WORKSPACE_ITEMS: BarItem[] = [
  { kind: 'panel', id: 'workspace', label: 'Workspace', path: ICON.workspace },
];

const SOLUTION_ITEMS: BarItem[] = [
  { kind: 'panel', id: 'explorer', label: 'Pages', path: ICON.explorer },
  { kind: 'panel', id: 'sdm', label: 'Shared Data Model', path: ICON.sdm },
  { kind: 'tab', tab: WORKBENCH_TAB, label: 'Workbench', path: ICON.workbench },
  { kind: 'panel', id: 'components', label: 'Components', path: ICON.components },
  { kind: 'panel', id: 'search', label: 'Search', path: ICON.search },
];

function ActivityBarComponent() {
  const { activeActivityItem, solutionId, activeTab } = useShellState([
    'activeActivityItem',
    'solutionId',
    'activeTab',
  ]);
  const items = solutionId ? SOLUTION_ITEMS : WORKSPACE_ITEMS;

  function togglePanel(id: ActivityItem) {
    shellStore.set((prev) => ({
      ...prev,
      activeActivityItem: prev.activeActivityItem === id ? null : id,
    }));
  }

  return (
    <div className="activity-bar">
      {items.map((item) => {
        const active = item.kind === 'panel' ? activeActivityItem === item.id : activeTab === item.tab;
        return (
          <button
            key={item.kind === 'panel' ? item.id : item.tab}
            className={`activity-bar-btn${active ? ' active' : ''}`}
            title={item.label}
            onClick={() => (item.kind === 'panel' ? togglePanel(item.id) : openTab(item.tab))}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d={item.path} />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

export const css = `
  .activity-bar {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 4px;
    gap: 2px;
    background: var(--color-activity);
    border-right: 1px solid var(--color-border);
    height: 100%;
  }
  .activity-bar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    cursor: pointer;
    color: var(--color-text-muted);
    transition: color 0.1s;
  }
  .activity-bar-btn:hover {
    color: var(--color-text);
  }
  .activity-bar-btn.active {
    color: var(--color-text);
    border-left-color: var(--color-accent);
  }
`;

export const ActivityBar = ActivityBarComponent;
