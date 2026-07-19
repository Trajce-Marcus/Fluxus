// The PageRuntime handle — the one injected dependency the whole runtime
// cluster reaches the SDM through (page-runtime extraction, 2026-07-19).
// A host creates it once at bootstrap from its connected FluxusClient
// (platform singleton, not React context — the Fork 2 ruling) and passes it
// to PageRenderer / the editor's validation calls. The store and config are
// the client's snapshot; activity runs round-trip the server through the
// client, exactly as before the extraction.

import type { FluxusClient } from '@fluxus/client';
import type { ActivityDef, ConfigRaw, MemoryAdapter, RecordTypeDef, WorkflowDef } from '@fluxus/engine';
import type { Diagnostic } from '@fluxus/dsl';
import type { PageDef } from './pageDef';
import {
  evaluatePageExpression,
  runPageCallback,
  validatePageExpression,
  validatePageCallback,
  type CallbackPayload,
  type PageContext,
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
  readonly config: ConfigRaw;
  /** Resolve an activity id to its resolved def + owning record type. */
  findActivity(activityId: string): FoundActivity | null;
  /** Read a page definition from the client's page snapshot. */
  getPage(path: string): PageDef | null;
  listPagePaths(): string[];
  /** Evaluate a dynamic-prop expression (datasource posture, reads only). */
  evaluateExpression(source: string, pageCtx: PageContext): unknown;
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
    evaluateExpression: (source, pageCtx) => evaluatePageExpression(store, config, source, pageCtx),
    runCallback: (source, callbackData, pageCtx, handlers) =>
      runPageCallback(store, config, source, callbackData, pageCtx, handlers),
    validateExpression: (source) => validatePageExpression(config, source),
    validateCallback: (source) => validatePageCallback(config, source),
    validatePage: (def) => validatePage(runtime, def),
    reportPageFindings: (pagePath, def) => reportPageFindings(runtime, pagePath, def),
  };
  return runtime;
}
