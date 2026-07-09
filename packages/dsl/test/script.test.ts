// Scripts tier (Phase 2): statements, fail/warn, staged mutations with
// transactional commit, queue outbox, named functions. GRAMMAR §5, DSL_SPEC §6–§8.

import { describe, it, expect, vi } from 'vitest';
import { executeScript, FluxRuntimeError } from '../src/evaluator';
import { parseScript } from '../src/parser';
import { FluxFailError, FluxSyntaxError } from '../src/errors';
import type { DslRecord, EvalHost, MutationOp, RecordsHost } from '../src/host';

// ── In-memory mutable host ───────────────────────────────────────────────────────

interface TestStore {
  host: RecordsHost;
  data: Record<string, DslRecord[]>;
  applied: MutationOp[][];
}

function makeStore(): TestStore {
  const data: Record<string, DslRecord[]> = {
    work_orders: [
      { id: 'wo1', type: 'work_orders', fields: { code: 'WO-1', status: 'Raised', workgroup_id: 'wg1' } },
      { id: 'wo2', type: 'work_orders', fields: { code: 'WO-2', status: 'Completed', workgroup_id: null } },
    ],
    wo_resources: [],
    workgroups: [{ id: 'wg1', type: 'workgroups', fields: { name: 'North', last_assigned: null } }],
    resources: [
      { id: 'r1', type: 'resources', fields: { name: 'Bob', status: 'Active', contact: '111' } },
      { id: 'r2', type: 'resources', fields: { name: 'Alice', status: 'Active', contact: '222' } },
    ],
  };
  const applied: MutationOp[][] = [];
  let seq = 0;

  const host: RecordsHost = {
    hasType: (type) => type in data,
    getAll: (type) => data[type] ?? [],
    getById: (type, id) => data[type]?.find((r) => r.id === id) ?? null,
    fkTarget: (type, field) => {
      if (type === 'work_orders' && field === 'workgroup_id') return 'workgroups';
      if (type === 'wo_resources' && field === 'work_order_id') return 'work_orders';
      if (type === 'wo_resources' && field === 'resource_id') return 'resources';
      return null;
    },
    reverseRef: (type, name) => {
      if (type === 'work_orders' && name === 'wo_resources') {
        return { sourceType: 'wo_resources', field: 'work_order_id' };
      }
      return null;
    },
    mutate: {
      prepareCreate: (type, fields) => {
        if (type === 'work_orders' && !fields.code) throw new Error('"code" is required');
        return { id: `new_${++seq}`, type, fields: { ...fields } };
      },
      prepareUpdate: (type, id, fields) => {
        if ('code' in fields) throw new Error('"code" is immutable and cannot be changed');
        void type; void id;
      },
      apply: (ops) => {
        applied.push(ops);
        for (const op of ops) {
          if (op.op === 'create') data[op.type].push(op.record);
          else {
            const target = data[op.type].find((r) => r.id === op.id);
            if (target) target.fields = { ...target.fields, ...op.fields };
          }
        }
      },
    },
  };
  return { host, data, applied };
}

function host(store: TestStore, extra: Partial<EvalHost> = {}): EvalHost {
  return {
    records: store.host,
    context: { record: store.data.work_orders[0], user: { id: 'u1' } },
    attributes: { qty: 2 },
    now: () => new Date('2026-07-07T00:00:00'),
    ...extra,
  };
}

const run = (source: string, h: EvalHost, mode: 'read' | 'mutate' = 'mutate') =>
  executeScript(source, h, { mode });

// ── Statements ──────────────────────────────────────────────────────────────────

describe('scripts — statements and variables', () => {
  it('let, reassignment, arithmetic, return', () => {
    const { value } = run(
      `let total = 0
       total = total + 1
       total = total * 10
       return total`,
      host(makeStore()),
    );
    expect(value).toBe(10);
  });

  it('a script without a return yields null', () => {
    expect(run('let x = 1', host(makeStore())).value).toBe(null);
  });

  it('if / else if / else', () => {
    const src = (qty: number) => `
      let label = ''
      if attributes.qty > 10 {
        label = 'many'
      } else if attributes.qty > 1 {
        label = 'some'
      } else {
        label = 'few'
      }
      return label`;
    const store = makeStore();
    expect(run(src(0), host(store, { attributes: { qty: 20 } })).value).toBe('many');
    expect(run(src(0), host(store, { attributes: { qty: 2 } })).value).toBe('some');
    expect(run(src(0), host(store, { attributes: { qty: 0 } })).value).toBe('few');
  });

  it('for each over a query, with early return', () => {
    const { value } = run(
      `for each r in records.resources.orderBy(name) {
         if r.name = 'Alice' {
           return r.contact
         }
       }
       return 'not found'`,
      host(makeStore()),
    );
    expect(value).toBe('222');
  });

  it('for each over null iterates nothing (null-safe)', () => {
    const { value } = run(
      `let n = 0
       for each x in context.missing {
         n = n + 1
       }
       return n`,
      host(makeStore()),
    );
    expect(value).toBe(0);
  });

  it('block scoping: a let inside a block is gone outside it', () => {
    expect(() =>
      run(
        `if true {
           let inner = 1
         }
         return inner`,
        host(makeStore()),
      ),
    ).toThrow(/Unknown name 'inner'/);
  });

  it('assignment to an undeclared variable points at let', () => {
    expect(() => run(`x = 5`, host(makeStore()))).toThrow(/declare it with 'let'/);
  });

  it('redeclaring in the same block is an error', () => {
    expect(() => run(`let x = 1\nlet x = 2`, host(makeStore()))).toThrow(/already declared/);
  });

  it('variables hold snapshot copies (D11): store changes do not ripple in', () => {
    const store = makeStore();
    const h = host(store);
    const { value } = run(
      `let wo = records.work_orders.where(code = 'WO-1').first
       records.work_orders.where(code = 'WO-1').update({ status: 'Closed' })
       return wo.status`,
      h,
    );
    // the snapshot was taken before the update — but note read-your-writes applies
    // to *new* reads, not to snapshots already held
    expect(value).toBe('Raised');
  });

  it('field assignment on a record errors, pointing to .update (D14)', () => {
    expect(() => run(`context.record.status = 'x'`, host(makeStore()))).toThrow(/read-only.*update/);
  });

  it('semicolons and multi-statement lines are rejected', () => {
    expect(() => parseScript('let x = 1; let y = 2')).toThrow(FluxSyntaxError);
    expect(() => parseScript('let x = 1 let y = 2')).toThrow(/end of line/);
  });

  it('multi-line object literals parse inside scripts', () => {
    const script = parseScript(`records.wo_resources.create({
      work_order_id: context.record.id,
      qty: 1
    })`);
    expect(script.body).toHaveLength(1);
  });
});

// ── fail / warn ─────────────────────────────────────────────────────────────────

describe('scripts — fail and warn', () => {
  it('fail throws FluxFailError with the user-facing message', () => {
    expect(() => run(`fail('Select at least one resource')`, host(makeStore()), 'read')).toThrow(FluxFailError);
    expect(() => run(`fail('Select at least one resource')`, host(makeStore()), 'read')).toThrow(
      'Select at least one resource',
    );
  });

  it('warn collects messages without stopping the script', () => {
    const { value, warnings } = run(
      `warn('heads up')
       warn('again: ' + attributes.qty)
       return 'done'`,
      host(makeStore()),
      'read',
    );
    expect(value).toBe('done');
    expect(warnings).toEqual(['heads up', 'again: 2']);
  });

  it('fail aborts before any mutation commits', () => {
    const store = makeStore();
    expect(() =>
      run(
        `records.work_orders.where(code = 'WO-1').update({ status: 'Closed' })
         fail('no')`,
        host(store),
      ),
    ).toThrow(FluxFailError);
    expect(store.applied).toHaveLength(0);
    expect(store.data.work_orders[0].fields.status).toBe('Raised');
  });
});

// ── Mutations and the transaction ───────────────────────────────────────────────

describe('scripts — staged mutations', () => {
  it('instance update commits on success', () => {
    const store = makeStore();
    run(`context.record.update({ status: 'Scheduled' })`, host(store));
    expect(store.data.work_orders[0].fields.status).toBe('Scheduled');
    expect(store.applied).toHaveLength(1);
  });

  it('update through an FK-deref target works', () => {
    const store = makeStore();
    run(`context.record.workgroup_id.update({ last_assigned: 'today' })`, host(store));
    expect(store.data.workgroups[0].fields.last_assigned).toBe('today');
  });

  it('create returns the record; its id is usable for FKs', () => {
    const store = makeStore();
    const { value } = run(
      `let line = records.wo_resources.create({ work_order_id: context.record.id, resource_id: 'r1', qty: 1 })
       return line.id`,
      host(store),
    );
    expect(value).toBe('new_1');
    expect(store.data.wo_resources).toHaveLength(1);
    expect(store.data.wo_resources[0].fields.work_order_id).toBe('wo1');
  });

  it('the script reads its own writes before commit', () => {
    const store = makeStore();
    const { value } = run(
      `records.wo_resources.create({ work_order_id: context.record.id, resource_id: 'r1' })
       records.wo_resources.create({ work_order_id: context.record.id, resource_id: 'r2' })
       return context.record.wo_resources.count`,
      host(store),
    );
    expect(value).toBe(2); // reverse-FK navigation sees the staged creates
    expect(store.data.wo_resources).toHaveLength(2);
  });

  it('updating a record created in the same script folds into the create', () => {
    const store = makeStore();
    run(
      `let line = records.wo_resources.create({ work_order_id: 'wo1', qty: 1 })
       line.update({ qty: 5 })`,
      host(store),
    );
    expect(store.applied[0]).toHaveLength(1); // one create op, no separate update
    expect(store.data.wo_resources[0].fields.qty).toBe(5);
  });

  it('bulk update via where() chain terminal returns the affected count', () => {
    const store = makeStore();
    const { value } = run(
      `return records.resources.where(status = 'Active').update({ status: 'Busy' })`,
      host(store),
    );
    expect(value).toBe(2);
    expect(store.data.resources.every((r) => r.fields.status === 'Busy')).toBe(true);
  });

  it('bulk update without a where is a runtime error too', () => {
    expect(() => run(`records.resources.update({ status: 'x' })`, host(makeStore()))).toThrow(
      /Bulk update needs a filter/,
    );
  });

  it('a mid-script error rolls everything back (atomicity)', () => {
    const store = makeStore();
    expect(() =>
      run(
        `records.wo_resources.create({ work_order_id: 'wo1' })
         context.record.update({ status: 'Closed' })
         let boom = 1 / 0`,
        host(store),
      ),
    ).toThrow(FluxRuntimeError);
    expect(store.applied).toHaveLength(0);
    expect(store.data.wo_resources).toHaveLength(0);
    expect(store.data.work_orders[0].fields.status).toBe('Raised');
  });

  it('host constraints surface at the mutation statement (stage time)', () => {
    const store = makeStore();
    expect(() => run(`context.record.update({ code: 'HACK' })`, host(store))).toThrow(/immutable/);
    expect(() => run(`records.work_orders.create({ status: 'Raised' })`, host(store))).toThrow(/required/);
    expect(store.applied).toHaveLength(0);
  });

  it("mutations in 'read' mode (before hooks, expressions) are runtime errors", () => {
    const store = makeStore();
    expect(() => run(`context.record.update({ status: 'x' })`, host(store), 'read')).toThrow(
      /after hooks only/,
    );
    expect(() => run(`records.wo_resources.create({ qty: 1 })`, host(store), 'read')).toThrow(
      /after hooks only/,
    );
  });
});

// ── queue (outbox) ──────────────────────────────────────────────────────────────

/** One-module test registry: services.notify.sms(to, message), kind 'effect'. */
function notifyServices(sms: (...args: unknown[]) => unknown) {
  return [{
    name: 'notify',
    description: 'test notifications',
    functions: { sms: { params: ['to', 'message'], description: 'send an SMS', kind: 'effect' as const, fn: sms } },
  }];
}

describe('scripts — queue', () => {
  it('queued calls dispatch only after a successful commit, with staged args', () => {
    const store = makeStore();
    const sms = vi.fn();
    const h = host(store, { services: notifyServices(sms) });
    run(
      `for each r in records.resources.where(status = 'Active') {
         queue services.notify.sms(r.contact, 'Assigned to ' + context.record.code)
       }
       context.record.update({ status: 'Assigned' })`,
      h,
    );
    expect(sms).toHaveBeenCalledTimes(2);
    expect(sms).toHaveBeenCalledWith('111', 'Assigned to WO-1');
    expect(store.data.work_orders[0].fields.status).toBe('Assigned');
  });

  it('a failing script dispatches nothing', () => {
    const sms = vi.fn();
    const h = host(makeStore(), { services: notifyServices(sms) });
    expect(() =>
      run(
        `queue services.notify.sms('111', 'hi')
         fail('stop')`,
        h,
      ),
    ).toThrow(FluxFailError);
    expect(sms).not.toHaveBeenCalled();
  });

  it('a failing queued dispatch becomes a warning, not an error', () => {
    const h = host(makeStore(), {
      services: notifyServices(() => { throw new Error('gateway down'); }),
    });
    const { warnings } = run(`queue services.notify.sms('111', 'hi')`, h);
    expect(warnings).toEqual(['queued services.notify.sms failed: gateway down']);
  });

  it("queue is rejected in 'read' mode", () => {
    const h = host(makeStore(), { services: notifyServices(vi.fn()) });
    expect(() => run(`queue services.notify.sms('111', 'hi')`, h, 'read')).toThrow(/after hooks only/);
  });

  it('queue dispatches async services fire-and-forget; rejections reach onQueuedFailure', async () => {
    const failures: string[] = [];
    const h = host(makeStore(), {
      services: notifyServices(async () => { throw new Error('smtp down'); }),
      onQueuedFailure: (label, message) => failures.push(`${label}: ${message}`),
    });
    const { warnings } = run(`queue services.notify.sms('111', 'hi')`, h);
    expect(warnings).toEqual([]); // the script already returned — not a warning
    await Promise.resolve(); // let the rejection propagate
    expect(failures).toEqual(['services.notify.sms: smtp down']);
  });

  it('a waiting effect call is allowed in after hooks (the documented non-transactional exception)', () => {
    const sms = vi.fn(() => 'sent');
    const h = host(makeStore(), { services: notifyServices(sms) });
    run(`let receipt = services.notify.sms('111', 'now')`, h);
    expect(sms).toHaveBeenCalledWith('111', 'now');
  });

  it('queueing an unknown service function is a runtime error before anything commits', () => {
    const store = makeStore();
    const h = host(store, { services: notifyServices(vi.fn()) });
    expect(() =>
      run(
        `context.record.update({ status: 'Assigned' })
         queue services.notify.nope('111')`,
        h,
      ),
    ).toThrow(/Service 'notify' has no function 'nope'/);
    expect(store.data.work_orders[0].fields.status).not.toBe('Assigned');
  });
});

// ── Named functions ─────────────────────────────────────────────────────────────

describe('scripts — named functions', () => {
  const FNS = [
    `function calcTotal(items, rate) {
       let total = 0
       for each i in items {
         total = total + i * rate
       }
       return total
     }`,
    `function activeResources() {
       return records.resources.where(status = 'Active').orderBy(name)
     }`,
  ];

  it('functions take explicit params and see the roots implicitly', () => {
    const h = host(makeStore(), { functions: FNS });
    expect(run(`return calcTotal([1, 2, 3], 10)`, h).value).toBe(60);
    const { value } = run(`return activeResources().first.name`, h);
    expect(value).toBe('Alice');
  });

  it('functions are callable from the expression tier', async () => {
    const { evaluateExpression } = await import('../src/evaluator');
    const h = host(makeStore(), { functions: FNS });
    expect(evaluateExpression('activeResources().count', h)).toBe(2);
  });

  it('functions are lexically isolated from caller variables', () => {
    const h = host(makeStore(), {
      functions: [`function leak() { return outer }`],
    });
    expect(() => run(`let outer = 1\nreturn leak()`, h)).toThrow(/Unknown name 'outer'/);
  });

  it('arity is enforced', () => {
    const h = host(makeStore(), { functions: FNS });
    expect(() => run(`return calcTotal([1])`, h)).toThrow(/takes 2 arguments, got 1/);
  });

  it('runaway recursion hits the call-depth guard', () => {
    const h = host(makeStore(), { functions: [`function loop(n) { return loop(n + 1) }`] });
    expect(() => run(`return loop(0)`, h)).toThrow(/Call depth exceeded/);
  });
});

// ── Quotas ──────────────────────────────────────────────────────────────────────

describe('scripts — quotas', () => {
  it('the step quota caps loops', () => {
    const h = host(makeStore(), { quotas: { maxSteps: 200 } });
    expect(() =>
      run(
        `let n = 0
         for each a in [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] {
           for each b in [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] {
             n = n + 1
           }
         }`,
        h,
      ),
    ).toThrow(/step quota/);
  });
});
