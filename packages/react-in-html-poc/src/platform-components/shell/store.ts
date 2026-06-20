import { createContextStore } from '../../store/contextStore';

export type FileNode =
  | { kind: 'folder'; name: string; children: FileNode[] }
  | { kind: 'page'; name: string; path: string };

export type ActivityItem = 'explorer' | 'search' | 'sdm' | 'components';

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

export function openPage(path: string): void {
  shellStore.set((prev) => {
    if (prev.openTabs.includes(path)) return { ...prev, activeTab: path };
    return { ...prev, openTabs: [...prev.openTabs, path], activeTab: path };
  });
}

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
