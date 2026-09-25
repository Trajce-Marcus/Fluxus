// Performance logging (docs/PERFORMANCE_LOGGING.md) over the real stack: the
// tRPC middleware, the spans the handlers open, the switches, retention, and
// the dashboard's report. PGlite has no connections to time, so db_connect and
// db_queries are absent here by design (§10a) — everything else is exercised.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import type { ContextUser } from '@fluxus/engine';
import { createDb, type Db } from '../src/db/client';
import { perfSpans, records } from '../src/db/schema';
import { ensureOperation, ensureSolution, putConfig } from '../src/host';
import { appRouter, DEFAULT_OPERATION, DEFAULT_SOLUTION } from '../src/router';
import { createDbRolesResolver } from '../src/auth';
import { deleteSettings, invalidateSettingsCache, resetSweepClock, setSettings } from '../src/perf';
import type { NotificationEvent, NotifySink } from '../src/services/notify';
import { config } from '../../runtime/src/config';

let db: Db;
const notifications: NotificationEvent[] = [];
const sink: NotifySink = { append: (event) => notifications.push(event) };
const caller = (traceHeader?: string) => appRouter.createCaller({ db, sink, traceHeader });

const vendor: ContextUser = { id: 'auth-vendor', name: 'Vendor', email: 'vendor@fluxus.dev', roles: [] };
const outsider: ContextUser = { id: 'auth-outsider', name: 'Outsider', email: 'someone@example.com', roles: [] };
const asUser = (user: ContextUser) =>
  appRouter.createCaller({ db, sink, user, roles: createDbRolesResolver(db), authConfigured: true });

const createJob = (c = caller()) =>
  c.activities.run({
    activityId: 'act_raise_inspection_jobs',
    attributes: { job_no: 'J-1', job_type: 'Inspection', contract_id: '', location: 'Depot', due_date: '2026-08-01' },
  });

const spans = () => db.select().from(perfSpans).orderBy(asc(perfSpans.startedAt), asc(perfSpans.id));

beforeAll(async () => {
  process.env.FLUXUS_PLATFORM_ADMINS = 'vendor@fluxus.dev';
  db = await createDb();
  await ensureSolution(db, DEFAULT_SOLUTION, 'Demo');
  await putConfig(db, DEFAULT_SOLUTION, config, sink);
  await ensureOperation(db, DEFAULT_OPERATION, DEFAULT_SOLUTION, 'Demo');
});

beforeEach(async () => {
  await db.delete(perfSpans);
  await deleteSettings(db, 'platform');
  await deleteSettings(db, DEFAULT_OPERATION);
  invalidateSettingsCache();
  resetSweepClock();
});

describe('what a run records', () => {
  it('times the request and the steps under it, joined into one trace', async () => {
    await createJob();
    const rows = await spans();
    const kinds = rows.map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(['request', 'host_load', 'validate', 'engine', 'write_back']));

    const request = rows.find((r) => r.kind === 'request')!;
    expect(request).toMatchObject({ name: 'activities.run', side: 'server', outcome: 'ok', operationId: DEFAULT_OPERATION });
    expect(request.parentId).toBeNull();
    // One request, one trace; every step is a child of the request span.
    expect(new Set(rows.map((r) => r.traceId)).size).toBe(1);
    for (const step of rows.filter((r) => r.kind !== 'request')) expect(step.parentId).toBe(request.spanId);

    expect(rows.find((r) => r.kind === 'host_load')).toMatchObject({ name: DEFAULT_OPERATION });
    expect(rows.find((r) => r.kind === 'validate')!.name).toBe('act_raise_inspection_jobs');
    expect(rows.find((r) => r.kind === 'engine')!.name).toBe('act_raise_inspection_jobs');
    // The run created one record and touched nothing else.
    expect(rows.find((r) => r.kind === 'write_back')!.counts).toEqual({ created: 1, changed: 0, deleted: 0 });
  });

  it('a host_load counts nothing — it loads the model, and no record (SERVER_DATA_LOADING ruling 23)', async () => {
    await createJob();
    const load = (await spans()).find((r) => r.kind === 'host_load')!;
    expect(load.counts).toBeNull();
  });

  it('counts the rows a GET returned; a GET has no write_back — its entry is one statement in the engine span', async () => {
    await createJob();
    await db.delete(perfSpans);
    await caller().activities.query({ activityId: 'act_get_work_orders', attributes: { status: 'Raised' } });
    const rows = await spans();
    expect(rows.find((r) => r.kind === 'request')!.name).toBe('activities.query');
    expect(rows.find((r) => r.kind === 'engine')!.counts).toEqual({ rows: 0 });
    expect(rows.find((r) => r.kind === 'write_back')).toBeUndefined();
  });

  it("joins the browser's trace when the request carries x-fluxus-trace", async () => {
    await createJob(caller('trace-abc:span-xyz'));
    const request = (await spans()).find((r) => r.kind === 'request')!;
    expect(request.traceId).toBe('trace-abc');
    expect(request.parentId).toBe('span-xyz');
  });

  it('starts its own trace when the header is absent or malformed', async () => {
    await createJob(caller('no-colon-here'));
    const request = (await spans()).find((r) => r.kind === 'request')!;
    expect(request.traceId).not.toBe('no-colon-here');
    expect(request.parentId).toBeNull();
  });

  it('records a refusal as refused — with the message — not as an error', async () => {
    await expect(
      caller().activities.run({ activityId: 'act_raise_inspection_jobs', attributes: {} }),
    ).rejects.toThrow();
    const rows = await spans();
    expect(rows.find((r) => r.kind === 'request')).toMatchObject({ outcome: 'refused' });
    expect(rows.find((r) => r.kind === 'request')!.message).toBeTruthy();
  });

  it('times procedures that have no operation too — config loads, page lists, admin', async () => {
    await caller().solutions.list();
    const request = (await spans()).find((r) => r.kind === 'request')!;
    expect(request).toMatchObject({ name: 'solutions.list', operationId: null });
  });

  it('does not time perf.* itself', async () => {
    await caller().perf.settings();
    await caller().perf.record({ spans: [] });
    expect(await spans()).toEqual([]);
  });
});

describe('the switches', () => {
  it('is on by default, platform-wide', async () => {
    await createJob();
    expect((await spans()).length).toBeGreaterThan(0);
  });

  it('platform off writes nothing', async () => {
    await setSettings(db, 'platform', { enabled: 'off' });
    await createJob();
    expect(await spans()).toEqual([]);
  });

  it('an operation can switch itself on while the platform is off', async () => {
    await setSettings(db, 'platform', { enabled: 'off' });
    await setSettings(db, DEFAULT_OPERATION, { enabled: 'on' });
    await createJob();
    expect((await spans()).length).toBeGreaterThan(0);
  });

  it('an operation can switch itself off while the platform is on', async () => {
    await setSettings(db, DEFAULT_OPERATION, { enabled: 'off' });
    await createJob();
    expect(await spans()).toEqual([]);
  });

  it("'follow' defers to the platform, part by part", async () => {
    await setSettings(db, 'platform', { server: 'off' });
    await setSettings(db, DEFAULT_OPERATION, { enabled: 'follow', server: 'follow' });
    await createJob();
    expect(await spans()).toEqual([]);
  });

  it('server spans off writes no server spans even when the master is on', async () => {
    await setSettings(db, 'platform', { server: 'off' });
    await createJob();
    expect(await spans()).toEqual([]);
  });

  it("editing one switch of an operation leaves the others following the platform", async () => {
    await setSettings(db, 'platform', { browser: 'off' });
    await setSettings(db, DEFAULT_OPERATION, { server: 'off' });
    // Only `server` was named; `browser` still follows the platform (off).
    expect(await caller().perf.settings({ operationId: DEFAULT_OPERATION })).toEqual({
      effective: { enabled: true, server: false, browser: false, dbCounts: true },
    });
    await asUser(vendor).perf.setSettings({ scope: DEFAULT_OPERATION, browser: 'on' });
    expect((await caller().perf.settings({ operationId: DEFAULT_OPERATION })).effective.browser).toBe(true);
  });

  it('takes effect within the cache window — and immediately after a change through setSettings', async () => {
    await createJob();
    const before = (await spans()).length;
    await setSettings(db, 'platform', { enabled: 'off' });
    await createJob();
    expect((await spans()).length).toBe(before);
  });
});

describe('the browser', () => {
  const browserSpan = (over: Record<string, unknown> = {}) => ({
    traceId: 'tr1',
    spanId: 'sp1',
    parentId: null,
    kind: 'page_open',
    name: 'work-orders',
    operationId: DEFAULT_OPERATION,
    startedAt: new Date().toISOString(),
    durationMs: 812,
    outcome: 'ok' as const,
    counts: { components: 3, calls: 5 },
    ...over,
  });

  it('files its batch as browser spans', async () => {
    await caller().perf.record({ spans: [browserSpan(), browserSpan({ spanId: 'sp2', parentId: 'sp1', kind: 'call', name: 'activities.query · act_get_work_orders', counts: null })] });
    const rows = await spans();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ side: 'browser', kind: 'page_open', name: 'work-orders', durationMs: 812, counts: { components: 3, calls: 5 } });
    expect(rows[1]).toMatchObject({ side: 'browser', parentId: 'sp1' });
  });

  it('drops the batch when browser spans are off', async () => {
    await setSettings(db, 'platform', { browser: 'off' });
    await caller().perf.record({ spans: [browserSpan()] });
    expect(await spans()).toEqual([]);
  });

  it('is told what applies to its operation', async () => {
    await setSettings(db, DEFAULT_OPERATION, { browser: 'off' });
    expect(await caller().perf.settings({ operationId: DEFAULT_OPERATION })).toEqual({
      effective: { enabled: true, server: true, browser: false, dbCounts: true },
    });
  });

  it('refuses a span with an oversized or malformed field', async () => {
    await expect(caller().perf.record({ spans: [browserSpan({ name: 'x'.repeat(301) })] })).rejects.toThrow();
    await expect(caller().perf.record({ spans: [browserSpan({ startedAt: 'yesterday' })] })).rejects.toThrow();
  });
});

describe('retention', () => {
  it('deletes spans older than 30 days when spans are next written', async () => {
    const old = new Date(Date.now() - 31 * 86_400_000);
    await db.insert(perfSpans).values({ traceId: 'old', spanId: 'o1', side: 'server', kind: 'request', name: 'x', startedAt: old, durationMs: 1, outcome: 'ok' });
    await createJob();
    expect(await db.select().from(perfSpans).where(eq(perfSpans.traceId, 'old'))).toEqual([]);
    expect((await spans()).length).toBeGreaterThan(0);
  });

  it('keeps spans younger than 30 days', async () => {
    const recent = new Date(Date.now() - 29 * 86_400_000);
    await db.insert(perfSpans).values({ traceId: 'recent', spanId: 'r1', side: 'server', kind: 'request', name: 'x', startedAt: recent, durationMs: 1, outcome: 'ok' });
    await createJob();
    expect(await db.select().from(perfSpans).where(eq(perfSpans.traceId, 'recent'))).toHaveLength(1);
  });
});

describe('the dashboard', () => {
  const seed = async () => {
    const t = new Date();
    const row = (over: Record<string, unknown>) => ({ traceId: 'a', spanId: 's', side: 'server' as const, startedAt: t, durationMs: 100, outcome: 'ok' as const, ...over });
    await db.insert(perfSpans).values([
      row({ spanId: '1', kind: 'engine', name: 'act_x', durationMs: 100 }),
      row({ spanId: '2', kind: 'engine', name: 'act_x', durationMs: 300 }),
      row({ spanId: '3', kind: 'engine', name: 'act_x', durationMs: 500 }),
      row({ spanId: '4', kind: 'engine', name: 'act_y', durationMs: 50 }),
      row({ spanId: '5', side: 'browser', kind: 'page_open', name: 'home', durationMs: 1200 }),
      row({ spanId: '6', kind: 'db_connect', name: '-', durationMs: 900 }),
      // A slow trace: a browser span, and the server step under it that ends 2.6s in.
      row({ traceId: 'slow', spanId: 'b1', side: 'browser', kind: 'page_open', name: 'slowpage', durationMs: 2600 }),
      row({ traceId: 'slow', spanId: 'b2', parentId: 'b1', kind: 'request', name: 'activities.query', durationMs: 2400 }),
    ]);
  };

  it('is for platform admins only', async () => {
    await expect(asUser(outsider).perf.report({ range: '24h' })).rejects.toThrow(/Requires platform admin/);
    await expect(asUser(outsider).perf.setSettings({ scope: 'platform', enabled: 'off' })).rejects.toThrow(/Requires platform admin/);
    await expect(caller().perf.report({ range: '24h' })).rejects.toThrow(/Requires platform admin/);
  });

  it('ranks the slowest things by kind and name, with the median, the slow end and the worst', async () => {
    await seed();
    const { slowest } = await asUser(vendor).perf.report({ range: '24h' });
    const x = slowest!.find((r) => r.name === 'act_x')!;
    expect(x).toMatchObject({ kind: 'engine', count: 3, medianMs: 300, maxMs: 500 });
    expect(x.p95Ms).toBeGreaterThan(300);
    // Slowest end first: act_x's 95th percentile beats act_y's.
    const order = slowest!.filter((r) => r.kind === 'engine').map((r) => r.name);
    expect(order).toEqual(['act_x', 'act_y']);
  });

  it('answers page opens and database wake-ups on their own', async () => {
    await seed();
    const { pageOpens, dbWakeups } = await asUser(vendor).perf.report({ range: '24h' });
    expect(pageOpens!.find((r) => r.name === 'home')).toMatchObject({ count: 1, medianMs: 1200 });
    expect(dbWakeups).toMatchObject({ count: 1, maxMs: 900 });
  });

  it('has no wake-ups to report when there were none', async () => {
    const { dbWakeups } = await asUser(vendor).perf.report({ range: '24h' });
    expect(dbWakeups).toBeNull();
  });

  it('lists traces over two seconds, and only those', async () => {
    await seed();
    const { recentSlowTraces } = await asUser(vendor).perf.report({ range: '24h' });
    expect(recentSlowTraces!.map((r) => r.traceId)).toEqual(['slow']);
    expect(recentSlowTraces![0].durationMs).toBeGreaterThanOrEqual(2600);
  });

  it("opens one trace's spans, parents before children", async () => {
    await seed();
    const { traceSpans } = await asUser(vendor).perf.report({ range: '24h', traceId: 'slow' });
    expect(traceSpans!.map((s) => s.spanId).sort()).toEqual(['b1', 'b2']);
    expect(traceSpans!.find((s) => s.spanId === 'b2')!.parentId).toBe('b1');
  });

  it('honours the time range', async () => {
    const old = new Date(Date.now() - 2 * 3_600_000);
    await db.insert(perfSpans).values({ traceId: 'o', spanId: 'o', side: 'server', kind: 'engine', name: 'act_old', startedAt: old, durationMs: 10, outcome: 'ok' });
    expect((await asUser(vendor).perf.report({ range: '1h' })).slowest).toEqual([]);
    expect((await asUser(vendor).perf.report({ range: '24h' })).slowest).toHaveLength(1);
  });

  it('shows the raw switches to a platform admin, and only the effective answer to anyone else', async () => {
    await setSettings(db, DEFAULT_OPERATION, { browser: 'off' });
    const admin = await asUser(vendor).perf.settings();
    expect(admin.platform).toMatchObject({ scope: 'platform', enabled: 'on' });
    expect(admin.operations).toEqual([expect.objectContaining({ scope: DEFAULT_OPERATION, browser: 'off' })]);
    expect(await asUser(outsider).perf.settings()).toEqual({ effective: { enabled: true, server: true, browser: true, dbCounts: true } });
  });

  it("writes a switch through, and refuses 'follow' on the platform row", async () => {
    await asUser(vendor).perf.setSettings({ scope: 'platform', browser: 'off' });
    await asUser(vendor).perf.setSettings({ scope: DEFAULT_OPERATION, browser: 'follow' });
    expect((await asUser(vendor).perf.settings()).platform).toMatchObject({ browser: 'off' });
    await expect(asUser(vendor).perf.setSettings({ scope: 'platform', browser: 'follow' })).rejects.toThrow(/nothing above it/);
  });
});
