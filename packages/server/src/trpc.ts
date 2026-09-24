// The tRPC foundation every router file shares: the request context, the
// builder, the input schemas that repeat, and the error translation.
//
// Split out of router.ts on 2026-08-04 so the user/admin surface could become
// its own router module without either file importing the other.

import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { Db } from './db/client';
import type { AuthUser, RolesResolver } from './auth';
import type { BlobStore } from './services/blob';
import type { NotifySink } from './services/notify';
import {
  ConfigValidationError,
  NotImplementedError,
  OperationNotFoundError,
  OrgExistsError,
  OrgNotFoundError,
  SolutionNotFoundError,
} from './host';
import {
  classifyOutcome,
  currentCtx,
  flushSpans,
  getSettings,
  newTraceId,
  parseTraceHeader,
  runRequest,
  type SpanRow,
} from './perf';

/** The single demo bundle keeps one id as both its solution and its operation. */
export const DEFAULT_SOLUTION = 'demo/sdm';
export const DEFAULT_OPERATION = 'demo/sdm';
/** The single implicit org (§1) until the auth tier resolves user → org. */
export const DEFAULT_ORG = 'default';

export interface AppContext {
  db: Db;
  sink?: NotifySink;
  /** The blob store (R2) for `files` presigns; unconfigured when FLUXUS_R2_* is unset. */
  blob?: BlobStore;
  /**
   * The per-request verified identity (RBAC_COMPACT "Auth") — produced by
   * Auth.authenticate in createApp's createContext. Absent (tests, direct
   * callers) ⇒ the demo stub.
   */
  user?: AuthUser;
  /** Roles-resolver seam (§0.4); absent ⇒ the stage-1/2 stubs. */
  roles?: RolesResolver;
  /**
   * Whether Neon Auth is configured. RBAC enforcement (the record-type read
   * filter) is active only when true; the env stub (tests, local dev) leaves
   * everything open, matching "no auth env ⇒ everything open".
   */
  authConfigured?: boolean;
  /** The `x-fluxus-trace` header, verbatim, when the caller sent one
   *  (docs/PERFORMANCE_LOGGING.md §5) — set by createApp's createContext.
   *  Absent for headless/test callers, which just start a fresh trace. */
  traceHeader?: string | null;
}

const baseT = initTRPC.context<AppContext>().create();

/**
 * Performance logging's one hook point (PERFORMANCE_LOGGING.md §10a): a
 * middleware on the procedure builder covers every procedure, in every
 * runtime (local/Vercel/Lambda), with nothing added at each call site.
 *
 * `perf.*` is excluded (logging about logging is noise). Everything else
 * always runs inside a request context — deciding whether logging is
 * actually ON happens once, at the very end, by re-resolving settings
 * against whatever operation the handler turned out to be about
 * (`setScope`, called from `resolveUser`). That ordering — decide late, not
 * early — is what lets an operation's own override apply even though the
 * operation isn't known until the handler runs.
 */
const perfMiddleware = baseT.middleware(async ({ path, ctx, next }) => {
  if (path.startsWith('perf.')) return next();

  const header = parseTraceHeader(ctx.traceHeader);
  const traceId = header?.traceId ?? newTraceId();
  const spanId = crypto.randomUUID().replace(/-/g, '');
  const collector: SpanRow[] = [];
  const startedAt = new Date();
  const started = performance.now();

  return runRequest({ traceId, spanId, collector }, async () => {
    let outcome: 'ok' | 'refused' | 'error' = 'ok';
    let message: string | null = null;
    try {
      const result = await next();
      if (!result.ok) {
        const classified = classifyOutcome(result.error);
        outcome = classified.outcome;
        message = classified.message;
      }
      return result;
    } catch (err) {
      const classified = classifyOutcome(err);
      outcome = classified.outcome;
      message = classified.message;
      throw err;
    } finally {
      const live = currentCtx();
      const operationId = live?.operationId ?? null;
      const userEmail = live?.userEmail ?? ctx.user?.email ?? null;
      // db_queries/db_ms only when the request actually touched the database
      // (config loads, records, activities) — a bare `me` or `platform.listOrgs`
      // carries none, which is the signal that nothing was measured, not that
      // it was zero.
      const dbCounters = live?.dbCounters;
      collector.push({
        traceId,
        spanId,
        parentId: header?.spanId ?? null,
        side: 'server',
        kind: 'request',
        name: path,
        operationId,
        userEmail,
        startedAt,
        durationMs: Math.round(performance.now() - started),
        outcome,
        message,
        counts: dbCounters && dbCounters.queries > 0 ? { db_queries: dbCounters.queries, db_ms: Math.round(dbCounters.ms) } : null,
      });

      await flushRequest(ctx.db, operationId, collector);
    }
  });
});

/** Decide, now that the request's operation is known, whether this request is
 *  logged at all — and write it if so. Its own function (not inline in the
 *  middleware's `finally`) so no early `return` can replace the procedure's
 *  result. Never throws: a logging failure must not fail the request. */
async function flushRequest(db: Db, operationId: string | null, collector: SpanRow[]): Promise<void> {
  const settings = await getSettings(db, operationId).catch(() => null);
  if (!settings || !settings.enabled || !settings.server) return; // dropped — nothing measured is written
  const rows = settings.dbCounts
    ? collector
    : collector.filter((s) => s.kind !== 'db_connect').map((s) => ({ ...s, counts: stripDbCounts(s.counts) }));
  await flushSpans(db, rows).catch((err) => {
    console.warn(`[perf] failed to write spans: ${err instanceof Error ? err.message : String(err)}`);
  });
}

function stripDbCounts(counts: Record<string, number> | null): Record<string, number> | null {
  if (!counts) return counts;
  const { db_queries: _q, db_ms: _m, ...rest } = counts;
  return Object.keys(rest).length > 0 ? rest : null;
}

export const t = { ...baseT, procedure: baseT.procedure.use(perfMiddleware) };

export const solutionInput = z.string().min(1).default(DEFAULT_SOLUTION);
export const operationInput = z.string().min(1).default(DEFAULT_OPERATION);
export const orgInput = z.string().min(1).default(DEFAULT_ORG);
export const emailInput = z.string().email();

export function rethrow(err: unknown): never {
  if (err instanceof SolutionNotFoundError) throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
  if (err instanceof NotImplementedError) throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: err.message });
  if (err instanceof OperationNotFoundError) throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
  if (err instanceof OrgNotFoundError) throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
  if (err instanceof OrgExistsError) throw new TRPCError({ code: 'CONFLICT', message: err.message });
  if (err instanceof ConfigValidationError) throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
  if (err instanceof TRPCError) throw err;
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: err instanceof Error ? err.message : String(err),
  });
}
