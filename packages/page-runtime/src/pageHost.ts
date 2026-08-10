// The page runtime's DSL host surface (page wiring redesign, 2026-07-12;
// de-singletoned at the page-runtime extraction: the store and config arrive
// as parameters from the PageRuntime handle instead of host-app singletons).
//
// Pages speak FluxScript everywhere: dynamic props are single expressions
// evaluated with datasource posture (reads only) — and since 2026-08-10 such an
// expression may name a GET activity rather than carry the query itself
// (DATA_THROUGH_ACTIVITIES step 2) — while component callbacks are
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
  type Diagnostic,
  type ServiceModuleDef,
} from '@fluxus/dsl';
import { buildDslSchema, buildEvalHost, functionSignatures, toComponentValue } from '@fluxus/engine';
import type { ClientSolutionConfig, MemoryAdapter, RecordInstance } from '@fluxus/engine';

// ── The callbackData root ─────────────────────────────────────────────────────
// Components emit one value — a selection value or anchor record id. The host
// packs it under one root so scripts see `callbackData.value`. The free-form
// `data` half was removed (DATA_THROUGH_ACTIVITIES §4): values reach an
// activity as declared attributes, never as an undeclared object off the wire.
// `value` stays because it is the anchor, and an anchor is authorised on every
// run.

export interface CallbackPayload {
  value: unknown;
}

export const packCallbackData = (value: unknown): CallbackPayload => ({ value });

// ── services.page + services.activities ──────────────────────────────────────
// Two modules with one handler set. `page` is honestly UI-only; `activities`
// is the host-neutral activity surface (ruled 2026-07-12): its manifest is
// identical across hosts, each host supplies its own implementation — the
// page host opens the capture form for UI activities, a headless host (Phase
// 4) will take attributes directly. Scripts that only run activities are
// therefore host-portable.

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
  runActivity(activityId: string, record: unknown): void;
}

export function buildPageServices(handlers: PageServiceHandlers): ServiceModuleDef[] {
  return [
    {
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
      },
    },
    {
      name: 'activities',
      description: 'Run activities — the host-neutral mutation path',
      functions: {
        run: {
          params: ['activityId', 'record'],
          description: 'Run an activity on an anchor record (id, or null for a CREATE)',
          kind: 'effect',
          fn: (activityId, record) => handlers.runActivity(String(activityId), record),
        },
      },
    },
  ];
}

/** Manifest-only modules for validation — same schema, no live handlers. */
export const pageServicesStub = (): ServiceModuleDef[] =>
  buildPageServices({ setContext: () => {}, hideComponent: () => {}, runActivity: () => {} });

// ── Evaluation ────────────────────────────────────────────────────────────────

/** The ctx root's page-host members: platform built-ins + the page layer. */
export interface PageContext {
  app: { name: string };
  page: Record<string, unknown>;
  /**
   * The record this page is about (`PageDef.record`, resolved at page open) —
   * `context.record` in every expression and callback the page runs, and the
   * anchor every GET it fires is logged against. Null on a pure view.
   */
  record?: RecordInstance | null;
}

// ── Naming a GET (DATA_THROUGH_ACTIVITIES step 2) ─────────────────────────────
// A dynamic prop stops carrying its own query and names an activity instead:
// `invoke('act_get_work_orders', { status: context.page.status })`. No new
// syntax was needed — `invoke` is a DSL built-in, legal in expressions, and a
// host that runs no activities simply leaves `EvalHost.invoke` absent. Supplying
// it here is the whole of "the page names its producer", and the same
// expression text runs unchanged server-side, where `invoke` is already native.
//
// The one obstacle is that the evaluator is synchronous while a GET is a round
// trip. So evaluation runs in **rounds**: a round evaluates the expression with
// an `invoke` that records the calls it is asked for and answers a placeholder,
// the round's requests are fetched together, and the next round evaluates again
// with those answers in hand. When a round asks for nothing new, its value is
// the answer.
//
// Re-evaluating is free by construction — datasource posture is 'read' mode
// against a mutation-less records host, so an expression cannot do anything the
// second pass would repeat. Rounds beat walking the AST for `invoke` calls
// because an expression may reach one through a named function (§8), which no
// walk of the expression alone can see, and because a GET whose parameters come
// from another GET's answer converges instead of being a special case.

/**
 * How the page host reaches a GET activity — the client's `query`, bound by the
 * runtime handle. `recordId` is the page's own record: where the server lands
 * the read's light entry (step 3), not what the query is about.
 */
export type PageQueryFn = (
  activityId: string,
  params: Record<string, unknown>,
  recordId?: string,
) => Promise<unknown>;

/**
 * Enough rounds for a GET fed by a GET fed by a GET, and few enough that a
 * pathological expression fails loudly instead of hammering the server.
 */
const MAX_QUERY_ROUNDS = 4;

/**
 * What a round hands back for a GET it has not fetched yet.
 *
 * A **symbol**, deliberately, and not null or a placeholder object: the
 * evaluator treats an object with unknown members as a bag of nulls, which
 * would quietly turn `invoke(…).first.status` into null and send the *next*
 * GET a question nobody meant (rejected server-side for a missing required
 * parameter). A symbol has no members the evaluator will read, so reaching
 * into an unfetched answer throws, the round is abandoned, and the round that
 * has the answer asks the real question. Where the placeholder survives as a
 * parameter untouched, `isTainted` catches it directly.
 */
const UNRESOLVED = Symbol('fluxus.unresolved-get');

const isTainted = (value: unknown): boolean => {
  if (value === UNRESOLVED) return true;
  if (Array.isArray(value)) return value.some(isTainted);
  if (value !== null && typeof value === 'object') return Object.values(value).some(isTainted);
  return false;
};

const requestKey = (activityId: string, params: Record<string, unknown>): string =>
  `${activityId} ${JSON.stringify(params)}`;

/**
 * Evaluate a dynamic-prop expression with datasource posture: reads only —
 * the evaluator runs in 'read' mode and the records host has no mutation
 * surface, so effects and writes fail loudly rather than silently.
 *
 * Async because the expression may name a GET activity (above). Without a
 * `query` the host runs as it did before: `invoke` fails loudly.
 */
export async function evaluatePageExpression(
  store: MemoryAdapter,
  config: ClientSolutionConfig,
  source: string,
  pageCtx: PageContext,
  query?: PageQueryFn,
): Promise<unknown> {
  const answers = new Map<string, unknown>();

  for (let round = 0; ; round++) {
    const pending = new Map<string, { activityId: string; params: Record<string, unknown> }>();
    const invoke = (activityId: string, rawParams: Record<string, unknown>) => {
      if (!query) {
        throw new Error(`invoke('${activityId}') — this page host cannot run activities`);
      }
      // Parameters built on an answer this round doesn't have yet are not a
      // question worth asking; the round that resolves them will ask it.
      if (isTainted(rawParams)) return UNRESOLVED;
      // Parameters cross the wire, so they get the same flattening the answer
      // does — a record reaches the server as its plain fields, never as a
      // DslRecord the attribute trio could not coerce.
      const params = toComponentValue(rawParams) as Record<string, unknown>;
      const key = requestKey(activityId, params);
      if (answers.has(key)) return answers.get(key);
      pending.set(key, { activityId, params });
      return UNRESOLVED;
    };

    const host = buildEvalHost(store, config, {
      contextExtras: { app: pageCtx.app, page: pageCtx.page },
      anchorRecord: pageCtx.record ?? null,
      readonlyRecords: true,
      invoke,
    });

    let value: unknown;
    let failure: unknown = null;
    try {
      value = evaluateExpression(source, host);
    } catch (err) {
      // A placeholder legitimately breaks the rest of the expression
      // (`invoke(…).count`), so a round that asked for something is allowed to
      // fail — the failure only counts once nothing is left to fetch.
      failure = err;
    }

    if (pending.size === 0) {
      if (failure) throw failure;
      // Unreachable by construction — a placeholder only exists in a round that
      // asked for something — but a symbol reaching a component would be a
      // baffling bug, so it stops here.
      if (isTainted(value)) throw new Error('Dynamic prop resolved to an unfetched GET answer');
      return toComponentValue(value);
    }
    if (round >= MAX_QUERY_ROUNDS) {
      throw new Error(
        `Dynamic prop still asking for GET activities after ${MAX_QUERY_ROUNDS} rounds — ` +
        `check for an invoke() whose parameters depend on its own answer`,
      );
    }

    await Promise.all(
      [...pending].map(async ([key, req]) => {
        answers.set(key, await query!(req.activityId, req.params, pageCtx.record?.id));
      }),
    );
  }
}

// Records flatten to plain data on their way to an SDM-blind component. The
// transform moved to the engine bridge when GET activities landed — a GET's
// caller needs the same shaping — and is re-exported here unchanged.
export { toComponentValue };

/**
 * Run a callback script: 'mutate' mode so service effects execute, but with a
 * read-only records host — direct record writes throw ("mutations flow through
 * activities"), matching the validator's 'callback' mode.
 */
export function runPageCallback(
  store: MemoryAdapter,
  config: ClientSolutionConfig,
  source: string,
  callbackData: CallbackPayload,
  pageCtx: PageContext,
  handlers: PageServiceHandlers,
): void {
  const host = buildEvalHost(
    store,
    config,
    {
      contextExtras: { app: pageCtx.app, page: pageCtx.page },
      anchorRecord: pageCtx.record ?? null,
      readonlyRecords: true,
      extras: { callbackData },
    },
    buildPageServices(handlers),
  );
  executeScript(source, host, { mode: 'mutate' });
}

// ── Validation (shared by the editor dialog and validatePage) ─────────────────

const pageSchema = (config: ClientSolutionConfig) => buildDslSchema(config, pageServicesStub());

const pageFunctions = (config: ClientSolutionConfig) => functionSignatures(config);

/** Validate a dynamic-prop expression. `attributes` is not a page root. */
export function validatePageExpression(config: ClientSolutionConfig, source: string): Diagnostic[] {
  return validateExpression(source, pageSchema(config), {
    bannedRoots: ['attributes'],
    functions: pageFunctions(config),
  });
}

/** Validate a callback script: effects allowed, record mutations rejected. */
export function validatePageCallback(config: ClientSolutionConfig, source: string): Diagnostic[] {
  return validateScript(source, pageSchema(config), {
    mode: 'callback',
    bannedRoots: ['attributes'],
    extraRoots: ['callbackData'],
    functions: pageFunctions(config),
  });
}
