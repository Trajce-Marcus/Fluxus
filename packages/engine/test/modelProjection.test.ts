// The model answerable as `model.*` (docs/QUERYING_THE_MODEL.md).
//
// The design's whole claim is that this needs no new machinery: model
// collections are ordinary record types under an internal `sdm_` prefix, so
// every chain, shape and projection rule applies unchanged. These tests hold
// that claim, and the two traps the spec names.

import { describe, it, expect } from 'vitest';
import { evaluateExpression, executeScript, validateExpression } from '@fluxus/dsl';
import { buildDslSchema, buildEvalHost, modelSchemaTypes, MemoryAdapter } from '../src/index';
import type { SolutionConfig } from '../src/types';

const config = {
  recordTypes: [
    {
      id: 'rt_projects',
      name: 'Projects',
      description: 'A project',
      workflow_ref: 'wf_projects',
      custom_fields: [
        { key: 'code', label: 'Code', type: 'text', required: true },
        // No label, no flags — the absent-key trap.
        { key: 'owner_id', type: 'fk_ref', fk_record_type: 'rt_people', fk_display_field: 'name' },
      ],
    },
    { id: 'rt_people', name: 'People', description: '', workflow_ref: 'wf_people', custom_fields: [{ key: 'name', label: 'Name', type: 'text' }] },
  ],
  attributes: [
    { key: 'closure_note', label: 'Closure note', description: '', type: 'text' },
  ],
  workflows: [
    {
      id: 'wf_projects',
      name: 'Projects',
      description: '',
      activities: [
        {
          id: 'act_close_projects',
          name: 'Close Project',
          description: '',
          sort_order: 20,
          record_map: 'UPDATE',
          show_condition: "context.record.code != ''",
          before_hook: "if 1 > 2 { fail('no') }",
          after_hook: null,
          attributes: [{ section: 'Closing' }, { attribute_ref: 'closure_note', required: true }],
        },
      ],
    },
    { id: 'wf_people', name: 'People', description: '', activities: [] },
  ],
  functions: [{ id: 'fn_total', name: 'total', description: 'Adds up', body: 'function total(a, b) { return a }' }],
  access: { roles: [{ id: 'role_supervisors', name: 'Supervisors' }] },
} as unknown as SolutionConfig;

function host() {
  const adapter = new MemoryAdapter(config, { initialRecords: [] });
  return buildEvalHost(adapter, config, { readonlyRecords: true, modelTypes: true }, []);
}

const run = (src: string) => evaluateExpression(src, host());

const schema = { types: { ...buildDslSchema(config).types, ...modelSchemaTypes() } };
const errors = (src: string) =>
  validateExpression(src, schema, { bannedRoots: ['attributes'] }).filter((d) => d.severity === 'error');

describe('model.* — the collections', () => {
  it('lists record types with the name a script can actually use', () => {
    const rows = run('model.record_types.select(id, query_name)') as Record<string, unknown>[];
    expect(rows).toEqual([
      { id: 'rt_projects', query_name: 'projects' },
      { id: 'rt_people', query_name: 'people' },
    ]);
  });

  it('lists fields across types, with a synthesised id', () => {
    const rows = run("model.fields.where(record_type_ref = 'rt_projects').select(id, key, type)") as Record<string, unknown>[];
    expect(rows).toEqual([
      { id: 'rt_projects.code', key: 'code', type: 'text' },
      { id: 'rt_projects.owner_id', key: 'owner_id', type: 'fk_ref' },
    ]);
  });

  it('projects a reference target as the query name, not the stored id', () => {
    const rows = run("model.fields.where(key = 'owner_id').select(target, target_display_field)") as Record<string, unknown>[];
    expect(rows).toEqual([{ target: 'people', target_display_field: 'name' }]);
  });

  it('derives an activity back to its workflow and record type', () => {
    const rows = run('model.activities.select(id, workflow_ref, record_type_ref)') as Record<string, unknown>[];
    expect(rows).toEqual([
      { id: 'act_close_projects', workflow_ref: 'wf_projects', record_type_ref: 'rt_projects' },
    ]);
  });

  it('includes hook source text', () => {
    const rows = run('model.activities.select(before_hook)') as Record<string, unknown>[];
    expect(rows[0].before_hook).toBe("if 1 > 2 { fail('no') }");
  });

  it('projects the resolved capture list, section markers included as rows', () => {
    const rows = run('model.activity_attributes.select(position, kind, label)') as Record<string, unknown>[];
    // The raw list is heterogeneous — a marker carries no attribute_ref — so
    // projecting it unresolved would break this query outright.
    expect(rows).toEqual([
      { position: 0, kind: 'section', label: 'Closing' },
      { position: 1, kind: 'attribute', label: 'Closure note' },
    ]);
  });

  it('filters headings out, which is the point of `kind`', () => {
    const rows = run("model.activity_attributes.where(kind = 'attribute').select(key)") as Record<string, unknown>[];
    expect(rows).toEqual([{ key: 'closure_note' }]);
  });

  it('derives function params by parsing the body', () => {
    const rows = run('model.functions.select(name, params)') as Record<string, unknown>[];
    expect(rows).toEqual([{ name: 'total', params: '["a","b"]' }]);
  });

  it('lists roles', () => {
    expect(run('model.roles.select(id)')).toEqual([{ id: 'role_supervisors' }]);
  });
});

describe('the two traps the spec names', () => {
  it('materializes absent optionals as null — otherwise where/select throws', () => {
    // `required` is absent on owner_id in the config. Were it merely missing
    // from the row, this would raise "Unknown name 'required'" at run time.
    expect(() => run('model.fields.where(required = true).select(key)')).not.toThrow();
    expect(run('model.fields.where(required = true).select(key)')).toEqual([{ key: 'code' }]);
  });

  it('falls back to the key when a field has no label', () => {
    const rows = run("model.fields.where(key = 'owner_id').select(label)") as Record<string, unknown>[];
    expect(rows).toEqual([{ label: 'owner_id' }]);
  });
});

describe('shape and chain are the ones data already uses', () => {
  it('no select gives a record, select gives a flat row', () => {
    const rec = run("model.record_types.where(id = 'rt_projects').first") as Record<string, unknown>;
    expect(rec).toMatchObject({ id: 'rt_projects', type: 'sdm_record_types' });
    expect(rec.fields).toMatchObject({ query_name: 'projects' });

    const row = run("model.record_types.where(id = 'rt_projects').select(query_name).first");
    expect(row).toEqual({ query_name: 'projects' });
  });

  it('dereferences a model reference the way a data FK dereferences', () => {
    const rows = run(
      "model.fields.where(key = 'code').select(rt: record_type_ref.name)",
    ) as Record<string, unknown>[];
    expect(rows).toEqual([{ rt: 'Projects' }]);
  });

  it('counts and tops like any collection', () => {
    expect(run('model.record_types.count')).toBe(2);
    expect((run('model.record_types.top(1)') as unknown[]).length).toBe(1);
  });
});

describe('the model is read-only and opt-in', () => {
  it('refuses a mutation through the model root, in both postures', () => {
    // Read posture: the evaluator's own mode guard gets there first.
    expect(() => run("model.record_types.where(id = 'rt_projects').update({ name: 'x' })")).toThrow();

    // Mutate posture is the one that needs the model's own guard — an after
    // hook may write records, and must still not write the model.
    const adapter = new MemoryAdapter(config, { initialRecords: [] });
    const writable = buildEvalHost(adapter, config, { modelTypes: true }, []);
    expect(() =>
      executeScript("model.record_types.where(id = 'rt_projects').update({ name: 'x' })", writable, { mode: 'mutate' }),
    ).toThrow(/read-only/);
    expect(() =>
      executeScript("model.record_types.where(id = 'rt_projects').delete()", writable, { mode: 'mutate' }),
    ).toThrow(/read-only/);
  });

  it('is absent from a host that did not ask for it', () => {
    const adapter = new MemoryAdapter(config, { initialRecords: [] });
    const plain = buildEvalHost(adapter, config, { readonlyRecords: true }, []);
    expect(() => evaluateExpression('model.record_types', plain)).toThrow(/not available here/);
  });

  it('validates clean with the model types declared', () => {
    expect(errors('model.record_types.select(query_name)')).toEqual([]);
    expect(errors("model.fields.where(type = 'text').select(key)")).toEqual([]);
  });

  it('reports an unknown collection and an unknown column', () => {
    expect(errors('model.nope.select(x)').length).toBeGreaterThan(0);
    expect(errors('model.record_types.select(no_such_column)').length).toBeGreaterThan(0);
  });

  it('fails validation where the model types are not declared', () => {
    const dataOnly = { types: buildDslSchema(config).types };
    const found = validateExpression('model.record_types.select(query_name)', dataOnly, {}).filter((d) => d.severity === 'error');
    expect(found.length).toBeGreaterThan(0);
  });
});
