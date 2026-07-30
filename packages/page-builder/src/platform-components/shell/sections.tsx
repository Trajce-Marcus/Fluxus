// The Console section registry (CONSOLE_RUNTIME_SPEC §3, M16) — the shell's
// extensibility seam. The nav, the content area and the router all render from
// these arrays; adding a Console surface is one entry here. A section's inner
// chrome (master/detail lists, editor tabs, panels) is its own business — the
// shell never knows.

import type { JSX } from 'react';
import { AdminView } from '../admin/AdminView';
import { SdmView } from '../sdm-builder/SdmView';
import { WorkbenchView } from '../workbench/WorkbenchView';
import { PagesSection } from '../page-builder/PagesSection';
import { OverviewSection } from './OverviewSection';
import { sdmDirty, setSdmDirty } from '../sdm-builder/useSolutionConfig';

export interface ConsoleSection {
  /** Registry id — nav key and route segment. */
  id: string;
  label: string;
  /** Nav group heading (flat label above the item, not a collapsible tree). */
  group?: string;
  render: () => JSX.Element;
  /** Veto navigation away (e.g. dirty-draft confirm). */
  canLeave?: () => boolean;
}

/** Leaving an SDM section unmounts its editor, which throws away its draft —
 *  so a dirty editor gets one confirm first (moved here from SdmSidebar). */
function canLeaveSdm(): boolean {
  if (sdmDirty.current && !window.confirm('Discard unsaved SDM changes?')) return false;
  setSdmDirty(false);
  return true;
}

const SDM_GROUP = 'Shared Data Model';

export const WORKSPACE_SECTIONS: ConsoleSection[] = [
  { id: 'organisation', label: 'Organisation', render: () => <AdminView tab="organisation" /> },
  { id: 'solutions', label: 'Solutions', render: () => <AdminView tab="solutions" /> },
  { id: 'operations', label: 'Operations', render: () => <AdminView tab="operations" /> },
  { id: 'implementers', label: 'Implementer levels', render: () => <AdminView tab="implementers" /> },
];

export const SOLUTION_SECTIONS: ConsoleSection[] = [
  { id: 'overview', label: 'Overview', render: () => <OverviewSection /> },
  { id: 'pages', label: 'Pages', render: () => <PagesSection /> },
  { id: 'record-types', label: 'Record types', group: SDM_GROUP, render: () => <SdmView tab="record-types" />, canLeave: canLeaveSdm },
  { id: 'attributes', label: 'Attributes', group: SDM_GROUP, render: () => <SdmView tab="attributes" />, canLeave: canLeaveSdm },
  { id: 'workflows', label: 'Workflows', group: SDM_GROUP, render: () => <SdmView tab="workflows" />, canLeave: canLeaveSdm },
  { id: 'roles', label: 'Roles', group: SDM_GROUP, render: () => <SdmView tab="roles" />, canLeave: canLeaveSdm },
  { id: 'menu', label: 'Menu', group: SDM_GROUP, render: () => <SdmView tab="menu" />, canLeave: canLeaveSdm },
  { id: 'workbench', label: 'Workbench', render: () => <WorkbenchView /> },
];

export function sectionsForScope(solutionOpen: boolean): ConsoleSection[] {
  return solutionOpen ? SOLUTION_SECTIONS : WORKSPACE_SECTIONS;
}
