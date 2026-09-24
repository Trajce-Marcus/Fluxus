// The join mechanism (docs/PERFORMANCE_LOGGING.md §5): one AsyncLocalStorage
// context per request, so code deeper in the call stack (host.ts, router.ts)
// opens a child span without anything being threaded through it. A request's
// spans are collected in an in-memory array and written in one insert when
// the request finishes (trpc.ts's perf middleware).
//
// Whether logging is actually ON for this request is decided once, at flush
// time, in trpc.ts — not here. Everything below runs unconditionally cheap
// (object spreads, one array push) so a request that turns out to be
// unlogged cost nothing but that.

import { AsyncLocalStorage } from 'node:async_hooks';

export type Side = 'server' | 'browser';
export type Outcome = 'ok' | 'refused' | 'error';

export interface SpanRow {
  traceId: string;
  spanId: string;
  parentId: string | null;
  side: Side;
  kind: string;
  name: string;
  operationId: string | null;
  userEmail: string | null;
  startedAt: Date;
  durationMs: number;
  outcome: Outcome;
  message: string | null;
  counts: Record<string, number> | null;
}

export interface Ctx {
  traceId: string;
  /** The current span's own id — the parent id the next nested span gets. */
  spanId: string | null;
  operationId: string | null;
  userEmail: string | null;
  /** Shared by reference across every span in this request (§4's db_queries/
   *  db_ms are the REQUEST's total, not any one nested span's). */
  dbCounters: { queries: number; ms: number };
  /** Shared by reference — every span in the request pushes into the same
   *  array; trpc.ts flushes it once, in the outermost `finally`. */
  collector: SpanRow[];
}

const als = new AsyncLocalStorage<Ctx>();

function randomId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** A fresh trace id — used when no `x-fluxus-trace` header named one. */
export function newTraceId(): string {
  return randomId();
}

/** Parse the `x-fluxus-trace` header (§5): `traceId:spanId`, spanId being the
 *  browser span the request belongs to. Malformed/absent ⇒ null, a new trace. */
export function parseTraceHeader(header: string | null | undefined): { traceId: string; spanId: string } | null {
  if (!header) return null;
  const i = header.indexOf(':');
  if (i <= 0) return null;
  const traceId = header.slice(0, i);
  const spanId = header.slice(i + 1);
  return traceId && spanId ? { traceId, spanId } : null;
}

/**
 * Establish the request's root context — one call per procedure (trpc.ts's
 * perf middleware). `spanId` is the `request` span's own id: whatever runs
 * inside `fn` and opens a child span gets this as its parent.
 */
export function runRequest<T>(
  init: { traceId: string; spanId: string; collector: SpanRow[] },
  fn: () => Promise<T>,
): Promise<T> {
  return als.run(
    { traceId: init.traceId, spanId: init.spanId, operationId: null, userEmail: null, dbCounters: { queries: 0, ms: 0 }, collector: init.collector },
    fn,
  );
}

/** Record the operation this request turned out to be about, and who it is
 *  for — called once the handler knows (router.ts's `resolveUser`). A no-op
 *  outside a request context (headless callers with no trace wrapping, tests
 *  that build a caller directly). */
export function setScope(operationId?: string | null, userEmail?: string | null): void {
  const ctx = als.getStore();
  if (!ctx) return;
  if (operationId !== undefined) ctx.operationId = operationId;
  if (userEmail !== undefined) ctx.userEmail = userEmail;
}

/** The live context, for trpc.ts to read `operationId`/`userEmail`/`collector`
 *  back out after `next()` resolves — deliberately re-read rather than closed
 *  over, since a nested span's context is a copy (below), not the same object
 *  `setScope` mutated. */
export function currentCtx(): Readonly<Ctx> | undefined {
  return als.getStore();
}

/** A query's cost, counted where the code already runs it (db/client.ts's
 *  pool wrap) — never by an extra query. Silently a no-op outside a request. */
export function recordDbQuery(ms: number, ctx: Ctx | undefined = als.getStore()): void {
  if (ctx) {
    ctx.dbCounters.queries += 1;
    ctx.dbCounters.ms += ms;
  }
}

/** A new physical database connection opening (db/client.ts) — its own span,
 *  attributed to whichever request happened to need it. */
export function pushDbConnectSpan(durationMs: number, ctx: Ctx | undefined = als.getStore()): void {
  if (!ctx) return;
  ctx.collector.push({
    traceId: ctx.traceId,
    spanId: randomId(),
    parentId: ctx.spanId,
    side: 'server',
    kind: 'db_connect',
    name: '-',
    operationId: ctx.operationId,
    userEmail: ctx.userEmail,
    startedAt: new Date(),
    durationMs,
    outcome: 'ok',
    message: null,
    counts: null,
  });
}

/**
 * Time an async operation as a child span of whichever span is current
 * (§3's host_load/validate/engine/write_back). Always runs `fn` — logging
 * being off only means the row this produces gets dropped at flush time, not
 * that the timing itself is skipped, which keeps this the one code path
 * whether or not anyone will ever read the result.
 */
export async function withSpan<T>(
  kind: string,
  name: string,
  fn: () => Promise<T>,
  countsOf?: (result: T) => Record<string, number> | undefined,
): Promise<T> {
  const parent = als.getStore();
  if (!parent) return fn(); // no request context (a test calling host.ts directly) — nothing to attribute this to
  const spanId = randomId();
  const startedAt = new Date();
  const started = performance.now();
  const child: Ctx = { ...parent, spanId };
  let outcome: Outcome = 'ok';
  let message: string | null = null;
  let result: T | undefined;
  try {
    result = await als.run(child, fn);
    return result;
  } catch (err) {
    outcome = 'error';
    message = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    parent.collector.push({
      traceId: parent.traceId,
      spanId,
      parentId: parent.spanId,
      side: 'server',
      kind,
      name,
      operationId: child.operationId,
      userEmail: child.userEmail,
      startedAt,
      durationMs: Math.round(performance.now() - started),
      outcome,
      message,
      counts: (outcome === 'ok' && countsOf && result !== undefined) ? (countsOf(result) ?? null) : null,
    });
  }
}
