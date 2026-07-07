import { describe, it, expect } from 'vitest';
import { validateExpression, lintSchema } from '../src/validator';
import type { DslSchema } from '../src/validator';

const schema: DslSchema = {
  types: {
    cities: { fields: { name: { type: 'text' }, state: { type: 'text' } } },
    suburbs: {
      fields: {
        name: { type: 'text' },
        city_id: { type: 'fk_ref', fkTarget: 'cities' },
      },
    },
    resources: {
      fields: {
        name: { type: 'text' },
        rest_type: { type: 'text' },
        status: { type: 'text' },
        rate: { type: 'int' },
        hired_on: { type: 'date' },
      },
    },
  },
};

const validate = (source: string, anchorType?: string) => validateExpression(source, schema, { anchorType });
const errors = (source: string, anchorType?: string) =>
  validate(source, anchorType).filter((d) => d.severity === 'error').map((d) => d.message);

describe('validator — happy paths produce no diagnostics', () => {
  const good = [
    "records.resources.where(rest_type = 'Labour' and status = 'Active').orderBy(name).select(id, name, rate)",
    "records.suburbs.where(city_id = attributes.city).values(name)",
    "records.suburbs.where(city_id.state = 'NSW').top(10)",          // FK path in where
    "records.suburbs.select(id, city: city_id.name)",                // FK path in select
    "records.resources.where(true).count",
    "records.resources.first.rate > 100",
    "records.cities.where(id in records.suburbs.where(name like 'M%').values(city_id)).values(name)",
    "records.resources.where(hired_on < now().addDays(-30)).count",
    "iif(context.page.flag, 'a', 'b')",
    "attributes.qty + ' attributes'",
    "context.record.anything.at.all",                                    // ctx untyped without anchorType
  ];
  for (const source of good) {
    it(`ok: ${source.slice(0, 60)}`, () => {
      expect(validate(source)).toEqual([]);
    });
  }
});

describe('validator — schema errors', () => {
  it('unknown record type', () => {
    expect(errors('records.widgets.count')).toEqual(["Unknown record type 'widgets'"]);
  });

  it('unknown field in where (bare-field scope)', () => {
    expect(errors("records.resources.where(rest_typo = 'Labour')")).toEqual([
      "'resources' has no field 'rest_typo'",
    ]);
  });

  it('unknown field through first', () => {
    expect(errors('records.resources.first.no_such_field')).toEqual([
      "'resources' has no field 'no_such_field'",
    ]);
  });

  it('broken FK path — field missing on the target type', () => {
    expect(errors("records.suburbs.where(city_id.postcode = '2000')")).toEqual([
      "'cities' has no field 'postcode'",
    ]);
  });

  it('reverse-FK navigation validates (D12)', () => {
    expect(errors('records.cities.first.suburbs.count')).toEqual([]);
    expect(errors('records.cities.first.resources.count')).toEqual([
      "'cities' has no field 'resources'", // resources has no FK to cities
    ]);
  });

  it('anchorType types context.record', () => {
    expect(errors('context.record.rate > 50', 'resources')).toEqual([]);
    expect(errors('context.record.no_field', 'resources')).toEqual([
      "'resources' has no field 'no_field'",
    ]);
  });

  it('select rows are checked by column', () => {
    expect(errors('records.resources.select(id, name).first.name')).toEqual([]);
    expect(errors('records.resources.select(id, name).first.rate')).toEqual([
      "This row has no column 'rate' (columns: id, name)",
    ]);
  });

  it('bare identifiers outside chains', () => {
    expect(errors('rest_type')).toEqual([
      "Unknown name 'rest_type' — bare field names are only available inside query methods",
    ]);
  });
});

describe('validator — functions and methods', () => {
  it('unknown function', () => {
    expect(errors("frobnicate(1)")).toEqual(["Unknown function 'frobnicate'"]);
  });

  it('builtin arity', () => {
    expect(errors("iif(true, 'a')")).toEqual(["iif() takes 3 arguments, got 2"]);
    expect(errors('round(1, 2, 3)')).toEqual(['round() takes 1–2 arguments, got 3']);
  });

  it('property vs method confusion gets a teaching message', () => {
    expect(errors('records.resources.count()')).toEqual([
      "'count' is a property, not a method — drop the parentheses: .count",
    ]);
    expect(errors('records.resources.where')).toEqual([
      "'where' is a method — call it: .where(...)",
    ]);
  });

  it('select expressions need aliases', () => {
    expect(errors('records.suburbs.select(city_id.name)')).toEqual([
      'Give this select expression a name: alias: expression',
    ]);
  });

  it('services calls pass through untyped, arguments still checked', () => {
    expect(errors('services.geo.suburbsOf(attributes.city)')).toEqual([]);
    expect(errors('services.geo.suburbsOf(records.nope.count)')).toEqual(["Unknown record type 'nope'"]);
  });
});

describe('validator — syntax errors surface as diagnostics', () => {
  it('parse failure becomes a single error diagnostic', () => {
    const diags = validate('records.resources.where(');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].line).toBe(1);
  });
});

describe('validator — schema lint (D8)', () => {
  it('warns when an SDM field shadows a root', () => {
    const shadowing: DslSchema = {
      types: { jobs: { fields: { context: { type: 'text' }, name: { type: 'text' } } } },
    };
    const diags = lintSchema(shadowing);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].message).toContain("shadows the 'context' root");
  });

  it('clean schema lints clean', () => {
    expect(lintSchema(schema)).toEqual([]);
  });
});
