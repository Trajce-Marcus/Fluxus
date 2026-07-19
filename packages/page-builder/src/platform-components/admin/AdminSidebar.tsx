// Sidebar for the Administration activity (Console §3): a flat list of admin
// sections; clicking opens the matching content tab. Operations today;
// assignments / implementer levels join as their milestones land.

import { ADMIN_TAB, openTab } from '../shell/store';
import { useShellState } from '../shell/useShellState';

const SECTIONS: { key: string; label: string }[] = [
  { key: ADMIN_TAB.operations, label: 'Operations' },
  { key: ADMIN_TAB.menu, label: 'Operation menu' },
  { key: ADMIN_TAB.assignments, label: 'Role assignments' },
  { key: ADMIN_TAB.implementers, label: 'Implementer levels' },
];

export function AdminSidebar() {
  const { activeTab } = useShellState(['activeTab']);
  return (
    <div className="admin-sidebar">
      {SECTIONS.map(({ key, label }) => (
        <button
          key={key}
          className={`admin-sidebar-item${activeTab === key ? ' active' : ''}`}
          onClick={() => openTab(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export const css = `
  .admin-sidebar { display: flex; flex-direction: column; padding: 4px 0; }
  .admin-sidebar-item {
    text-align: left; background: none; border: none; cursor: pointer;
    color: var(--color-text); padding: 6px 14px; font-size: 0.82rem;
    border-left: 2px solid transparent;
  }
  .admin-sidebar-item:hover { background: rgba(255,255,255,0.04); }
  .admin-sidebar-item.active { border-left-color: var(--color-accent); background: rgba(255,255,255,0.06); }
`;
