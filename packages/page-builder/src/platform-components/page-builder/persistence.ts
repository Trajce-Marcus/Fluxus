import type { LayoutDefinition } from './layout-editor/types';
import { reportPageFindings } from './validatePage';
import { sdmClient } from '../../sdm-runtime/engine';

// Pages live on @fluxus/server (config pipeline; no localStorage, hard
// cutover like stage 2). The client snapshots the scope's page set at
// connect, so reads here stay synchronous; writes update the snapshot and
// round-trip in the background — a failed write logs loudly, same posture
// as validatePage findings. Everything renders after initSdmRuntime()
// resolves, so sdmClient is always assigned by the time these run.

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
  sdmClient.savePage(path, def).catch((err) => {
    console.error(`savePage('${path}') failed to persist to the server`, err);
  });
  reportPageFindings(path, def);
}

export function loadPage(path: string): PageDef | null {
  return (sdmClient.pages.get(path) as PageDef | undefined) ?? null;
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
  return [...sdmClient.pages.keys()].sort();
}

export function deletePage(path: string): void {
  sdmClient.deletePage(path).catch((err) => {
    console.error(`deletePage('${path}') failed to persist to the server`, err);
  });
}

export function pageExists(path: string): boolean {
  return sdmClient.pages.has(path);
}
