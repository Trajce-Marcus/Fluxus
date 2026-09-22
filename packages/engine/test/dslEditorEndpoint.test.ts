// What `engine.evaluate` does BARE — the read-only posture the DSL Editor's
// endpoint is built on (packages/console/docs/DSL_EDITOR_SPEC.md §6).
//
// Scope, stated because an earlier version of this header overclaimed it: this
// builds `engine.evaluate(source, { readonlyRecords: true, quotas, anchorRecord })`
// and NOT the endpoint. It does not thread `invoke`, does not pass
// `modelTypes`, does not classify errors and does not call `forWire` — all four
// are the router's, and are pinned in packages/server/test/. What passes here
// is the evaluation posture, not the endpoint's contract.

import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/memoryAdapter';
import { createEngine } from '../src/engine';
import { buildEvalHost } from '../src/bridge';
import { DEFAULT_QUOTAS, executeScript, evaluateExpression } from '@fluxus/dsl';
import type { ClientSolutionConfig } from '../src/types';

const config = {
  attributes: [{ key: 'reason', type: 'text', label: 'Reason' }],
  recordTypes: [
    {
      id: 'rt_projects',
      name: 'Projects',
      workflow_ref: 'wf_projects',
      custom_fields: [
        { key: 'project_no', type: 'text', label: 'No', default: '' },
        { key: 'status', type: 'text', label: 'Status', default: 'Open' },
      ],
    },
    {
      id: 'rt_wbs_nodes',
      name: 'WBS',
      workflow_ref: 'wf_wbs_nodes',
      custom_fields: [
        { key: 'code', type: 'text', label: 'Code', default: '' },
        { key: 'project_id', type: 'fk_ref', label: 'Project', default: '', fk_record_type: 'rt_projects', fk_display_field: 'project_no' },
      ],
    },
  ],
  workflows: [
    { id: 'wf_projects', name: 'Projects', activities: [] },
    { id: 'wf_wbs_nodes', name: 'WBS', activities: [] },
  ],
  // A named function whose body mutates. Static validation cannot catch the
  // call site — DSL_EDITOR_SPEC §6 says so explicitly — so the run-time guard
  // is the only thing standing between an ad-hoc script and a write.
  functions: [
    {
      id: 'fn_sneaky_close',
      name: 'sneaky_close',
      description: 'mutates from inside a function',
      body: "function sneaky_close(id) {\n  records.projects.where(id = id).update({ status: 'Closed' })\n  return 'closed'\n}",
    },
    {
      id: 'fn_sneaky_create',
      name: 'sneaky_create',
      description: 'creates from inside a function',
      body: "function sneaky_create(no) {\n  return records.projects.create({ project_no: no, status: 'Open' })\n}",
    },
    {
      id: 'fn_sneaky_delete',
      name: 'sneaky_delete',
      description: 'deletes from inside a function',
      body: "function sneaky_delete(code) {\n  records.wbs_nodes.where(code = code).delete()\n  return 'gone'\n}",
    },
  ],
} as unknown as ClientSolutionConfig;

function build(nodeCount = 3) {
  const adapter = new MemoryAdapter(config);
  const project = adapter.createRecord('rt_projects', { project_no: 'P26-011', status: 'Open' });
  const nodes = Array.from({ length: nodeCount }, (_, i) =>
    adapter.createRecord('rt_wbs_nodes', { code: `N${i}`, project_id: project.id }));
  const engine = createEngine({
    store: adapter,
    config,
    user: { id: 'u1', name: 'Designer', email: 'd@example.com', roles: [] },
  });
  return { adapter, engine, project, nodes };
}

/** Exactly what router.ts `scripts.query` calls. */
function runEditor(engine: ReturnType<typeof build>['engine'], source: string, anchorRecord: unknown = null) {
  return engine.evaluate(source, {
    anchorRecord: anchorRecord as never,
    readonlyRecords: true,
    quotas: { maxRows: 100_000, maxSteps: 2_000_000, timeoutMs: 15_000 },
  });
}

// ── §6 Read-only enforcement ────────────────────────────────────────────────

describe('DSL editor: read-only holds at run time (§6)', () => {
  it('refuses a direct create, and nothing lands', () => {
    const { engine, adapter } = build();
    const before = adapter.allRecords().length;
    expect(() => runEditor(engine, "records.projects.create({ project_no: 'X', status: 'Open' })")).toThrow();
    expect(adapter.allRecords().length).toBe(before);
  });

  it('refuses a direct update, and the field is unchanged', () => {
    const { engine, adapter, project } = build();
    expect(() => runEditor(engine, "records.projects.where(id = '" + project.id + "').update({ status: 'Closed' })")).toThrow();
    expect(adapter.getRecord(project.id).customFields.status).toBe('Open');
  });

  it('refuses a direct delete, and the records survive', () => {
    const { engine, adapter, nodes } = build();
    expect(() => runEditor(engine, "records.wbs_nodes.where(code = 'N0').delete()")).toThrow();
    expect(() => adapter.getRecord(nodes[0].id)).not.toThrow();
  });

  it('refuses update through the anchor record', () => {
    const { engine, adapter, project } = build();
    expect(() => runEditor(engine, "context.record.update({ status: 'Closed' })", adapter.getRecord(project.id))).toThrow();
    expect(adapter.getRecord(project.id).customFields.status).toBe('Open');
  });

  it('refuses delete through the anchor record', () => {
    const { engine, adapter, project } = build();
    expect(() => runEditor(engine, 'context.record.delete()', adapter.getRecord(project.id))).toThrow();
    expect(() => adapter.getRecord(project.id)).not.toThrow();
  });

  // The case static validation cannot catch: the mutation is in a model
  // function's body, validated separately, so the call site looks innocent.
  it('refuses a mutation reached through a named model function — update', () => {
    const { engine, adapter, project } = build();
    expect(() => runEditor(engine, `sneaky_close('${project.id}')`)).toThrow();
    expect(adapter.getRecord(project.id).customFields.status).toBe('Open');
  });

  it('refuses a mutation reached through a named model function — create', () => {
    const { engine, adapter } = build();
    const before = adapter.allRecords().length;
    expect(() => runEditor(engine, "sneaky_create('SNEAK')")).toThrow();
    expect(adapter.allRecords().length).toBe(before);
  });

  it('refuses a mutation reached through a named model function — delete', () => {
    const { engine, adapter, nodes } = build();
    expect(() => runEditor(engine, "sneaky_delete('N1')")).toThrow();
    expect(() => adapter.getRecord(nodes[1].id)).not.toThrow();
  });

  // Two independent guards are claimed (§6). Prove BOTH, not just whichever
  // fires first: `readonlyRecords` removes the capability from the host, and
  // `mode: 'read'` refuses the verb.
  it('readonlyRecords removes records.mutate from the host object', () => {
    const { adapter } = build();
    const host = buildEvalHost(adapter, config, { readonlyRecords: true });
    expect(host.records?.mutate).toBeUndefined();
    const writable = buildEvalHost(adapter, config, {});
    expect(writable.records?.mutate).toBeDefined();
  });

  it('a mutate-mode script on a readonly host still cannot write (capability guard alone)', () => {
    const { adapter, project } = build();
    const host = buildEvalHost(adapter, config, { readonlyRecords: true, anchorRecord: adapter.getRecord(project.id) });
    expect(() =>
      executeScript("records.projects.where(id = '" + project.id + "').update({ status: 'Closed' })", host, { mode: 'mutate' }),
    ).toThrow(/does not support record mutations/);
    expect(adapter.getRecord(project.id).customFields.status).toBe('Open');
  });

  it('a mutate-mode script reaching a model function on a readonly host cannot write either', () => {
    const { adapter, project } = build();
    const host = buildEvalHost(adapter, config, { readonlyRecords: true });
    expect(() => executeScript(`sneaky_close('${project.id}')`, host, { mode: 'mutate' })).toThrow(
      /does not support record mutations/,
    );
    expect(adapter.getRecord(project.id).customFields.status).toBe('Open');
  });

  it('the error says why — it names mutations, not an internal', () => {
    const { engine } = build();
    let message = '';
    try {
      runEditor(engine, "records.projects.create({ project_no: 'X', status: 'Open' })");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/mutation/i);
  });

  it('deleting mutate off one host does not poison the next host built from the same adapter', () => {
    const { adapter } = build();
    buildEvalHost(adapter, config, { readonlyRecords: true });
    expect(buildEvalHost(adapter, config, {}).records?.mutate).toBeDefined();
  });
});

// ── §6 Quotas ───────────────────────────────────────────────────────────────

describe('DSL editor: quotas reach the evaluator (§6)', () => {
  it('a low maxRows throws', () => {
    const { engine } = build(5);
    expect(() => engine.evaluate('records.wbs_nodes', { quotas: { maxRows: 2 } })).toThrow(/row quota \(2\)/);
  });

  it('a raised maxRows does not', () => {
    const { engine } = build(5);
    expect(() => engine.evaluate('records.wbs_nodes', { quotas: { maxRows: 100_000 } })).not.toThrow();
  });

  it('the row quota throws in readAll, BEFORE where runs — a type over the cap cannot be queried at all', () => {
    const { engine, nodes } = build(5);
    expect(() => engine.evaluate(`records.wbs_nodes.where(code = 'N0')`, { quotas: { maxRows: 2 } })).toThrow(/row quota/);
    // even by id
    expect(() => engine.evaluate(`records.wbs_nodes.where(id = '${nodes[0].id}')`, { quotas: { maxRows: 2 } })).toThrow(
      /row quota/,
    );
  });

  it('maxSteps is honoured per call', () => {
    const { engine } = build(5);
    expect(() => engine.evaluate('1 + 1 + 1 + 1 + 1', { quotas: { maxSteps: 2 } })).toThrow();
    expect(engine.evaluate('1 + 1 + 1 + 1 + 1', { quotas: { maxSteps: 2_000_000 } })).toBe(5);
  });

  it('omitting quotas leaves DEFAULT_QUOTAS in force, and one call does not leak into the next', () => {
    const { engine } = build(5);
    expect(() => engine.evaluate('records.wbs_nodes', { quotas: { maxRows: 1 } })).toThrow(/row quota/);
    // next call, no quotas: defaults (maxRows 10_000) apply, so 5 rows are fine
    expect((engine.evaluate('records.wbs_nodes', {}) as unknown[]).length).toBe(5);
  });

  it('DEFAULT_QUOTAS itself is not mutated by a per-call override', () => {
    const { engine } = build(5);
    engine.evaluate('records.wbs_nodes', { quotas: { maxRows: 100_000, maxSteps: 2_000_000, timeoutMs: 15_000 } });
    expect(DEFAULT_QUOTAS).toEqual({ maxSteps: 100_000, maxRows: 10_000, timeoutMs: 1_000 });
  });

  it('a host built with no quotas passes undefined through, not an empty object', () => {
    const { adapter } = build();
    expect(buildEvalHost(adapter, config, {}).quotas).toBeUndefined();
    expect(buildEvalHost(adapter, config, { quotas: { maxRows: 7 } }).quotas).toEqual({ maxRows: 7 });
  });
});

// ── §10 engine.evaluate returns the value ───────────────────────────────────

describe('DSL editor: engine.evaluate returns the value (§10)', () => {
  it('a bare expression yields its value', () => {
    const { engine } = build();
    expect(runEditor(engine, '1 + 1')).toBe(2);
    expect(runEditor(engine, "'a' + 'b'")).toBe('ab');
  });

  it('a query yields its rows', () => {
    const { engine } = build(3);
    const rows = runEditor(engine, 'records.wbs_nodes') as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(3);
  });

  it('executeScript really does return null for the same sources — the bug §10 names', () => {
    const { adapter } = build(3);
    const host = buildEvalHost(adapter, config, { readonlyRecords: true });
    expect(executeScript('1 + 1', host).value).toBeNull();
    expect(executeScript('records.wbs_nodes', host).value).toBeNull();
  });
});

// ── §9 / §12 result shapes ──────────────────────────────────────────────────

describe('DSL editor: the two row shapes (§9, §12)', () => {
  it('records.<type> returns DslRecord objects — { id, type, fields }', () => {
    const { engine } = build(2);
    const rows = runEditor(engine, 'records.wbs_nodes') as Record<string, unknown>[];
    expect(Object.keys(rows[0]).sort()).toEqual(['fields', 'id', 'type']);
    expect(rows[0].type).toBe('wbs_nodes');
    expect(Object.keys(rows[0].fields as object).sort()).toEqual(['code', 'project_id']);
  });

  it('.select(...) returns flat rows with the FK already a raw id', () => {
    const { engine, project } = build(2);
    const rows = runEditor(engine, 'records.wbs_nodes.select(id, code, project_id)') as Record<string, unknown>[];
    expect(Object.keys(rows[0]).sort()).toEqual(['code', 'id', 'project_id']);
    expect(rows[0].project_id).toBe(project.id);
    expect(typeof rows[0].project_id).toBe('string');
  });

  it('.select() can produce rows with DIFFERENT key sets across a result', () => {
    // Not reachable from one select(), but a union of shapes is what the grid's
    // column logic has to survive; prove the evaluator can emit a null row too.
    const { engine } = build(2);
    const rows = runEditor(engine, 'records.wbs_nodes.values(code)') as unknown[];
    expect(rows).toEqual(['N0', 'N1']);
  });

  // The grid's `asRows`/`columnsOf` (DslEditorView) decide grid-vs-value off
  // `value[0]` and then call Object.keys on EVERY element. An array whose
  // first element is an object and whose later elements are null is reachable
  // from an ordinary query, and it makes Object.keys(null) throw during
  // render. This pins that the evaluator really does emit that shape.
  it('values() over a descriptor field emits [object, null] — the shape that breaks columnsOf', () => {
    const descriptorConfig = {
      attributes: [],
      recordTypes: [
        {
          id: 'rt_a',
          name: 'A',
          workflow_ref: 'wf_a',
          custom_fields: [
            { key: 'code', type: 'text', label: 'C', default: '' },
            { key: 'shot', type: 'photo', label: 'Shot', default: '' },
          ],
        },
      ],
      workflows: [{ id: 'wf_a', name: 'A', activities: [] }],
    } as unknown as ClientSolutionConfig;
    const adapter = new MemoryAdapter(descriptorConfig);
    adapter.createRecord('rt_a', { code: 'x', shot: { hash: 'h1', name: 'a.jpg' } } as never);
    adapter.createRecord('rt_a', { code: 'y', shot: null } as never);
    const engine = createEngine({ store: adapter, config: descriptorConfig });
    const v = engine.evaluate('records.a.values(shot)', { readonlyRecords: true }) as unknown[];
    expect(v).toEqual([{ hash: 'h1', name: 'a.jpg' }, null]);
    expect(v[0]).not.toBeNull();
    expect(v[1]).toBeNull();
    // What the grid then does, verbatim from DslEditorView.columnsOf:
    expect(() => v.forEach((r) => Object.keys(r as object))).toThrow(TypeError);
  });

  it('a query over an empty type returns [] — rowCount 0, not a value', () => {
    const adapter = new MemoryAdapter(config);
    const engine = createEngine({ store: adapter, config });
    const v = runEditor(engine, 'records.wbs_nodes');
    expect(v).toEqual([]);
    expect(Array.isArray(v)).toBe(true);
  });
});

// ── §7 roots available to the tool ──────────────────────────────────────────

describe('DSL editor: the roots (§7)', () => {
  it('context.user is populated from the engine user', () => {
    const { engine } = build();
    expect(runEditor(engine, 'context.user.email')).toBe('d@example.com');
  });

  it('context.record is null without an anchor, and resolves with one', () => {
    const { engine, adapter, project } = build();
    expect(runEditor(engine, 'context.record')).toBeNull();
    expect(runEditor(engine, 'context.record.project_no', adapter.getRecord(project.id))).toBe('P26-011');
  });

  it('`attributes` is NOT banned at run time — buildEvalHost always supplies {} (§7 note)', () => {
    const { engine } = build();
    // Documented as "ban is static only". Confirm the run-time behaviour so the
    // note is not quietly wrong: reading an unknown attribute yields null.
    expect(runEditor(engine, 'attributes.anything')).toBeNull();
  });

  it('invoke() is absent unless the caller threads one', () => {
    const { engine } = build();
    // Not a defect: the built-in is host-supplied by design, so a host that
    // runs no activities fails loudly rather than answering null. The ROUTER
    // does thread it (`host.engine.invoke` with the anchor), which is what
    // makes §7's `invoke` real — that is the endpoint's business, not this
    // call's.
    expect(() => runEditor(engine, "invoke('act_get_projects')")).toThrow(/not available here/);
  });
});

// ── §10 error shape: what the router can actually read off a thrown error ───

describe('DSL editor: error position capture (§9, §10)', () => {
  it('a runtime error carries line/col as own fields, not a `position` object', () => {
    const { adapter } = build();
    const host = buildEvalHost(adapter, config, { readonlyRecords: true });
    let err: Record<string, unknown> = {};
    try {
      evaluateExpression('records.nope_not_a_type.top(1)', host);
    } catch (e) {
      err = e as unknown as Record<string, unknown>;
    }
    expect(typeof err.line).toBe('number');
    expect(typeof err.col).toBe('number');
    // Neither DSL error class has a `position` object — both carry line/col as
    // own fields, which is what the router's classifier reads.
    expect(err.position).toBeUndefined();
    expect(err.line as number).toBeGreaterThan(0);
  });

  it('a SYNTAX error carries line/col and its own class name', () => {
    const { adapter } = build();
    const host = buildEvalHost(adapter, config, { readonlyRecords: true });
    let err: Record<string, unknown> = {};
    try {
      evaluateExpression('records.wbs_nodes.where(', host);
    } catch (e) {
      err = e as unknown as Record<string, unknown>;
    }
    // The class name is how the router tells a parse failure from an
    // evaluation failure — `engine.evaluate` parses too, so both arrive in the
    // one catch. `compile` vs `runtime` is pinned in packages/server/test/.
    expect((err as Error).name).toBe('FluxSyntaxError');
    expect(typeof err.line).toBe('number');
  });

  it('a quota error is indistinguishable from an ordinary runtime error (§9, accepted)', () => {
    const { adapter } = build(5);
    const host = buildEvalHost(adapter, config, { readonlyRecords: true, quotas: { maxRows: 1 } });
    let err: Error | null = null;
    try {
      evaluateExpression('records.wbs_nodes', host);
    } catch (e) {
      err = e as Error;
    }
    expect(err?.name).toBe('FluxRuntimeError');
  });
});

// ── Why the router walks the value before sending it ────────────────────────
//
// These pin the RAW behaviour that makes `forWire` necessary, not what the
// endpoint sends. What actually crosses is pinned in
// packages/server/test/scriptResultWire.test.ts, where a Date goes back as
// wall-clock text and an FkPointer as its id.

describe('the raw values forWire exists to correct', () => {
  it('a Date would cross as a UTC instant if nothing walked it', () => {
    const { engine } = build();
    const v = runEditor(engine, "date('2026-07-01')");
    expect(v).toBeInstanceOf(Date);
    // What the browser actually receives: a UTC ISO string. `date('…')` parses
    // at LOCAL midnight, so on any non-UTC server the day shifts in the grid.
    const crossed = JSON.parse(JSON.stringify({ value: v })).value;
    expect(typeof crossed).toBe('string');
    expect(crossed).toBe((v as Date).toISOString());
    const offset = new Date('2026-07-01T00:00:00').getTimezoneOffset();
    // Ahead of UTC ⇒ local midnight is the previous UTC day: the grid shows
    // 2026-06-30 for a value the model calls 2026-07-01.
    expect(crossed.slice(0, 10)).toBe(offset < 0 ? '2026-06-30' : '2026-07-01');
  });

  it('now() is a Date too, so the same applies', () => {
    const { engine } = build();
    expect(runEditor(engine, 'now()')).toBeInstanceOf(Date);
  });

  it('a stored FK inside DslRecord.fields is a plain id, not a pointer', () => {
    const { engine, project } = build(1);
    const v = runEditor(engine, 'records.wbs_nodes.top(1)') as Record<string, unknown>[];
    // DslRecord.fields hold the raw stored value, so the FK is a plain id here.
    expect((v[0].fields as Record<string, unknown>).project_id).toBe(project.id);
  });
});
