import type { LayoutDefinition } from './layout-editor/types';
import { reportPageFindings } from './validatePage';

const KEY_PREFIX = 'fluxus:page:';

// ── Shared entry types ────────────────────────────────────────────────────────

export interface PageComponentEntry {
  name: string;
  version: string;
}

export type ContextKeyType = 'string' | 'number' | 'boolean' | 'object';

/**
 * A page-declared context key: seeds `context.page.<key>` at page start.
 * Declarations are conveniences, not a schema — the validator treats
 * `context.page.*` as opaque (ruled 2026-07-12: permissive for MVP).
 * Platform built-ins (`context.user`, `context.app`) come from the host,
 * never from here.
 */
export interface ContextKeyDef {
  key: string;
  type: ContextKeyType;
  defaultValue?: unknown;
}

// ── ComponentContainer config ─────────────────────────────────────────────────
// Page wiring is FluxScript everywhere (PAGE_WIRING_DESIGN, 2026-07-12):
// a dynamic prop is a single expression evaluated with datasource posture;
// a callback is a script receiving the payload as the `callbackData` root.
// The stored artifact is the source text; any picker UI merely writes it.

export interface SlotConfig {
  componentName: string;
  staticConfig: Record<string, unknown>;
  /** propName → FluxScript expression source. */
  dynamicProps: Record<string, string>;
  /** callbackName → FluxScript script source. */
  callbacks: Record<string, string>;
}

// ── Page Definition ───────────────────────────────────────────────────────────

export interface PageDef {
  template?: string;
  layout?: LayoutDefinition;
  componentDependencies?: PageComponentEntry[];
  contextSchema?: ContextKeyDef[];
  slotConfigs?: Record<string, SlotConfig | null>;
}

// ── Persistence functions ─────────────────────────────────────────────────────

/**
 * Persist + validate: every save runs validatePage and reports findings to
 * the console — the page-file counterpart of the engine's config-save-time
 * check (DSL_SPEC §9). Findings never block the save; a page mid-edit is
 * allowed to be broken, loudly.
 */
export function savePage(path: string, def: PageDef): void {
  localStorage.setItem(`${KEY_PREFIX}${path}`, JSON.stringify(def));
  reportPageFindings(path, def);
}

/**
 * Pages written before the wiring redesign stored dropdown-built config
 * objects (`{source: 'context', ...}` props, `callbackActions`, overlays,
 * platform context keys). Layout and component lists carry over; old wiring
 * is dropped — it has no expression equivalent and is re-authored.
 */
function normalizePage(raw: Record<string, unknown>): PageDef {
  const def: PageDef = raw as PageDef;

  if (Array.isArray(def.contextSchema)) {
    def.contextSchema = def.contextSchema
      .filter((k) => (k as { source?: string }).source !== 'platform')
      .map(({ key, type, defaultValue }) => ({ key, type, defaultValue }));
  }

  if (def.slotConfigs) {
    for (const config of Object.values(def.slotConfigs)) {
      if (!config) continue;
      config.dynamicProps = Object.fromEntries(
        Object.entries(config.dynamicProps ?? {}).filter(([, v]) => typeof v === 'string'),
      );
      config.callbacks = Object.fromEntries(
        Object.entries(config.callbacks ?? {}).filter(([, v]) => typeof v === 'string'),
      );
      delete (config as unknown as Record<string, unknown>).callbackActions;
    }
  }

  delete (raw as Record<string, unknown>).overlays;
  return def;
}

export function loadPage(path: string): PageDef | null {
  const raw = localStorage.getItem(`${KEY_PREFIX}${path}`);
  if (!raw) return null;
  try {
    return normalizePage(JSON.parse(raw) as Record<string, unknown>);
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
