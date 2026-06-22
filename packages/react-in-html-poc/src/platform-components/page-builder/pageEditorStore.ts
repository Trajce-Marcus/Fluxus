import { createContextStore } from '../../store/contextStore';
import {
  loadPageComponents,
  savePageComponents,
  loadContextSchema,
  saveContextSchema,
  loadSlotConfigs,
  saveSlotConfigs,
  type PageComponentEntry,
  type ContextKeyDef,
  type SlotConfig,
  type DynamicPropConfig,
  type CallbackAction,
} from './persistence';

export type { PageComponentEntry, ContextKeyDef, SlotConfig, DynamicPropConfig, CallbackAction };

export interface PageEditorState {
  mode: 'builder' | 'layout';
  pageComponents: PageComponentEntry[];
  contextSchema: ContextKeyDef[];
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

// ── Slot configs ─────────────────────────────────────────────────────────────

export function assignComponent(pagePath: string, slotId: string, componentName: string): void {
  getStore(pagePath).set((prev) => {
    const slotConfigs = {
      ...prev.slotConfigs,
      [slotId]: { componentName, staticConfig: {}, dynamicProps: {}, callbackActions: {} },
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

export function setDynamicProp(pagePath: string, slotId: string, propName: string, config: DynamicPropConfig | null): void {
  getStore(pagePath).set((prev) => {
    const slot = prev.slotConfigs[slotId];
    if (!slot) return prev;
    const dynamicProps = { ...slot.dynamicProps };
    if (config === null) delete dynamicProps[propName];
    else dynamicProps[propName] = config;
    const slotConfigs = { ...prev.slotConfigs, [slotId]: { ...slot, dynamicProps } };
    saveSlotConfigs(pagePath, slotConfigs);
    return { ...prev, slotConfigs };
  });
}

export function setCallbackAction(pagePath: string, slotId: string, propName: string, action: CallbackAction | null): void {
  getStore(pagePath).set((prev) => {
    const slot = prev.slotConfigs[slotId];
    if (!slot) return prev;
    const callbackActions = { ...slot.callbackActions };
    if (action === null) delete callbackActions[propName];
    else callbackActions[propName] = action;
    const slotConfigs = { ...prev.slotConfigs, [slotId]: { ...slot, callbackActions } };
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
