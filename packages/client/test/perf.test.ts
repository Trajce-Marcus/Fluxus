// The browser's half of performance logging (docs/PERFORMANCE_LOGGING.md §3,
// §5): what a call and a page open record, that the trace is stamped for the
// transport, and that nothing is recorded — or sent — until the operation's
// switches say so.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observable } from '@trpc/server/observable';
import { BrowserPerf, perfLink, type BrowserSpan } from '../src/perf';

let perf: BrowserPerf;
let sent: BrowserSpan[][];

beforeEach(() => {
  vi.useFakeTimers();
  perf = new BrowserPerf();
  sent = [];
  perf.setSender(async (spans) => {
    sent.push(spans);
  });
});
afterEach(() => vi.useRealTimers());

/** Run one operation through the link against a fake next() that answers or fails. */
function run(op: { path: string; input?: unknown; context?: Record<string, unknown> }, outcome: 'ok' | { code: string }) {
  let seen: Record<string, unknown> | undefined;
  const link = perfLink(perf)(undefined as never);
  const next = (o: { context: Record<string, unknown> }) => {
    seen = o.context;
    return observable<{ result: unknown }, Error>((observer) => {
      if (outcome === 'ok') {
        observer.next({ result: 1 });
        observer.complete();
      } else {
        observer.error(Object.assign(new Error('nope'), { data: { code: outcome.code } }));
      }
    });
  };
  return new Promise<{ context: Record<string, unknown> | undefined }>((resolve) => {
    const result = link({ op: { context: {}, ...op } as never, next: next as never });
    result.subscribe({ complete: () => resolve({ context: seen }), error: () => resolve({ context: seen }) });
  });
}

describe('while logging is off', () => {
  it('records nothing, stamps nothing, and hands the call straight through', async () => {
    const { context } = await run({ path: 'records.get' }, 'ok');
    expect(context).toEqual({});
    perf.configure('op', false);
    expect(perf.beginPage('home')).toBeNull();
    await perf.flush();
    expect(sent).toEqual([]);
  });
});

describe('a call', () => {
  beforeEach(() => perf.configure('op-1', true));

  it('is a span named for the procedure and the activity, with the trace stamped for the header', async () => {
    const { context } = await run({ path: 'activities.run', input: { activityId: 'act_x' } }, 'ok');
    expect(context?.fluxusTrace).toMatch(/^[0-9a-f]{32}:[0-9a-f]{32}$/);
    await perf.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toMatchObject({ kind: 'call', name: 'activities.run · act_x', operationId: 'op-1', outcome: 'ok', parentId: null });
    // The header names this call's own trace and span.
    expect(context?.fluxusTrace).toBe(`${sent[0][0].traceId}:${sent[0][0].spanId}`);
  });

  it('is named for the procedure alone when it has no activity', async () => {
    await run({ path: 'pages.list', input: { solutionId: 's' } }, 'ok');
    await perf.flush();
    expect(sent[0][0].name).toBe('pages.list');
  });

  it("records a refusal as refused and anything else as an error, with the message", async () => {
    await run({ path: 'a.b' }, { code: 'FORBIDDEN' });
    await run({ path: 'c.d' }, { code: 'INTERNAL_SERVER_ERROR' });
    await perf.flush();
    expect(sent[0].map((s) => s.outcome)).toEqual(['refused', 'error']);
    expect(sent[0][0].message).toBe('nope');
  });

  it('never times perf.* itself', async () => {
    await run({ path: 'perf.record' }, 'ok');
    await perf.flush();
    expect(sent).toEqual([]);
  });

  it('each starts its own trace when no page is opening', async () => {
    await run({ path: 'a.b' }, 'ok');
    await run({ path: 'a.b' }, 'ok');
    await perf.flush();
    expect(new Set(sent[0].map((s) => s.traceId)).size).toBe(2);
  });
});

describe('a page open', () => {
  beforeEach(() => perf.configure('op-1', true));

  it('makes the calls it opens part of one trace, under its span, and counts them', async () => {
    const page = perf.beginPage('work-orders')!;
    await run({ path: 'records.get' }, 'ok');
    await run({ path: 'activities.query', input: { activityId: 'act_get' } }, 'ok');
    page.end({ components: 3 });
    await perf.flush();
    const spans = sent[0];
    const open = spans.find((s) => s.kind === 'page_open')!;
    expect(open).toMatchObject({ name: 'work-orders', parentId: null, outcome: 'ok', counts: { components: 3, calls: 2 } });
    const calls = spans.filter((s) => s.kind === 'call');
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.traceId).toBe(open.traceId);
      expect(c.parentId).toBe(open.spanId);
    }
  });

  it('stops carrying its trace once it is ready — the next action is its own', async () => {
    perf.beginPage('home')!.end({ components: 1 });
    await run({ path: 'activities.run', input: { activityId: 'act_x' } }, 'ok');
    await perf.flush();
    const open = sent[0].find((s) => s.kind === 'page_open')!;
    const call = sent[0].find((s) => s.kind === 'call')!;
    expect(call.traceId).not.toBe(open.traceId);
    expect(call.parentId).toBeNull();
  });

  it('is never recorded when another page is opened before it is ready', async () => {
    const first = perf.beginPage('first')!;
    const second = perf.beginPage('second')!;
    first.end({ components: 1 }); // superseded: a no-op
    second.end({ components: 2 });
    await perf.flush();
    expect(sent[0].map((s) => s.name)).toEqual(['second']);
  });

  it('is dropped, and stops carrying its trace, when cancelled', async () => {
    perf.beginPage('gone')!.cancel();
    await run({ path: 'a.b' }, 'ok');
    await perf.flush();
    expect(sent[0].map((s) => s.kind)).toEqual(['call']);
    expect(sent[0][0].parentId).toBeNull();
  });

  it('records a page that failed to open, with why', async () => {
    perf.beginPage('broken')!.fail('anchor not found');
    await perf.flush();
    expect(sent[0][0]).toMatchObject({ kind: 'page_open', outcome: 'error', message: 'anchor not found' });
  });
});

describe('sending', () => {
  beforeEach(() => perf.configure('op-1', true));

  it('batches every 10 seconds', async () => {
    perf.beginPage('p')!.end({ components: 1 });
    await vi.advanceTimersByTimeAsync(9_000);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(sent).toHaveLength(1);
  });

  it('sends nothing when there is nothing', async () => {
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sent).toEqual([]);
  });

  it('drops a batch that fails to send — it is not retried', async () => {
    perf.setSender(async () => {
      throw new Error('offline');
    });
    perf.beginPage('p')!.end({ components: 1 });
    await expect(perf.flush()).resolves.toBeUndefined();
    perf.setSender(async (spans) => {
      sent.push(spans);
    });
    await perf.flush();
    expect(sent).toEqual([]);
  });

  it('keeps at most 500 spans, dropping the oldest', async () => {
    for (let i = 0; i < 510; i++) perf.beginPage(`p${i}`)!.end({ components: 0 });
    await perf.flush();
    expect(sent[0]).toHaveLength(500);
    expect(sent[0][0].name).toBe('p10');
  });

  it('stops and forgets when switched off', async () => {
    perf.beginPage('p')!.end({ components: 1 });
    perf.configure('op-1', false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sent).toEqual([]);
  });
});
