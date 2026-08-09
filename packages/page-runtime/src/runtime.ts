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
  evaluatePageExpression,
  runPageCallback,
  validatePageExpression,
  validatePageCallback,
  type CallbackPayload,
  type PageContext,
  type PageQueryFn,
  type PageServiceHandlers,
} from './pageHost';
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
  validateCallback(source: string): Diagnostic[];
  validatePage(def: PageDef): PageFinding[];
  /** validatePage + console reporting, the save-time voice. */
  reportPageFindings(pagePath: string, def: PageDef): PageFinding[];
}

export function createPageRuntime({ client }: { client: FluxusClient }): PageRuntime {
  const store = client.adapter;
  const config = client.config;

  // The page's door to a GET activity (DATA_THROUGH_ACTIVITIES step 2): the
  // page names the activity, the model answers. No anchor record is sent — a
  // page has none of its own until app records land with GET logging (step 3).
  // The gate's warnings have nowhere to go on a read, so they go to the
  // console rather than being dropped silently.
  const query: PageQueryFn = async (activityId, params) => {
    const result = await client.query({ activityId, attributes: params });
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

  const runtime: PageRuntime = {
    client,
    store,
    config,
    findActivity,
    getPage: (path) => (client.pages.get(path) as PageDef | undefined) ?? null,
    listPagePaths: () => [...client.pages.keys()].sort(),
    evaluateExpression: (source, pageCtx) => evaluatePageExpression(store, config, source, pageCtx, query),
    runCallback: (source, callbackData, pageCtx, handlers) =>
      runPageCallback(store, config, source, callbackData, pageCtx, handlers),
    validateExpression: (source) => validatePageExpression(config, source),
    validateCallback: (source) => validatePageCallback(config, source),
    validatePage: (def) => validatePage(runtime, def),
    reportPageFindings: (pagePath, def) => reportPageFindings(runtime, pagePath, def),
  };
  return runtime;
}
