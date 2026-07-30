import { createContextStore } from '../../store/contextStore';

export type FileNode =
  | { kind: 'folder'; name: string; children: FileNode[] }
  | { kind: 'page'; name: string; path: string };

// Two-level IA (CONSOLE_RUNTIME_SPEC §3): workspace scope (no solution open —
// cross-solution/org admin) vs solution scope (a solution open — its design
// artifacts). Which section set the nav shows is chosen by `solutionId`
// presence; the sections themselves live in the registry (sections.tsx, M16).

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
  /** Active nav section (registry id) within the current scope. */
  activeSection: string;
  tree: FileNode[];
  /** Open page-editor tabs (M16: page paths only — sections are not tabs). */
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
  activeSection: 'solutions',
  tree: [],
  openTabs: [],
  activeTab: null,
  consoleOpen: true,
  consoleHeight: 200,
});

/** Enter a solution's design scope (call after engine.openSolution resolves —
 *  it decides which operation supplies the records). */
export function enterSolutionScope(
  solutionId: string,
  solutionName: string,
  data: { operationId: string | null; operations: { id: string; name: string }[] } = { operationId: null, operations: [] },
  section = 'overview',
): void {
  shellStore.set((prev) => ({
    ...prev,
    solutionId,
    solutionName,
    dataOperationId: data.operationId,
    dataOperations: data.operations,
    scopeVersion: prev.scopeVersion + 1,
    activeSection: section,
    openTabs: [],
    activeTab: null,
  }));
}

/** Return to workspace mode (Solutions list). */
export function exitSolutionScope(section = 'solutions'): void {
  shellStore.set((prev) => ({
    ...prev,
    solutionId: null,
    solutionName: null,
    dataOperationId: null,
    dataOperations: [],
    scopeVersion: prev.scopeVersion + 1,
    activeSection: section,
    openTabs: [],
    activeTab: null,
  }));
}

/** Open (or focus) a page-editor tab. */
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
