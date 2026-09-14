// The PageRuntime handle — the one injected dependency the whole runtime
// cluster reaches the SDM through (page-runtime extraction, 2026-07-19).
// A host creates it once at bootstrap from its connected FluxusClient
// (platform singleton, not React context — the Fork 2 ruling) and passes it
// to PageRenderer / the editor's validation calls. The store and config are
// the client's snapshot; activity runs round-trip the server through the
// client, exactly as before the extraction.

import type { FluxusClient } from '@fluxus/client';
import type { ActivityDef, ClientSolutionConfig, MemoryAdapter, RecordTypeDef, WorkflowDef } from '@fluxus/engine';
import type { Diagnostic } from '@fluxus/dsl';
import type { PageDef } from './pageDef';
import {
  evaluateCapture,
  evaluatePageExpression,
  runPageCallback,
  validatePageExpression,
  validatePageExpressionWithoutRecords,
  validatePageCallback,
  type CallbackPayload,
  type PageContext,
  type PageQueryFn,
  type PageServiceHandlers,
} from './pageHost';
import type { CaptureHost } from './capture/host';
import { validatePage, reportPageFindings, type PageFinding } from './validatePage';

export interface FoundActivity {
  activity: ActivityDef;
  typeDef: RecordTypeDef & { workflow: WorkflowDef };
}

export interface PageRuntime {
  readonly client: FluxusClient;
  readonly store: MemoryAdapter;
  /** The client's grade of the model (CLIENT_TRUST_BOUNDARY §2) — pages run on
   *  both planes, and the narrower of the two is what they may rely on. */
  readonly config: ClientSolutionConfig;
  /** Resolve an activity id to its resolved def + owning record type. */
  findActivity(activityId: string): FoundActivity | null;
  /** Resolve a record type id to its def + workflow; null when the model has
   *  no such type (a page may declare one that was since renamed). */
  findRecordType(typeId: string): (RecordTypeDef & { workflow: WorkflowDef }) | null;
  /**
   * What the capture form runs against when a page opens one. No record
   * picker: choosing a reference by browsing needs records, which a page does
   * not hold — a reference is typed as an id until a GET can answer that.
   */
  readonly captureHost: CaptureHost;
  /**
   * Open a page, optionally about a record — what `services.page.open` reaches
   * (2026-08-27). The seam is here rather than in the container because
   * navigation is the *host's* idea: the Runtime app pushes `?page=&record=`,
   * the Console swaps the previewed page, and neither meaning belongs to a
   * component. Absent when the host has no notion of navigating; the container
   * then fails loudly rather than swallowing the call.
   */
  readonly openPage?: (page: string, recordId: string | null) => void;
  /** Read a page definition from the client's page snapshot. */
  getPage(path: string): PageDef | null;
  listPagePaths(): string[];
  /**
   * Evaluate a dynamic-prop expression (datasource posture, reads only).
   * Async: the expression may name a GET activity, which the server answers.
   */
  evaluateExpression(source: string, pageCtx: PageContext): Promise<unknown>;
  /** Run a callback script with the payload as the `callbackData` root. */
  runCallback(
    source: string,
    callbackData: CallbackPayload,
    pageCtx: PageContext,
    handlers: PageServiceHandlers,
  ): void;
  validateExpression(source: string): Diagnostic[];
  /** validateExpression with `records` banned too — what flags a prop that
   *  reads records directly rather than naming a GET. */
  validateExpressionWithoutRecords(source: string): Diagnostic[];
  validateCallback(source: string): Diagnostic[];
  validatePage(def: PageDef): PageFinding[];
  /** validatePage + console reporting, the save-time voice. */
  reportPageFindings(pagePath: string, def: PageDef): PageFinding[];
}

export function createPageRuntime(
  { client, openPage }: { client: FluxusClient; openPage?: (page: string, recordId: string | null) => void },
): PageRuntime {
  const store = client.adapter;
  const config = client.config;

  // The page's door to a GET activity (DATA_THROUGH_ACTIVITIES step 2): the
  // page names the activity, the model answers. Since step 3 the page's own
  // record rides along as the anchor — where the server lands the read's light
  // entry — so a page that is about something logs what it asked, and a pure
  // view still reads, untraced. The gate's warnings have nowhere to go on a
  // read, so they go to the console rather than being dropped silently.
  const query: PageQueryFn = async (activityId, params, recordId) => {
    const result = await client.query({ activityId, attributes: params, recordId });
    for (const warning of result.warnings) console.warn(`[invoke ${activityId}] ${warning}`);
    return result.data;
  };

  const findActivity = (activityId: string): FoundActivity | null => {
    for (const rt of store.listRecordTypes()) {
      const typeDef = store.getRecordTypeDef(rt.id);
      const activity = typeDef.workflow.activities.find((a) => a.id === activityId);
      if (activity) return { activity, typeDef };
    }
    return null;
  };

  const findRecordType = (typeId: string): (RecordTypeDef & { workflow: WorkflowDef }) | null => {
    if (!store.listRecordTypes().some((rt) => rt.id === typeId)) return null;
    return store.getRecordTypeDef(typeId);
  };

  // The capture form's door to the same model: the page's GET query, the
  // client's upload service, and label resolution off the snapshot (which on a
  // page is empty, so a reference shows its raw id — honest, and what the
  // page's own form showed before).
  const captureHost: CaptureHost = {
    evaluate: (source, script) => evaluateCapture(store, config, source, script),
    query,
    uploads: client.uploads,
    resolveDisplayLabel: (fkRecordType, fkDisplayField, rawId) =>
      store.resolveDisplayLabel(fkRecordType, fkDisplayField, rawId),
    resolveAttributeDisplayField: (typeId, attrKey) => store.resolveAttributeDisplayField(typeId, attrKey),
    resolveAttributeTarget: (typeId, attrKey) => store.resolveAttributeTarget(typeId, attrKey),
  };

  const runtime: PageRuntime = {
    client,
    store,
    config,
    captureHost,
    openPage,
    findActivity,
    findRecordType,
    getPage: (path) => (client.pages.get(path) as PageDef | undefined) ?? null,
    listPagePaths: () => [...client.pages.keys()].sort(),
    evaluateExpression: (source, pageCtx) => evaluatePageExpression(store, config, source, pageCtx, query),
    runCallback: (source, callbackData, pageCtx, handlers) =>
      runPageCallback(store, config, source, callbackData, pageCtx, handlers),
    validateExpression: (source) => validatePageExpression(config, source),
    validateExpressionWithoutRecords: (source) => validatePageExpressionWithoutRecords(config, source),
    validateCallback: (source) => validatePageCallback(config, source),
    validatePage: (def) => validatePage(runtime, def),
    reportPageFindings: (pagePath, def) => reportPageFindings(runtime, pagePath, def),
  };
  return runtime;
}
