// An app's own activities (APPS_AND_INSTANCES Part 2 step 5, §2.2, §2.4). An
// activity on a page's list that no record type's workflow lists runs on its
// app's record — a record of the platform's `rt_sys_apps`, typed with
// `page_id`, `label` and `definition`. Its scripts see the app as
// `context.app`, it never changes the app, and an app's own GET leaves no
// history entry.

import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/memoryAdapter';
import { createEngine } from '../src/engine';
import { validateConfig } from '../src/validateConfig';
import { APPS_RECORD_TYPE } from '../src/platformApps';
import type { ActivityDef, ActivityRawDef, SolutionConfig, WorkflowRawDef } from '../src/types';

const act = (id: string, over: Partial<ActivityRawDef> = {}): ActivityRawDef => ({
  id, name: id, description: '', attributes: [], before_hook: null, after_hook: null, ...over,
});
const wf = (id: string, refs: (string | { activity_ref: string; show_condition?: string })[]): WorkflowRawDef => ({
  id, name: id, description: '', activities: refs.map((r) => (typeof r === 'string' ? { activity_ref: r } : r)),
});

function model(over: { own?: ActivityRawDef; list?: WorkflowRawDef } = {}): SolutionConfig {
  return {
    attributes: [],
    recordTypes: [
      { id: 'rt_jobs', name: 'Jobs', description: '', workflow_ref: 'wf_jobs', custom_fields: [{ key: 'region', type: 'text' }] },
    ],
    activities: [
      act('act_create_jobs', { record_map: 'CREATE' }),
      over.own ?? act('act_plan_day', { after_hook: 'records.jobs.create({ region: context.app.definition.region })' }),
      act('act_count_jobs', { record_map: 'GET', returns: 'records.jobs.count' }),
    ],
    workflows: [
      wf('wf_jobs', ['act_create_jobs']),
      over.list ?? wf('wf_app_board', ['act_create_jobs', 'act_plan_day', 'act_count_jobs']),
    ],
  };
}

const atSave = (config: SolutionConfig, appLists = new Set(['wf_app_board'])) =>
  validateConfig(config, [], { appLists }).map((f) => `${f.where}: ${f.diagnostic.message}`);

describe("an app's own activity at model save", () => {
  it("is checked against rt_sys_apps: its page, name and definition, never its roles", () => {
    expect(atSave(model({ own: act('act_plan_day', { after_hook: "services.logger.note(context.record.page_id + context.record.label + context.record.definition)" }) }))).toEqual([]);
    const found = atSave(model({ own: act('act_plan_day', { after_hook: 'services.logger.note(context.record.role_ids)' }) }));
    expect(found.join('\n')).toMatch(/act_plan_day after_hook: .*role_ids/);
  });

  it('may not change the app', () => {
    const found = atSave(model({ own: act('act_plan_day', { after_hook: "context.record.update({ label: 'x' })" }) }));
    expect(found.join('\n')).toMatch(/sys_apps records never change through a script/);
  });

  it("types an item's condition on it against rt_sys_apps", () => {
    expect(atSave(model({ list: wf('wf_app_board', [{ activity_ref: 'act_plan_day', show_condition: "context.record.page_id = 'pages/board'" }]) }))).toEqual([]);
    const found = atSave(model({ list: wf('wf_app_board', [{ activity_ref: 'act_plan_day', show_condition: "context.record.region = 'north'" }]) }));
    expect(found.join('\n')).toMatch(/act_plan_day' condition: .*region/);
  });

  it('stays untyped where no page names the workflow', () => {
    expect(atSave(model({ own: act('act_plan_day', { after_hook: 'services.logger.note(context.record.anything)' }) }), new Set())).toEqual([]);
  });
});

function build(config = model(), app = { pageId: 'pages/board', label: 'North board', definition: { region: 'north' } }) {
  const adapter = new MemoryAdapter(config);
  const appRecord = { id: 'APP1', typeRef: APPS_RECORD_TYPE, customFields: { page_id: 'pages/board', label: 'North board', role_ids: '[]', definition: '{"region":"north"}' }, activityHistory: [] };
  adapter.insertRecord(appRecord);
  const engine = createEngine({ store: adapter, config, user: { id: 'u', name: 'u', email: null, roles: [] }, app });
  const find = (id: string) => adapter.listWorkflows().flatMap((w) => w.activities).find((a) => a.id === id) as ActivityDef;
  return { adapter, engine, find, app: () => adapter.getRecord('APP1') };
}

describe("an app's own activity at run time", () => {
  it("runs on its app's record, leaving its entry there, and its hook reads context.app", async () => {
    const { adapter, engine, find, app } = build();
    await expect(engine.runActivity(find('act_plan_day'), {}, app())).resolves.toMatchObject({ status: 'done' });
    expect(app().activityHistory.map((e) => e.activityId)).toEqual(['act_plan_day']);
    expect(adapter.getRecordTypeData('rt_jobs').map((r) => r.customFields.region)).toEqual(['north']);
  });

  it('cannot change the app, whatever its hook tries', async () => {
    const { engine, find, app } = build(model({ own: act('act_plan_day', { after_hook: "context.record.update({ label: 'x' })" }) }));
    await expect(engine.runActivity(find('act_plan_day'), {}, app())).rejects.toThrow(/never changes through a script/);
    expect(app().customFields.label).toBe('North board');
  });

  it('its GET can run on the app without leaving an entry', async () => {
    const { engine, find, app } = build();
    await expect(engine.runQuery(find('act_count_jobs'), {}, app(), { log: false })).resolves.toMatchObject({ data: 0 });
    expect(app().activityHistory).toEqual([]);
    await engine.runQuery(find('act_count_jobs'), {}, app());
    expect(app().activityHistory).toHaveLength(1);
  });

  it("a script never sees the app's roles, even holding the whole record", async () => {
    // Found by the step 5 cold test: the type omits role_ids at save, but a
    // GET returning context.record whole carried the stored row.
    const config = model();
    config.activities.push(act('act_whole_app', { record_map: 'GET', returns: 'context.record' }));
    config.workflows[1].activities.push({ activity_ref: 'act_whole_app' });
    expect(atSave(config)).toEqual([]);
    const { engine, find, app } = build(config);
    const { data } = await engine.runQuery(find('act_whole_app'), {}, app(), { log: false });
    expect(data).toEqual({ id: 'APP1', page_id: 'pages/board', label: 'North board', definition: '{"region":"north"}' });
  });

  it("its conditions see context.app too", async () => {
    const { engine, find, app } = build();
    const plan = find('act_plan_day');
    expect((await engine.activityAvailabilityAsync(plan, app(), "context.app.label = 'North board'")).available).toBe(true);
    expect((await engine.activityAvailabilityAsync(plan, app(), "context.app.definition.region = 'south'")).available).toBe(false);
  });
});
