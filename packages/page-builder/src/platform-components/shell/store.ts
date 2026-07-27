import { createContextStore } from '../../store/contextStore';

export type FileNode =
  | { kind: 'folder'; name: string; children: FileNode[] }
  | { kind: 'page'; name: string; path: string };

// Two-level IA (CONSOLE_RUNTIME_SPEC §3): workspace-level items (no solution
// open — cross-solution/org admin) vs solution-level items (a solution open —
// its design artifacts). The active set is chosen by `solutionId` presence.
export type WorkspaceActivityItem = 'workspace';
export type SolutionActivityItem = 'explorer' | 'search' | 'sdm' | 'components';
export type ActivityItem = WorkspaceActivityItem | SolutionActivityItem;

/** Workspace admin content tabs (Console §3) share the tab strip; the `admin/`
 *  prefix routes them to the admin views instead of the page editor. */
export const ADMIN_TAB = {
  organisation: 'admin/organisation',
  solutions: 'admin/solutions',
  operations: 'admin/operations',
  implementers: 'admin/implementers',
} as const;

/** The workbench (CONSOLE_RUNTIME_SPEC §4, M15) — one solution-level content
 *  tab, opened straight from the activity bar. Raw record access and arbitrary
 *  activity runs are implementer work, so they live here, not in the Runtime
 *  app; the tab runs against the solution's current data operation. */
export const WORKBENCH_TAB = 'workbench';

/** Solution-level design tabs (SDM editor sections). */
export const SDM_TAB = {
  recordTypes: 'sdm/record-types',
  attributes: 'sdm/attributes',
  workflows: 'sdm/workflows',
  roles: 'sdm/roles',
  menu: 'sdm/menu',
} as const;

export interface ShellState {
  /** Open solution (design scope), or null in workspace mode. */
  solutionId: string | null;
  solutionName: string | null;
  /** Which operation's records the design views show (ruled 2026-07-26) —
   *  null when the open solution has no operations yet. */
  dataOperationId: string | null;
  /** The open solution's operations, for the header picker. */
  dataOperations: { id: string; name: string }[];
  /** Bumped on solution open/switch to remount the solution subtree. */
  scopeVersion: number;
  activeActivityItem: ActivityItem | null;
  tree: FileNode[];
  openTabs: string[];
  activeTab: string | null;
  consoleOpen: boolean;
  consoleHeight: number;
}

export const shellStore = createContextStore<ShellState>({
  solutionId: null,
  solutionName: null,
  dataOperationId: null,
  dataOperations: [],
  scopeVersion: 0,
  activeActivityItem: 'workspace',
  tree: [],
  openTabs: [ADMIN_TAB.solutions],
  activeTab: ADMIN_TAB.solutions,
  consoleOpen: true,
  consoleHeight: 200,
});

/** Enter a solution's design scope (call after engine.openSolution resolves —
 *  it decides which operation supplies the records). */
export function enterSolutionScope(
  solutionId: string,
  solutionName: string,
  data: { operationId: string | null; operations: { id: string; name: string }[] } = { operationId: null, operations: [] },
): void {
  shellStore.set((prev) => ({
    ...prev,
    solutionId,
    solutionName,
    dataOperationId: data.operationId,
    dataOperations: data.operations,
    scopeVersion: prev.scopeVersion + 1,
    activeActivityItem: 'explorer',
    openTabs: [],
    activeTab: null,
  }));
}

/** Return to workspace mode (Solutions list). */
export function exitSolutionScope(): void {
  shellStore.set((prev) => ({
    ...prev,
    solutionId: null,
    solutionName: null,
    dataOperationId: null,
    dataOperations: [],
    scopeVersion: prev.scopeVersion + 1,
    activeActivityItem: 'workspace',
    openTabs: [ADMIN_TAB.solutions],
    activeTab: ADMIN_TAB.solutions,
  }));
}

/** Open (or focus) a tab by key — page paths and `admin/*` keys alike. */
export function openTab(path: string): void {
  shellStore.set((prev) => {
    if (prev.openTabs.includes(path)) return { ...prev, activeTab: path };
    return { ...prev, openTabs: [...prev.openTabs, path], activeTab: path };
  });
}

/** @deprecated use openTab — kept for existing page-explorer callers. */
export const openPage = openTab;

export function closeTab(path: string): void {
  shellStore.set((prev) => {
    const idx = prev.openTabs.indexOf(path);
    const openTabs = prev.openTabs.filter((t) => t !== path);
    const activeTab =
      prev.activeTab === path
        ? (openTabs[Math.max(0, idx - 1)] ?? null)
        : prev.activeTab;
    return { ...prev, openTabs, activeTab };
  });
}
