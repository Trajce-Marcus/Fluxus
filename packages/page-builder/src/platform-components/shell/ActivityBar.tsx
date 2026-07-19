import { shellStore, type ActivityItem } from './store';
import { useShellState } from './useShellState';

const ITEMS: { id: ActivityItem; label: string; path: string }[] = [
  {
    id: 'explorer',
    label: 'Pages',
    path: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z',
  },
  {
    id: 'search',
    label: 'Search',
    path: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  },
  {
    id: 'components',
    label: 'Components',
    path: 'M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5A2.5 2.5 0 0 0 10.5 1 2.5 2.5 0 0 0 8 3.5V5H4c-1.1 0-2 .9-2 2v3.8h1.5c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5a2.5 2.5 0 0 0 2.5-2.5 2.5 2.5 0 0 0-2.5-2.5z',
  },
  {
    id: 'sdm',
    label: 'Simple Data Model',
    path: 'M20 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 2v3H5V5h15zm-5 14h-5v-9h5v9zm-7 0H5v-9h3v9zm12 0h-3v-9h3v9z',
  },
  {
    id: 'admin',
    label: 'Administration',
    path: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm6.5-9.5l1.5-1.5-1.4-1.4-1.5 1.5c-.3-.2-.64-.36-1-.48V1h-2v1.62c-.36.12-.7.28-1 .48L11.1 1.6 9.7 3l1.5 1.5c-.2.3-.36.64-.48 1H9v.02A6 6 0 0 1 18.98 8H21V6h-1.62c-.12-.36-.28-.7-.48-1z',
  },
];

function ActivityBarComponent() {
  const { activeActivityItem } = useShellState(['activeActivityItem']);

  function handleClick(id: ActivityItem) {
    shellStore.set((prev) => ({
      ...prev,
      activeActivityItem: prev.activeActivityItem === id ? null : id,
    }));
  }

  return (
    <div className="activity-bar">
      {ITEMS.map(({ id, label, path }) => (
        <button
          key={id}
          className={`activity-bar-btn${activeActivityItem === id ? ' active' : ''}`}
          title={label}
          onClick={() => handleClick(id)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d={path} />
          </svg>
        </button>
      ))}
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
