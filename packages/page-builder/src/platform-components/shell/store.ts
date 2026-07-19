import { createContextStore } from '../../store/contextStore';

export type FileNode =
  | { kind: 'folder'; name: string; children: FileNode[] }
  | { kind: 'page'; name: string; path: string };

export type ActivityItem = 'explorer' | 'search' | 'sdm' | 'components' | 'admin';

/** Admin content tabs (Console §3) share the tab strip with pages; the
 *  `admin/` prefix routes them to the admin views instead of the page editor. */
export const ADMIN_TAB = {
  operations: 'admin/operations',
  menu: 'admin/menu',
  assignments: 'admin/assignments',
  implementers: 'admin/implementers',
} as const;

export interface ShellState {
  activeActivityItem: ActivityItem | null;
  tree: FileNode[];
  openTabs: string[];
  activeTab: string | null;
  consoleOpen: boolean;
  consoleHeight: number;
}

export const shellStore = createContextStore<ShellState>({
  activeActivityItem: 'explorer',
  tree: [],
  openTabs: [],
  activeTab: null,
  consoleOpen: true,
  consoleHeight: 200,
});

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
