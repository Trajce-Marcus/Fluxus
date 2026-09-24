// Performance logging's four routes (docs/PERFORMANCE_LOGGING.md §10): the
// browser's span intake, the switches, and the dashboard's report. The
// `perf.*` prefix is what trpc.ts's middleware skips — logging about logging
// is noise.

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { isPlatformAdmin } from '../auth';
import { requirePlatformAdmin } from '../gates';
import { buildReport, flushSpans, getSettings, rawSettings, setSettings, type SpanRow } from '../perf';
import { t } from '../trpc';

const switchValue = z.enum(['on', 'off', 'follow']);

// A browser span as it arrives: ISO start time, and counts limited to
// numbers. Bounded on every string so a rogue tab cannot fill the table with
// one enormous row.
const browserSpan = z.object({
  traceId: z.string().min(1).max(64),
  spanId: z.string().min(1).max(64),
  parentId: z.string().max(64).nullable(),
  kind: z.string().min(1).max(40),
  name: z.string().max(300),
  operationId: z.string().max(300).nullable().optional(),
  startedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative().max(3_600_000),
  outcome: z.enum(['ok', 'refused', 'error']),
  message: z.string().max(1000).nullable().optional(),
  counts: z.record(z.string(), z.number()).nullable().optional(),
});

type Switches = { enabled: 'on' | 'off' | 'follow'; server: 'on' | 'off' | 'follow'; browser: 'on' | 'off' | 'follow'; dbCounts: 'on' | 'off' | 'follow' };
const plainRow = (r: { scope: string } & Switches) => ({ scope: r.scope, enabled: r.enabled, server: r.server, browser: r.browser, dbCounts: r.dbCounts });

export const perfRouter = t.router({
  /** The browser sending its spans (batched every 10s and when the tab is
   *  hidden). Dropped silently when the operation's browser switch is off —
   *  a browser that has not yet learned the switch changed is not an error. */
  record: t.procedure
    .input(z.object({ spans: z.array(browserSpan).max(500) }))
    .mutation(async ({ ctx, input }) => {
      if (input.spans.length === 0) return { ok: true as const };
      // One page ⇒ one operation: the first span that names one stands for the batch.
      const settings = await getSettings(ctx.db, input.spans.find((s) => s.operationId)?.operationId ?? null);
      if (!settings.enabled || !settings.browser) return { ok: true as const };
      const rows: SpanRow[] = input.spans.map((s) => ({
        traceId: s.traceId,
        spanId: s.spanId,
        parentId: s.parentId,
        side: 'browser',
        kind: s.kind,
        name: s.name,
        operationId: s.operationId ?? null,
        userEmail: ctx.user?.email ?? null,
        startedAt: new Date(s.startedAt),
        durationMs: s.durationMs,
        outcome: s.outcome,
        message: s.message ?? null,
        counts: s.counts ?? null,
      }));
      await flushSpans(ctx.db, rows);
      return { ok: true as const };
    }),

  /**
   * What is switched on. Two callers, one route:
   *   - the browser, at connect, naming its operation → just what applies to it;
   *   - the Platform dashboard, naming none → the platform-wide answer, plus
   *     (platform admins only) the raw rows to edit.
   */
  settings: t.procedure
    .input(z.object({ operationId: z.string().min(1).optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const effective = await getSettings(ctx.db, input.operationId ?? null);
      if (input.operationId || !isPlatformAdmin(ctx.user?.email)) return { effective };
      const { platform, operations } = await rawSettings(ctx.db);
      return { effective, platform: plainRow(platform), operations: operations.map(plainRow) };
    }),

  /** `scope` is `'platform'` or an operation id. Only the switches named are
   *  changed. 'follow' is meaningless for the platform row (nothing above it
   *  to defer to) and is refused there. */
  setSettings: t.procedure
    .input(
      z.object({
        scope: z.string().min(1),
        enabled: switchValue.optional(),
        server: switchValue.optional(),
        browser: switchValue.optional(),
        dbCounts: switchValue.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePlatformAdmin(ctx);
      const { scope, ...patch } = input;
      if (scope === 'platform' && Object.values(patch).includes('follow')) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "The platform's own switches are on or off — there is nothing above it to follow" });
      }
      await setSettings(ctx.db, scope, patch);
      return { ok: true as const };
    }),

  /** The dashboard. With `traceId`, one trace's spans instead of the panels. */
  report: t.procedure
    .input(z.object({ range: z.enum(['1h', '24h', '7d']).default('24h'), traceId: z.string().min(1).optional() }).default({ range: '24h' }))
    .query(async ({ ctx, input }) => {
      await requirePlatformAdmin(ctx);
      return buildReport(ctx.db, input);
    }),
});
