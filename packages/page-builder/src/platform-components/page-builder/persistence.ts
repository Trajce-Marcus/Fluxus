import type { LayoutDefinition } from './layout-editor/types';

const KEY_PREFIX = 'fluxus:page:';

// ── Shared entry types ────────────────────────────────────────────────────────

export interface PageComponentEntry {
  name: string;
  version: string;
}

export type ContextKeyType = 'string' | 'number' | 'boolean' | 'object';
export type ContextKeySource = 'platform' | 'page';

export interface ContextKeyDef {
  key: string;
  type: ContextKeyType;
  source: ContextKeySource;
  defaultValue?: unknown;
}

// ── ComponentContainer config ─────────────────────────────────────────────────

export interface ArgSource {
  contextKey: string;
}

export type DynamicPropConfig =
  | { source: 'context'; contextKey: string }
  | { source: 'procedure'; procedureName: string; args: Record<string, ArgSource> };

export type CallbackAction =
  | { type: 'set-context'; key: string }
  | { type: 'hide-component' }
  | { type: 'show-overlay'; overlayId: string }
  // Extraction stage 2: the callback contract is (record, data object).
  // UI activity (has attributes) → standard capture form opens; non-UI →
  // straight to the hooks with the data object as the `callbackData` root.
  | { type: 'run-activity'; activityId: string };

export interface SlotConfig {
  componentName: string;
  staticConfig: Record<string, unknown>;
  dynamicProps: Record<string, DynamicPropConfig>;
  callbackActions: Record<string, CallbackAction>;
}

export interface OverlayConfig {
  id: string;
  componentName: string;
  staticConfig: Record<string, unknown>;
  dynamicProps: Record<string, DynamicPropConfig>;
  callbackActions: Record<string, CallbackAction>;
}

// ── Page Definition ───────────────────────────────────────────────────────────

export interface PageDef {
  template?: string;
  layout?: LayoutDefinition;
  componentDependencies?: PageComponentEntry[];
  contextSchema?: ContextKeyDef[];
  slotConfigs?: Record<string, SlotConfig | null>;
  overlays?: OverlayConfig[];
}

// ── Persistence functions ─────────────────────────────────────────────────────

export function savePage(path: string, def: PageDef): void {
  localStorage.setItem(`${KEY_PREFIX}${path}`, JSON.stringify(def));
}

export function loadPage(path: string): PageDef | null {
  const raw = localStorage.getItem(`${KEY_PREFIX}${path}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PageDef;
  } catch {
    return null;
  }
}

export function savePageLayout(path: string, layout: LayoutDefinition): void {
  const existing = loadPage(path) ?? {};
  savePage(path, { ...existing, layout });
}

export function loadPageLayout(path: string): LayoutDefinition | null {
  return loadPage(path)?.layout ?? null;
}

export function loadPageComponents(path: string): PageComponentEntry[] {
  return loadPage(path)?.componentDependencies ?? [];
}

export function savePageComponents(path: string, components: PageComponentEntry[]): void {
  const existing = loadPage(path) ?? {};
  savePage(path, { ...existing, componentDependencies: components });
}

export function loadContextSchema(path: string): ContextKeyDef[] {
  return loadPage(path)?.contextSchema ?? [];
}

export function saveContextSchema(path: string, schema: ContextKeyDef[]): void {
  const existing = loadPage(path) ?? {};
  savePage(path, { ...existing, contextSchema: schema });
}

export function loadSlotConfigs(path: string): Record<string, SlotConfig | null> {
  return loadPage(path)?.slotConfigs ?? {};
}

export function saveSlotConfigs(path: string, slotConfigs: Record<string, SlotConfig | null>): void {
  const existing = loadPage(path) ?? {};
  savePage(path, { ...existing, slotConfigs });
}

export function loadOverlays(path: string): OverlayConfig[] {
  return loadPage(path)?.overlays ?? [];
}

export function saveOverlays(path: string, overlays: OverlayConfig[]): void {
  const existing = loadPage(path) ?? {};
  savePage(path, { ...existing, overlays });
}

export function listPagePaths(): string[] {
  const paths: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(KEY_PREFIX)) paths.push(key.slice(KEY_PREFIX.length));
  }
  return paths.sort();
}

export function deletePage(path: string): void {
  localStorage.removeItem(`${KEY_PREFIX}${path}`);
}

export function pageExists(path: string): boolean {
  return localStorage.getItem(`${KEY_PREFIX}${path}`) !== null;
}
