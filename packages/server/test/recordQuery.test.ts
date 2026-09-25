// Record queries run in the database (SERVER_DATA_LOADING §5, §7 step 3):
// what a query means against PGlite (§5.3), that memory agrees on ordinary
// cases (§5.4), that a hook's writes are seen by its later queries, that
// `model.*` still answers from the model, the row quota (§5.5), and the
// run-time refusal (ruling 14). Records are written straight into the table so
// the stored values are exactly the ones under test — blanks, numbers kept as
// text, dates with and without offsets, booleans both ways.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { executeScriptAsync, type DslRecord } from '@fluxus/dsl';
import { buildEvalHost, buildTimeModule, createEngine, MemoryAdapter, type RecordInstance, type SolutionConfig } from '@fluxus/engine';
import { createDb, type Db } from '../src/db/client';
import { DatabaseStore, ensureOperation, ensureSolution, loadOperationHost, putConfig } from '../src/host';
import { appRouter } from '../src/router';
import { records } from '../src/db/schema';

const SOL = 'test/record-query';
const OP = 'test/record-query';

const field = (key: string, type: string, extra: Record<string, unknown> = {}) => ({ key, type, label: key, default: '', ...extra });
const act = (id: string, record_map: string | null, attributes: string[], after?: string) => ({
  id, name: id, description: '', sort_order: 0, record_map, before_hook: null, after_hook: after ?? null,
  attributes: attributes.map((a) => ({ attribute_ref: a })),
});

const config = {
  attributes: [{ key: 'name', type: 'text', label: 'name', description: '' }],
  recordTypes: [
    { id: 'rt_jobs', name: 'Jobs', description: '', workflow_ref: 'wf_jobs',
      custom_fields: [
        field('name', 'text'), field('code', 'text'), field('qty', 'int'), field('price', 'decimal'),
        field('due', 'date'), field('starts', 'datetime'), field('at', 'time'), field('active', 'bool'),
        field('photo', 'photo'), field('spot', 'geopoint'),
        field('grp', 'fk_ref', { fk_record_type: 'rt_groups', fk_display_field: 'region' }),
      ] },
    { id: 'rt_groups', name: 'Groups', description: '', workflow_ref: 'wf_groups',
      custom_fields: [field('region', 'text'), field('since', 'date')] },
    { id: 'rt_items', name: 'Items', description: '', workflow_ref: 'wf_items',
      custom_fields: [field('label', 'text'), field('job', 'fk_ref', { fk_record_type: 'rt_jobs', fk_display_field: 'name' })] },
  ],
  workflows: [
    { id: 'wf_jobs', name: 'Jobs', description: '', activities: [
      // A hook that writes, then reads its writes back through every form of query.
      act('act_touch_jobs', null, [], `
        let g = records.groups.where(region = 'north').first
        records.jobs.create({ name: 'zz fresh', qty: 3, grp: g.id })
        records.jobs.where(name = 'Alpha').first.update({ qty: 99 })
        records.jobs.where(name = 'gone').first.delete()
        warn('direct:' + records.jobs.where(name = 'zz fresh').count)
        warn('through:' + records.jobs.where(grp.region = 'north' and name = 'zz fresh').count)
        warn('top:' + records.jobs.orderby(qty desc).top(1).first.name)
        warn('first:' + records.jobs.where(qty = 99).first.name)
        warn('gone:' + records.jobs.where(name = 'gone').count)`),
    ] },
    { id: 'wf_groups', name: 'Groups', description: '', activities: [] },
    { id: 'wf_items', name: 'Items', description: '', activities: [] },
  ],
} as unknown as SolutionConfig;

/** The table under test. Ids sort in the order written, so "by id" is readable. */
const ROWS: [string, string, Record<string, unknown>][] = [
  ['g1', 'rt_groups', { region: 'north', since: '2020-01-01' }],
  ['g2', 'rt_groups', { region: 'South', since: '' }],
  ['g3', 'rt_groups', { region: 'west', since: '2020-12-31T24:00:00' }],
  ['j01', 'rt_jobs', { name: 'Alpha', code: 'A', qty: 10, price: 1.5, due: '2026-09-01', starts: '2026-09-01T10:00:00+10:00', at: '08:30', active: 'true', photo: '', spot: '', grp: 'g1' }],
  ['j02', 'rt_jobs', { name: 'alpha', code: 'b', qty: '7', price: '2.25', due: '2020-01-01', starts: '2026-09-01T00:30:00', at: '09:15', active: true, photo: { storage_key: 'k', name: 'p.jpg' }, spot: { lat: 1, lng: 2 }, grp: 'g2' }],
  ['j03', 'rt_jobs', { name: 'BETA', code: 'c', qty: '', price: '', due: '', starts: '2026-09-01', at: '', active: 'false', photo: '', spot: '', grp: '' }],
  ['j04', 'rt_jobs', { name: '', code: 'd', qty: 'abc', price: 3, due: 'bad', starts: 'nope', at: '17:00', active: '', photo: '', spot: '', grp: 'g1' }],
  ['j05', 'rt_jobs', { name: 'line\nbreak', code: 'e', qty: 0, price: -2, due: '2026-02-30', starts: '', at: '', active: false, photo: '', spot: '', grp: 'missing' }],
  ['j06', 'rt_jobs', { name: 'back\\slash', code: 'f', qty: 5, price: 0.5, due: '2026-12-31', starts: '2026-12-31T23:59:00Z', at: '23:59', active: 'TRUE', photo: '', spot: '', grp: 'g2' }],
  // Declares every field but holds only a name — the rest are missing keys, not blanks.
  ['j07', 'rt_jobs', { name: 'sparse' }],
  ['j08', 'rt_jobs', { name: 'gone', code: 'g', qty: 1 }],
  ['i1', 'rt_items', { label: 'x', job: 'j01' }],
  ['i2', 'rt_items', { label: 'x', job: 'j06' }],
  ['i3', 'rt_items', { label: 'y', job: 'j02' }],
];

let db: Db;
const caller = () => appRouter.createCaller({ db });

async function seed(): Promise<void> {
  await db.delete(records).where(eq(records.operationId, OP));
  for (const [id, typeRef, customFields] of ROWS) {
    await db.insert(records).values({ operationId: OP, id, typeRef, customFields, activityHistory: [], updatedAt: new Date() });
  }
}

/** Ids a query answers, in order, from the database. */
async function inDb(expr: string): Promise<unknown> {
  const host = await loadOperationHost(db, OP);
  return shape(await host.engine.evaluateAsync(expr, {}));
}

/** The same query over the same table held in a MemoryAdapter — the browser's path. */
function inMemory(expr: string): unknown {
  const initialRecords = ROWS.map(([id, typeRef, customFields]): [string, RecordInstance] => [
    id,
    { id, typeRef, customFields: structuredClone(customFields), activityHistory: [] },
  ]);
  const adapter = new MemoryAdapter(config, { initialRecords });
  return shape(createEngine({ store: adapter, config }).evaluate(expr, {}));
}

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((r) => (r as DslRecord).id ?? r);
  if (value && typeof value === 'object' && 'id' in value) return (value as DslRecord).id;
  return value;
}

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'Record query');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Record query');
  await seed();
});

afterEach(() => vi.restoreAllMocks());

describe('what a query means (§5.3), against PGlite', () => {
  const cases: [string, unknown][] = [
    // blanks and values that do not fit the type read as null; a missing key too
    ["records.jobs.where(qty is null)", ['j03', 'j04', 'j07']],
    ["records.jobs.where(due is null)", ['j03', 'j04', 'j05', 'j07', 'j08']],
    ["records.jobs.where(name is null)", ['j04']],
    // text: case-insensitive
    ["records.jobs.where(name = 'ALPHA')", ['j01', 'j02']],
    ["records.jobs.where(code < 'c')", ['j01', 'j02']],
    // numbers as float8, numeric text included
    ["records.jobs.where(qty > 5)", ['j01', 'j02']],
    ["records.jobs.where(qty = '7')", ['j02']],
    ["records.jobs.where(price * 2 >= 3)", ['j01', 'j02', 'j04']],
    // date against date(), against text; a datetime with an offset, without one (UTC), date-only
    ["records.jobs.where(due < date('2026-09-02'))", ['j01', 'j02']],
    ["records.jobs.where(due = '2026-09-01')", ['j01']],
    ["records.jobs.where(due < now())", ['j01', 'j02']],
    ["records.jobs.where(starts = date('2026-09-01T00:00:00Z'))", ['j01', 'j03']],
    ["records.jobs.where(starts > '2026-09-01T00:15:00Z' and starts < '2026-09-02')", ['j02']],
    ["records.jobs.where(starts >= date('2026-12-31T23:59:00+00:00'))", ['j06']],
    // 24:00 is the next midnight, in the database and in memory alike
    ["records.groups.where(since = date('2021-01-01'))", ['g3']],
    // time as text
    ["records.jobs.where(at > '09:00')", ['j02', 'j04', 'j06']],
    // bool as text and as JSON
    ["records.jobs.where(active)", ['j01', 'j02', 'j06']],
    ["records.jobs.where(active = false)", ['j03', 'j05']],
    ["records.jobs.where(not active)", ['j03', 'j04', 'j05', 'j07', 'j08']],
    // the null rules
    ["records.jobs.where(name != 'alpha')", ['j03', 'j04', 'j05', 'j06', 'j07', 'j08']],
    ["records.jobs.where(name = null)", []],
    ["records.jobs.where(qty not in [10, 7])", ['j03', 'j04', 'j05', 'j06', 'j07', 'j08']],
    ["records.jobs.where(name not like 'a%')", ['j03', 'j04', 'j05', 'j06', 'j07', 'j08']],
    ["records.jobs.where(not (qty > 5))", ['j03', 'j04', 'j05', 'j06', 'j07', 'j08']],
    ["records.jobs.where(qty not between 1 and 6)", ['j01', 'j02', 'j03', 'j04', 'j05', 'j07']],
    // nulls last whichever the direction, ties by id
    ["records.jobs.orderby(qty)", ['j05', 'j08', 'j06', 'j02', 'j01', 'j03', 'j04', 'j07']],
    ["records.jobs.orderby(qty desc)", ['j01', 'j02', 'j06', 'j08', 'j05', 'j03', 'j04', 'j07']],
    ["records.jobs.orderby(active desc, name)", ['j01', 'j02', 'j06', 'j03', 'j05', 'j08', 'j07', 'j04']],
    // like: a line break, a backslash, no escape character
    ["records.jobs.where(name like 'line%break')", ['j05']],
    ["records.jobs.where(name like 'back\\%')", ['j06']],
    ["records.jobs.where(name like '_lpha')", ['j01', 'j02']],
    // references
    ["records.jobs.where(grp.region = 'NORTH')", ['j01', 'j04']],
    ["records.jobs.where(grp.since is null)", ['j02', 'j03', 'j05', 'j06', 'j07', 'j08']],
    ["records.jobs.where(grp.id = 'g2')", ['j02', 'j06']],
    ["records.items.where(job.grp.region = 'south').values(label)", ['x', 'y']],
    // in: a list, a subquery run once
    ["records.jobs.where(code in ['A', 'B'])", ['j01', 'j02']],
    ["records.jobs.where(id in records.items.where(label = 'x').values(job))", ['j01', 'j06']],
    ["records.jobs.where(name in [code, 'beta'])", ['j03']],
    // between, iif, arithmetic, unary minus, the built-ins and date methods
    ["records.jobs.where(price between 1 and 2.25)", ['j01', 'j02']],
    ["records.jobs.where(iif(active, qty, 0) > 6)", ['j01', 'j02']],
    ["records.jobs.where(-price > 1)", ['j05']],
    ["records.jobs.where(qty % 4 = 2)", ['j01']],
    ["records.jobs.where(len(name) = 5)", ['j01', 'j02']],
    ["records.jobs.where(upper(code) = 'A' or lower(name) = 'beta')", ['j01', 'j03']],
    ["records.jobs.where(trim(code) = 'b')", ['j02']],
    ["records.jobs.where(abs(price) = 2)", ['j05']],
    ["records.jobs.where(round(price) = 2)", ['j01', 'j02']],
    ["records.jobs.where(exact(name, 'alpha'))", ['j02']],
    ["records.jobs.where(date(code) is null and code = 'a')", ['j01']],
    ["records.jobs.where(due.addDays(1) = date('2026-09-02'))", ['j01']],
    ["records.jobs.where(due.addMonths(1) = date('2020-02-01'))", ['j02']],
    ["records.jobs.where(due.addYears(-6) = date('2020-12-31'))", ['j06']],
    // top, .count, .first, chained wheres
    ["records.jobs.orderby(name).top(2)", ['j01', 'j02']],
    ["records.jobs.where(qty > 0).count", 4],
    ["records.jobs.where(qty > 0).orderby(qty).first", 'j08'],
    ["records.jobs.where(qty > 0).where(active).count", 3],
    // a reverse reference, and a chain continuing from it
    ["records.groups.where(region = 'north').first.jobs.where(qty > 5)", ['j01']],
  ];

  for (const [expr, expected] of cases) {
    it(expr, async () => {
      expect(await inDb(expr)).toEqual(expected);
    });
  }

  it('a record lacking a declared key reads it as null, though an outer variable has that name (ruling 13)', async () => {
    const host = await loadOperationHost(db, OP);
    const result = await executeScriptAsync(
      `let qty = 999
       return records.jobs.where(qty is null).count`,
      buildEvalHost(host.store, host.config, {}),
    );
    expect(result.value).toBe(3);
  });

  it('division by zero is the DSL error', async () => {
    await expect(inDb('records.jobs.where(10 / qty > 1)')).rejects.toThrow(/Division by zero/);
  });

  it('text that does not convert to the field type is an error in the query', async () => {
    await expect(inDb("records.jobs.where(due < 'soon')")).rejects.toThrow(/Invalid date: 'soon'/);
    await expect(inDb("records.jobs.where(qty > 'many')")).rejects.toThrow(/'many' is not a number/);
  });
});

describe('memory agrees on ordinary cases (§5.4)', () => {
  const ordinary = [
    "records.jobs.where(qty is null)",
    "records.jobs.where(due is null)",
    "records.jobs.where(name = 'ALPHA')",
    "records.jobs.where(qty > 5)",
    "records.jobs.where(qty = '7')",
    "records.jobs.where(due < date('2026-09-02'))",
    "records.jobs.where(starts = date('2026-09-01T00:00:00Z'))",
    "records.jobs.where(at > '09:00')",
    "records.jobs.where(active)",
    "records.jobs.where(not active)",
    "records.jobs.where(name != 'alpha')",
    "records.jobs.where(name = null)",
    "records.jobs.where(qty not in [10, 7])",
    "records.jobs.where(name not like 'a%')",
    "records.jobs.orderby(qty)",
    "records.jobs.orderby(qty desc)",
    "records.jobs.orderby(active desc, name)",
    "records.jobs.where(name like 'line%break')",
    "records.jobs.where(grp.region = 'NORTH')",
    "records.items.where(job.grp.region = 'south').values(label)",
    "records.jobs.where(id in records.items.where(label = 'x').values(job))",
    "records.jobs.where(price between 1 and 2.25)",
    "records.jobs.where(iif(active, qty, 0) > 6)",
    "records.jobs.where(due.addDays(1) = date('2026-09-02'))",
    "records.groups.where(since = date('2021-01-01'))",
    "records.jobs.orderby(name).top(2)",
    "records.jobs.where(qty > 0).count",
    "records.jobs.where(qty > 0).orderby(qty).first",
    "records.groups.where(region = 'north').first.jobs.where(qty > 5)",
  ];
  for (const expr of ordinary) {
    it(expr, async () => {
      expect(inMemory(expr)).toEqual(await inDb(expr));
    });
  }
});

describe("a hook's writes are seen by its later queries", () => {
  it('directly, through a reference, with orderby … top, .count and .first; its delete hidden', async () => {
    await seed();
    const result = await caller().activities.run({ operationId: OP, activityId: 'act_touch_jobs', recordId: 'j01', attributes: {} });
    expect(result.warnings).toEqual(expect.arrayContaining(['direct:1', 'through:1', 'top:Alpha', 'first:Alpha', 'gone:0']));
    await seed();
  });
});

describe('model.* still answers from the model', () => {
  it('a model collection never reaches the database', async () => {
    const byQuery = vi.spyOn(DatabaseStore.prototype, 'queryRecords');
    const result = await caller().scripts.query({ operationId: OP, source: "model.record_types.where(query_name = 'jobs').count" });
    expect(result.error).toBeUndefined();
    expect(result.value).toBe(1);
    const fields = await caller().scripts.query({ operationId: OP, source: "model.fields.where(record_type_ref.query_name = 'jobs' and type = 'date').values(key)" });
    expect(fields.value).toEqual(['due']);
    expect(byQuery).not.toHaveBeenCalled();
  });
});

describe('the row quota (§5.5)', () => {
  it('fires without reading past maxRows + 1; .count over more rows than the quota works', async () => {
    const host = await loadOperationHost(db, OP);
    const answers: unknown[] = [];
    const real = DatabaseStore.prototype.queryRecords;
    vi.spyOn(DatabaseStore.prototype, 'queryRecords').mockImplementation(async function (this: DatabaseStore, query) {
      const answer = await real.call(this, query);
      answers.push(answer);
      return answer;
    });
    const evalHost = buildEvalHost(host.store, host.config, { quotas: { maxRows: 3 } });
    await expect(executeScriptAsync('return records.jobs.where(true)', evalHost)).rejects.toThrow(/row quota \(3\)/);
    expect((answers[0] as unknown[]).length).toBe(4);
    expect((await executeScriptAsync('return records.jobs.count', evalHost)).value).toBe(8);
    expect((await executeScriptAsync('return records.jobs.where(qty > 5)', evalHost)).value).toHaveLength(2);
  });
});

describe('a filter that cannot become SQL is refused when it runs (ruling 14)', () => {
  it('reaching the server through scripts.query', async () => {
    const result = await caller().scripts.query({ operationId: OP, source: "records.jobs.where(services.time.hoursBetween(at, '10:00') > 1)" });
    expect(result.error?.message).toMatch(/A query filter cannot pass a record field to services\.time\.hoursbetween/i);
    const photo = await caller().scripts.query({ operationId: OP, source: "records.jobs.where(photo = 'x')" });
    expect(photo.error?.message).toMatch(/only test a photo, file, geopoint or composite field with 'is null'/);
  });

  it('the same call with no field argument is worked out once and used as a value', async () => {
    const result = await caller().scripts.query({ operationId: OP, source: "records.jobs.where(qty < services.time.hoursBetween('08:00', '14:00')).count" });
    expect(result.error).toBeUndefined();
    expect(result.value).toBe(3);
  });

  it('a list held in a variable is filtered in memory, where nothing is refused (ruling 8)', async () => {
    const host = await loadOperationHost(db, OP);
    const result = await executeScriptAsync(
      `let jobs = records.jobs.where(qty > 0)
       return jobs.where(services.time.hoursBetween(at, '23:59') > 0).count`,
      buildEvalHost(host.store, host.config, {}, [buildTimeModule()]),
    );
    expect(result.value).toBe(3);
  });
});

describe('the stored rows are what the tests say', () => {
  it('seeded once, read back', async () => {
    const [row] = await db.select().from(records).where(and(eq(records.operationId, OP), eq(records.id, 'j02')));
    expect((row.customFields as Record<string, unknown>).qty).toBe('7');
  });
});
