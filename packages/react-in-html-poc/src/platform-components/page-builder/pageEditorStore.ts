import { createContextStore } from '../../store/contextStore';
import {
  loadPageComponents,
  savePageComponents,
  type PageComponentEntry,
} from './persistence';

export type { PageComponentEntry };

export interface SlotAssignment {
  componentName: string;
  props: Record<string, unknown>;
}

export interface PageEditorState {
  mode: 'builder' | 'layout';
  pageComponents: PageComponentEntry[];
  selectedComponentName: string | null;
  selectedSlotId: string | null;
  col1Collapsed: boolean;
  assignments: Record<string, SlotAssignment | null>;
}

const stores = new Map<string, ReturnType<typeof createContextStore<PageEditorState>>>();

function getStore(pagePath: string) {
  if (!stores.has(pagePath)) {
    stores.set(pagePath, createContextStore<PageEditorState>({
      mode: 'builder',
      pageComponents: loadPageComponents(pagePath),
      selectedComponentName: null,
      selectedSlotId: null,
      col1Collapsed: false,
      assignments: {},
    }));
  }
  return stores.get(pagePath)!;
}

export function addPageComponent(pagePath: string, entry: PageComponentEntry): void {
  getStore(pagePath).set((prev) => {
    if (prev.pageComponents.some((c) => c.name === entry.name)) return prev;
    const pageComponents = [...prev.pageComponents, entry];
    savePageComponents(pagePath, pageComponents);
    return { ...prev, pageComponents };
  });
}

export function removePageComponent(pagePath: string, name: string): void {
  getStore(pagePath).set((prev) => {
    const pageComponents = prev.pageComponents.filter((c) => c.name !== name);
    savePageComponents(pagePath, pageComponents);
    // Clear selection and any slot assignments using this component
    const assignments = { ...prev.assignments };
    for (const slotId of Object.keys(assignments)) {
      if (assignments[slotId]?.componentName === name) assignments[slotId] = null;
    }
    return {
      ...prev,
      pageComponents,
      assignments,
      selectedComponentName: prev.selectedComponentName === name ? null : prev.selectedComponentName,
    };
  });
}

export function selectComponent(pagePath: string, name: string | null): void {
  getStore(pagePath).set((prev) => ({ ...prev, selectedComponentName: name }));
}

export function selectSlot(pagePath: string, slotId: string | null): void {
  getStore(pagePath).set((prev) => ({ ...prev, selectedSlotId: slotId }));
}

export function setMode(pagePath: string, mode: 'builder' | 'layout'): void {
  getStore(pagePath).set((prev) => ({ ...prev, mode }));
}

export function toggleCol1(pagePath: string): void {
  getStore(pagePath).set((prev) => ({ ...prev, col1Collapsed: !prev.col1Collapsed }));
}

export function assignComponent(pagePath: string, slotId: string, componentName: string): void {
  getStore(pagePath).set((prev) => ({
    ...prev,
    assignments: { ...prev.assignments, [slotId]: { componentName, props: {} } },
    selectedSlotId: slotId,
    selectedComponentName: null,
  }));
}

export function unassignSlot(pagePath: string, slotId: string): void {
  getStore(pagePath).set((prev) => ({
    ...prev,
    assignments: { ...prev.assignments, [slotId]: null },
  }));
}

export function usePageEditorStore(pagePath: string) {
  return getStore(pagePath);
}
