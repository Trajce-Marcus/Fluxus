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
  solutions: 'admin/solutions',
  operations: 'admin/operations',
  menu: 'admin/menu',
  assignments: 'admin/assignments',
  implementers: 'admin/implementers',
} as const;

/** Solution-level design tabs (SDM editor sections). */
export const SDM_TAB = {
  recordTypes: 'sdm/record-types',
  attributes: 'sdm/attributes',
  roles: 'sdm/roles',
} as const;

export interface ShellState {
  /** Open solution (design scope), or null in workspace mode. */
  solutionId: string | null;
  solutionName: string | null;
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
  scopeVersion: 0,
  activeActivityItem: 'workspace',
  tree: [],
  openTabs: [ADMIN_TAB.solutions],
  activeTab: ADMIN_TAB.solutions,
  consoleOpen: true,
  consoleHeight: 200,
});

/** Enter a solution's design scope (call after engine.openSolution resolves). */
export function enterSolutionScope(solutionId: string, solutionName: string): void {
  shellStore.set((prev) => ({
    ...prev,
    solutionId,
    solutionName,
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
