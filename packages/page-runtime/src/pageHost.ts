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
import { buildDslSchema, buildEvalHost, evaluateWithGets, functionSignatures, toComponentValue } from '@fluxus/engine';
import type { ClientSolutionConfig, GetQueryFn, MemoryAdapter, RecordInstance } from '@fluxus/engine';
import type { CaptureScript } from './capture/host';

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

/**
 * Records a control is about, on their way into one **named, declared**
 * attribute of the activity being run (2026-09-08). A bulk action fills it
 * with what is ticked; a row action with its own row.
 *
 * Deliberately not the `data` bag removed on 2026-08-09. That was free-form
 * and undeclared — anything off the wire, landing wherever. This names one
 * attribute the model already declares, and the only value it can carry is
 * record ids the host itself holds. It is also why `services.activities.run`
 * stays a two-parameter function below: a **script** still cannot pass values
 * into an activity, only a component placed by an author can.
 */
export interface AttributeSeed {
  /** The activity attribute the records fill. */
  attribute: string;
  /** Always a list — one record or forty (the selection ruling). */
  records: string[];
}

import type { ActivityOption } from './availableActivities';

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
  runActivity(activityId: string, record: unknown, seed?: AttributeSeed): void;
  /**
   * Open another page, optionally about a record (2026-08-27). Navigating *is*
   * setting the two values the page-anchor model already ruled — `?page=` and
   * `?record=` — so this invents no concept, it writes the pair.
   *
   * The host owns what that means: the Runtime app pushes a URL, the Console
   * swaps the previewed page. A host that supplies none fails loudly, the same
   * posture as `invoke` without a query — a page that cannot navigate should
   * say so, not quietly do nothing.
   */
  openPage(page: string, record: unknown): void;
  /**
   * Which activities apply to a record right now (2026-09-14) — the workflow's
   * record-level acts, minus the ones their `show_condition` rules out.
   *
   * A **component** door, not a script one: it is deliberately absent from
   * `buildPageServices` below, so no FluxScript can call it. A script asking
   * the model what it may do is a read, and reads go through GET activities
   * (DATA_THROUGH_ACTIVITIES). This is the host answering a component that
   * draws buttons, from what the host already holds.
   */
  listActivities(record: unknown): Promise<ActivityOption[]>;
  /**
   * A stored file key → an address a browser can load (2026-09-23,
   * COMPONENT_PHOTOS §2). The channel a photo reaches a component through: the
   * container assigns host services onto every component's resolved props, and
   * this package's SPEC already named that as the route to
   * `UploadService.resolveUrl`.
   *
   * A **component** door, not a script one — absent from `buildPageServices`
   * below, exactly as `listActivities` is, so no FluxScript can name it. A
   * page's script has no business minting file addresses.
   */
  resolveUrl(storageKey: string): Promise<string>;
  /**
   * Back to the page before, and whether there is one (2026-09-23, PageHeader).
   * The host owns the history — the Runtime app's is the browser's, so this
   * and the browser's Back are the same step; a host with none (the Console's
   * preview) answers false and ignores the call. A **component** door, absent
   * from `buildPageServices` like `listActivities`: no script asked for it.
   */
  goBack(): void;
  canGoBack(): boolean;
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
        open: {
          params: ['page', 'record'],
          description: 'Open a page, optionally about a record (id, or null for a pure view)',
          kind: 'effect',
          fn: (page, record) => handlers.openPage(String(page), record),
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
          // Two arguments, and no third: a script may name the activity and its
          // anchor, never the values it runs with (DATA_THROUGH_ACTIVITIES §4).
          fn: (activityId, record) => handlers.runActivity(String(activityId), record),
        },
      },
    },
  ];
}

/** Manifest-only modules for validation — same schema, no live handlers. */
export const pageServicesStub = (): ServiceModuleDef[] =>
  buildPageServices({
    setContext: () => {}, hideComponent: () => {}, runActivity: () => {}, openPage: () => {},
    // Not in any module below, so nothing can name them in a script — they are
    // here only because the handler set is one interface.
    listActivities: async () => [],
    resolveUrl: async () => '',
    goBack: () => {},
    canGoBack: () => false,
  });

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
// The waiting — evaluate, fetch what the round asked for, evaluate again — is
// `evaluateWithGets` in the engine. It was written here and moved there on
// 2026-08-16, when a capture form's dropdown needed the same loop; the
// reasoning for rounds (and for the placeholder being a symbol) lives with it.

/**
 * How the page host reaches a GET activity — the client's `query`, bound by the
 * runtime handle. `recordId` is the page's own record: where the server lands
 * the read's light entry (step 3), not what the query is about.
 */
export type PageQueryFn = GetQueryFn;

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
  return evaluateWithGets(
    (invoke) => evaluateExpression(source, buildEvalHost(store, config, {
      contextExtras: { app: pageCtx.app, page: pageCtx.page },
      anchorRecord: pageCtx.record ?? null,
      readonlyRecords: true,
      invoke,
    })),
    { query, anchorId: pageCtx.record?.id, label: 'Dynamic prop' },
  );
}

/**
 * Evaluate a capture-form expression — a show condition, a validation rule, or
 * a dropdown's datasource (2026-08-16, when pages started opening the real
 * form). Same posture as a dynamic prop (reads only), different roots: capture
 * expressions speak `attributes`, which a page's own expressions may not.
 *
 * Synchronous, and the `invoke` is the caller's: the form owns the waiting,
 * through the engine's rounds loop, because only it knows which of its
 * expressions is allowed a round trip.
 */
export function evaluateCapture(
  store: MemoryAdapter,
  config: ClientSolutionConfig,
  source: string,
  script: CaptureScript,
): unknown {
  return evaluateExpression(source, buildEvalHost(store, config, {
    attributes: script.attributes,
    anchorRecord: script.anchorRecord,
    activity: script.activity,
    // `context.page.record` — the record the page was showing when this run
    // was launched, flattened the way a component sees one so a field reads as
    // `context.page.record.project_id`. It is what a CREATE has instead of an
    // anchor. `record` is reserved here: a page context key of that name is
    // shadowed by it.
    contextExtras: script.pageRecord
      ? { page: { record: { id: script.pageRecord.id, ...script.pageRecord.customFields } } }
      : { page: { record: null } },
    extras: script.extras,
    invoke: script.invoke,
    readonlyRecords: true,
  }));
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

/**
 * The same validation with `records` banned as well — how `validatePage` spots
 * a prop that reads records directly instead of naming a GET (2026-08-16).
 * The real parser answers the question, so a `records` inside a string literal
 * or behind a named function is judged correctly, which a text search over the
 * expression would not manage.
 */
export function validatePageExpressionWithoutRecords(config: ClientSolutionConfig, source: string): Diagnostic[] {
  return validateExpression(source, pageSchema(config), {
    bannedRoots: ['attributes', 'records'],
    functions: pageFunctions(config),
  }).filter((d) => d.message.toLowerCase().includes('records'));
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
