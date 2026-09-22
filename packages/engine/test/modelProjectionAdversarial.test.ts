// Adversarial tests for `model.*` (docs/QUERYING_THE_MODEL.md), written by a
// reviewer who did not build it. Failures here are findings, not fixes.

import { describe, it, expect } from 'vitest';
import { evaluateExpression, executeScript, validateExpression, type DslRecord } from '@fluxus/dsl';
import {
  buildDslSchema,
  buildEvalHost,
  modelSchemaTypes,
  modelRows,
  withModelTypes,
  MemoryAdapter,
  validateConfig,
} from '../src/index';
import { resolvedCaptureLists } from '../src/modelProjection';
import type { SolutionConfig } from '../src/types';

// ── Configs ─────────────────────────────────────────────────────────────────

/** One of everything, every optional ABSENT — the absent-key trap. */
const bare = {
  recordTypes: [
    {
      id: 'rt_widgets',
      name: 'Widgets',
      workflow_ref: 'wf_widgets',
      custom_fields: [{ key: 'code', type: 'text' }],
    },
    // A record type with no fields at all.
    { id: 'rt_empty', name: 'Empty', workflow_ref: 'wf_empty', custom_fields: [] },
  ],
  attributes: [{ key: 'note', type: 'text' }],
  workflows: [
    {
      id: 'wf_widgets',
      name: 'Widgets',
      activities: [{ id: 'act_do_widgets', name: 'Do', attributes: [{ attribute_ref: 'note' }] }],
    },
    { id: 'wf_empty', name: 'Empty', activities: [] },
  ],
  functions: [{ id: 'fn_x', name: 'x', body: 'function x() { return 1 }' }],
  access: { roles: [{ id: 'role_a', name: 'A' }] },
} as unknown as SolutionConfig;

function hostFor(config: SolutionConfig, opts: { mutate?: boolean } = {}) {
  const adapter = new MemoryAdapter(config, { initialRecords: [] });
  return buildEvalHost(
    adapter,
    config,
    { readonlyRecords: !opts.mutate, modelTypes: true },
    [],
  );
}

const runOn = (config: SolutionConfig, src: string) => evaluateExpression(src, hostFor(config));
const run = (src: string) => runOn(bare, src);

const rowsOf = (config: SolutionConfig) => {
  const adapter = new MemoryAdapter(config, { initialRecords: [] });
  return modelRows(config, { resolvedAttributes: resolvedCaptureLists(adapter) });
};

const COLLECTIONS = Object.keys(modelSchemaTypes());
const short = (t: string) => t.replace(/^sdm_/, '');

// ── 1. The absent-key trap, every collection, every column ──────────────────

describe('rule 1: every declared column is materialized on every row', () => {
  const rows = rowsOf(bare);

  it('covers every collection with at least one row, so the sweep means something', () => {
    for (const c of COLLECTIONS) {
      expect(rows.get(c)?.length ?? 0, `${c} has no rows in the bare config`).toBeGreaterThan(0);
    }
  });

  for (const c of COLLECTIONS) {
    const columns = Object.keys(modelSchemaTypes()[c].fields);
    it(`${c}: every declared column is an own key on every row`, () => {
      for (const row of rows.get(c) ?? []) {
        for (const col of columns) {
          expect(col in row.fields, `${c}.${col} missing on row ${row.id}`).toBe(true);
        }
      }
    });

    it(`${c}: every declared column is nameable inside where/select`, () => {
      for (const col of columns) {
        expect(
          () => run(`model.${short(c)}.where(${col} is null).select(v: ${col})`),
          `${c}.${col}`,
        ).not.toThrow();
      }
      // `id` too — it is not in the column list but every query uses it.
      expect(() => run(`model.${short(c)}.select(id)`)).not.toThrow();
    });
  }
});

// ── 2. Read-only, by every route ────────────────────────────────────────────

describe('the model is read-only whatever route reaches it', () => {
  const mutateHost = () => hostFor(bare, { mutate: true });

  const refuses = (src: string, mode: 'read' | 'mutate') => {
    const host = mode === 'mutate' ? mutateHost() : hostFor(bare);
    let caught: unknown = null;
    try {
      executeScript(src, host, { mode });
    } catch (e) {
      caught = e;
    }
    return caught;
  };

  for (const mode of ['read', 'mutate'] as const) {
    it(`${mode}: collection-level create/update/delete are refused as read-only`, () => {
      expect(String(refuses("model.record_types.create({ name: 'x' })", mode))).toMatch(/read-only/);
      expect(String(refuses("model.record_types.update({ name: 'x' })", mode))).toMatch(/read-only/);
      expect(String(refuses('model.record_types.delete()', mode))).toMatch(/read-only/);
    });

    it(`${mode}: the chain terminal is refused as read-only`, () => {
      expect(String(refuses("model.record_types.where(id = 'rt_widgets').update({ name: 'x' })", mode))).toMatch(/read-only/);
      expect(String(refuses("model.record_types.where(id = 'rt_widgets').delete()", mode))).toMatch(/read-only/);
    });

    it(`${mode}: a single model row is blocked somehow`, () => {
      expect(refuses("model.record_types.first.update({ name: 'x' })", mode)).not.toBe(null);
      expect(refuses('model.record_types.first.delete()', mode)).not.toBe(null);
    });
  }

  it('a single model row cannot be DELETED — the guard is in deleteRecord', () => {
    const host = mutateHost();
    expect(() => executeScript('model.record_types.first.delete()', host, { mode: 'mutate' })).toThrow(/read-only/);
  });

  it('a single model row cannot be UPDATED — same rule, same message', () => {
    // FINDING: updateRecord has no MODEL_PREFIX guard (deleteRecord does), so
    // this falls through to the store and answers "Record not found:
    // rt_widgets" — exactly the confusing answer evaluator.ts:733-738 says the
    // row-level guard exists to prevent.
    const host = mutateHost();
    expect(() => executeScript("model.record_types.first.update({ name: 'x' })", host, { mode: 'mutate' })).toThrow(
      /read-only/,
    );
  });

  it('a model row reached through an FK dereference cannot be updated', () => {
    const host = mutateHost();
    expect(() =>
      executeScript("model.fields.where(key = 'code').first.record_type_ref.update({ name: 'x' })", host, {
        mode: 'mutate',
      }),
    ).toThrow(/read-only/);
  });

  it('the prefixed type is not a back door through `records.`', () => {
    // §3: "The `sdm_` prefix never appears in a script." FINDING: with
    // modelTypes on, `hasType` answers true for the prefixed name, so the
    // model is readable through `records.` as well.
    expect(() => run('records.sdm_record_types.count')).toThrow(/is a model collection — reach it as model\./);
  });

  it('a create through the prefixed name is refused as read-only, not as unknown', () => {
    // FINDING: the collection-level guard tests `inner.prefix !== ''`, so the
    // `records.` spelling misses it and fails with "Unknown record type
    // 'sdm_record_types'" out of the store instead.
    const adapter = new MemoryAdapter(bare, { initialRecords: [] });
    const host = buildEvalHost(adapter, bare, { modelTypes: true }, []);
    expect(() => executeScript("records.sdm_record_types.create({ name: 'x' })", host, { mode: 'mutate' })).toThrow(
      /read-only/,
    );
  });

  it('a writable host still refuses the model while ordinary records write fine', () => {
    const adapter = new MemoryAdapter(bare, { initialRecords: [] });
    const host = buildEvalHost(adapter, bare, { modelTypes: true }, []);
    const ok = executeScript("records.widgets.create({ code: 'A' })", host, { mode: 'mutate' });
    expect(ok.warnings).toEqual([]);
    expect(adapter.allRecords().length).toBe(1);
  });
});

describe('a hook cannot reach the model at all', () => {
  it('a hook host has no model collections', () => {
    const adapter = new MemoryAdapter(bare, { initialRecords: [] });
    const hookHost = buildEvalHost(adapter, bare, {}, []); // no modelTypes — every hook
    expect(() => executeScript('model.record_types.count', hookHost, { mode: 'mutate' })).toThrow();
  });

  it('a hook naming the model is refused at config-save validation', () => {
    const withHook = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (withHook.workflows[0] as { activities: { before_hook?: string }[] }).activities[0].before_hook =
      'if model.record_types.count > 0 { fail(\'no\') }';
    const findings = validateConfig(withHook).filter((f) => f.diagnostic.severity === 'error');
    expect(findings.length).toBeGreaterThan(0);
  });
});

// ── 3. Opt-in, and the two failures being different ─────────────────────────

describe('opt-in fails cleanly, and differently, on each side', () => {
  it('a host without modelTypes fails at run time', () => {
    const adapter = new MemoryAdapter(bare, { initialRecords: [] });
    const plain = buildEvalHost(adapter, bare, { readonlyRecords: true }, []);
    expect(() => evaluateExpression('model.record_types.count', plain)).toThrow(/not available here/);
  });

  it('a schema without the model types fails at validation', () => {
    const dataOnly = { types: buildDslSchema(bare).types };
    const errs = validateExpression('model.record_types.count', dataOnly, {}).filter((d) => d.severity === 'error');
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toMatch(/not available at this embedding point/);
  });

  it('a host with no records root at all still fails, not silently', () => {
    expect(() => evaluateExpression('model.record_types.count', {})).toThrow();
  });
});

// ── 4. Derived and synthesised columns ──────────────────────────────────────

describe('derived columns', () => {
  it('query_name is the pasteable name, and records.<query_name> actually resolves', () => {
    const names = run('model.record_types.select(query_name)') as Record<string, unknown>[];
    expect(names).toEqual([{ query_name: 'widgets' }, { query_name: 'empty' }]);
    expect(() => run('records.widgets.count')).not.toThrow();
  });

  it('synthesised ids are unique per collection', () => {
    const rows = rowsOf(bare);
    for (const c of COLLECTIONS) {
      const ids = (rows.get(c) ?? []).map((r) => r.id);
      expect(new Set(ids).size, `${c} has duplicate ids`).toBe(ids.length);
    }
  });

  it('record_type_ref is null when no record type points at the workflow', () => {
    const orphan = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (orphan.workflows as { id: string; name: string; activities: unknown[] }[]).push({
      id: 'wf_orphan',
      name: 'Orphan',
      activities: [{ id: 'act_do_orphans', name: 'Do', attributes: [{ attribute_ref: 'note' }] }],
    });
    const row = runOn(orphan, "model.activities.where(id = 'act_do_orphans').select(record_type_ref).first");
    expect(row).toEqual({ record_type_ref: null });
  });

  it('an orphan workflow\'s activity still has its capture list projected', () => {
    // §5: "One row per entry in an activity's ordered capture list."
    const orphan = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (orphan.workflows as { id: string; name: string; activities: unknown[] }[]).push({
      id: 'wf_orphan',
      name: 'Orphan',
      activities: [{ id: 'act_do_orphans', name: 'Do', attributes: [{ attribute_ref: 'note' }] }],
    });
    const rows = runOn(orphan, "model.activity_attributes.where(activity_ref = 'act_do_orphans').select(key)");
    expect(rows).toEqual([{ key: 'note' }]);
  });

  it('record_type_ref is the first by config order when two types share a workflow', () => {
    const shared = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (shared.recordTypes as unknown[]).push({
      id: 'rt_gadgets',
      name: 'Gadgets',
      workflow_ref: 'wf_widgets',
      custom_fields: [],
    });
    const row = runOn(shared, "model.activities.where(id = 'act_do_widgets').select(record_type_ref).first");
    expect(row).toEqual({ record_type_ref: 'rt_widgets' });
  });

  it('params is null when the body does not parse, [] when it takes none', () => {
    const fns = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (fns as { functions: unknown[] }).functions = [
      { id: 'fn_none', name: 'none', body: 'function none() { return 1 }' },
      { id: 'fn_bad', name: 'bad', body: 'this is not a function at all' },
      { id: 'fn_empty', name: 'empty', body: '' },
      { id: 'fn_two', name: 'two', body: 'function two(a, b) { return a }' },
    ];
    const rows = runOn(fns, 'model.functions.select(id, params)') as Record<string, unknown>[];
    expect(rows).toEqual([
      { id: 'fn_none', params: '[]' },
      { id: 'fn_bad', params: null },
      { id: 'fn_empty', params: null },
      { id: 'fn_two', params: '["a","b"]' },
    ]);
  });

  it('params survives a body the DSL itself accepts — line array, leading comment', () => {
    const fns = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (fns as { functions: unknown[] }).functions = [
      { id: 'fn_lines', name: 'lines', body: ['function lines(a, b) {', '  return a', '}'] },
      { id: 'fn_comment', name: 'commented', body: '// adds up\nfunction commented(a) { return a }' },
    ];
    const rows = runOn(fns, 'model.functions.select(id, params)') as Record<string, unknown>[];
    expect(rows).toEqual([
      { id: 'fn_lines', params: '["a","b"]' },
      { id: 'fn_comment', params: '["a"]' },
    ]);
  });
});

describe('label fallback matches the one the UI uses', () => {
  it('an empty-string label falls back to the key, as fieldLabel does', () => {
    // §5: "`label` falls back to the key when absent, as `fieldLabel` already
    // does." fieldLabel is `label?.trim() || key`; the projection is
    // `label ?? key`, so a blank label projects blank while every UI surface
    // shows the key.
    const c = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (c.recordTypes[0] as { custom_fields: { label?: string }[] }).custom_fields[0].label = '   ';
    expect(runOn(c, "model.fields.where(key = 'code').select(label).first")).toEqual({ label: 'code' });
  });
});

describe('inherited resolution behaviour, pinned', () => {
  const withUsage = (usage: Record<string, unknown>, pool: Record<string, unknown>) => {
    const c = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (c as { attributes: unknown[] }).attributes = [{ key: 'note', type: 'text', ...pool }];
    (c.workflows[0] as { activities: { attributes: unknown[] }[] }).activities[0].attributes = [
      { attribute_ref: 'note', ...usage },
    ];
    return c;
  };

  it('a usage with NO overrides reports the pool\'s required', () => {
    const c = withUsage({}, { required: true });
    expect(runOn(c, 'model.activity_attributes.select(required).first')).toEqual({ required: true });
  });

  it('a usage with ANY other override drops the pool\'s required to false', () => {
    // Pinned, not endorsed: MemoryAdapter's merge sets `required: usage.required`
    // outright, so an unrelated override silently clears it. The projection is
    // faithful to the adapter; the model therefore reports `false` for an
    // attribute the form treats as optional too. Pre-existing (engine SPEC),
    // now visible as model data.
    const c = withUsage({ show_condition: '1 = 1' }, { required: true });
    expect(runOn(c, 'model.activity_attributes.select(required).first')).toEqual({ required: false });
  });
});

describe('what the chain can and cannot do over the model', () => {
  it('orderBy, values and top all work', () => {
    expect(runOn(bare, 'model.record_types.orderBy(query_name).select(query_name)')).toEqual([
      { query_name: 'empty' },
      { query_name: 'widgets' },
    ]);
    expect(runOn(bare, 'model.record_types.values(query_name)')).toEqual(['widgets', 'empty']);
    expect((runOn(bare, 'model.fields.top(1)') as unknown[]).length).toBe(1);
  });

  it('reverse navigation is not available on model rows — only the forward FK', () => {
    // Pinned limitation: withModelTypes returns null from reverseRef for every
    // model type, so workflow → activities has to be written as a filter.
    expect(() => run('model.workflows.first.activities')).toThrow(/has no field/);
    expect(
      runOn(bare, "model.activities.where(workflow_ref = 'wf_widgets').count"),
    ).toBe(1);
  });
});

// ── 5. Section markers ──────────────────────────────────────────────────────

describe('capture lists: markers, interleaving, emptiness', () => {
  const withList = (entries: unknown[]) => {
    const c = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (c.workflows[0] as { activities: { attributes: unknown[] }[] }).activities[0].attributes = entries;
    return c;
  };

  it('an activity whose list is only markers still queries', () => {
    const c = withList([{ section: 'One' }, { section: 'Two' }]);
    const rows = runOn(c, 'model.activity_attributes.select(position, kind, label)');
    expect(rows).toEqual([
      { position: 0, kind: 'section', label: 'One' },
      { position: 1, kind: 'section', label: 'Two' },
    ]);
  });

  it('markers interleaved keep position and kind straight', () => {
    const c = withList([
      { attribute_ref: 'note' },
      { section: 'Middle' },
      { attribute_ref: 'note' },
    ]);
    const rows = runOn(c, 'model.activity_attributes.select(position, kind, key)') as Record<string, unknown>[];
    expect(rows.map((r) => [r.position, r.kind])).toEqual([
      [0, 'attribute'],
      [1, 'section'],
      [2, 'attribute'],
    ]);
    expect(rows[1].key).toMatch(/^_section_/);
  });

  it('an activity with an empty capture list contributes no rows and breaks nothing', () => {
    const c = withList([]);
    expect(runOn(c, 'model.activity_attributes.count')).toBe(0);
    expect(runOn(c, "model.activity_attributes.where(kind = 'attribute').count")).toBe(0);
  });
});

// ── 6. Edge configs ─────────────────────────────────────────────────────────

describe('edge configs', () => {
  const strip = (keys: string[]) => {
    const c = JSON.parse(JSON.stringify(bare)) as Record<string, unknown>;
    for (const k of keys) delete c[k];
    return c as unknown as SolutionConfig;
  };

  it('no functions key at all', () => {
    expect(runOn(strip(['functions']), 'model.functions.count')).toBe(0);
  });

  it('no access key at all — indistinguishable from empty roles, as §5 says', () => {
    const absent = strip(['access']);
    const empty = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (empty as { access: unknown }).access = { roles: [] };
    expect(runOn(absent, 'model.roles.count')).toBe(0);
    expect(runOn(empty, 'model.roles.count')).toBe(0);
  });

  it('a record type with no fields contributes nothing and breaks nothing', () => {
    expect(runOn(bare, "model.fields.where(record_type_ref = 'rt_empty').count")).toBe(0);
  });

  it('a solution with no workflows at all', () => {
    const c = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (c as { workflows: unknown[] }).workflows = [];
    (c as { recordTypes: unknown[] }).recordTypes = [];
    expect(runOn(c, 'model.workflows.count')).toBe(0);
    expect(runOn(c, 'model.activities.count')).toBe(0);
    expect(runOn(c, 'model.activity_attributes.count')).toBe(0);
  });

  it('a composite attribute projects its sub-attributes and not a null', () => {
    const c = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (c as { attributes: unknown[] }).attributes = [
      { key: 'note', type: 'text' },
      {
        key: 'permit',
        label: 'Permit',
        type: 'composite',
        type_config: { attributes: [{ attribute_ref: 'note' }] },
      },
    ];
    const row = runOn(c, "model.attributes.where(key = 'permit').select(sub_attributes, config).first") as Record<string, unknown>;
    expect(row.sub_attributes).toBe('[{"attribute_ref":"note"}]');
    expect(row.config).toBe('{"attributes":[{"attribute_ref":"note"}]}');
  });

  it('max_size_mb never reaches a projected config', () => {
    const c = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (c as { attributes: unknown[] }).attributes = [
      { key: 'note', type: 'text' },
      { key: 'photo', type: 'photo', type_config: { max_size_mb: 12, multi: true } },
    ];
    const row = runOn(c, "model.attributes.where(key = 'photo').select(config).first") as Record<string, unknown>;
    expect(String(row.config)).not.toMatch(/max_size_mb/);
    expect(row.config).toBe('{"multi":true}');
  });

  it('a record type whose stripped name starts with sdm_ is refused at save', () => {
    const c = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (c.recordTypes[0] as { id: string }).id = 'rt_sdm_record_types';
    (c.workflows[0] as { id: string }).id = 'wf_widgets';
    const findings = validateConfig(c);
    expect(findings.some((f) => /sdm_/.test(f.diagnostic.message))).toBe(true);
  });
});

// ── 7. withModelTypes as a wrapper ──────────────────────────────────────────

describe('withModelTypes leaves the ordinary records host alone', () => {
  const baseHost = () => {
    const adapter = new MemoryAdapter(bare, { initialRecords: [] });
    return { adapter, host: buildEvalHost(adapter, bare, { modelTypes: true }, []).records! };
  };

  it('hasType still answers for ordinary types and refuses nonsense', () => {
    const { host } = baseHost();
    expect(host.hasType('widgets')).toBe(true);
    expect(host.hasType('nope')).toBe(false);
    expect(host.hasType('sdm_record_types')).toBe(true);
  });

  it('fkTarget still falls through for ordinary types', () => {
    const c = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (c.recordTypes[0] as { custom_fields: unknown[] }).custom_fields.push({
      key: 'owner_id',
      type: 'fk_ref',
      fk_record_type: 'rt_empty',
    });
    const adapter = new MemoryAdapter(c, { initialRecords: [] });
    const host = buildEvalHost(adapter, c, { modelTypes: true }, []).records!;
    expect(host.fkTarget('widgets', 'owner_id')).toBe('empty');
    expect(host.fkTarget('widgets', 'code')).toBe(null);
    expect(host.fkTarget('sdm_fields', 'record_type_ref')).toBe('sdm_record_types');
  });

  it('reverseRef still works for ordinary types', () => {
    const c = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (c.recordTypes[0] as { custom_fields: unknown[] }).custom_fields.push({
      key: 'owner_id',
      type: 'fk_ref',
      fk_record_type: 'rt_empty',
    });
    const adapter = new MemoryAdapter(c, { initialRecords: [] });
    const host = buildEvalHost(adapter, c, { modelTypes: true }, []).records!;
    expect(host.reverseRef('empty', 'widgets')).toEqual({ sourceType: 'widgets', field: 'owner_id' });
    expect(host.reverseRef('sdm_workflows', 'sdm_record_types')).toBe(null);
  });

  it('rows handed out are copies — a script cannot poison the projection', () => {
    const adapter = new MemoryAdapter(bare, { initialRecords: [] });
    const host = buildEvalHost(adapter, bare, { modelTypes: true }, []).records!;
    const first = host.getAll('sdm_record_types')[0] as DslRecord;
    first.fields.name = 'poisoned';
    expect(host.getAll('sdm_record_types')[0].fields.name).toBe('Widgets');
  });

  it('getById answers by the collection\'s own id', () => {
    const adapter = new MemoryAdapter(bare, { initialRecords: [] });
    const host = buildEvalHost(adapter, bare, { modelTypes: true }, []).records!;
    expect(host.getById('sdm_record_types', 'rt_widgets')?.fields.name).toBe('Widgets');
    expect(host.getById('sdm_record_types', 'nope')).toBe(null);
  });
});

// ── 8. A config the adapter cannot fully resolve ────────────────────────────

describe('a config with a dangling workflow reference', () => {
  const dangling = () => {
    const c = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (c.recordTypes[0] as { workflow_ref: string }).workflow_ref = 'wf_gone';
    return c;
  };

  it('builds a host without modelTypes', () => {
    const c = dangling();
    const adapter = new MemoryAdapter(c, { initialRecords: [] });
    expect(() => buildEvalHost(adapter, c, { readonlyRecords: true }, [])).not.toThrow();
  });

  // The server's save gate (host.ts validateConfigGraph) calls
  // getRecordTypeDef on every type, so this config cannot be written through
  // config.put today. It is still the difference between "the model query
  // answers nothing" and "every scripts.query call, records.* included, 500s".
  it('builds a host WITH modelTypes', () => {
    const c = dangling();
    const adapter = new MemoryAdapter(c, { initialRecords: [] });
    expect(() => buildEvalHost(adapter, c, { readonlyRecords: true, modelTypes: true }, [])).not.toThrow();
  });
});

// ── 9. §5's column lists, checked name by name ──────────────────────────────

describe('the spec\'s column lists', () => {
  const spec: Record<string, string[]> = {
    sdm_record_types: ['query_name', 'name', 'description', 'workflow_ref'],
    sdm_fields: [
      // `target` is the pasteable query name; `target_ref` is the stored id and
      // the one that dereferences (§5).
      'record_type_ref', 'key', 'label', 'type', 'target', 'target_ref',
      'target_display_field', 'required', 'unique', 'immutable', 'default',
    ],
    sdm_attributes: [
      'key', 'label', 'description', 'type', 'config', 'sub_attributes', 'source',
      'show_condition', 'required', 'validation', 'validation_message', 'can_waive',
    ],
    sdm_workflows: ['name', 'description'],
    sdm_activities: [
      'name', 'description', 'workflow_ref', 'record_type_ref', 'sort_order',
      'record_map', 'show_condition', 'before_hook', 'after_hook', 'returns',
    ],
    sdm_activity_attributes: [
      'activity_ref', 'position', 'kind', 'key', 'label', 'type', 'required',
      'source', 'show_condition', 'validation', 'validation_message', 'can_waive',
    ],
    sdm_functions: ['name', 'description', 'body', 'params'],
    sdm_roles: ['name', 'description'],
  };

  it('declares exactly the collections the spec lists', () => {
    expect(COLLECTIONS.sort()).toEqual(Object.keys(spec).sort());
  });

  for (const [type, columns] of Object.entries(spec)) {
    it(`${type} declares exactly the spec's columns`, () => {
      expect(Object.keys(modelSchemaTypes()[type].fields).sort()).toEqual([...columns].sort());
    });
  }

  it('the columns the spec says dereference, do', () => {
    const t = modelSchemaTypes();
    const fk = (type: string, col: string) =>
      (t[type].fields[col] as { fkTarget?: string }).fkTarget ?? null;
    expect(fk('sdm_record_types', 'workflow_ref')).toBe('sdm_workflows');
    expect(fk('sdm_fields', 'record_type_ref')).toBe('sdm_record_types');
    // §5: `target_ref` → `model.record_types`. `target` is the query name,
    // which the collection is not keyed by, so it deliberately does not.
    expect(fk('sdm_fields', 'target_ref')).toBe('sdm_record_types');
    expect(fk('sdm_fields', 'target')).toBeNull();
    expect(fk('sdm_activities', 'workflow_ref')).toBe('sdm_workflows');
    expect(fk('sdm_activities', 'record_type_ref')).toBe('sdm_record_types');
    expect(fk('sdm_activity_attributes', 'activity_ref')).toBe('sdm_activities');
  });

  it('access.read is not exposed anywhere', () => {
    const all = Object.values(modelSchemaTypes()).flatMap((t) => Object.keys(t.fields));
    expect(all).not.toContain('access');
    expect(all).not.toContain('read');
    expect(all).not.toContain('indexed');
  });
});

// ── 10. Root-name regressions from adding `model` to ROOTS ──────────────────

describe('adding `model` to ROOTS', () => {
  const schema = { types: { ...buildDslSchema(bare).types, ...modelSchemaTypes() } };
  const errs = (src: string) =>
    validateExpression(src, schema, {}).filter((d) => d.severity === 'error');

  it('does not break a record type that has a field called `model`', () => {
    const c = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    (c.recordTypes[0] as { custom_fields: unknown[] }).custom_fields.push({ key: 'model', type: 'text' });
    const s = { types: { ...buildDslSchema(c).types, ...modelSchemaTypes() } };
    const found = validateExpression("records.widgets.where(model = 'X').select(model)", s, {}).filter(
      (d) => d.severity === 'error',
    );
    expect(found).toEqual([]);
    // With a real row present, so the predicate actually evaluates — an empty
    // collection would never touch the bare name and the test would lie.
    const adapter = new MemoryAdapter(c, {
      initialRecords: [
        ['r1', { id: 'r1', typeRef: 'rt_widgets', customFields: { code: 'A', model: 'X' }, activityHistory: [] }],
      ],
    });
    const host = buildEvalHost(adapter, c, { readonlyRecords: true, modelTypes: true }, []);
    expect(evaluateExpression("records.widgets.where(model = 'X').count", host)).toBe(1);
    expect(evaluateExpression('records.widgets.select(model).first', host)).toEqual({ model: 'X' });
  });

  it('reports a script that used `model` as a variable name', () => {
    // Pre-existing scripts are the risk here: `let model = …` was legal before.
    expect(errs('let model = 1\nreturn model').length).toBeGreaterThan(0);
  });
});
