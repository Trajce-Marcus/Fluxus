import { describe, it, expect } from 'vitest';
import { FluxRuntimeError } from '../src/evaluator';
import { DRIVERS, type Driver } from './drivers';
import type { DslRecord, EvalHost, RecordsHost } from '../src/host';

// ── In-memory SDM host: cities / suburbs / resources ────────────────────────────

const DATA: Record<string, DslRecord[]> = {
  cities: [
    { id: 'c1', type: 'cities', fields: { name: 'Sydney', state: 'NSW' } },
    { id: 'c2', type: 'cities', fields: { name: 'Melbourne', state: 'VIC' } },
  ],
  suburbs: [
    { id: 's1', type: 'suburbs', fields: { name: 'Newtown', city_id: 'c1' } },
    { id: 's2', type: 'suburbs', fields: { name: 'Manly', city_id: 'c1' } },
    { id: 's3', type: 'suburbs', fields: { name: 'Fitzroy', city_id: 'c2' } },
    { id: 's4', type: 'suburbs', fields: { name: 'Orphanville', city_id: null } },
  ],
  resources: [
    { id: 'r1', type: 'resources', fields: { name: 'Bob', rest_type: 'Labour', status: 'Active', rate: 50 } },
    { id: 'r2', type: 'resources', fields: { name: 'alice', rest_type: 'Labour', status: 'Active', rate: 65 } },
    { id: 'r3', type: 'resources', fields: { name: 'Crane', rest_type: 'Plant', status: 'Active', rate: 200 } },
    { id: 'r4', type: 'resources', fields: { name: 'Dave', rest_type: 'Labour', status: 'Inactive', rate: null } },
  ],
};

const FKS: Record<string, Record<string, string>> = {
  suburbs: { city_id: 'cities' },
};

const recordsHost: RecordsHost = {
  hasType: (type) => type in DATA,
  getAll: (type) => DATA[type] ?? [],
  getById: (type, id) => DATA[type]?.find((r) => r.id === id) ?? null,
  fkTarget: (type, field) => FKS[type]?.[field] ?? null,
  reverseRef: (type, name) => {
    // cities.suburbs ← suburbs.city_id
    if (type === 'cities' && name === 'suburbs') return { sourceType: 'suburbs', field: 'city_id' };
    return null;
  },
};

function host(extra: Partial<EvalHost> = {}): EvalHost {
  return {
    records: recordsHost,
    context: { record: DATA.cities[0], page: { selectedState: 'NSW' } },
    attributes: { city: 'c1', qty: 5 },
    now: () => new Date('2026-07-07T00:00:00'),
    ...extra,
  };
}

function suite(driver: Driver) {
  const run = (source: string, h: EvalHost = host()) => driver.evaluate(source, h);

  // ── Scalars and operators ───────────────────────────────────────────────────────

  describe('evaluator — operators and semantics', () => {
    it('arithmetic and precedence', async () => {
      expect(await run('1 + 2 * 3')).toBe(7);
      expect(await run('round(10 / 4, 1)')).toBe(2.5);
    });

    it('string concat with + needs no cast', async () => {
      expect(await run("attributes.qty + ' attributes'")).toBe('5 attributes');
      expect(await run("'rate: ' + 12.5")).toBe('rate: 12.5');
    });

    it('string comparison is case-insensitive; exact() is not', async () => {
      expect(await run("'OPEN' = 'open'")).toBe(true);
      expect(await run("exact('OPEN', 'open')")).toBe(false);
      expect(await run("'apple' < 'BANANA'")).toBe(true);
    });

    it('null semantics: the JS way (D5)', async () => {
      expect(await run('null = null')).toBe(true);
      expect(await run("attributes.missing = null")).toBe(true);
      expect(await run('null < 5')).toBe(false);
      expect(await run('null + 1')).toBe(null);
      expect(await run("null + 'x'")).toBe(null);
      expect(await run('attributes.missing is null')).toBe(true);
      expect(await run('attributes.qty is not null')).toBe(true);
    });

    it('null-safe navigation through dotted paths', async () => {
      // Orphanville has no city: city_id is null, so .city_id.name is null
      expect(await run("records.suburbs.where(name = 'Orphanville').first.city_id.name")).toBe(null);
    });

    it('like with % and _, case-insensitive', async () => {
      expect(await run("'Pump Station 3' like 'pump%'")).toBe(true);
      expect(await run("'Bob' like 'B_b'")).toBe(true);
      expect(await run("'Bob' not like 'crane%'")).toBe(true);
    });

    it('between is inclusive', async () => {
      expect(await run('5 between 1 and 5')).toBe(true);
      expect(await run('0 not between 1 and 5')).toBe(true);
    });

    it('in: bracket list, paren list, scalar fallback', async () => {
      expect(await run("'NSW' in ['NSW', 'VIC']")).toBe(true);
      expect(await run("'NSW' in ('NSW', 'VIC')")).toBe(true);
      expect(await run("'NSW' in ('NSW')")).toBe(true); // one-element paren
      expect(await run("'QLD' not in ('NSW', 'VIC')")).toBe(true);
    });

    it('iif is lazy — the untaken branch never evaluates', async () => {
      expect(await run("iif(true, 'yes', 1 / 0)")).toBe('yes');
      await expect(run("iif(false, 'yes', 1 / 0)")).rejects.toThrowError(/Division by zero/);
    });

    it('date builtins and method extensions (D2)', async () => {
      expect(await run("date('2026-07-01') < date('2026-07-31')")).toBe(true);
      expect(await run('now().addDays(7) > now()')).toBe(true);
      expect(await run("date('2026-01-31').addMonths(1) < date('2026-03-05')")).toBe(true);
    });

    it('conditions must be boolean — no silent truthiness', async () => {
      await expect(run('iif(1, 2, 3)')).rejects.toThrowError(/Expected true\/false/);
    });

    it('division by zero errors instead of Infinity', async () => {
      await expect(run('1 / 0')).rejects.toThrowError(/Division by zero/);
    });
  });

  // ── Roots and context ───────────────────────────────────────────────────────────

  describe('evaluator — the four roots', () => {
    it('ctx and attrs resolve case-insensitively; missing keys are null', async () => {
      expect(await run('context.page.selectedState')).toBe('NSW');
      expect(await run('context.page.SELECTEDSTATE')).toBe('NSW');
      expect(await run('context.page.not_a_key')).toBe(null);
    });

    it('bare identifiers outside chains are errors with guidance', async () => {
      await expect(run('rest_type')).rejects.toThrowError(/inside query methods/);
    });

    it('extras inject embedding-point roots (e.g. value in validation rules)', async () => {
      const h = host({ extras: { value: new Date('2026-01-01') }, now: () => new Date('2026-07-07') });
      expect(await run('value <= now()', h)).toBe(true);
      expect(await run('value is null', host({ extras: { value: null } }))).toBe(true);
    });

    it('registered read service functions are callable', async () => {
      const h = host({
        services: [{
          name: 'geo',
          description: 'test geo module',
          functions: {
            suburbsOf: { params: ['city'], description: 'suburbs of a city', kind: 'read', fn: (cityId: unknown) => `suburbs-of-${cityId}` },
          },
        }],
      });
      expect(await run("services.geo.suburbsOf(attributes.city)", h)).toBe('suburbs-of-c1');
      // case-insensitive like the rest of the language
      expect(await run("SERVICES.Geo.SUBURBSOF(attributes.city)", h)).toBe('suburbs-of-c1');
    });

    it('unknown service modules and functions are runtime errors', async () => {
      const h = host({
        services: [{ name: 'geo', description: 'test', functions: {} }],
      });
      await expect(run("services.nope.fn(1)", h)).rejects.toThrow(/Unknown service module 'nope'/);
      await expect(run("services.geo.fn(1)", h)).rejects.toThrow(/Service 'geo' has no function 'fn'/);
    });

    it('effect service functions are rejected outside after hooks', async () => {
      const h = host({
        services: [{
          name: 'notify',
          description: 'test',
          functions: { user: { params: ['message'], description: 'notify', kind: 'effect', fn: () => undefined } },
        }],
      });
      await expect(run("services.notify.user('hi')", h)).rejects.toThrow(/has effects — it runs in after hooks only/);
    });

    it('a waiting call that returns a Promise: the immediate driver refuses it, the waiting one waits', async () => {
      const h = host({
        services: [{
          name: 'geo',
          description: 'test',
          functions: { lookup: { params: ['q'], description: 'async lookup', kind: 'read', fn: async () => 'later' } },
        }],
      });
      if (driver.waiting) expect(await run("services.geo.lookup('x')", h)).toBe('later');
      else await expect(run("services.geo.lookup('x')", h)).rejects.toThrow(/is asynchronous/);
    });
  });

  // ── Queries ─────────────────────────────────────────────────────────────────────

  describe('evaluator — query chains', () => {
    it('where with bare-field scope and outer attrs (the city → suburb case)', async () => {
      const names = await run('records.suburbs.where(city_id = attributes.city).values(name)');
      expect(names).toEqual(['Newtown', 'Manly']);
    });

    it('where + orderBy + select', async () => {
      const rows = await run(
        "records.resources.where(rest_type = 'Labour' and status = 'Active').orderBy(name).select(id, name, rate)",
      );
      expect(rows).toEqual([
        { id: 'r2', name: 'alice', rate: 65 }, // case-insensitive sort
        { id: 'r1', name: 'Bob', rate: 50 },
      ]);
    });

    it('select aliases, including FK paths', async () => {
      const rows = await run("records.suburbs.where(name = 'Manly').select(id, city: city_id.name)");
      expect(rows).toEqual([{ id: 's2', city: 'Sydney' }]);
    });

    it('FK auto-deref inside where', async () => {
      const names = await run("records.suburbs.where(city_id.state = 'NSW').orderBy(name).values(name)");
      expect(names).toEqual(['Manly', 'Newtown']);
    });

    it('first and count terminal properties', async () => {
      expect(await run("records.resources.where(status = 'Active').count")).toBe(3);
      expect(await run("records.resources.where(rate > 100).first.name")).toBe('Crane');
      expect(await run("records.resources.where(rate > 9999).first")).toBe(null);
    });

    it('reverse-FK navigation (D12)', async () => {
      expect(await run('context.record.suburbs.count')).toBe(2);
      expect(await run('context.record.suburbs.orderBy(name desc).first.name')).toBe('Newtown');
    });

    it('M:N-style subquery membership via values()', async () => {
      const names = await run(
        "records.cities.where(id in records.suburbs.where(name like 'M%').values(city_id)).values(name)",
      );
      expect(names).toEqual(['Sydney']);
    });

    it('orderBy desc and nulls-last', async () => {
      const rates = await run('records.resources.orderBy(rate desc).values(rate)');
      expect(rates).toEqual([200, 65, 50, null]);
    });

    it('where(true) selects everything, explicitly', async () => {
      expect(await run('records.resources.where(true).count')).toBe(4);
    });

    it('top(n) caps the result set', async () => {
      expect(await run('records.resources.orderBy(name).top(2).values(name)')).toEqual(['alice', 'Bob']);
      expect(await run('records.resources.top(0).count')).toBe(0);
      await expect(run("records.resources.top('lots')")).rejects.toThrowError(/non-negative number/);
    });

    it('where must produce a boolean', async () => {
      await expect(run('records.resources.where(rate)')).rejects.toThrowError(/Expected true\/false/);
    });

    it('unknown record types and fields are errors', async () => {
      await expect(run('records.widgets.count')).rejects.toThrowError(/Unknown record type 'widgets'/);
      await expect(run('records.resources.first.no_such_field')).rejects.toThrowError(/has no field 'no_such_field'/);
    });

    it('snapshot copies (D11): results never alias the store', async () => {
      const first = await run('records.resources.first') as { fields: Record<string, unknown> };
      first.fields.name = 'MUTATED';
      expect(await run('records.resources.first.name')).toBe('Bob');
      expect(DATA.resources[0].fields.name).toBe('Bob');
    });
  });

  // ── Quotas ──────────────────────────────────────────────────────────────────────

  describe('evaluator — quotas', () => {
    it('step quota halts runaway evaluation', async () => {
      await expect(run('records.resources.where(rate > 0 or rate > 1 or rate > 2)', host({ quotas: { maxSteps: 10 } })))
        .rejects.toThrowError(/step quota/);
    });

    it('row quota caps query materialization', async () => {
      await expect(run('records.resources.count', host({ quotas: { maxRows: 2 } })))
        .rejects.toThrowError(/row quota/);
    });

    it('runtime errors carry position', async () => {
      try {
        await run("1 +\n'a' * 2");
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(FluxRuntimeError);
        expect((e as FluxRuntimeError).line).toBe(2);
      }
    });
  });
}

for (const driver of DRIVERS) describe(`${driver.name} driver`, () => suite(driver));
