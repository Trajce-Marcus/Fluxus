// A form's GETs (APPS_AND_INSTANCES Part 2 §2.2, step 4). A dropdown's
// datasource reaches a GET with `invoke('…')`, directly or through a named
// function; an app counts those GETs as on its list. They are worked out from
// the literal ids on that path, so a computed id there is refused at save.

import { describe, expect, it } from 'vitest';
import { formGetIds } from '../src/formGets';
import { validateModel } from '../src/validateModel';
import type { ActivityRawDef, AttributeDef, FunctionDef, SolutionModel } from '../src/types';

const get = (id: string): ActivityRawDef => ({
  id, name: id, description: '', record_map: 'GET', attributes: [], before_hook: null, after_hook: null, returns: 'records.jobs',
});
const list = (key: string, datasource: string): AttributeDef => ({
  key, label: key, description: '', type: 'list', type_config: { datasource, key_field: 'id', display_field: 'name' },
});
const fn = (name: string, body: string): FunctionDef => ({ id: `fn_${name}`, name, description: 'd', body });

function model({ attributes = [], functions = [] }: { attributes?: AttributeDef[]; functions?: FunctionDef[] } = {}): SolutionModel {
  return {
    attributes: [
      list('crew', "invoke('act_list_crews')"),
      list('region', 'regionsfor()'),
      list('colour', "['red', 'blue']"),
      list('cell_crew', "invoke('act_list_cell_crews')"),
      { key: 'shift', label: 'Shift', description: '', type: 'composite', type_config: { attributes: [{ attribute_ref: 'cell_crew' }] } },
      ...attributes,
    ],
    functions: [
      fn('regionsfor', 'function regionsfor() { return allregions() }'),
      fn('allregions', "function allregions() { return invoke('act_list_regions') }"),
      ...functions,
    ],
    recordTypes: [
      { id: 'rt_jobs', name: 'Jobs', description: '', workflow_ref: 'wf_jobs', custom_fields: [{ key: 'name', type: 'text' }] },
    ],
    activities: [
      { id: 'act_assign_jobs', name: 'Assign', description: '', attributes: [{ attribute_ref: 'crew' }, { attribute_ref: 'colour' }], before_hook: null, after_hook: null },
      { id: 'act_plan_jobs', name: 'Plan', description: '', attributes: [{ section: 'Where' }, { attribute_ref: 'region' }, { attribute_ref: 'shift' }], before_hook: null, after_hook: null },
      { id: 'act_close_jobs', name: 'Close', description: '', attributes: [], before_hook: null, after_hook: null },
      get('act_list_crews'), get('act_list_regions'), get('act_list_cell_crews'), get('act_list_jobs'),
    ],
    workflows: [{
      id: 'wf_jobs', name: 'Jobs', description: '',
      activities: ['act_assign_jobs', 'act_plan_jobs', 'act_close_jobs', 'act_list_crews', 'act_list_regions', 'act_list_cell_crews', 'act_list_jobs']
        .map((activity_ref) => ({ activity_ref })),
    }],
  } as SolutionModel;
}

const onPath = (config: SolutionModel) =>
  validateModel(config).filter((f) => f.diagnostic.message.includes('invoke'));

describe('formGetIds', () => {
  it("names the GETs an activity's datasources invoke", () => {
    expect([...formGetIds(model(), ['act_assign_jobs'])]).toEqual(['act_list_crews']);
  });

  it('follows named functions, and the functions they call', () => {
    expect(formGetIds(model(), ['act_plan_jobs']).has('act_list_regions')).toBe(true);
  });

  it("includes a composite's cells", () => {
    expect(formGetIds(model(), ['act_plan_jobs']).has('act_list_cell_crews')).toBe(true);
  });

  it('is empty for an activity whose form calls nothing', () => {
    expect(formGetIds(model(), ['act_close_jobs']).size).toBe(0);
  });
});

describe('a datasource at model save', () => {
  it('passes with literal GET ids, direct or through functions', () => {
    expect(onPath(model())).toEqual([]);
  });

  it('refuses a computed id in the datasource', () => {
    const found = onPath(model({ attributes: [list('area', "invoke('act_list_' + 'crews')")] }));
    expect(found.map((f) => f.where)).toEqual(["attribute 'area' datasource"]);
    expect(found[0].diagnostic.message).toMatch(/computed activity id/);
  });

  it('refuses a computed id in a function it reaches, once however many reach it', () => {
    const found = onPath(model({
      attributes: [list('area', 'pick(attributes.kind)'), list('zone', 'pick(attributes.kind)')],
      functions: [fn('pick', 'function pick(kind) { return invoke(kind) }')],
    }));
    expect(found).toHaveLength(1);
    expect(found[0].where).toMatch(/^function 'pick' \(reached from attribute 'area' datasource\)$/);
  });

  it('leaves a computed id in a function no datasource reaches to run time', () => {
    expect(onPath(model({ functions: [fn('pick', 'function pick(kind) { return invoke(kind) }')] }))).toEqual([]);
  });

  it("says nothing of a GET a browser's copy leaves out", () => {
    // The trimmed copy: no hooks keys, and the GET's workflow not sent.
    const config = model({ attributes: [list('area', "invoke('act_list_areas')")] });
    const trimmed = { ...config, activities: config.activities!.map(({ before_hook: _b, after_hook: _a, returns: _r, ...rest }) => rest) };
    expect(onPath(trimmed as SolutionModel)).toEqual([]);
    expect(onPath(config).map((f) => f.diagnostic.message)).toEqual(["invoke('act_list_areas') — no such activity"]);
  });

  it('refuses a literal id that is not a GET, or not an activity', () => {
    const found = onPath(model({ attributes: [list('area', "invoke('act_close_jobs')"), list('zone', "invoke('act_nope')")] }));
    expect(found.map((f) => f.diagnostic.message)).toEqual([
      "invoke('act_close_jobs') — only GET activities can be invoked",
      "invoke('act_nope') — no such activity",
    ]);
  });
});
