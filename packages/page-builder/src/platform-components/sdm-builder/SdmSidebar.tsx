// Sidebar for the Simple Data Model activity (solution-level): a flat list of
// model sections; clicking opens the matching content tab. Slice 1 — record
// types, the attribute pool, and role defs (plain-form editing, no DSL).

import { SDM_TAB } from '../shell/store';
import { openTab } from '../shell/store';
import { useShellState } from '../shell/useShellState';

const SECTIONS: { key: string; label: string }[] = [
  { key: SDM_TAB.recordTypes, label: 'Record types' },
  { key: SDM_TAB.attributes, label: 'Attributes' },
  { key: SDM_TAB.workflows, label: 'Workflows' },
  { key: SDM_TAB.roles, label: 'Roles' },
];

export function SdmSidebar() {
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

// Reuses the shared `.admin-sidebar*` classes (defined in AdminSidebar).
export const css = ``;
