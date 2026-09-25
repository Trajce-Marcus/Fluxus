// SERVER_DATA_LOADING step 2 at the DSL level: `invoke` and service calls
// through both drivers, the time budget counting evaluation only (ruling 20),
// and a write-through host (ruling 10) — writes land as they happen, a failed
// script is undone by the host, references are checked at the end, and
// `queue`d calls wait for the host's commit.

import { describe, it, expect } from 'vitest';
import { evaluateExpressionAsync, executeScriptAsync } from '../src/evaluator';
import type { DslRecord, EvalHost, RecordsHost, WriteThroughMutationHost } from '../src/host';
import { DRIVERS, type Driver } from './drivers';

function suite(driver: Driver) {
  it('invoke answers with what the host returns', async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const host: EvalHost = {
      invoke: (id, params) => {
        calls.push([id, params]);
        return [{ id: 'j1', name: 'Job 1' }];
      },
    };
    expect(await driver.evaluate("invoke('act_get_jobs', { region: 'N' }).first.name", host)).toBe('Job 1');
    expect(calls).toEqual([['act_get_jobs', { region: 'N' }]]);
  });

  it('invoke without a host door fails loudly', async () => {
    await expect(driver.evaluate("invoke('act_get_jobs')", {})).rejects.toThrow(/not available here/);
  });

  it('a read service call answers inside a filter', async () => {
    const host: EvalHost = {
      records: {
        hasType: (t) => t === 'jobs',
        getAll: () => [
          { id: 'j1', type: 'jobs', fields: { qty: 3 } },
          { id: 'j2', type: 'jobs', fields: { qty: 9 } },
        ],
        getById: () => null,
        fkTarget: () => null,
        reverseRef: () => null,
      },
      services: [{
        name: 'limits',
        description: 'test',
        functions: { max: { params: [], description: 'the limit', kind: 'read', fn: () => 5 } },
      }],
    };
    expect(await driver.evaluate('records.jobs.where(qty > services.limits.max()).values(id)', host)).toEqual(['j2']);
  });
}

for (const driver of DRIVERS) describe(`${driver.name} driver`, () => suite(driver));

describe('waiting driver — the time budget counts evaluation only (ruling 20)', () => {
  it('time spent waiting on the host does not exhaust the budget', async () => {
    const rows: DslRecord[] = Array.from({ length: 120 }, (_, i) => ({ id: `r${i}`, type: 'jobs', fields: { qty: i } }));
    const host: EvalHost = {
      records: {
        hasType: (t) => t === 'jobs',
        getAll: () => rows,
        getById: () => null,
        fkTarget: () => null,
        reverseRef: () => null,
      },
      services: [{
        name: 'slow',
        description: 'test',
        functions: {
          one: { params: [], description: 'waits', kind: 'read', fn: () => new Promise((resolve) => setTimeout(() => resolve(1), 2)) },
        },
      }],
      quotas: { timeoutMs: 50 },
    };
    // ~120 waits of ≥2ms is well past 50ms of wall clock, and well past 512
    // steps, so the budget is checked many times while mostly waiting.
    const result = await executeScriptAsync(
      `let n = 0
       for each r in records.jobs {
         n = n + services.slow.one() + r.qty - r.qty
       }
       return n`,
      host,
    );
    expect(result.value).toBe(120);
  });

  it('evaluation time still counts', async () => {
    const host: EvalHost = { quotas: { timeoutMs: 1, maxSteps: 50_000_000 } };
    await expect(
      executeScriptAsync(
        `let n = 0
         for each a in [1,2,3,4,5,6,7,8,9,10] { for each b in [1,2,3,4,5,6,7,8,9,10] { for each c in [1,2,3,4,5,6,7,8,9,10] { for each d in [1,2,3,4,5,6,7,8,9,10] { for each e in [1,2,3,4,5,6,7,8,9,10] { n = n + 1 } } } } }
         return n`,
        host,
      ),
    ).rejects.toThrow(/time budget/);
  });
});

// ── A write-through host ─────────────────────────────────────────────────────

interface WriteThroughLog {
  events: string[];
  committed: (() => void)[];
}

function writeThroughHost(): { host: EvalHost; data: Map<string, DslRecord>; log: WriteThroughLog } {
  const data = new Map<string, DslRecord>([
    ['p1', { id: 'p1', type: 'projects', fields: { name: 'Alpha' } }],
    ['t1', { id: 't1', type: 'tasks', fields: { title: 'Dig', project_id: 'p1' } }],
  ]);
  const log: WriteThroughLog = { events: [], committed: [] };
  let undo: Map<string, DslRecord> | null = null;
  let seq = 0;
  const wait = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 0));
  const mutate: WriteThroughMutationHost = {
    writesThrough: true,
    begin: () => {
      log.events.push('begin');
      undo = new Map([...data].map(([id, r]) => [id, { ...r, fields: { ...r.fields } }]));
      return wait(undefined);
    },
    create: (type, fields) => {
      if (type === 'tasks' && !fields.title) throw new Error('"title" is required');
      const record = { id: `n${++seq}`, type, fields: { ...fields } };
      data.set(record.id, record);
      log.events.push(`create ${record.id}`);
      return wait(record);
    },
    update: (type, id, fields) => {
      const record = data.get(id);
      if (!record) return Promise.reject(new Error(`Record '${id}' was deleted meanwhile`));
      record.fields = { ...record.fields, ...fields };
      log.events.push(`update ${id}`);
      return wait(undefined);
    },
    delete: (type, id) => {
      data.delete(id);
      log.events.push(`delete ${id}`);
      return wait(undefined);
    },
    finish: (deleted) => {
      log.events.push(`finish ${deleted.map((d) => d.id).join(',')}`);
      for (const { id } of deleted) {
        const holder = [...data.values()].find((r) => r.fields.project_id === id);
        if (holder) throw new Error(`'${id}' cannot be deleted — tasks.project_id still points at it (${holder.id})`);
      }
      return wait(undefined);
    },
    undo: () => {
      log.events.push('undo');
      data.clear();
      for (const [id, r] of undo!) data.set(id, r);
      return wait(undefined);
    },
    afterCommit: (dispatch) => {
      log.committed.push(dispatch);
    },
  };
  const records: RecordsHost = {
    hasType: (t) => t === 'projects' || t === 'tasks',
    getAll: (type) => wait([...data.values()].filter((r) => r.type === type)),
    getById: (type, id) => wait(data.get(String(id))?.type === type ? data.get(String(id))! : null),
    fkTarget: (type, field) => (type === 'tasks' && field === 'project_id' ? 'projects' : null),
    reverseRef: (type, name) => (type === 'projects' && name === 'tasks' ? { sourceType: 'tasks', field: 'project_id' } : null),
    mutate,
  };
  return { host: { records, context: { record: data.get('p1') } }, data, log };
}

describe('waiting driver — a write-through host (ruling 10)', () => {
  it('each write lands at once and later reads see it, deletes included', async () => {
    const { host, data, log } = writeThroughHost();
    const { value } = await executeScriptAsync(
      `let t = records.tasks.create({ title: 'Pour', project_id: context.record.id })
       t.update({ title: 'Pour slab' })
       records.tasks.where(title = 'Dig').first.delete()
       return records.tasks.values(title)`,
      host,
      { mode: 'mutate' },
    );
    expect(value).toEqual(['Pour slab']);
    expect(data.get('n1')?.fields.title).toBe('Pour slab');
    expect(data.has('t1')).toBe(false);
    expect(log.events).toEqual(['begin', 'create n1', 'update n1', 'delete t1', 'finish t1']);
  });

  it('a failing script is undone by the host, and its queued calls never fire', async () => {
    const { host, data, log } = writeThroughHost();
    let sent = 0;
    host.services = [{ name: 'notify', description: 't', functions: { sms: { params: [], description: 's', kind: 'effect', fn: () => { sent++; } } } }];
    await expect(
      executeScriptAsync(
        `records.tasks.create({ title: 'Pour', project_id: 'p1' })
         queue services.notify.sms()
         fail('no')`,
        host,
        { mode: 'mutate' },
      ),
    ).rejects.toThrow('no');
    expect(log.events).toEqual(['begin', 'create n1', 'undo']);
    expect(data.has('n1')).toBe(false);
    expect(log.committed).toHaveLength(0);
    expect(sent).toBe(0);
  });

  it('references are checked at the end: a subtree may go, a referenced parent alone may not', async () => {
    const subtree = writeThroughHost();
    await executeScriptAsync(
      `for each t in context.record.tasks { t.delete() }
       context.record.delete()`,
      subtree.host,
      { mode: 'mutate' },
    );
    expect(subtree.data.size).toBe(0);

    const parent = writeThroughHost();
    await expect(
      executeScriptAsync(`context.record.delete()`, parent.host, { mode: 'mutate' }),
    ).rejects.toThrow(/tasks.project_id still points at it/);
    expect(parent.log.events).toEqual(['begin', 'delete p1', 'finish p1', 'undo']);
    expect(parent.data.has('p1')).toBe(true);
  });

  it('queued calls wait for the host to commit', async () => {
    const { host, log } = writeThroughHost();
    let sent = 0;
    host.services = [{ name: 'notify', description: 't', functions: { sms: { params: [], description: 's', kind: 'effect', fn: () => { sent++; } } } }];
    await executeScriptAsync(`queue services.notify.sms()`, host, { mode: 'mutate' });
    expect(sent).toBe(0);
    expect(log.committed).toHaveLength(1);
    log.committed[0]();
    expect(sent).toBe(1);
  });

  it('a script that writes nothing opens no undo point', async () => {
    const { host, log } = writeThroughHost();
    await executeScriptAsync(`return records.tasks.count`, host, { mode: 'mutate' });
    expect(log.events).toEqual([]);
  });

  it('a host error on a write is a script error at the call', async () => {
    const { host } = writeThroughHost();
    await expect(
      executeScriptAsync(`records.tasks.create({ project_id: 'p1' })`, host, { mode: 'mutate' }),
    ).rejects.toThrow(/"title" is required \(line 1/);
  });

  it('an expression reads through the same host', async () => {
    const { host } = writeThroughHost();
    expect(await evaluateExpressionAsync('context.record.tasks.first.project_id.name', host)).toBe('Alpha');
  });
});
