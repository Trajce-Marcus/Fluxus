// Record queries (SERVER_DATA_LOADING §5): the chain handed to a host as one
// description, the parts worked out before it runs, the refusals (ruling 14)
// and the save check (§5.6), and the in-memory answer by §5.3/§5.4 — through
// both drivers.

import { describe, expect, it } from 'vitest';
import { DRIVERS } from './drivers';
import { validateExpression, validateScript, type DslSchema } from '../src/validator';
import type { DslRecord, EvalHost, QueryExpr, RecordQuery, RecordsHost, ServiceModuleDef } from '../src/host';

const FIELDS: Record<string, Record<string, string>> = {
  jobs: { name: 'text', qty: 'int', due: 'date', active: 'bool', photo: 'photo', grp: 'fk_ref' },
  groups: { region: 'text' },
};

const DATA: Record<string, DslRecord[]> = {
  groups: [
    { id: 'g1', type: 'groups', fields: { region: 'North' } },
    { id: 'g2', type: 'groups', fields: { region: 'south' } },
  ],
  jobs: [
    // Stored out of id order: without an orderby a query answers by id.
    { id: 'j3', type: 'jobs', fields: { name: 'gamma', qty: '', due: '2026-09-01', active: 'false', photo: '', grp: 'g2' } },
    { id: 'j1', type: 'jobs', fields: { name: 'Alpha', qty: 10, due: '2026-09-01T10:00:00+10:00', active: 'true', photo: '', grp: 'g1' } },
    { id: 'j2', type: 'jobs', fields: { name: 'beta', qty: '7', due: 'bad', active: true, photo: { name: 'p' }, grp: 'g1' } },
    { id: 'j4', type: 'jobs', fields: { name: '' } },
  ],
};

const fkTargets: Record<string, Record<string, string>> = { jobs: { grp: 'groups' } };

function recordsHost(extra: Partial<RecordsHost> = {}): RecordsHost {
  return {
    hasType: (type) => type in DATA,
    getAll: (type) => DATA[type].map((r) => ({ ...r, fields: { ...r.fields } })),
    getById: (type, id) => DATA[type]?.find((r) => r.id === id) ?? null,
    fkTarget: (type, field) => fkTargets[type]?.[field] ?? null,
    reverseRef: (type, name) => (type === 'groups' && name === 'jobs' ? { sourceType: 'jobs', field: 'grp' } : null),
    declaredFields: (type) => FIELDS[type] ?? null,
    ...extra,
  };
}

let calls = 0;
const services: ServiceModuleDef[] = [
  {
    name: 'util',
    description: '',
    functions: {
      seven: { params: [], description: '', kind: 'read', fn: () => (calls++, 7) },
      shout: { params: ['s'], description: '', kind: 'read', fn: (s) => String(s).toUpperCase() },
    },
  },
];

const ids = (value: unknown) => (value as DslRecord[]).map((r) => r.id);

for (const driver of DRIVERS) {
  describe(`in memory by §5.3 (${driver.name})`, () => {
    const host: EvalHost = { records: recordsHost(), services, attributes: { n: 5 } };
    const run = (source: string) => driver.evaluate(source, host);

    it('answers by id without an orderby', async () => {
      expect(ids(await run('records.jobs'))).toEqual(['j1', 'j2', 'j3', 'j4']);
    });

    it('reads fields by their declared type: blanks and unfit values are null', async () => {
      expect(ids(await run('records.jobs.where(qty is null)'))).toEqual(['j3', 'j4']);
      expect(ids(await run('records.jobs.where(due is null)'))).toEqual(['j2', 'j4']);
      expect(ids(await run('records.jobs.where(qty > attributes.n)'))).toEqual(['j1', 'j2']);
      expect(ids(await run('records.jobs.where(active)'))).toEqual(['j1', 'j2']);
    });

    it('compares dates as instants in UTC, text converted', async () => {
      // j1's +10:00 midnight-plus-ten is 00:00 UTC.
      expect(ids(await run("records.jobs.where(due = '2026-09-01')"))).toEqual(['j1', 'j3']);
      expect(ids(await run("records.jobs.where(due < date('2026-09-01T00:00:01Z'))"))).toEqual(['j1', 'j3']);
      expect(ids(await run("records.jobs.where(due.addDays(1) = date('2026-09-02'))"))).toEqual(['j1', 'j3']);
    });

    it('follows references, and the null rules hold', async () => {
      expect(ids(await run("records.jobs.where(grp.region = 'north')"))).toEqual(['j1', 'j2']);
      expect(ids(await run("records.jobs.where(name != 'alpha')"))).toEqual(['j2', 'j3', 'j4']);
      expect(ids(await run('records.jobs.where(name = null)'))).toEqual([]);
      expect(ids(await run('records.jobs.orderby(qty desc)'))).toEqual(['j1', 'j2', 'j3', 'j4']);
    });

    it('runs a part that cannot become SQL per row — the browser does not refuse', async () => {
      expect(ids(await run("records.jobs.where(services.util.shout(name) = 'BETA')"))).toEqual(['j2']);
      expect(ids(await run("records.jobs.where(qty > 5 and services.util.shout(name) like 'A%')"))).toEqual(['j1']);
    });

    it('works out the row-independent parts once', async () => {
      calls = 0;
      expect(ids(await run('records.jobs.where(qty >= services.util.seven())'))).toEqual(['j1', 'j2']);
      expect(calls).toBe(1);
    });

    it('.count, .first, top and the reverse reference', async () => {
      expect(await run('records.jobs.where(qty > 0).count')).toBe(2);
      expect((await run('records.jobs.orderby(name desc).first') as DslRecord).id).toBe('j3');
      expect(ids(await run('records.jobs.orderby(name).top(2)'))).toEqual(['j1', 'j2']);
      expect(ids(await run("records.groups.where(region = 'north').first.jobs"))).toEqual(['j1', 'j2']);
    });

    it('the row quota counts the result; .count is not limited', async () => {
      const small: EvalHost = { ...host, quotas: { maxRows: 2 } };
      expect(ids(await driver.evaluate("records.jobs.where(grp.region = 'north')", small))).toEqual(['j1', 'j2']);
      await expect(driver.evaluate('records.jobs', small)).rejects.toThrow(/row quota \(2\)/);
      expect(await driver.evaluate('records.jobs.count', small)).toBe(4);
    });

    it('a record lacking a declared key reads it as null; outer names are the undeclared ones (ruling 13)', async () => {
      const result = await driver.execute(
        `let qty = 1
         let limit = 5
         return records.jobs.where(qty is null or qty > limit).count`,
        host,
      );
      expect(result.value).toBe(4);
    });

    it('a list held in a variable is filtered by the same rules, in memory (ruling 8)', async () => {
      const result = await driver.execute(
        `let jobs = records.jobs.where(qty > 0)
         return jobs.where(services.util.shout(name) = 'ALPHA').count`,
        host,
      );
      expect(result.value).toBe(1);
    });
  });

  describe(`handed to a host that answers queries (${driver.name})`, () => {
    const seen: RecordQuery[] = [];
    const answering = recordsHost({
      query: (q) => {
        seen.push(q);
        return q.count ? 42 : DATA[q.type].slice(0, 1);
      },
    });
    const host: EvalHost = { records: answering, services, attributes: { n: '5' } };
    const run = async (source: string) => {
      seen.length = 0;
      return driver.evaluate(source, host);
    };

    it('where*, orderby, top as one description; the values worked out and converted', async () => {
      await run("records.jobs.where(qty > attributes.n).where(name like 'a%').orderby(name desc).top(3)");
      expect(seen).toHaveLength(1);
      const q = seen[0];
      expect(q.type).toBe('jobs');
      expect(q.where).toHaveLength(2);
      const first = q.where[0] as QueryExpr & { kind: 'binary' };
      expect(first.left).toMatchObject({ kind: 'field', path: [{ type: 'jobs', key: 'qty' }], as: 'number' });
      expect(first.right).toMatchObject({ kind: 'value', value: 5, as: 'number' });
      expect(q.orderBy).toMatchObject([{ key: { kind: 'field' }, desc: true }]);
      expect(q.limit).toBe(3);
      expect(q.count).toBe(false);
    });

    it('.count and .first go in the query; after top they run in memory', async () => {
      expect(await run('records.jobs.where(qty > 1).count')).toBe(42);
      expect(seen[0].count).toBe(true);
      await run('records.jobs.orderby(name).first');
      expect(seen[0].limit).toBe(1);
      expect(await run('records.jobs.top(5).count')).toBe(1);
      expect(seen[0]).toMatchObject({ limit: 5, count: false });
    });

    it('a where after top runs in memory over the answer', async () => {
      await run("records.jobs.top(5).where(services.util.shout(name) = 'GAMMA')");
      expect(seen[0].where).toEqual([]);
    });

    it('a reverse reference starts the query at its source type', async () => {
      await run("records.groups.first.jobs.where(qty > 1)");
      const q = seen[seen.length - 1];
      expect(q.type).toBe('jobs');
      expect(q.where[0]).toMatchObject({ kind: 'binary', op: '=', left: { path: [{ key: 'grp' }] }, right: { value: 'g1' } });
    });

    it('refuses a filter that cannot become SQL, naming why (ruling 14)', async () => {
      await expect(run("records.jobs.where(services.util.shout(name) = 'X')")).rejects.toThrow(/cannot pass a record field to services\.util\.shout/);
      await expect(run("records.jobs.where(photo = 'x')")).rejects.toThrow(/only test a photo/);
      await expect(run('records.jobs.orderby(photo)')).rejects.toThrow(/only test a photo/);
      await expect(run('records.groups.where(jobs.count > 0)')).rejects.toThrow(/Unknown name 'jobs'/);
      expect(seen).toEqual([]);
    });

    it('a call with no field argument is worked out once and used as a value', async () => {
      await run('records.jobs.where(qty > services.util.seven())');
      expect(seen[0].where[0]).toMatchObject({ right: { kind: 'value', value: 7 } });
    });
  });
}

describe('the save check (§5.6)', () => {
  const schema: DslSchema = {
    types: {
      jobs: { fields: { name: { type: 'text' }, qty: { type: 'int' }, photo: { type: 'photo' }, tags: { type: 'list' }, grp: { type: 'fk_ref', fkTarget: 'groups' } } },
      groups: { fields: { region: { type: 'text' } } },
      items: { fields: { label: { type: 'text' }, job: { type: 'fk_ref', fkTarget: 'jobs' } } },
    },
    services: { util: { functions: { shout: { params: ['s'], kind: 'read' }, seven: { params: [], kind: 'read' } } } },
  };
  const refusals = (source: string) =>
    validateExpression(source, schema).filter((d) => /query filter|iif\(\) in a query/.test(d.message)).map((d) => d.message);

  const refused: [string, RegExp][] = [
    ["records.jobs.where(services.util.shout(name) = 'X')", /cannot pass a record field to services\.util\.shout/],
    ['records.jobs.where(tags[0] = 1)', /cannot index into a list field/],
    ["records.jobs.where(photo.name = 'x')", /cannot read '\.name' inside/],
    ["records.jobs.where('a' in tags)", /cannot test 'in' against a list field/],
    ['records.jobs.where(len(tags) > 0)', /cannot count or measure a list field/],
    ['records.jobs.where(grp.jobs.count > 0)', /cannot follow the reverse reference 'jobs'/],
    ["records.jobs.where(records.items.where(label = name).count > 0)", /records query that refers to the record being filtered/],
    ["records.jobs.where(photo = 'x')", /only test a photo, file, geopoint or composite field/],
    ['records.jobs.orderby(photo)', /only test a photo/],
    ["records.jobs.where(iif(qty > 1, name, 5) = 'x')", /both branches of one type/],
    ["records.jobs.where(invoke('act_x', { n: name }) = 1)", /cannot run in the database|cannot pass a record field to invoke/],
  ];
  for (const [source, why] of refused) {
    it(`refuses ${source}`, () => {
      const found = refusals(source);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(why);
    });
  }

  const accepted = [
    "records.jobs.where(qty > services.util.seven() and name like 'a%')",
    "records.jobs.where(grp.region = 'north' and photo is null)",
    "records.jobs.where(id in records.items.where(label = 'x').values(job))",
    "records.jobs.top(5).where(services.util.shout(name) = 'X')",
    "records.jobs.orderby(name).where(services.util.shout(name) = 'X')",
  ];
  for (const source of accepted) {
    it(`accepts ${source}`, () => {
      expect(refusals(source)).toEqual([]);
    });
  }

  it('does not refuse a list held in a variable (ruling 8)', () => {
    const found = validateScript(
      `let jobs = records.jobs.where(qty > 1)
       return jobs.where(services.util.shout(name) = 'X').count`,
      schema,
    ).filter((d) => /query filter/.test(d.message));
    expect(found).toEqual([]);
  });
});
