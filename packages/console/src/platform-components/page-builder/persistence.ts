import type {
  LayoutDefinition,
  PageDef,
  PageComponentEntry,
  ContextKeyDef,
  ContextKeyType,
  PageRecordDef,
  SlotConfig,
} from '@fluxus/page-runtime';
import { sdmClient, pageRuntime } from '../../sdm-runtime/engine';
import { shellStore } from '../shell/store';

/** The client's page snapshot is mutated in place, so a write is invisible to
 *  React on its own. Every page write ends here. */
function bumpPagesVersion(): void {
  shellStore.set((prev) => ({ ...prev, pagesVersion: prev.pagesVersion + 1 }));
}

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

export type { PageDef, PageComponentEntry, ContextKeyDef, ContextKeyType, PageRecordDef, SlotConfig };

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
  bumpPagesVersion();
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

/**
 * The record the page is about (DATA_THROUGH_ACTIVITIES step 3): which record
 * type, its record's id coming in the URL. Absent ⇒ a pure view. Stored absent
 * rather than as a half-filled object.
 */
export function loadPageRecord(path: string): PageRecordDef | null {
  return loadPage(path)?.record ?? null;
}

export function savePageRecord(path: string, record: PageRecordDef | null): void {
  const existing = loadPage(path) ?? {};
  savePage(path, { ...existing, record: record ?? undefined });
}

/**
 * The page's list (APPS_AND_INSTANCES §2.2): the workflow its apps offer and
 * run from. Absent ⇒ none, and the page offers nothing. Stored absent rather
 * than empty, like the page record.
 */
export function loadPageWorkflow(path: string): string | null {
  return loadPage(path)?.workflowId ?? null;
}

export function savePageWorkflow(path: string, workflowId: string | null): void {
  const existing = loadPage(path) ?? {};
  savePage(path, { ...existing, workflowId: workflowId ?? undefined });
}

/**
 * The page's example definition (APPS_AND_INSTANCES §3.1): JSON text the
 * preview runs with as `context.app.definition`, and a new app starts with.
 * Blank is stored absent.
 */
export function loadPageExample(path: string): string {
  return loadPage(path)?.exampleDefinition ?? '';
}

export function savePageExample(path: string, example: string): void {
  const existing = loadPage(path) ?? {};
  savePage(path, { ...existing, exampleDefinition: example.trim() === '' ? undefined : example });
}

/** The workflows a page's list may be — those no record type points to. */
export function pageListCandidates(): { id: string; name: string }[] {
  const config = sdmClient.config as { workflows?: { id: string; name: string }[]; recordTypes?: { workflow_ref: string }[] };
  const typed = new Set((config.recordTypes ?? []).map((rt) => rt.workflow_ref));
  return (config.workflows ?? []).filter((w) => !typed.has(w.id));
}

/** The record types a page may be about — every type in the solution's model. */
export function solutionRecordTypes(): { id: string; name: string }[] {
  return (sdmClient.config as { recordTypes?: { id: string; name: string }[] }).recordTypes ?? [];
}

export function listPagePaths(): string[] {
  return pageRuntime.listPagePaths();
}

export function deletePage(path: string): void {
  sdmClient.deletePage(path).catch((err) => {
    console.error(`deletePage('${path}') failed to persist to the server`, err);
  });
  bumpPagesVersion();
}

export function pageExists(path: string): boolean {
  return sdmClient.pages.has(path);
}
