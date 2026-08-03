import { createContextStore, type ContextStore } from '../../../store/contextStore';
import { savePageLayout, loadPageLayout } from '../persistence';
import type { LayoutDefinition, Panel } from './types';

export interface LayoutPageState {
  current: LayoutDefinition;
  past: LayoutDefinition[];
  future: LayoutDefinition[];
  selectedPanelId: string;
}

function makeRoot(): Panel {
  return {
    id: crypto.randomUUID(),
    name: 'ROOT',
    direction: 'vertical',
    size: { type: 'flex', value: 1 },
    children: [],
  };
}

export function findPanel(root: Panel, id: string): Panel | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findPanel(child, id);
    if (found) return found;
  }
  return null;
}

export function findParent(root: Panel, id: string): Panel | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

function findSibling(root: Panel, id: string, dir: 'prev' | 'next'): Panel | null {
  const parent = findParent(root, id);
  if (!parent) return null;
  const idx = parent.children.findIndex((c) => c.id === id);
  return parent.children[dir === 'prev' ? idx - 1 : idx + 1] ?? null;
}

export { findSibling };

function updateInTree(root: Panel, id: string, updater: (p: Panel) => Panel): Panel {
  if (root.id === id) return updater(root);
  return { ...root, children: root.children.map((c) => updateInTree(c, id, updater)) };
}

function nextSlotNumber(root: Panel): number {
  let max = 0;
  function scan(p: Panel) {
    const m = p.name?.match(/^PANEL(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
    p.children.forEach(scan);
  }
  scan(root);
  return max + 1;
}

function pushHistory(state: LayoutPageState): LayoutPageState {
  return { ...state, past: [...state.past, state.current], future: [] };
}

const stores = new Map<string, ContextStore<LayoutPageState>>();

export function evictLayoutEditorStore(path: string): void {
  stores.delete(path);
}

export function getLayoutEditorStore(path: string): ContextStore<LayoutPageState> {
  if (!stores.has(path)) {
    const root = makeRoot();
    const initial: LayoutPageState = {
      current: { root },
      past: [],
      future: [],
      selectedPanelId: root.id,
    };

    const saved = loadPageLayout(path);
    if (saved) {
      initial.current = saved;
      initial.selectedPanelId = saved.root.id;
    }

    const store = createContextStore(initial);

    let lastSaved: LayoutDefinition | null = initial.current;
    store.subscribe((state) => {
      if (state.current !== lastSaved) {
        lastSaved = state.current;
        savePageLayout(path, state.current);
      }
    });

    stores.set(path, store);
  }
  return stores.get(path)!;
}

export function createLayoutActions(store: ContextStore<LayoutPageState>) {
  return {
    selectPanel(id: string) {
      store.set((prev) => ({ ...prev, selectedPanelId: id }));
    },

    addPanel() {
      store.set((prev) => {
        const makeChild = (num: number): Panel => ({
          id: crypto.randomUUID(),
          name: `PANEL${num}`,
          direction: 'vertical',
          size: { type: 'flex', value: 1 },
          children: [],
        });
        const next = nextSlotNumber(prev.current.root);
        const root = updateInTree(prev.current.root, prev.selectedPanelId, (p) => {
          const newChildren = p.children.length === 0
            ? [makeChild(next), makeChild(next + 1)]
            : [...p.children, makeChild(next)];
          return { ...p, children: newChildren };
        });
        return { ...pushHistory(prev), current: { root } };
      });
    },

    deletePanel() {
      store.set((prev) => {
        const parent = findParent(prev.current.root, prev.selectedPanelId);
        if (!parent) return prev;
        const siblings = parent.children;

        let newSelectedId: string;
        let updater: (p: Panel) => Panel;

        if (siblings.length === 2) {
          updater = (p) => ({ ...p, children: [] });
          newSelectedId = parent.id;
        } else {
          const idx = siblings.findIndex((c) => c.id === prev.selectedPanelId);
          newSelectedId = (siblings[idx + 1] ?? siblings[idx - 1]).id;
          updater = (p) => ({ ...p, children: p.children.filter((c) => c.id !== prev.selectedPanelId) });
        }

        const root = updateInTree(prev.current.root, parent.id, updater);
        return { ...pushHistory(prev), current: { root }, selectedPanelId: newSelectedId };
      });
    },

    updatePanel(id: string, changes: Partial<Omit<Panel, 'id' | 'children'>>) {
      store.set((prev) => {
        const root = updateInTree(prev.current.root, id, (p) => ({ ...p, ...changes }));
        return { ...pushHistory(prev), current: { root } };
      });
    },

    clearPanel() {
      store.set((prev) => {
        const root = updateInTree(prev.current.root, prev.selectedPanelId, (p) => ({ ...p, children: [] }));
        return { ...pushHistory(prev), current: { root } };
      });
    },

    reset() {
      const root = makeRoot();
      store.set({ current: { root }, past: [], future: [], selectedPanelId: root.id });
    },

    undo() {
      store.set((prev) => {
        if (prev.past.length === 0) return prev;
        const past = [...prev.past];
        const current = past.pop()!;
        return { ...prev, current, past, future: [prev.current, ...prev.future] };
      });
    },

    redo() {
      store.set((prev) => {
        if (prev.future.length === 0) return prev;
        const future = [...prev.future];
        const current = future.shift()!;
        return { ...prev, current, past: [...prev.past, prev.current], future };
      });
    },

    navigate(dir: 'up' | 'down' | 'left' | 'right') {
      store.set((prev) => {
        const root = prev.current.root;
        const sel = prev.selectedPanelId;
        let target: Panel | null = null;
        if (dir === 'up')    target = findParent(root, sel);
        if (dir === 'down')  target = findPanel(root, sel)?.children[0] ?? null;
        if (dir === 'left')  target = findSibling(root, sel, 'prev');
        if (dir === 'right') target = findSibling(root, sel, 'next');
        return target ? { ...prev, selectedPanelId: target.id } : prev;
      });
    },

    importLayout(layout: LayoutDefinition) {
      store.set((prev) => ({
        ...pushHistory(prev),
        current: layout,
        selectedPanelId: layout.root.id,
      }));
    },
  };
}
