// Independent audit of `model.*` (docs/QUERYING_THE_MODEL.md).
//
// Written against the SPEC, not against the implementation: every assertion
// below quotes the clause it holds. A failure here is a finding, not a test to
// relax.

import { describe, it, expect } from 'vitest';
import { evaluateExpression, executeScript, validateExpression, type DslSchema } from '@fluxus/dsl';
import {
  buildDslSchema,
  buildEvalHost,
  buildRecordsHost,
  modelSchemaTypes,
  modelRows,
  withModelTypes,
  validateConfig,
  MemoryAdapter,
} from '../src/index';
// Not re-exported from the package index — imported from source so this file
// can build the projection the way bridge.ts does.
import { resolvedCaptureLists } from '../src/modelProjection';
import type { SolutionConfig } from '../src/types';

// ───────────────────────────────────────────────────────────────────────────
// Configs
// ───────────────────────────────────────────────────────────────────────────

/**
 * The bare-minimum config: every optional the spec names is ABSENT, not null.
 * This is the shape a hand-authored JSON model really has, and §4 rule 1 is
 * the rule it exists to break.
 */
const bare = {
  recordTypes: [
    {
      id: 'rt_widgets',
      name: 'Widgets',
      // no description
      workflow_ref: 'wf_widgets',
      custom_fields: [
        // no label, no required/unique/immutable, no default, no fk
        { key: 'serial', type: 'text' },
      ],
    },
  ],
  attributes: [
    // no label, no description, no type_config, no source/show_condition,
    // no required/validation/validation_message/can_waive
    { key: 'note', type: 'text' },
  ],
  workflows: [
    {
      id: 'wf_widgets',
      name: 'Widgets',
      // no description
      activities: [
        {
          id: 'act_log_widgets',
          name: 'Log Widget',
          // no description, no sort_order, no record_map, no show_condition,
          // no before_hook/after_hook/returns
          attributes: [{ attribute_ref: 'note' }],
        },
      ],
    },
  ],
  // no functions key at all, no access key at all
} as unknown as SolutionConfig;

/** A fuller config, for the derived/synthesised columns. */
const full = {
  recordTypes: [
    {
      id: 'rt_jobs',
      name: 'Jobs',
      description: 'Work to do',
      workflow_ref: 'wf_jobs',
      custom_fields: [
        { key: 'ref', label: 'Reference', type: 'text', required: true, unique: true, immutable: true, default: 'X' },
        { key: 'site_id', type: 'fk_ref', fk_record_type: 'rt_sites', fk_display_field: 'name' },
      ],
    },
    // Second type on the SAME workflow — §5's "two point at one workflow".
    { id: 'rt_jobs_archive', name: 'Archived Jobs', workflow_ref: 'wf_jobs', custom_fields: [] },
    { id: 'rt_sites', name: 'Sites', workflow_ref: 'wf_sites', custom_fields: [{ key: 'name', label: 'Name', type: 'text' }] },
  ],
  attributes: [
    { key: 'photo', label: 'Photo', type: 'file', type_config: { max_size_mb: 25, accept: 'image/*' } },
    { key: 'qty', label: 'Qty', type: 'number' },
    { key: 'line', label: 'Line', type: 'composite', type_config: { attributes: [{ attribute_ref: 'qty' }] } },
    { key: 'reason', label: 'Reason', type: 'text', source: "'auto'", show_condition: '1 = 1', required: true, validation: 'len(value) > 2', validation_message: 'too short', can_waive: true },
  ],
  workflows: [
    {
      id: 'wf_jobs',
      name: 'Jobs',
      description: 'The job flow',
      activities: [
        {
          id: 'act_create_jobs',
          name: 'Create Job',
          description: 'Opens one',
          sort_order: 10,
          record_map: 'CREATE',
          show_condition: '1 = 1',
          before_hook: ['let a = 1', 'let b = 2'],
          after_hook: null,
          returns: null,
          attributes: [{ section: 'Head' }, { attribute_ref: 'qty' }, { section: 'Tail' }, { attribute_ref: 'reason', required: true }],
        },
        // Only section markers.
        { id: 'act_markers_jobs', name: 'Markers', attributes: [{ section: 'One' }, { section: 'Two' }] },
        // Empty capture list.
        { id: 'act_empty_jobs', name: 'Empty', attributes: [] },
      ],
    },
    { id: 'wf_sites', name: 'Sites', activities: [] },
    // An ORPHAN workflow: no record type points at it (§5 "answers null").
    {
      id: 'wf_orphan',
      name: 'Orphan',
      activities: [{ id: 'act_orphan', name: 'Orphan Activity', attributes: [{ attribute_ref: 'qty' }] }],
    },
  ],
  functions: [
    { id: 'fn_ok', name: 'addup', description: 'd', body: 'function addup(a, b) { return a + b }' },
    { id: 'fn_none', name: 'nowt', description: 'd', body: 'function nowt() { return 1 }' },
    { id: 'fn_bad', name: 'broken', description: 'd', body: 'this is not a function at all' },
  ],
  access: { roles: [{ id: 'role_admins', name: 'Admins', description: 'The bosses' }, { id: 'role_crew', name: 'Crew' }] },
} as unknown as SolutionConfig;

function hostFor(config: SolutionConfig, opts: Record<string, unknown> = {}) {
  const adapter = new MemoryAdapter(config, { initialRecords: [] });
  return buildEvalHost(adapter, config, { readonlyRecords: true, modelTypes: true, ...opts }, []);
}

const runOn = (config: SolutionConfig, src: string) => evaluateExpression(src, hostFor(config));

const schemaFor = (config: SolutionConfig): DslSchema => ({
  ...buildDslSchema(config),
  types: { ...buildDslSchema(config).types, ...modelSchemaTypes() },
});

const errorsOn = (config: SolutionConfig, src: string) =>
  validateExpression(src, schemaFor(config), {}).filter((d) => d.severity === 'error');

const COLLECTIONS = [
  'record_types',
  'fields',
  'attributes',
  'workflows',
  'activities',
  'activity_attributes',
  'functions',
  'roles',
] as const;

// ───────────────────────────────────────────────────────────────────────────
// §4 rule 1 — the absent-key trap, every collection, nothing optional present
// ───────────────────────────────────────────────────────────────────────────

describe('§4 rule 1: every declared column is materialized, on a config with nothing optional set', () => {
  const types = modelSchemaTypes();

  it('the bare config actually produces a row in every collection it can', () => {
    // Without this the sweep below would pass vacuously on empty collections.
    const nonEmpty = COLLECTIONS.filter((c) => (runOn(bare, `model.${c}.count`) as number) > 0);
    expect(nonEmpty).toEqual([
      'record_types',
      'fields',
      'attributes',
      'workflows',
      'activities',
      'activity_attributes',
    ]);
  });

  for (const collection of COLLECTIONS) {
    const declared = Object.keys(types[`sdm_${collection}`].fields);

    it(`model.${collection}: every declared column is nameable inside where()`, () => {
      // The trap: a merely-absent key falls through to the outer scope and
      // raises "Unknown name '<x>'". where() is where it bites.
      const rowCount = runOn(bare, `model.${collection}.count`) as number;
      if (rowCount === 0) return;
      for (const col of declared) {
        expect(
          () => runOn(bare, `model.${collection}.where(${col} = null).count`),
          `where(${col} = null) on model.${collection}`,
        ).not.toThrow();
      }
    });

    it(`model.${collection}: every declared column is nameable inside select()`, () => {
      const rowCount = runOn(bare, `model.${collection}.count`) as number;
      if (rowCount === 0) return;
      for (const col of declared) {
        expect(
          () => runOn(bare, `model.${collection}.select(x: ${col})`),
          `select(${col}) on model.${collection}`,
        ).not.toThrow();
      }
    });

    it(`model.${collection}: every declared column is an OWN key of every projected row`, () => {
      const rows = modelRows(full, { resolvedAttributes: resolvedFor(full) }).get(`sdm_${collection}`)!;
      for (const row of rows) {
        for (const col of declared) {
          expect(Object.prototype.hasOwnProperty.call(row.fields, col), `${col} on ${row.id}`).toBe(true);
        }
      }
    });
  }
});

function resolvedFor(config: SolutionConfig) {
  return resolvedCaptureLists(new MemoryAdapter(config, { initialRecords: [] }));
}

// ───────────────────────────────────────────────────────────────────────────
// §5 — the spec's column lists, verbatim
// ───────────────────────────────────────────────────────────────────────────

describe('§5: the collections declare exactly the columns the spec lists', () => {
  const types = modelSchemaTypes();
  const declared = (c: string) => Object.keys(types[`sdm_${c}`].fields).sort();

  it('the eight collections, no more and no fewer', () => {
    expect(Object.keys(types).sort()).toEqual(COLLECTIONS.map((c) => `sdm_${c}`).sort());
  });

  it('record_types', () => {
    expect(declared('record_types')).toEqual(['description', 'name', 'query_name', 'workflow_ref'].sort());
  });
  it('fields', () => {
    expect(declared('fields')).toEqual(
      ['record_type_ref', 'key', 'label', 'type', 'target', 'target_ref', 'target_display_field', 'required', 'unique', 'immutable', 'default'].sort(),
    );
  });
  it('attributes', () => {
    expect(declared('attributes')).toEqual(
      ['key', 'label', 'description', 'type', 'config', 'sub_attributes', 'source', 'show_condition', 'required', 'validation', 'validation_message', 'can_waive'].sort(),
    );
  });
  it('workflows', () => {
    expect(declared('workflows')).toEqual(['description', 'name']);
  });
  it('activities', () => {
    expect(declared('activities')).toEqual(
      ['name', 'description', 'workflow_ref', 'record_type_ref', 'sort_order', 'record_map', 'show_condition', 'before_hook', 'after_hook', 'returns'].sort(),
    );
  });
  it('activity_attributes', () => {
    expect(declared('activity_attributes')).toEqual(
      ['activity_ref', 'position', 'kind', 'key', 'label', 'type', 'required', 'source', 'show_condition', 'validation', 'validation_message', 'can_waive'].sort(),
    );
  });
  it('functions', () => {
    expect(declared('functions')).toEqual(['body', 'description', 'name', 'params']);
  });
  it('roles', () => {
    expect(declared('roles')).toEqual(['description', 'name']);
  });

  it('every column the spec marks with "→ model.<x>" actually dereferences', () => {
    const host = withModelTypes(buildRecordsHost(new MemoryAdapter(full, {}), full), full);
    const fk = (t: string, f: string) => host.fkTarget(t, f);
    expect(fk('sdm_record_types', 'workflow_ref')).toBe('sdm_workflows');
    expect(fk('sdm_fields', 'record_type_ref')).toBe('sdm_record_types');
    expect(fk('sdm_activities', 'workflow_ref')).toBe('sdm_workflows');
    expect(fk('sdm_activities', 'record_type_ref')).toBe('sdm_record_types');
    expect(fk('sdm_activity_attributes', 'activity_ref')).toBe('sdm_activities');
    // §5: `target_ref` is the one that dereferences — `target` holds the
    // query name, which the collection is not keyed by.
    expect(fk('sdm_fields', 'target_ref')).toBe('sdm_record_types');
  });

  it('§5 model.fields: `target_ref` can be walked to the type it names', () => {
    // The spec writes it as a reference, so this is the query it promises.
    expect(runOn(full, "model.fields.where(key = 'site_id').select(t: target_ref.name)")).toEqual([{ t: 'Sites' }]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Read-only, every route
// ───────────────────────────────────────────────────────────────────────────

describe('the model cannot be written by any route', () => {
  const writable = () => {
    const adapter = new MemoryAdapter(full, { initialRecords: [] });
    return buildEvalHost(adapter, full, { modelTypes: true }, []);
  };
  const mutate = (src: string) => executeScript(src, writable(), { mode: 'mutate' });
  const read = (src: string) => evaluateExpression(src, hostFor(full));

  const routes: [string, string][] = [
    ['collection create', "model.record_types.create({ name: 'x' })"],
    ['collection update', "model.record_types.update({ name: 'x' })"],
    ['collection delete', 'model.record_types.delete()'],
    ['chain terminal update', "model.record_types.where(id = 'rt_jobs').update({ name: 'x' })"],
    ['chain terminal delete', "model.record_types.where(id = 'rt_jobs').delete()"],
    ['single row update', "model.record_types.where(id = 'rt_jobs').first.update({ name: 'x' })"],
    ['single row delete', "model.record_types.where(id = 'rt_jobs').first.delete()"],
    ['fk deref then update', "model.fields.where(key = 'ref').first.record_type_ref.update({ name: 'x' })"],
    ['let-bound row update', "let r = model.record_types.first\nr.update({ name: 'x' })"],
  ];

  for (const [label, src] of routes) {
    it(`${label} — refused as read-only in MUTATE posture`, () => {
      expect(() => mutate(src), src).toThrow(/read-only/);
    });
    it(`${label} — refused in READ posture`, () => {
      expect(() => read(src), src).toThrow();
    });
  }

  it('the prefixed name is not a back door: `records.sdm_*` is not a script name (§3)', () => {
    // §3: "The `sdm_` prefix never appears in a script."
    expect(() => read('records.sdm_record_types.count')).toThrow();
  });

  it('a writable host still writes ordinary records — the guard is not a blanket', () => {
    const adapter = new MemoryAdapter(full, { initialRecords: [] });
    const h = buildEvalHost(adapter, full, { modelTypes: true }, []);
    expect(() => executeScript("records.sites.create({ name: 'Yard' })", h, { mode: 'mutate' })).not.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Opt-in, and the two sides failing differently
// ───────────────────────────────────────────────────────────────────────────

describe('exposure is opt-in, and the browser and server fail differently', () => {
  it('a host without modelTypes fails at run time, cleanly', () => {
    const adapter = new MemoryAdapter(full, { initialRecords: [] });
    const plain = buildEvalHost(adapter, full, { readonlyRecords: true }, []);
    let msg = '';
    try {
      evaluateExpression('model.record_types.count', plain);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/not available (here|at this embedding point)/);
  });

  it('a schema without the model types fails at validation, cleanly', () => {
    const found = validateExpression('model.record_types.count', buildDslSchema(full), {}).filter((d) => d.severity === 'error');
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].message).toMatch(/not available (here|at this embedding point)/);
  });

  it('a hook cannot reach the model — validateConfig refuses one that names it', () => {
    const withHook = JSON.parse(JSON.stringify(full)) as SolutionConfig;
    (withHook.workflows[0].activities[0] as { after_hook?: unknown }).after_hook = 'let n = model.record_types.count';
    const errs = validateConfig(withHook).filter((f) => f.diagnostic.severity === 'error');
    expect(errs.length).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Derived and synthesised columns
// ───────────────────────────────────────────────────────────────────────────

describe('derived and synthesised columns', () => {
  it('query_name is the name `records.` actually takes', () => {
    const rows = runOn(full, 'model.record_types.select(id, query_name)') as Record<string, unknown>[];
    expect(rows).toContainEqual({ id: 'rt_jobs', query_name: 'jobs' });
    // and it round-trips
    expect(() => runOn(full, 'records.jobs.count')).not.toThrow();
  });

  it('synthesised ids: field is <record_type>.<key>, activity_attribute is <activity>.<position>', () => {
    expect(runOn(full, "model.fields.where(key = 'ref').select(id)")).toEqual([{ id: 'rt_jobs.ref' }]);
    const ids = runOn(full, "model.activity_attributes.where(activity_ref = 'act_create_jobs').values(id)");
    expect(ids).toEqual(['act_create_jobs.0', 'act_create_jobs.1', 'act_create_jobs.2', 'act_create_jobs.3']);
  });

  it('the attribute id is the key (§5: the table carries no id column)', () => {
    expect(runOn(full, "model.attributes.where(key = 'qty').select(id)")).toEqual([{ id: 'qty' }]);
  });

  it('record_type_ref is null when NO record type points at the workflow', () => {
    expect(runOn(full, "model.activities.where(id = 'act_orphan').select(record_type_ref)")).toEqual([
      { record_type_ref: null },
    ]);
  });

  it('record_type_ref is the FIRST by config order when TWO point at the workflow', () => {
    expect(runOn(full, "model.activities.where(id = 'act_create_jobs').select(record_type_ref)")).toEqual([
      { record_type_ref: 'rt_jobs' },
    ]);
  });

  it('an activity in a workflow no record type points at still has its capture list', () => {
    // §5: activity_attributes is "one row per entry in an activity's ordered
    // capture list" — nothing in the spec excludes an orphan workflow.
    expect(runOn(full, "model.activity_attributes.where(activity_ref = 'act_orphan').values(key)")).toEqual(['qty']);
  });

  it('params: a list for a body with parameters, [] for none, null for one that will not parse', () => {
    const rows = runOn(full, 'model.functions.select(id, params)') as Record<string, unknown>[];
    expect(rows).toEqual([
      { id: 'fn_ok', params: '["a","b"]' },
      { id: 'fn_none', params: '[]' },
      { id: 'fn_bad', params: null },
    ]);
  });

  it('params is derived from a body the DSL itself accepts, not only from one the regex likes', () => {
    const withComment = JSON.parse(JSON.stringify(full)) as SolutionConfig;
    (withComment as { functions: { id: string; name: string; description: string; body: string }[] }).functions = [
      { id: 'fn_c', name: 'commented', description: 'd', body: '// what it does\nfunction commented(a) { return a }' },
    ];
    // parseFunction accepts this body, so "could not tell" is the wrong answer.
    expect(runOn(withComment, 'model.functions.select(params)')).toEqual([{ params: '["a"]' }]);
  });

  it('hook lines stored as an array are joined', () => {
    expect(runOn(full, "model.activities.where(id = 'act_create_jobs').select(before_hook)")).toEqual([
      { before_hook: 'let a = 1\nlet b = 2' },
    ]);
  });

  it('a declared reference dereferences end to end, and is null-safe when empty', () => {
    expect(runOn(full, "model.record_types.where(id = 'rt_jobs').select(wf: workflow_ref.name)")).toEqual([
      { wf: 'Jobs' },
    ]);
    // record_type_ref is null on the orphan — the deref must not throw.
    expect(runOn(full, "model.activities.where(id = 'act_orphan').select(rt: record_type_ref.name)")).toEqual([
      { rt: null },
    ]);
  });

  it('the label fallback is the one `fieldLabel` uses — blank counts as absent', () => {
    // §5: "`label` falls back to the key when absent, as `fieldLabel` already
    // does". fieldLabel is `field.label?.trim() || field.key` (bridge.ts:36).
    const blank = JSON.parse(JSON.stringify(full)) as SolutionConfig;
    blank.recordTypes[0].custom_fields[0].label = '   ';
    expect(runOn(blank, "model.fields.where(key = 'ref').select(label)")).toEqual([{ label: 'ref' }]);
  });

  it('a field label falls back to the key; target is the query name', () => {
    expect(runOn(full, "model.fields.where(key = 'site_id').select(label, target, target_display_field)")).toEqual([
      { label: 'site_id', target: 'sites', target_display_field: 'name' },
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Section markers
// ───────────────────────────────────────────────────────────────────────────

describe('section markers', () => {
  it('markers interleaved with usages keep position and kind straight', () => {
    expect(runOn(full, "model.activity_attributes.where(activity_ref = 'act_create_jobs').select(position, kind, label)")).toEqual([
      { position: 0, kind: 'section', label: 'Head' },
      { position: 1, kind: 'attribute', label: 'Qty' },
      { position: 2, kind: 'section', label: 'Tail' },
      { position: 3, kind: 'attribute', label: 'Reason' },
    ]);
  });

  it('an activity whose list is ONLY markers queries without breaking', () => {
    expect(runOn(full, "model.activity_attributes.where(activity_ref = 'act_markers_jobs').values(kind)")).toEqual([
      'section',
      'section',
    ]);
  });

  it('an activity with an empty list contributes no rows', () => {
    expect(runOn(full, "model.activity_attributes.where(activity_ref = 'act_empty_jobs').count")).toBe(0);
  });

  it("filtering headings out is the whole point of `kind`", () => {
    expect(runOn(full, "model.activity_attributes.where(kind = 'attribute').count")).toBe(3);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Edge configs
// ───────────────────────────────────────────────────────────────────────────

describe('edge configs', () => {
  it('no functions key: an empty collection, not a throw', () => {
    expect(runOn(bare, 'model.functions.count')).toBe(0);
  });

  it('no access key at all: indistinguishable from empty roles, as §5 concedes', () => {
    const emptyRoles = { ...bare, access: { roles: [] } } as unknown as SolutionConfig;
    expect(runOn(bare, 'model.roles.count')).toBe(0);
    expect(runOn(emptyRoles, 'model.roles.count')).toBe(0);
  });

  it('a record type with no fields', () => {
    expect(runOn(full, "model.fields.where(record_type_ref = 'rt_jobs_archive').count")).toBe(0);
  });

  it('a solution with no workflows at all', () => {
    const noWf = { recordTypes: [], attributes: [], workflows: [] } as unknown as SolutionConfig;
    expect(runOn(noWf, 'model.activities.count')).toBe(0);
    expect(runOn(noWf, 'model.record_types.count')).toBe(0);
  });

  it('a composite projects its sub-attributes, not a null (§5)', () => {
    const rows = runOn(full, "model.attributes.where(key = 'line').select(sub_attributes)") as Record<string, unknown>[];
    expect(rows[0].sub_attributes).toBe('[{"attribute_ref":"qty"}]');
  });

  it('max_size_mb never reaches a projected config (§5, §10.4)', () => {
    const rows = runOn(full, 'model.attributes.values(config)') as (string | null)[];
    for (const cfg of rows) expect(cfg ?? '').not.toContain('max_size_mb');
    // but the rest of the type_config survives
    expect(runOn(full, "model.attributes.where(key = 'photo').values(config)")).toEqual(['{"accept":"image/*"}']);
  });

  it("a record type whose stripped name starts with sdm_ is refused at save (§3)", () => {
    const clash = JSON.parse(JSON.stringify(bare)) as SolutionConfig;
    clash.recordTypes[0].id = 'rt_sdm_fields';
    clash.recordTypes[0].workflow_ref = 'wf_widgets';
    const errs = validateConfig(clash).filter((f) => f.diagnostic.severity === 'error');
    expect(errs.some((f) => /sdm_/.test(f.diagnostic.message))).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// withModelTypes must not alter ordinary records.* behaviour
// ───────────────────────────────────────────────────────────────────────────

describe('withModelTypes leaves the data host alone', () => {
  const base = () => buildRecordsHost(new MemoryAdapter(full, {}), full);

  it('fkTarget falls through for ordinary types and is null for unknown fields', () => {
    const w = withModelTypes(base(), full);
    expect(w.fkTarget('jobs', 'site_id')).toBe('sites');
    expect(w.fkTarget('jobs', 'ref')).toBeNull();
    expect(w.fkTarget('nope', 'x')).toBeNull();
  });

  it('reverseRef still resolves for ordinary types, and is null for model types', () => {
    const w = withModelTypes(base(), full);
    expect(w.reverseRef('sites', 'jobs')).toEqual({ sourceType: 'jobs', field: 'site_id' });
    expect(w.reverseRef('sdm_record_types', 'sdm_fields')).toBeNull();
  });

  it('hasType answers for both, and refuses nonsense', () => {
    const w = withModelTypes(base(), full);
    expect(w.hasType('jobs')).toBe(true);
    expect(w.hasType('sdm_fields')).toBe(true);
    expect(w.hasType('sdm_nope')).toBe(false);
    expect(w.hasType('nope')).toBe(false);
  });

  it('rows handed out are copies — a script cannot poison the projection', () => {
    const w = withModelTypes(base(), full);
    const first = w.getAll('sdm_record_types')[0];
    first.fields.name = 'POISONED';
    expect(w.getAll('sdm_record_types')[0].fields.name).toBe('Jobs');
  });

  it('ordinary reverse navigation still works through the evaluator', () => {
    const adapter = new MemoryAdapter(full, { initialRecords: [] });
    const h = buildEvalHost(adapter, full, { modelTypes: true }, []);
    executeScript("records.sites.create({ name: 'Yard' })", h, { mode: 'mutate' });
    expect(() => evaluateExpression('records.sites.first.jobs.count', h)).not.toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// `model` became a reserved word everywhere — including hosts that have none
// ───────────────────────────────────────────────────────────────────────────

describe("adding `model` to ROOTS: what it costs every other script", () => {
  const plainHost = () => {
    const adapter = new MemoryAdapter(full, { initialRecords: [] });
    return buildEvalHost(adapter, full, { readonlyRecords: true }, []);
  };

  it('a bare field named `model` still filters (item scope wins)', () => {
    const withModelField = JSON.parse(JSON.stringify(full)) as SolutionConfig;
    withModelField.recordTypes[2].custom_fields.push({ key: 'model', label: 'Model', type: 'text' } as never);
    expect(errorsOn(withModelField, "records.sites.where(model = 'A').count")).toEqual([]);
  });

  it('a record type with a field named `model` draws no new schema warning', () => {
    const withModelField = JSON.parse(JSON.stringify(full)) as SolutionConfig;
    withModelField.recordTypes[2].custom_fields.push({ key: 'model', label: 'Model', type: 'text' } as never);
    const warnings = validateConfig(withModelField).filter((f) => f.diagnostic.severity === 'warning');
    expect(warnings.map((w) => w.diagnostic.message)).not.toContain(
      "Field 'model' on 'sites' shadows the 'model' root inside query methods",
    );
  });

  it("a script may still declare `let model = …` where no model root exists", () => {
    expect(() => executeScript('let model = 1\nmodel', plainHost(), { mode: 'read' })).not.toThrow();
  });
});
