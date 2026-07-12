// Static validation of the scripts tier (Phase 2): scope rules, mutation
// placement (before vs after hooks), bulk-update-needs-where, queue rules,
// named-function arity. GRAMMAR §5, DSL_SPEC §6–§9.

import { describe, it, expect } from 'vitest';
import { validateScript, validateFunction, validateExpression, type DslSchema, type ScriptValidateOptions } from '../src/validator';

const SCHEMA: DslSchema = {
  types: {
    work_orders: {
      fields: {
        code: { type: 'text' },
        status: { type: 'text' },
        due_date: { type: 'date' },
        workgroup_id: { type: 'fk_ref', fkTarget: 'workgroups' },
      },
    },
    workgroups: { fields: { name: { type: 'text' }, last_assigned: { type: 'text' } } },
    wo_resources: {
      fields: {
        work_order_id: { type: 'fk_ref', fkTarget: 'work_orders' },
        resource_id: { type: 'text' },
        qty: { type: 'int' },
      },
    },
  },
};

const check = (source: string, options: ScriptValidateOptions = {}) =>
  validateScript(source, SCHEMA, { anchorType: 'work_orders', ...options });
const errors = (source: string, options: ScriptValidateOptions = {}) =>
  check(source, options).map((d) => d.message);

describe('script validation — scopes', () => {
  it('clean scripts validate clean', () => {
    expect(
      check(`
        let open = records.work_orders.where(status = 'Open')
        for each wo in open {
          if wo.due_date < now() {
            wo.update({ status: 'Overdue' })
          }
        }
      `),
    ).toEqual([]);
  });

  it('use before declaration and unknown variables', () => {
    expect(errors('return missing')[0]).toMatch(/Unknown name 'missing'/);
    expect(errors('x = 1')[0]).toMatch(/declare it with 'let x/);
  });

  it('roots cannot be redeclared or assigned', () => {
    expect(errors('let context = 1')[0]).toMatch(/root and cannot be redeclared/);
    expect(errors('records = 1')[0]).toMatch(/root and cannot be assigned/);
  });

  it('redeclaration in the same block; shadowing in an inner block is fine', () => {
    expect(errors('let x = 1\nlet x = 2')[0]).toMatch(/already declared/);
    expect(check('let x = 1\nif true {\n  let y = 2\n}')).toEqual([]);
  });

  it('builtin and function names cannot be redeclared', () => {
    expect(errors('let now = 1')[0]).toMatch(/function name/);
    expect(errors('let helper = 1', { functions: { helper: { params: [] } } })[0]).toMatch(/function name/);
  });

  it('variable shapes flow: fields of a held query result are checked', () => {
    expect(errors(`let pool = records.work_orders.where(true)\nreturn pool.first.nope`)[0]).toMatch(
      /has no field 'nope'/,
    );
    expect(check(`let pool = records.work_orders.where(true)\nreturn pool.first.status`)).toEqual([]);
  });

  it('for-each binds the element shape', () => {
    expect(errors(`for each wo in records.work_orders.where(true) {\n  return wo.nope\n}`)[0]).toMatch(
      /has no field 'nope'/,
    );
  });
});

describe('script validation — mutations', () => {
  it('record field assignment points to .update (D14)', () => {
    expect(errors(`context.record.status = 'x'`)[0]).toMatch(/read-only.*\.update/);
  });

  it('before hooks reject mutations and queue (validate only)', () => {
    const before: ScriptValidateOptions = { mode: 'before' };
    expect(errors(`context.record.update({ status: 'x' })`, before)[0]).toMatch(/Before hooks validate only/);
    expect(errors(`records.wo_resources.create({ qty: 1 })`, before)[0]).toMatch(/Before hooks validate only/);
    expect(errors(`queue services.notify.sms('1', 'hi')`, before)[0]).toMatch(/after hooks only/);
    // fail/warn are exactly what before hooks are for
    expect(check(`if context.record.status = 'Closed' {\n  fail('already closed')\n}`, before)).toEqual([]);
  });

  it('bulk update requires a where (D13)', () => {
    expect(errors(`records.work_orders.update({ status: 'x' })`)[0]).toMatch(/Bulk update needs a filter/);
    expect(errors(`records.work_orders.orderBy(code).update({ status: 'x' })`)[0]).toMatch(/Bulk update needs a filter/);
    expect(check(`records.work_orders.where(true).update({ status: 'x' })`)).toEqual([]);
  });

  it('projected rows cannot be updated', () => {
    expect(errors(`records.work_orders.where(true).select(id, code).update({ code: 'x' })`)[0]).toMatch(
      /rows have no identity/,
    );
  });

  it('create is collection-level only', () => {
    expect(errors(`records.work_orders.where(true).create({ code: 'x' })`)[0]).toMatch(/collection-level/);
    expect(check(`records.wo_resources.create({ work_order_id: 'wo1', qty: 1 })`)).toEqual([]);
  });

  it('mutation field keys are checked against the schema', () => {
    expect(errors(`context.record.update({ nope: 1 })`)[0]).toMatch(/has no field 'nope'/);
    expect(errors(`records.wo_resources.create({ nope: 1 })`)[0]).toMatch(/has no field 'nope'/);
    expect(errors(`context.record.update({ id: 'x' })`)[0]).toMatch(/'id' is not writable/);
  });

  it('the expression tier rejects mutations and fail/warn', () => {
    const expr = (s: string) => validateExpression(s, SCHEMA, { anchorType: 'work_orders' }).map((d) => d.message);
    expect(expr(`records.work_orders.where(true).update({ status: 'x' })`)[0]).toMatch(/not allowed in expressions/);
    expect(expr(`fail('x')`)[0]).toMatch(/belongs to scripts/);
  });
});

describe('script validation — queue', () => {
  it('queue must target a service call', () => {
    expect(errors(`queue records.work_orders.where(true)`)[0]).toMatch(/needs a service call/);
    expect(check(`queue services.notify.sms('1', 'hi')`)).toEqual([]);
  });
});

describe('script validation — service registry in hooks', () => {
  const SERVICES = {
    notify: { functions: { sms: { params: ['to', 'message'], kind: 'effect' as const } } },
    geo: { functions: { suburbsOf: { params: ['city'], kind: 'read' as const } } },
  };
  const withServices = { ...SCHEMA, services: SERVICES };
  const diag = (source: string, options: ScriptValidateOptions = {}) =>
    validateScript(source, withServices, { anchorType: 'work_orders', ...options }).map(
      (d) => `${d.severity}: ${d.message}`,
    );

  it('queue resolves module, function, and arity against the registry', () => {
    expect(diag(`queue services.notify.sms('1', 'hi')`)).toEqual([]);
    expect(diag(`queue services.nope.sms('1')`)).toEqual(["error: Unknown service module 'nope'"]);
    expect(diag(`queue services.notify.nope('1')`)).toEqual(["error: Service 'notify' has no function 'nope'"]);
    expect(diag(`queue services.notify.sms('1')`)).toEqual([
      'error: services.notify.sms(to, message) takes 2 arguments, got 1',
    ]);
  });

  it('read service calls pass anywhere; waiting effect calls error in before hooks, warn in after hooks', () => {
    expect(diag(`let s = services.geo.suburbsOf(attributes.city)`, { mode: 'before' })).toEqual([]);
    expect(diag(`let x = services.notify.sms('1', 'hi')`, { mode: 'before' })).toEqual([
      "error: Before hooks validate only — queue 'services.notify.sms' in the after hook",
    ]);
    expect(diag(`let x = services.notify.sms('1', 'hi')`)).toEqual([
      "warning: 'services.notify.sms' has effects — a waiting call is non-transactional; prefer 'queue services.notify.sms(…)'",
    ]);
  });

  it('callback mode: waiting effect calls pass silently; record mutations are errors', () => {
    const callback: ScriptValidateOptions = { mode: 'callback' };
    expect(diag(`services.notify.sms('1', 'hi')`, callback)).toEqual([]);
    expect(diag(`queue services.notify.sms('1', 'hi')`, callback)).toEqual([]);
    expect(diag(`context.record.update({ status: 'x' })`, callback)).toEqual([
      "error: update() is not allowed in callbacks — mutations flow through activities (services.activities.run)",
    ]);
    expect(diag(`records.wo_resources.create({ qty: 1 })`, callback)).toEqual([
      "error: create() is not allowed in callbacks — mutations flow through activities (services.activities.run)",
    ]);
  });
});

describe('script validation — named functions', () => {
  it('declared functions are callable with arity checking', () => {
    const options: ScriptValidateOptions = { functions: { calcTotal: { params: ['items', 'rate'] } } };
    expect(check(`return calcTotal([1], 2)`, options)).toEqual([]);
    expect(errors(`return calcTotal([1])`, options)[0]).toMatch(/takes 2 arguments, got 1/);
  });

  it('validateFunction checks the body with params in scope', () => {
    const diags = validateFunction(
      `function overdue(cutoff) {
         return records.work_orders.where(due_date < cutoff and status != 'Closed')
       }`,
      SCHEMA,
    );
    expect(diags).toEqual([]);
    const bad = validateFunction(`function f(x) { return records.nope }`, SCHEMA);
    expect(bad[0].message).toMatch(/Unknown record type/);
  });

  it('expression tier can call declared functions', () => {
    const diags = validateExpression('assignable(context.record)', SCHEMA, {
      anchorType: 'work_orders',
      functions: { assignable: { params: ['wo'] } },
    });
    expect(diags).toEqual([]);
  });
});
