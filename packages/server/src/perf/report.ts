// The dashboard's one query (docs/PERFORMANCE_LOGGING.md §8) — plain tables,
// no charts, for this MVP: slowest things per kind/name, page opens, database
// wake-ups, and recent slow traces (over 2s), or (with `traceId`) one trace's
// spans as a flat list the dashboard indents into a tree client-side.

import { and, asc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { perfSpans } from '../db/schema';

export type ReportRange = '1h' | '24h' | '7d';

export interface ReportInput {
  range: ReportRange;
  /** When given, answers with `traceSpans` instead of the summary panels — the
   *  dashboard's "recent slow actions" drill-in. */
  traceId?: string;
}

export interface SlowestRow {
  kind: string;
  name: string;
  count: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface PageOpenRow {
  name: string;
  count: number;
  medianMs: number;
  p95Ms: number;
}

export interface DbWakeupSummary {
  count: number;
  medianMs: number;
  maxMs: number;
}

export interface SlowTraceRow {
  traceId: string;
  startedAt: string;
  durationMs: number;
}

export interface SpanTreeRow {
  spanId: string;
  parentId: string | null;
  side: 'server' | 'browser';
  kind: string;
  name: string;
  startedAt: string;
  durationMs: number;
  outcome: 'ok' | 'refused' | 'error';
  message: string | null;
  counts: Record<string, number> | null;
}

export interface ReportResult {
  slowest?: SlowestRow[];
  pageOpens?: PageOpenRow[];
  dbWakeups?: DbWakeupSummary | null;
  recentSlowTraces?: SlowTraceRow[];
  traceSpans?: SpanTreeRow[];
}

function rangeCutoff(range: ReportRange): Date {
  const ms = range === '1h' ? 3_600_000 : range === '24h' ? 86_400_000 : 604_800_000;
  return new Date(Date.now() - ms);
}

/** The 2-second bar for "recent slow actions" (§8) — over the trace's whole
 *  span, not any one row in it. */
const SLOW_TRACE_THRESHOLD = "interval '2 seconds'";
/** Postgres has no `timestamp + milliseconds`; this is the idiom every span's
 *  end is computed with below. */
const spanEnd = sql`(${perfSpans.startedAt} + (${perfSpans.durationMs} || ' milliseconds')::interval)`;

export async function buildReport(db: Db, input: ReportInput): Promise<ReportResult> {
  if (input.traceId) {
    const rows = await db
      .select({
        spanId: perfSpans.spanId,
        parentId: perfSpans.parentId,
        side: perfSpans.side,
        kind: perfSpans.kind,
        name: perfSpans.name,
        startedAt: perfSpans.startedAt,
        durationMs: perfSpans.durationMs,
        outcome: perfSpans.outcome,
        message: perfSpans.message,
        counts: perfSpans.counts,
      })
      .from(perfSpans)
      .where(eq(perfSpans.traceId, input.traceId))
      .orderBy(asc(perfSpans.startedAt));
    return {
      traceSpans: rows.map((r) => ({ ...r, startedAt: r.startedAt.toISOString() })),
    };
  }

  const cutoff = rangeCutoff(input.range);

  const slowest = await db
    .select({
      kind: perfSpans.kind,
      name: perfSpans.name,
      count: sql<number>`count(*)::int`,
      medianMs: sql<number>`percentile_cont(0.5) within group (order by ${perfSpans.durationMs})`,
      p95Ms: sql<number>`percentile_cont(0.95) within group (order by ${perfSpans.durationMs})`,
      maxMs: sql<number>`max(${perfSpans.durationMs})`,
    })
    .from(perfSpans)
    .where(gte(perfSpans.startedAt, cutoff))
    .groupBy(perfSpans.kind, perfSpans.name)
    .orderBy(sql`percentile_cont(0.95) within group (order by ${perfSpans.durationMs}) desc`)
    .limit(100);

  const pageOpens = await db
    .select({
      name: perfSpans.name,
      count: sql<number>`count(*)::int`,
      medianMs: sql<number>`percentile_cont(0.5) within group (order by ${perfSpans.durationMs})`,
      p95Ms: sql<number>`percentile_cont(0.95) within group (order by ${perfSpans.durationMs})`,
    })
    .from(perfSpans)
    .where(and(gte(perfSpans.startedAt, cutoff), eq(perfSpans.kind, 'page_open')))
    .groupBy(perfSpans.name)
    .orderBy(sql`percentile_cont(0.95) within group (order by ${perfSpans.durationMs}) desc`)
    .limit(100);

  const [dbWakeupRow] = await db
    .select({
      count: sql<number>`count(*)::int`,
      medianMs: sql<number>`percentile_cont(0.5) within group (order by ${perfSpans.durationMs})`,
      maxMs: sql<number>`max(${perfSpans.durationMs})`,
    })
    .from(perfSpans)
    .where(and(gte(perfSpans.startedAt, cutoff), eq(perfSpans.kind, 'db_connect')));

  const recentSlowTraces = await db
    .select({
      traceId: perfSpans.traceId,
      startedAt: sql<string | Date>`min(${perfSpans.startedAt})`,
      durationMs: sql<number>`extract(epoch from (max(${spanEnd}) - min(${perfSpans.startedAt}))) * 1000`,
    })
    .from(perfSpans)
    .where(gte(perfSpans.startedAt, cutoff))
    .groupBy(perfSpans.traceId)
    .having(sql`max(${spanEnd}) - min(${perfSpans.startedAt}) > ${sql.raw(SLOW_TRACE_THRESHOLD)}`)
    .orderBy(sql`min(${perfSpans.startedAt}) desc`)
    .limit(50);

  return {
    slowest: slowest.map(round4),
    pageOpens: pageOpens.map(round3),
    dbWakeups: Number(dbWakeupRow?.count ?? 0) > 0 ? round3ish(dbWakeupRow) : null,
    recentSlowTraces: recentSlowTraces.map((r) => ({
      traceId: r.traceId,
      startedAt: new Date(r.startedAt).toISOString(),
      durationMs: Math.round(Number(r.durationMs)),
    })),
  };
}

// Aggregates (percentile_cont, count, max) are raw SQL expressions, which
// drizzle hands back undecoded — a double can arrive as a string — so every
// number is coerced here rather than trusted.
function round4(r: SlowestRow): SlowestRow {
  return { kind: r.kind, name: r.name, count: Number(r.count), medianMs: Math.round(Number(r.medianMs)), p95Ms: Math.round(Number(r.p95Ms)), maxMs: Math.round(Number(r.maxMs)) };
}
function round3(r: PageOpenRow): PageOpenRow {
  return { name: r.name, count: Number(r.count), medianMs: Math.round(Number(r.medianMs)), p95Ms: Math.round(Number(r.p95Ms)) };
}
function round3ish(r: { count: number; medianMs: number; maxMs: number }): DbWakeupSummary {
  return { count: Number(r.count), medianMs: Math.round(Number(r.medianMs)), maxMs: Math.round(Number(r.maxMs)) };
}
