import { createContextStore } from '../../store/contextStore';
import {
  loadPageComponents,
  savePageComponents,
  loadContextSchema,
  saveContextSchema,
  loadPageAccess,
  savePageAccess,
  loadPageRecord,
  savePageRecord,
  loadSlotConfigs,
  saveSlotConfigs,
  type PageComponentEntry,
  type ContextKeyDef,
  type PageRecordDef,
  type SlotConfig,
} from './persistence';

export type { PageComponentEntry, ContextKeyDef, PageRecordDef, SlotConfig };

export interface PageEditorState {
  mode: 'builder' | 'layout';
  pageComponents: PageComponentEntry[];
  contextSchema: ContextKeyDef[];
  /** Role ids that may open the page (CONSOLE_RUNTIME_SPEC §6). */
  accessOpen: string[];
  /** The record the page is about; null on a pure view (step 3). */
  pageRecord: PageRecordDef | null;
  selectedComponentName: string | null;
  selectedSlotId: string | null;
  col1Collapsed: boolean;
  slotConfigs: Record<string, SlotConfig | null>;
}

const stores = new Map<string, ReturnType<typeof createContextStore<PageEditorState>>>();

function getStore(pagePath: string) {
  if (!stores.has(pagePath)) {
    stores.set(pagePath, createContextStore<PageEditorState>({
      mode: 'builder',
      pageComponents: loadPageComponents(pagePath),
      contextSchema: loadContextSchema(pagePath),
      accessOpen: loadPageAccess(pagePath),
      pageRecord: loadPageRecord(pagePath),
      selectedComponentName: null,
      selectedSlotId: null,
      col1Collapsed: false,
      slotConfigs: loadSlotConfigs(pagePath),
    }));
  }
  return stores.get(pagePath)!;
}

// ── Page components ──────────────────────────────────────────────────────────

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
    const slotConfigs = { ...prev.slotConfigs };
    for (const slotId of Object.keys(slotConfigs)) {
      if (slotConfigs[slotId]?.componentName === name) slotConfigs[slotId] = null;
    }
    saveSlotConfigs(pagePath, slotConfigs);
    return {
      ...prev,
      pageComponents,
      slotConfigs,
      selectedComponentName: prev.selectedComponentName === name ? null : prev.selectedComponentName,
    };
  });
}

// ── Context schema ───────────────────────────────────────────────────────────

export function addContextKey(pagePath: string, def: ContextKeyDef): void {
  getStore(pagePath).set((prev) => {
    if (prev.contextSchema.some((k) => k.key === def.key)) return prev;
    const contextSchema = [...prev.contextSchema, def];
    saveContextSchema(pagePath, contextSchema);
    return { ...prev, contextSchema };
  });
}

export function removeContextKey(pagePath: string, key: string): void {
  getStore(pagePath).set((prev) => {
    const contextSchema = prev.contextSchema.filter((k) => k.key !== key);
    saveContextSchema(pagePath, contextSchema);
    return { ...prev, contextSchema };
  });
}

// ── Page access ──────────────────────────────────────────────────────────────

/** Grant or revoke one role's entry to the page. */
export function togglePageAccess(pagePath: string, roleId: string): void {
  getStore(pagePath).set((prev) => {
    const accessOpen = prev.accessOpen.includes(roleId)
      ? prev.accessOpen.filter((r) => r !== roleId)
      : [...prev.accessOpen, roleId];
    savePageAccess(pagePath, accessOpen);
    return { ...prev, accessOpen };
  });
}

// ── Page record ──────────────────────────────────────────────────────────────

/**
 * Declare what the page is about, or clear it back to a pure view. A page with
 * no record has no anchor, so the reads it fires leave no trace — which is a
 * legitimate choice for a page that only displays, and a mistake on one that
 * acts.
 */
export function setPageRecord(pagePath: string, record: PageRecordDef | null): void {
  getStore(pagePath).set((prev) => {
    savePageRecord(pagePath, record);
    return { ...prev, pageRecord: record };
  });
}

// ── Slot configs ─────────────────────────────────────────────────────────────

export function assignComponent(pagePath: string, slotId: string, componentName: string): void {
  getStore(pagePath).set((prev) => {
    const slotConfigs = {
      ...prev.slotConfigs,
      [slotId]: { componentName, staticConfig: {}, dynamicProps: {}, callbacks: {} },
    };
    saveSlotConfigs(pagePath, slotConfigs);
    return { ...prev, slotConfigs, selectedSlotId: slotId, selectedComponentName: null };
  });
}

export function unassignSlot(pagePath: string, slotId: string): void {
  getStore(pagePath).set((prev) => {
    const slotConfigs = { ...prev.slotConfigs, [slotId]: null };
    saveSlotConfigs(pagePath, slotConfigs);
    return { ...prev, slotConfigs };
  });
}

export function setStaticConfig(pagePath: string, slotId: string, propName: string, value: unknown): void {
  getStore(pagePath).set((prev) => {
    const slot = prev.slotConfigs[slotId];
    if (!slot) return prev;
    const slotConfigs = {
      ...prev.slotConfigs,
      [slotId]: { ...slot, staticConfig: { ...slot.staticConfig, [propName]: value } },
    };
    saveSlotConfigs(pagePath, slotConfigs);
    return { ...prev, slotConfigs };
  });
}

/** Set (or clear, with null/blank) a dynamic prop's FluxScript expression. */
export function setDynamicProp(pagePath: string, slotId: string, propName: string, source: string | null): void {
  getStore(pagePath).set((prev) => {
    const slot = prev.slotConfigs[slotId];
    if (!slot) return prev;
    const dynamicProps = { ...slot.dynamicProps };
    if (source === null || source.trim() === '') delete dynamicProps[propName];
    else dynamicProps[propName] = source;
    const slotConfigs = { ...prev.slotConfigs, [slotId]: { ...slot, dynamicProps } };
    saveSlotConfigs(pagePath, slotConfigs);
    return { ...prev, slotConfigs };
  });
}

/** Set (or clear, with null/blank) a callback's FluxScript script. */
export function setCallback(pagePath: string, slotId: string, callbackName: string, source: string | null): void {
  getStore(pagePath).set((prev) => {
    const slot = prev.slotConfigs[slotId];
    if (!slot) return prev;
    const callbacks = { ...slot.callbacks };
    if (source === null || source.trim() === '') delete callbacks[callbackName];
    else callbacks[callbackName] = source;
    const slotConfigs = { ...prev.slotConfigs, [slotId]: { ...slot, callbacks } };
    saveSlotConfigs(pagePath, slotConfigs);
    return { ...prev, slotConfigs };
  });
}

// ── UI state ─────────────────────────────────────────────────────────────────

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

export function usePageEditorStore(pagePath: string) {
  return getStore(pagePath);
}
