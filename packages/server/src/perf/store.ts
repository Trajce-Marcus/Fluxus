// Writing spans, and retention (docs/PERFORMANCE_LOGGING.md §7): spans older
// than 30 days are deleted, checked at most once an hour when spans are
// written. No archive — this data is disposable by design.

import { lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { perfSpans } from '../db/schema';
import type { SpanRow } from './context';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
let lastSweep = 0;

export async function flushSpans(db: Db, spans: SpanRow[]): Promise<void> {
  if (spans.length === 0) return;
  await db.insert(perfSpans).values(
    spans.map((s) => ({
      traceId: s.traceId,
      spanId: s.spanId,
      parentId: s.parentId,
      side: s.side,
      kind: s.kind,
      name: s.name,
      operationId: s.operationId,
      userEmail: s.userEmail,
      startedAt: s.startedAt,
      durationMs: s.durationMs,
      outcome: s.outcome,
      message: s.message,
      counts: s.counts,
    })),
  );
  await maybeSweep(db);
}

async function maybeSweep(db: Db): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  const cutoff = new Date(now - RETENTION_MS);
  await db.delete(perfSpans).where(lt(perfSpans.startedAt, cutoff));
}

/** Test-only: force the next flush to sweep regardless of the hourly gate. */
export function resetSweepClock(): void {
  lastSweep = 0;
}
