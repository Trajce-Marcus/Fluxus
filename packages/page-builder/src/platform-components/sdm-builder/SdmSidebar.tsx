// Sidebar for the Shared Data Model activity (solution-level): a flat list of
// model sections; clicking opens the matching content tab. Slice 1 — record
// types, the attribute pool, and role defs (plain-form editing, no DSL).

import { SDM_TAB } from '../shell/store';
import { openTab } from '../shell/store';
import { useShellState } from '../shell/useShellState';
import { sdmDirty, setSdmDirty } from './useSolutionConfig';

const SECTIONS: { key: string; label: string }[] = [
  { key: SDM_TAB.recordTypes, label: 'Record types' },
  { key: SDM_TAB.attributes, label: 'Attributes' },
  { key: SDM_TAB.workflows, label: 'Workflows' },
  { key: SDM_TAB.roles, label: 'Roles' },
  { key: SDM_TAB.menu, label: 'Menu' },
];

/** Switching section unmounts the current editor, which throws away its draft —
 *  so a dirty editor gets one confirm first. Guarded here only: the other ways
 *  out (activity bar, header) stay as they are. */
function leaveSection(key: string) {
  if (sdmDirty.current && !window.confirm('Discard unsaved SDM changes?')) return;
  setSdmDirty(false);
  openTab(key);
}

export function SdmSidebar() {
  const { activeTab } = useShellState(['activeTab']);
  return (
    <div className="admin-sidebar">
      {SECTIONS.map(({ key, label }) => (
        <button
          key={key}
          className={`admin-sidebar-item${activeTab === key ? ' active' : ''}`}
          onClick={() => leaveSection(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Reuses the shared `.admin-sidebar*` classes (defined in AdminSidebar).
export const css = ``;
