// The browser's half of performance logging (docs/PERFORMANCE_LOGGING.md §3,
// §5): a `call` span for every call to the server, a `page_open` span from a
// page being asked for until every component on it is ready, and the trace
// header that makes the server's spans join them.
//
// Disposable by design: spans are batched and sent every 10 seconds and when
// the tab is hidden; a failed send drops the batch. Nothing here may slow or
// break the app, so every path swallows its own errors.

import type { TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { AppRouter } from '@fluxus/server';

export interface BrowserSpan {
  traceId: string;
  spanId: string;
  parentId: string | null;
  kind: 'page_open' | 'call';
  name: string;
  operationId: string | null;
  startedAt: string;
  durationMs: number;
  outcome: 'ok' | 'refused' | 'error';
  message?: string | null;
  counts?: Record<string, number> | null;
}

export interface PageOpenHandle {
  /** The page is ready: every component on it has finished loading. */
  end(counts: { components: number }): void;
  /** The page failed to open. */
  fail(message: string): void;
  /** The page went away (or another was asked for) before it was ready —
   *  nothing is recorded, but calls stop carrying its trace. */
  cancel(): void;
}

const FLUSH_MS = 10_000;
const MAX_BUFFER = 500;

const REFUSED_CODES = new Set(['BAD_REQUEST', 'FORBIDDEN', 'UNAUTHORIZED', 'NOT_FOUND', 'CONFLICT', 'PRECONDITION_FAILED', 'NOT_IMPLEMENTED']);

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

interface OpenPage {
  traceId: string;
  spanId: string;
  name: string;
  startedAt: Date;
  started: number;
  calls: number;
}

/**
 * One per tRPC client. Inert until `configure` is told logging is on for the
 * operation the client connected to — the browser learns its switches at
 * connect (§6), and until then (or on a server that predates the switches)
 * it records and sends nothing.
 */
export class BrowserPerf {
  private active = false;
  private operationId: string | null = null;
  private buffer: BrowserSpan[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private page: OpenPage | null = null;
  private sender: ((spans: BrowserSpan[]) => Promise<unknown>) | null = null;
  private listening = false;

  /** Set once the client exists — the sender is a call on that same client. */
  setSender(send: (spans: BrowserSpan[]) => Promise<unknown>): void {
    this.sender = send;
  }

  configure(operationId: string | null, on: boolean): void {
    this.operationId = operationId;
    this.active = on;
    if (!on) {
      this.buffer = [];
      this.page = null;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    if (!this.timer) this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    if (!this.listening && typeof document !== 'undefined') {
      this.listening = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void this.flush();
      });
    }
  }

  get on(): boolean {
    return this.active;
  }

  /** A page is being asked for. Calls made until it is ready carry its trace. */
  beginPage(name: string): PageOpenHandle | null {
    if (!this.active) return null;
    const page: OpenPage = { traceId: newId(), spanId: newId(), name, startedAt: new Date(), started: performance.now(), calls: 0 };
    this.page = page; // a page still opening is superseded, and never recorded
    const finish = (outcome: 'ok' | 'error', counts: Record<string, number> | null, message: string | null) => {
      if (this.page !== page) return;
      this.page = null;
      this.push({
        traceId: page.traceId,
        spanId: page.spanId,
        parentId: null,
        kind: 'page_open',
        name: page.name,
        operationId: this.operationId,
        startedAt: page.startedAt.toISOString(),
        durationMs: Math.round(performance.now() - page.started),
        outcome,
        message,
        counts,
      });
    };
    return {
      end: (counts) => finish('ok', { components: counts.components, calls: page.calls }, null),
      fail: (message) => finish('error', { calls: page.calls }, message),
      cancel: () => {
        if (this.page === page) this.page = null;
      },
    };
  }

  /** Begin timing one call; the returned function closes it. */
  startCall(name: string): { traceHeader: string; end: (outcome: 'ok' | 'refused' | 'error', message?: string) => void } {
    const page = this.page;
    const traceId = page?.traceId ?? newId();
    const spanId = newId();
    const startedAt = new Date();
    const started = performance.now();
    if (page) page.calls++;
    return {
      traceHeader: `${traceId}:${spanId}`,
      end: (outcome, message) =>
        this.push({
          traceId,
          spanId,
          parentId: page?.spanId ?? null,
          kind: 'call',
          name,
          operationId: this.operationId,
          startedAt: startedAt.toISOString(),
          durationMs: Math.round(performance.now() - started),
          outcome,
          message: message ?? null,
        }),
    };
  }

  private push(span: BrowserSpan): void {
    if (!this.active) return;
    if (this.buffer.length >= MAX_BUFFER) this.buffer.shift(); // disposable: the oldest goes
    this.buffer.push(span);
  }

  async flush(): Promise<void> {
    if (!this.active || !this.sender || this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.sender(batch);
    } catch {
      // dropped — a failed send is not worth a retry or a warning
    }
  }
}

/** The procedure and, where there is one, the activity — what a `call` is named. */
function callName(path: string, input: unknown): string {
  const activityId = (input as { activityId?: unknown } | null | undefined)?.activityId;
  return typeof activityId === 'string' ? `${path} · ${activityId}` : path;
}

/**
 * Times every call as the browser saw it, network included, and stamps the
 * operation's context with the trace so the transport can put it in the
 * `x-fluxus-trace` header. `perf.*` itself is never timed.
 */
export function perfLink(perf: BrowserPerf): TRPCLink<AppRouter> {
  return () =>
    ({ op, next }) => {
      if (!perf.on || op.path.startsWith('perf.')) return next(op);
      const call = perf.startCall(callName(op.path, op.input));
      return observable((observer) => {
        const sub = next({ ...op, context: { ...op.context, fluxusTrace: call.traceHeader } }).subscribe({
          next: (value) => observer.next(value),
          error: (err) => {
            const code = (err as { data?: { code?: string } }).data?.code;
            call.end(code && REFUSED_CODES.has(code) ? 'refused' : 'error', err.message);
            observer.error(err);
          },
          complete: () => {
            call.end('ok');
            observer.complete();
          },
        });
        return () => sub.unsubscribe();
      });
    };
}
