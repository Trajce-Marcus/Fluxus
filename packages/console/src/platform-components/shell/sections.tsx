// The Console section registry (CONSOLE_RUNTIME_SPEC §3, M16) — the shell's
// extensibility seam. The nav, the content area and the router all render from
// these arrays; adding a Console surface is one entry here. A section's inner
// chrome (master/detail lists, editor tabs, panels) is its own business — the
// shell never knows.

import type { JSX } from 'react';
import { AdminView } from '../admin/AdminView';
import { SdmView } from '../sdm-builder/SdmView';
import { WorkbenchView } from '../workbench/WorkbenchView';
import { DslEditorView } from '../dsl-editor/DslEditorView';
import { PagesSection } from '../page-builder/PagesSection';
import { OverviewSection } from './OverviewSection';
import { SolutionOperationsSection } from './SolutionOperationsSection';
import { SolutionSettingsSection } from './SolutionSettingsSection';
import { SolutionUsersScreen } from '../users';
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
const ORG_GROUP = 'Organisation';
const SOLUTION_GROUP = 'Solution';
const DATA_GROUP = 'Data';

/** The organisation home (M17) — the tenant's own surfaces. Solutions is our
 *  Projects; Users/Billing/Integrations are the IA the org tier implies, with
 *  placeholder content where nothing is built (§1a: no signup, no billing).
 *
 *  "People" was retired 2026-08-04: the section holds users, so it is named
 *  Users, and its two audiences are two nav items rather than an inner panel. */
export const WORKSPACE_SECTIONS: ConsoleSection[] = [
  { id: 'solutions', label: 'Solutions', group: ORG_GROUP, render: () => <AdminView tab="solutions" /> },
  { id: 'users', label: 'Users', group: ORG_GROUP, render: () => <AdminView tab="users" /> },
  { id: 'billing', label: 'Billing', group: ORG_GROUP, render: () => <AdminView tab="billing" /> },
  { id: 'integrations', label: 'Integrations', group: ORG_GROUP, render: () => <AdminView tab="integrations" /> },
  { id: 'settings', label: 'Settings', group: ORG_GROUP, render: () => <AdminView tab="settings" /> },
];

export const SOLUTION_SECTIONS: ConsoleSection[] = [
  { id: 'overview', label: 'Overview', group: SOLUTION_GROUP, render: () => <OverviewSection /> },
  { id: 'operations', label: 'Operations', group: SOLUTION_GROUP, render: () => <SolutionOperationsSection /> },
  /* Solution → Users (2026-08-04): who builds this solution (read-only — it is
     appointed at the organisation) and who runs its operations. Not rendered
     for sol admins, who see no user list anywhere. */
  { id: 'users', label: 'Users', group: SOLUTION_GROUP, render: () => <SolutionUsersScreen /> },
  { id: 'pages', label: 'Pages', group: SOLUTION_GROUP, render: () => <PagesSection /> },
  { id: 'settings', label: 'Settings', group: SOLUTION_GROUP, render: () => <SolutionSettingsSection /> },
  { id: 'record-types', label: 'Record types', group: SDM_GROUP, render: () => <SdmView tab="record-types" />, canLeave: canLeaveSdm },
  { id: 'attributes', label: 'Attributes', group: SDM_GROUP, render: () => <SdmView tab="attributes" />, canLeave: canLeaveSdm },
  { id: 'workflows', label: 'Workflows', group: SDM_GROUP, render: () => <SdmView tab="workflows" />, canLeave: canLeaveSdm },
  { id: 'roles', label: 'Roles', group: SDM_GROUP, render: () => <SdmView tab="roles" />, canLeave: canLeaveSdm },
  { id: 'menu', label: 'Menu', group: SDM_GROUP, render: () => <SdmView tab="menu" />, canLeave: canLeaveSdm },
  { id: 'workbench', label: 'Workbench', group: DATA_GROUP, render: () => <WorkbenchView /> },
  /* Ad-hoc FluxScript over an operation's records, read-only (DSL_EDITOR_SPEC).
     A sibling of the workbench rather than a tab inside it: the workbench's
     frame is one record type at a time, and a query is not. */
  { id: 'dsl-editor', label: 'DSL Editor', group: DATA_GROUP, render: () => <DslEditorView /> },
];

export function sectionsForScope(solutionOpen: boolean): ConsoleSection[] {
  return solutionOpen ? SOLUTION_SECTIONS : WORKSPACE_SECTIONS;
}
