import type {
  LayoutDefinition,
  PageDef,
  PageComponentEntry,
  ContextKeyDef,
  ContextKeyType,
  SlotConfig,
} from '@fluxus/page-runtime';
import { sdmClient, pageRuntime } from '../../sdm-runtime/engine';

// Pages live on @fluxus/server (config pipeline; no localStorage, hard
// cutover like stage 2). The client snapshots the scope's page set at
// connect, so reads here stay synchronous; writes update the snapshot and
// round-trip in the background — a failed write logs loudly, same posture
// as validatePage findings. Everything renders after initSdmRuntime()
// resolves, so sdmClient is always assigned by the time these run.
//
// The page-def types and validatePage moved to @fluxus/page-runtime at the
// extraction; this module keeps the Console-side write path (save/delete)
// and re-exports the types for the editor's existing import paths.

export type { PageDef, PageComponentEntry, ContextKeyDef, ContextKeyType, SlotConfig };

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
  pageRuntime.reportPageFindings(path, def);
}

export function loadPage(path: string): PageDef | null {
  return pageRuntime.getPage(path);
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
  return pageRuntime.listPagePaths();
}

export function deletePage(path: string): void {
  sdmClient.deletePage(path).catch((err) => {
    console.error(`deletePage('${path}') failed to persist to the server`, err);
  });
}

export function pageExists(path: string): boolean {
  return sdmClient.pages.has(path);
}
