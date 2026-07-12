// The page-builder's DSL host surface (page wiring redesign, 2026-07-12).
//
// Pages speak FluxScript everywhere: dynamic props are single expressions
// evaluated with datasource posture (reads only), and component callbacks are
// scripts receiving the payload as the `callbackData` root. UI-local effects
// (set context, hide component, run an activity) are functions on a service
// module only this host injects — `services.page`. A page callback, a hook,
// and a future non-UI workflow differ only in which service modules their
// host provides.

import {
  evaluateExpression,
  executeScript,
  validateExpression,
  validateScript,
  FkPointer,
  type Diagnostic,
  type ServiceModuleDef,
} from '@fluxus/dsl';
import { buildDslSchema, buildEvalHost, functionSignatures } from '@fluxus/engine';
import { config } from '../../sdm-runtime/config';
import { sdmStore } from '../../sdm-runtime/engine';

// ── The callbackData root ─────────────────────────────────────────────────────
// Components emit (value, data?) — a selection value or anchor record id, plus
// an optional data object (the Extraction stage 2 contract). The host packs
// both under one root so scripts see `callbackData.value` / `callbackData.data`.

export interface CallbackPayload {
  value: unknown;
  data: unknown;
}

export const packCallbackData = (value: unknown, data: unknown): CallbackPayload => ({
  value,
  data: data ?? null,
});

// ── services.page ─────────────────────────────────────────────────────────────

/** What the rendering host (ComponentContainer) supplies per component instance. */
export interface PageServiceHandlers {
  /** Write a page-context key; the page layer of the ctx root. */
  setContext(key: string, value: unknown): void;
  /** Hide the invoking component instance. */
  hideComponent(): void;
  /**
   * Request an activity run — the only mutation path from a page. The host
   * owns presentation: UI activities open the standard capture form; the
   * run's outcome (gate fail, soft-stop) surfaces through the host.
   */
  runActivity(activityId: string, record: unknown, data: unknown): void;
}

export function buildPageServices(handlers: PageServiceHandlers): ServiceModuleDef {
  return {
    name: 'page',
    description: 'UI-local effects only the page host provides',
    functions: {
      setContext: {
        params: ['key', 'value'],
        description: 'Set a page context key (context.page.<key>)',
        kind: 'effect',
        fn: (key, value) => handlers.setContext(String(key), value),
      },
      hideComponent: {
        params: [],
        description: 'Hide this component instance',
        kind: 'effect',
        fn: () => handlers.hideComponent(),
      },
      runActivity: {
        params: ['activityId', 'record', 'data'],
        description: 'Run an activity: the anchor record (id or null) and the callback data object',
        kind: 'effect',
        fn: (activityId, record, data) => handlers.runActivity(String(activityId), record, data),
      },
    },
  };
}

/** Manifest-only module for validation — same schema, no live handlers. */
export const pageServicesStub = (): ServiceModuleDef =>
  buildPageServices({ setContext: () => {}, hideComponent: () => {}, runActivity: () => {} });

// ── Evaluation ────────────────────────────────────────────────────────────────

/** The ctx root's page-host members: platform built-ins + the page layer. */
export interface PageContext {
  app: { name: string };
  page: Record<string, unknown>;
}

/**
 * Evaluate a dynamic-prop expression with datasource posture: reads only —
 * the evaluator runs in 'read' mode and the records host has no mutation
 * surface, so effects and writes fail loudly rather than silently.
 */
export function evaluatePageExpression(source: string, pageCtx: PageContext): unknown {
  const host = buildEvalHost(sdmStore, config, {
    contextExtras: { app: pageCtx.app, page: pageCtx.page },
    readonlyRecords: true,
  });
  return toComponentValue(evaluateExpression(source, host));
}

/**
 * Expression results carry DSL shapes — DslRecord ({id, type, fields}),
 * FkPointer field values. Components are SDM-blind and expect plain data,
 * so records flatten to `{ id, ...fields }` and pointers to their raw id.
 */
export function toComponentValue(value: unknown): unknown {
  if (value instanceof FkPointer) return value.id;
  if (Array.isArray(value)) return value.map(toComponentValue);
  if (value !== null && typeof value === 'object') {
    const maybe = value as { id?: unknown; type?: unknown; fields?: unknown };
    if (typeof maybe.type === 'string' && maybe.fields !== null && typeof maybe.fields === 'object') {
      const flat: Record<string, unknown> = { id: maybe.id };
      for (const [k, v] of Object.entries(maybe.fields as Record<string, unknown>)) {
        flat[k] = toComponentValue(v);
      }
      return flat;
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toComponentValue(v)]),
    );
  }
  return value;
}

/**
 * Run a callback script: 'mutate' mode so service effects execute, but with a
 * read-only records host — direct record writes throw ("mutations flow through
 * activities"), matching the validator's 'callback' mode.
 */
export function runPageCallback(
  source: string,
  callbackData: CallbackPayload,
  pageCtx: PageContext,
  handlers: PageServiceHandlers,
): void {
  const host = buildEvalHost(
    sdmStore,
    config,
    {
      contextExtras: { app: pageCtx.app, page: pageCtx.page },
      readonlyRecords: true,
      extras: { callbackData },
    },
    [buildPageServices(handlers)],
  );
  executeScript(source, host, { mode: 'mutate' });
}

// ── Validation (shared by the editor dialog and validatePage) ─────────────────

const pageSchema = () => buildDslSchema(config, [pageServicesStub()]);

const pageFunctions = () => functionSignatures(config);

/** Validate a dynamic-prop expression. `attributes` is not a page root. */
export function validatePageExpression(source: string): Diagnostic[] {
  return validateExpression(source, pageSchema(), {
    bannedRoots: ['attributes'],
    functions: pageFunctions(),
  });
}

/** Validate a callback script: effects allowed, record mutations rejected. */
export function validatePageCallback(source: string): Diagnostic[] {
  return validateScript(source, pageSchema(), {
    mode: 'callback',
    bannedRoots: ['attributes'],
    extraRoots: ['callbackData'],
    functions: pageFunctions(),
  });
}
