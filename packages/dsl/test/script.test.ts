// Scripts tier (Phase 2): statements, fail/warn, staged mutations with
// transactional commit, queue outbox, named functions. GRAMMAR §5, DSL_SPEC §6–§8.

import { describe, it, expect, vi } from 'vitest';
import { FluxRuntimeError } from '../src/evaluator';
import { DRIVERS, type Driver } from './drivers';
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
      prepareDelete: (type, id) => {
        if (!data[type]?.some((r) => r.id === id)) throw new Error(`Record not found: ${id}`);
      },
      apply: (ops) => {
        applied.push(ops);
        for (const op of ops) {
          if (op.op === 'create') data[op.type].push(op.record);
          else if (op.op === 'delete') {
            data[op.type] = data[op.type].filter((r) => r.id !== op.id);
          } else {
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

function suite(driver: Driver) {
  const run = (source: string, h: EvalHost, mode: 'read' | 'mutate' = 'mutate') =>
    driver.execute(source, h, { mode });

  // ── Statements ──────────────────────────────────────────────────────────────────

  describe('scripts — statements and variables', () => {
    it('let, reassignment, arithmetic, return', async () => {
      const { value } = await run(
        `let total = 0
         total = total + 1
         total = total * 10
         return total`,
        host(makeStore()),
      );
      expect(value).toBe(10);
    });

    it('a script without a return yields null', async () => {
      expect((await run('let x = 1', host(makeStore()))).value).toBe(null);
    });

    it('if / else if / else', async () => {
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
      expect((await run(src(0), host(store, { attributes: { qty: 20 } }))).value).toBe('many');
      expect((await run(src(0), host(store, { attributes: { qty: 2 } }))).value).toBe('some');
      expect((await run(src(0), host(store, { attributes: { qty: 0 } }))).value).toBe('few');
    });

    it('for each over a query, with early return', async () => {
      const { value } = await run(
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

    it('for each over null iterates nothing (null-safe)', async () => {
      const { value } = await run(
        `let n = 0
         for each x in context.missing {
           n = n + 1
         }
         return n`,
        host(makeStore()),
      );
      expect(value).toBe(0);
    });

    it('block scoping: a let inside a block is gone outside it', async () => {
      await expect(run(
          `if true {
             let inner = 1
           }
           return inner`,
          host(makeStore()),
        )).rejects.toThrow(/Unknown name 'inner'/);
    });

    it('assignment to an undeclared variable points at let', async () => {
      await expect(run(`x = 5`, host(makeStore()))).rejects.toThrow(/declare it with 'let'/);
    });

    it('redeclaring in the same block is an error', async () => {
      await expect(run(`let x = 1\nlet x = 2`, host(makeStore()))).rejects.toThrow(/already declared/);
    });

    it('variables hold snapshot copies (D11): store changes do not ripple in', async () => {
      const store = makeStore();
      const h = host(store);
      const { value } = await run(
        `let wo = records.work_orders.where(code = 'WO-1').first
         records.work_orders.where(code = 'WO-1').update({ status: 'Closed' })
         return wo.status`,
        h,
      );
      // the snapshot was taken before the update — but note read-your-writes applies
      // to *new* reads, not to snapshots already held
      expect(value).toBe('Raised');
    });

    it('field assignment on a record errors, pointing to .update (D14)', async () => {
      await expect(run(`context.record.status = 'x'`, host(makeStore()))).rejects.toThrow(/read-only.*update/);
    });

    it('semicolons and multi-statement lines are rejected', async () => {
      expect(() => parseScript('let x = 1; let y = 2')).toThrow(FluxSyntaxError);
      expect(() => parseScript('let x = 1 let y = 2')).toThrow(/end of line/);
    });

    it('multi-line object literals parse inside scripts', async () => {
      const script = parseScript(`records.wo_resources.create({
        work_order_id: context.record.id,
        qty: 1
      })`);
      expect(script.body).toHaveLength(1);
    });
  });

  // ── fail / warn ─────────────────────────────────────────────────────────────────

  describe('scripts — fail and warn', () => {
    it('fail throws FluxFailError with the user-facing message', async () => {
      await expect(run(`fail('Select at least one resource')`, host(makeStore()), 'read')).rejects.toThrow(FluxFailError);
      await expect(run(`fail('Select at least one resource')`, host(makeStore()), 'read')).rejects.toThrow(
        'Select at least one resource',
      );
    });

    it('warn collects messages without stopping the script', async () => {
      const { value, warnings } = await run(
        `warn('heads up')
         warn('again: ' + attributes.qty)
         return 'done'`,
        host(makeStore()),
        'read',
      );
      expect(value).toBe('done');
      expect(warnings).toEqual(['heads up', 'again: 2']);
    });

    it('fail aborts before any mutation commits', async () => {
      const store = makeStore();
      await expect(run(
          `records.work_orders.where(code = 'WO-1').update({ status: 'Closed' })
           fail('no')`,
          host(store),
        )).rejects.toThrow(FluxFailError);
      expect(store.applied).toHaveLength(0);
      expect(store.data.work_orders[0].fields.status).toBe('Raised');
    });
  });

  // ── Mutations and the transaction ───────────────────────────────────────────────

  describe('scripts — staged mutations', () => {
    it('instance update commits on success', async () => {
      const store = makeStore();
      await run(`context.record.update({ status: 'Scheduled' })`, host(store));
      expect(store.data.work_orders[0].fields.status).toBe('Scheduled');
      expect(store.applied).toHaveLength(1);
    });

    it('update through an FK-deref target works', async () => {
      const store = makeStore();
      await run(`context.record.workgroup_id.update({ last_assigned: 'today' })`, host(store));
      expect(store.data.workgroups[0].fields.last_assigned).toBe('today');
    });

    it('create returns the record; its id is usable for FKs', async () => {
      const store = makeStore();
      const { value } = await run(
        `let line = records.wo_resources.create({ work_order_id: context.record.id, resource_id: 'r1', qty: 1 })
         return line.id`,
        host(store),
      );
      expect(value).toBe('new_1');
      expect(store.data.wo_resources).toHaveLength(1);
      expect(store.data.wo_resources[0].fields.work_order_id).toBe('wo1');
    });

    it('the script reads its own writes before commit', async () => {
      const store = makeStore();
      const { value } = await run(
        `records.wo_resources.create({ work_order_id: context.record.id, resource_id: 'r1' })
         records.wo_resources.create({ work_order_id: context.record.id, resource_id: 'r2' })
         return context.record.wo_resources.count`,
        host(store),
      );
      expect(value).toBe(2); // reverse-FK navigation sees the staged creates
      expect(store.data.wo_resources).toHaveLength(2);
    });

    it('updating a record created in the same script folds into the create', async () => {
      const store = makeStore();
      await run(
        `let line = records.wo_resources.create({ work_order_id: 'wo1', qty: 1 })
         line.update({ qty: 5 })`,
        host(store),
      );
      expect(store.applied[0]).toHaveLength(1); // one create op, no separate update
      expect(store.data.wo_resources[0].fields.qty).toBe(5);
    });

    it('bulk update via where() chain terminal returns the affected count', async () => {
      const store = makeStore();
      const { value } = await run(
        `return records.resources.where(status = 'Active').update({ status: 'Busy' })`,
        host(store),
      );
      expect(value).toBe(2);
      expect(store.data.resources.every((r) => r.fields.status === 'Busy')).toBe(true);
    });

    it('bulk update without a where is a runtime error too', async () => {
      await expect(run(`records.resources.update({ status: 'x' })`, host(makeStore()))).rejects.toThrow(
        /Bulk update needs a filter/,
      );
    });

    it('a mid-script error rolls everything back (atomicity)', async () => {
      const store = makeStore();
      await expect(run(
          `records.wo_resources.create({ work_order_id: 'wo1' })
           context.record.update({ status: 'Closed' })
           let boom = 1 / 0`,
          host(store),
        )).rejects.toThrow(FluxRuntimeError);
      expect(store.applied).toHaveLength(0);
      expect(store.data.wo_resources).toHaveLength(0);
      expect(store.data.work_orders[0].fields.status).toBe('Raised');
    });

    it('host constraints surface at the mutation statement (stage time)', async () => {
      const store = makeStore();
      await expect(run(`context.record.update({ code: 'HACK' })`, host(store))).rejects.toThrow(/immutable/);
      await expect(run(`records.work_orders.create({ status: 'Raised' })`, host(store))).rejects.toThrow(/required/);
      expect(store.applied).toHaveLength(0);
    });

    it("mutations in 'read' mode (before hooks, expressions) are runtime errors", async () => {
      const store = makeStore();
      await expect(run(`context.record.update({ status: 'x' })`, host(store), 'read')).rejects.toThrow(
        /after hooks only/,
      );
      await expect(run(`records.wo_resources.create({ qty: 1 })`, host(store), 'read')).rejects.toThrow(
        /after hooks only/,
      );
    });
  });

  // ── delete (D-something, 2026-09-21) ────────────────────────────────────────────
  //
  // The platform's position on deleting, in one line: a delete is for what should
  // never have existed, and anything worth keeping is marked instead. So the verb
  // destroys the record and its history, takes no arguments, and — like bulk
  // update — refuses to act on a whole collection unless the script says so.

  describe('scripts — delete', () => {
    it('deletes one record', async () => {
      const store = makeStore();
      await run(`context.record.delete()`, host(store));
      expect(store.data.work_orders.map((r) => r.id)).toEqual(['wo2']);
      expect(store.applied[0]).toEqual([{ op: 'delete', type: 'work_orders', id: 'wo1' }]);
    });

    it('bulk delete via where() returns the affected count', async () => {
      const store = makeStore();
      const { value } = await run(`return records.resources.where(status = 'Active').delete()`, host(store));
      expect(value).toBe(2);
      expect(store.data.resources.every((r) => r.fields.status !== 'Active')).toBe(true);
    });

    it('refuses a whole collection without a filter', async () => {
      await expect(run(`records.resources.delete()`, host(makeStore()))).rejects.toThrow(/Bulk delete needs a filter/);
    });

    it('takes no arguments', async () => {
      await expect(run(`context.record.delete({ reason: 'x' })`, host(makeStore()))).rejects.toThrow(/takes no arguments/);
    });

    it('is refused in read mode, like every other mutation', async () => {
      await expect(run(`context.record.delete()`, host(makeStore()), 'read')).rejects.toThrow(/after hooks only/);
    });

    it('surfaces a host refusal at the statement, staging nothing', async () => {
      const store = makeStore();
      await await run(`records.resources.where(id = 'nope').delete()`, host(store));
      expect(store.applied).toHaveLength(0); // nothing matched, nothing staged, no commit
    });

    // Deleting something the same script created cancels the create: there is no
    // persisted record to destroy, and staging both would ask the host to delete
    // an id it has never seen.
    it('deleting a record created in the same script cancels the create', async () => {
      const store = makeStore();
      await run(
        `let line = records.wo_resources.create({ work_order_id: 'wo1', qty: 1 })
         line.delete()`,
        host(store),
      );
      expect(store.applied).toHaveLength(0); // the create never reaches the host
      expect(store.data.wo_resources).toHaveLength(0);
    });

    // An update staged before the delete is pointless work the host would have to
    // apply to a row on its way out.
    it('drops an update staged against a record later deleted', async () => {
      const store = makeStore();
      await run(
        `context.record.update({ status: 'Scheduled' })
         context.record.delete()`,
        host(store),
      );
      expect(store.applied[0]).toEqual([{ op: 'delete', type: 'work_orders', id: 'wo1' }]);
      expect(store.data.work_orders.map((r) => r.id)).toEqual(['wo2']);
    });

    it('rolls back with everything else when a later statement fails', async () => {
      const store = makeStore();
      await expect(run(`context.record.delete()
             let boom = 1 / 0`, host(store))).rejects.toThrow(FluxRuntimeError);
      expect(store.applied).toHaveLength(0);
      expect(store.data.work_orders).toHaveLength(2);
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
    it('queued calls dispatch only after a successful commit, with staged args', async () => {
      const store = makeStore();
      const sms = vi.fn();
      const h = host(store, { services: notifyServices(sms) });
      await run(
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

    it('a failing script dispatches nothing', async () => {
      const sms = vi.fn();
      const h = host(makeStore(), { services: notifyServices(sms) });
      await expect(run(
          `queue services.notify.sms('111', 'hi')
           fail('stop')`,
          h,
        )).rejects.toThrow(FluxFailError);
      expect(sms).not.toHaveBeenCalled();
    });

    it('a failing queued dispatch becomes a warning, not an error', async () => {
      const h = host(makeStore(), {
        services: notifyServices(() => { throw new Error('gateway down'); }),
      });
      const { warnings } = await run(`queue services.notify.sms('111', 'hi')`, h);
      expect(warnings).toEqual(['queued services.notify.sms failed: gateway down']);
    });

    it("queue is rejected in 'read' mode", async () => {
      const h = host(makeStore(), { services: notifyServices(vi.fn()) });
      await expect(run(`queue services.notify.sms('111', 'hi')`, h, 'read')).rejects.toThrow(/after hooks only/);
    });

    it('queue dispatches async services fire-and-forget; rejections reach onQueuedFailure', async () => {
      const failures: string[] = [];
      const h = host(makeStore(), {
        services: notifyServices(async () => { throw new Error('smtp down'); }),
        onQueuedFailure: (label, message) => failures.push(`${label}: ${message}`),
      });
      const { warnings } = await run(`queue services.notify.sms('111', 'hi')`, h);
      expect(warnings).toEqual([]); // the script already returned — not a warning
      await Promise.resolve(); // let the rejection propagate
      expect(failures).toEqual(['services.notify.sms: smtp down']);
    });

    it('a waiting effect call is allowed in after hooks (the documented non-transactional exception)', async () => {
      const sms = vi.fn(() => 'sent');
      const h = host(makeStore(), { services: notifyServices(sms) });
      await run(`let receipt = services.notify.sms('111', 'now')`, h);
      expect(sms).toHaveBeenCalledWith('111', 'now');
    });

    it('queueing an unknown service function is a runtime error before anything commits', async () => {
      const store = makeStore();
      const h = host(store, { services: notifyServices(vi.fn()) });
      await expect(run(
          `context.record.update({ status: 'Assigned' })
           queue services.notify.nope('111')`,
          h,
        )).rejects.toThrow(/Service 'notify' has no function 'nope'/);
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

    it('functions take explicit params and see the roots implicitly', async () => {
      const h = host(makeStore(), { functions: FNS });
      expect((await run(`return calcTotal([1, 2, 3], 10)`, h)).value).toBe(60);
      const { value } = await run(`return activeResources().first.name`, h);
      expect(value).toBe('Alice');
    });

    it('functions are callable from the expression tier', async () => {
      const h = host(makeStore(), { functions: FNS });
      expect(await driver.evaluate('activeResources().count', h)).toBe(2);
    });

    it('functions are lexically isolated from caller variables', async () => {
      const h = host(makeStore(), {
        functions: [`function leak() { return outer }`],
      });
      await expect(run(`let outer = 1\nreturn leak()`, h)).rejects.toThrow(/Unknown name 'outer'/);
    });

    it('arity is enforced', async () => {
      const h = host(makeStore(), { functions: FNS });
      await expect(run(`return calcTotal([1])`, h)).rejects.toThrow(/takes 2 arguments, got 1/);
    });

    it('runaway recursion hits the call-depth guard', async () => {
      const h = host(makeStore(), { functions: [`function loop(n) { return loop(n + 1) }`] });
      await expect(run(`return loop(0)`, h)).rejects.toThrow(/Call depth exceeded/);
    });
  });

  // ── Quotas ──────────────────────────────────────────────────────────────────────

  describe('scripts — quotas', () => {
    it('the step quota caps loops', async () => {
      const h = host(makeStore(), { quotas: { maxSteps: 200 } });
      await expect(run(
          `let n = 0
           for each a in [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] {
             for each b in [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] {
               n = n + 1
             }
           }`,
          h,
        )).rejects.toThrow(/step quota/);
    });
  });
}

for (const driver of DRIVERS) describe(`${driver.name} driver`, () => suite(driver));
