import { describe, it, expect } from 'vitest';
import { evaluateExpression, FluxRuntimeError } from '../src/evaluator';
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

const run = (source: string, h: EvalHost = host()) => evaluateExpression(source, h);

// ── Scalars and operators ───────────────────────────────────────────────────────

describe('evaluator — operators and semantics', () => {
  it('arithmetic and precedence', () => {
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('round(10 / 4, 1)')).toBe(2.5);
  });

  it('string concat with + needs no cast', () => {
    expect(run("attributes.qty + ' attributes'")).toBe('5 attributes');
    expect(run("'rate: ' + 12.5")).toBe('rate: 12.5');
  });

  it('string comparison is case-insensitive; exact() is not', () => {
    expect(run("'OPEN' = 'open'")).toBe(true);
    expect(run("exact('OPEN', 'open')")).toBe(false);
    expect(run("'apple' < 'BANANA'")).toBe(true);
  });

  it('null semantics: the JS way (D5)', () => {
    expect(run('null = null')).toBe(true);
    expect(run("attributes.missing = null")).toBe(true);
    expect(run('null < 5')).toBe(false);
    expect(run('null + 1')).toBe(null);
    expect(run("null + 'x'")).toBe(null);
    expect(run('attributes.missing is null')).toBe(true);
    expect(run('attributes.qty is not null')).toBe(true);
  });

  it('null-safe navigation through dotted paths', () => {
    // Orphanville has no city: city_id is null, so .city_id.name is null
    expect(run("records.suburbs.where(name = 'Orphanville').first.city_id.name")).toBe(null);
  });

  it('like with % and _, case-insensitive', () => {
    expect(run("'Pump Station 3' like 'pump%'")).toBe(true);
    expect(run("'Bob' like 'B_b'")).toBe(true);
    expect(run("'Bob' not like 'crane%'")).toBe(true);
  });

  it('between is inclusive', () => {
    expect(run('5 between 1 and 5')).toBe(true);
    expect(run('0 not between 1 and 5')).toBe(true);
  });

  it('in: bracket list, paren list, scalar fallback', () => {
    expect(run("'NSW' in ['NSW', 'VIC']")).toBe(true);
    expect(run("'NSW' in ('NSW', 'VIC')")).toBe(true);
    expect(run("'NSW' in ('NSW')")).toBe(true); // one-element paren
    expect(run("'QLD' not in ('NSW', 'VIC')")).toBe(true);
  });

  it('iif is lazy — the untaken branch never evaluates', () => {
    expect(run("iif(true, 'yes', 1 / 0)")).toBe('yes');
    expect(() => run("iif(false, 'yes', 1 / 0)")).toThrowError(/Division by zero/);
  });

  it('date builtins and method extensions (D2)', () => {
    expect(run("date('2026-07-01') < date('2026-07-31')")).toBe(true);
    expect(run('now().addDays(7) > now()')).toBe(true);
    expect(run("date('2026-01-31').addMonths(1) < date('2026-03-05')")).toBe(true);
  });

  it('conditions must be boolean — no silent truthiness', () => {
    expect(() => run('iif(1, 2, 3)')).toThrowError(/Expected true\/false/);
  });

  it('division by zero errors instead of Infinity', () => {
    expect(() => run('1 / 0')).toThrowError(/Division by zero/);
  });
});

// ── Roots and context ───────────────────────────────────────────────────────────

describe('evaluator — the four roots', () => {
  it('ctx and attrs resolve case-insensitively; missing keys are null', () => {
    expect(run('context.page.selectedState')).toBe('NSW');
    expect(run('context.page.SELECTEDSTATE')).toBe('NSW');
    expect(run('context.page.not_a_key')).toBe(null);
  });

  it('bare identifiers outside chains are errors with guidance', () => {
    expect(() => run('rest_type')).toThrowError(/inside query methods/);
  });

  it('extras inject embedding-point roots (e.g. value in validation rules)', () => {
    const h = host({ extras: { value: new Date('2026-01-01') }, now: () => new Date('2026-07-07') });
    expect(run('value <= now()', h)).toBe(true);
    expect(run('value is null', host({ extras: { value: null } }))).toBe(true);
  });

  it('services functions are callable', () => {
    const h = host({ services: { geo: { suburbsOf: (cityId: unknown) => `suburbs-of-${cityId}` } } });
    expect(run("services.geo.suburbsOf(attributes.city)", h)).toBe('suburbs-of-c1');
  });
});

// ── Queries ─────────────────────────────────────────────────────────────────────

describe('evaluator — query chains', () => {
  it('where with bare-field scope and outer attrs (the city → suburb case)', () => {
    const names = run('records.suburbs.where(city_id = attributes.city).values(name)');
    expect(names).toEqual(['Newtown', 'Manly']);
  });

  it('where + orderBy + select', () => {
    const rows = run(
      "records.resources.where(rest_type = 'Labour' and status = 'Active').orderBy(name).select(id, name, rate)",
    );
    expect(rows).toEqual([
      { id: 'r2', name: 'alice', rate: 65 }, // case-insensitive sort
      { id: 'r1', name: 'Bob', rate: 50 },
    ]);
  });

  it('select aliases, including FK paths', () => {
    const rows = run("records.suburbs.where(name = 'Manly').select(id, city: city_id.name)");
    expect(rows).toEqual([{ id: 's2', city: 'Sydney' }]);
  });

  it('FK auto-deref inside where', () => {
    const names = run("records.suburbs.where(city_id.state = 'NSW').orderBy(name).values(name)");
    expect(names).toEqual(['Manly', 'Newtown']);
  });

  it('first and count terminal properties', () => {
    expect(run("records.resources.where(status = 'Active').count")).toBe(3);
    expect(run("records.resources.where(rate > 100).first.name")).toBe('Crane');
    expect(run("records.resources.where(rate > 9999).first")).toBe(null);
  });

  it('reverse-FK navigation (D12)', () => {
    expect(run('context.record.suburbs.count')).toBe(2);
    expect(run('context.record.suburbs.orderBy(name desc).first.name')).toBe('Newtown');
  });

  it('M:N-style subquery membership via values()', () => {
    const names = run(
      "records.cities.where(id in records.suburbs.where(name like 'M%').values(city_id)).values(name)",
    );
    expect(names).toEqual(['Sydney']);
  });

  it('orderBy desc and nulls-last', () => {
    const rates = run('records.resources.orderBy(rate desc).values(rate)');
    expect(rates).toEqual([200, 65, 50, null]);
  });

  it('where(true) selects everything, explicitly', () => {
    expect(run('records.resources.where(true).count')).toBe(4);
  });

  it('top(n) caps the result set', () => {
    expect(run('records.resources.orderBy(name).top(2).values(name)')).toEqual(['alice', 'Bob']);
    expect(run('records.resources.top(0).count')).toBe(0);
    expect(() => run("records.resources.top('lots')")).toThrowError(/non-negative number/);
  });

  it('where must produce a boolean', () => {
    expect(() => run('records.resources.where(rate)')).toThrowError(/Expected true\/false/);
  });

  it('unknown record types and fields are errors', () => {
    expect(() => run('records.widgets.count')).toThrowError(/Unknown record type 'widgets'/);
    expect(() => run('records.resources.first.no_such_field')).toThrowError(/has no field 'no_such_field'/);
  });

  it('snapshot copies (D11): results never alias the store', () => {
    const first = run('records.resources.first') as { fields: Record<string, unknown> };
    first.fields.name = 'MUTATED';
    expect(run('records.resources.first.name')).toBe('Bob');
    expect(DATA.resources[0].fields.name).toBe('Bob');
  });
});

// ── Quotas ──────────────────────────────────────────────────────────────────────

describe('evaluator — quotas', () => {
  it('step quota halts runaway evaluation', () => {
    expect(() => run('records.resources.where(rate > 0 or rate > 1 or rate > 2)', host({ quotas: { maxSteps: 10 } })))
      .toThrowError(/step quota/);
  });

  it('row quota caps query materialization', () => {
    expect(() => run('records.resources.count', host({ quotas: { maxRows: 2 } })))
      .toThrowError(/row quota/);
  });

  it('runtime errors carry position', () => {
    try {
      run("1 +\n'a' * 2");
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(FluxRuntimeError);
      expect((e as FluxRuntimeError).line).toBe(2);
    }
  });
});
