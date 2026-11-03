// The apps Part 2 step 3 script (APPS_AND_INSTANCES §2.8): every published page
// gets a list of what it uses today, made from its wiring — run against an
// in-memory database with a page shaped like the inspections Job page.

import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '../src/db/client';
import { ensureSolution, getSolutionModel, putModel } from '../src/host';
import { appRouter } from '../src/router';
import { pageVersions, pages } from '../src/db/schema';
import { applyPagePlan, listIdFor, planStep3 } from '../scripts/apps-step3';
import type { ActivityRawDef, SolutionModel } from '@fluxus/engine';

const SOL = 'test/step3';

const act = (id: string, record_map?: ActivityRawDef['record_map'], returns?: string): ActivityRawDef => ({
  id, name: id, description: '', ...(record_map ? { record_map } : {}), attributes: [], before_hook: null, after_hook: null,
  ...(returns ? { returns } : {}),
});
const wf = (id: string, ids: string[]) => ({ id, name: id, description: '', activities: ids.map((activity_ref) => ({ activity_ref })) });

const config: SolutionModel = {
  attributes: [],
  recordTypes: [
    { id: 'rt_jobs', name: 'Jobs', description: '', workflow_ref: 'wf_jobs', custom_fields: [{ key: 'quote', type: 'fk_ref', fk_record_type: 'rt_quotes', fk_display_field: 'id' }] },
    { id: 'rt_quotes', name: 'Quotes', description: '', workflow_ref: 'wf_quotes', custom_fields: [] },
    { id: 'rt_areas', name: 'Areas', description: '', workflow_ref: 'wf_areas', custom_fields: [] },
    { id: 'rt_notes', name: 'Notes', description: '', workflow_ref: 'wf_notes', custom_fields: [] },
    { id: 'rt_unused', name: 'Unused', description: '', workflow_ref: 'wf_unused', custom_fields: [] },
  ],
  activities: [
    act('act_create_jobs', 'CREATE'), act('act_start_jobs'), act('act_list_jobs', 'GET', 'records.jobs'),
    act('act_update_quotes', 'UPDATE'),
    act('act_add_areas', 'CREATE'), act('act_update_areas', 'UPDATE'), act('act_list_areas', 'GET', 'records.areas.where(1 = 1)'),
    act('act_note_notes', 'UPDATE'), act('act_summary', 'GET', "'Summary: ' + 1"),
    act('act_unused', 'UPDATE'),
  ],
  workflows: [
    wf('wf_jobs', ['act_create_jobs', 'act_start_jobs', 'act_list_jobs']),
    wf('wf_quotes', ['act_update_quotes']),
    wf('wf_areas', ['act_add_areas', 'act_update_areas', 'act_list_areas']),
    wf('wf_notes', ['act_note_notes', 'act_summary']),
    wf('wf_unused', ['act_unused']),
  ],
};

const jobPage = {
  record: { type: 'rt_jobs', instances: 'many' },
  slotConfigs: {
    title: { componentName: 'PageHeader', staticConfig: { title: "{{ invoke('act_summary', { job: context.record.id }) }}" }, dynamicProps: {}, callbacks: {} },
    areas: {
      componentName: 'RecordList',
      staticConfig: { columns: [{ component: 'RunActivity', target: 'act_update_areas' }, { component: 'OpenPage', target: 'pages/area' }] },
      dynamicProps: { rows: "invoke('act_list_areas', { job: context.record.id })" },
      callbacks: {},
    },
    quote: { componentName: 'RecordActivities', staticConfig: {}, dynamicProps: { record: 'context.record.quote' }, callbacks: {} },
    note: { componentName: 'Text', staticConfig: {}, dynamicProps: {}, callbacks: { onClick: "services.activities.run('act_note_notes', callbackData.value)" } },
    computed: { componentName: 'Text', staticConfig: {}, dynamicProps: { text: 'invoke(context.page.which, {})' }, callbacks: {} },
  },
};

let db: Db;
const open = () => appRouter.createCaller({ db });

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'Step 3');
  await putModel(db, SOL, config);
  await open().pages.put({ solutionId: SOL, path: 'pages/job', def: jobPage });
  await open().pages.publish({ solutionId: SOL, path: 'pages/job', readme: 'v1' });
  // The draft runs ahead of what is published: the list comes from v1.
  await open().pages.put({ solutionId: SOL, path: 'pages/job', def: { ...jobPage, draftOnly: true } });
});

describe('the step 3 plan — read only', () => {
  it('lists whole workflows of the types the page shows or acts on, and the GETs it calls', async () => {
    const [plan] = (await planStep3(db)).filter((p) => p.solutionId === SOL);
    expect(plan.workflowId).toBe('wf_app_pages_job');
    expect(plan.types.map((t) => t.typeId)).toEqual(['rt_jobs', 'rt_areas', 'rt_quotes', 'rt_notes']);
    expect(plan.activityIds).toEqual([
      'act_create_jobs', 'act_start_jobs', 'act_list_jobs',
      'act_add_areas', 'act_update_areas', 'act_list_areas',
      'act_update_quotes',
      'act_note_notes', 'act_summary',
    ]);
    expect(plan.unresolved).toEqual(['Text (computed) text: invoke with a computed id']);
  });

  it('makes a list id from the path', () => {
    expect(listIdFor('pages/new page 1')).toBe('wf_app_pages_new_page_1');
  });
});

describe('the step 3 script — written', () => {
  beforeAll(async () => {
    for (const plan of (await planStep3(db)).filter((p) => p.solutionId === SOL)) await applyPagePlan(db, plan);
  });

  it('adds the list as a workflow no record type points to', async () => {
    const model = await getSolutionModel(db, SOL);
    expect(model.workflows.find((w) => w.id === 'wf_app_pages_job')?.activities).toHaveLength(9);
    expect(model.recordTypes.some((rt) => rt.workflow_ref === 'wf_app_pages_job')).toBe(false);
  });

  it('names it on a new published version made from the latest published, and on the draft', async () => {
    const versions = await db.select().from(pageVersions).where(and(eq(pageVersions.solutionId, SOL), eq(pageVersions.path, 'pages/job')));
    const v2 = versions.find((v) => v.version === 2)!;
    expect(v2.def).toMatchObject({ workflowId: 'wf_app_pages_job', record: { type: 'rt_jobs' } });
    expect(v2.def).not.toHaveProperty('draftOnly');
    const [draft] = await db.select().from(pages).where(and(eq(pages.solutionId, SOL), eq(pages.path, 'pages/job')));
    expect(draft.def).toMatchObject({ workflowId: 'wf_app_pages_job', draftOnly: true });
  });

  it('does nothing on a second run', async () => {
    const [plan] = (await planStep3(db)).filter((p) => p.solutionId === SOL);
    expect(plan.skipped).toBe('already has a list (wf_app_pages_job)');
  });
});
