// The apps Part 2 step 6 script (APPS_AND_INSTANCES §2.8): every literal link
// between pages becomes a link to the app its app's definition names, and each
// operation's apps' definitions are filled — run against an in-memory database
// with pages shaped like the projects solution's.

import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '../src/db/client';
import { ensureOperation, ensureSolution, putConfig } from '../src/host';
import { appRouter } from '../src/router';
import { pageVersions, pages } from '../src/db/schema';
import { getApp, getAppRecord } from '../src/apps';
import { applySolutionPlan, keyFor, planStep6 } from '../scripts/apps-step6';
import type { SolutionConfig } from '@fluxus/engine';

const SOL = 'test/step6';
const OP = 'test/step6';
const TWO = 'test/step6-two';

const config: SolutionConfig = {
  access: { roles: [{ id: 'role_crew', name: 'Crew' }] },
  attributes: [],
  recordTypes: [{ id: 'rt_jobs', name: 'Jobs', description: '', workflow_ref: 'wf_jobs', custom_fields: [] }],
  activities: [{ id: 'act_note_jobs', name: 'Note', description: '', record_map: 'UPDATE', attributes: [], before_hook: null, after_hook: null }],
  workflows: [{ id: 'wf_jobs', name: 'Jobs', description: '', activities: [{ activity_ref: 'act_note_jobs' }] }],
};

const SELECT = "if callbackData.value <> null { services.page.open('pages/job', callbackData.value) }";
const jobsPage = {
  componentDependencies: [{ name: 'RecordList', version: '1.0.0' }, { name: 'OpenPage', version: '1.0.0' }],
  slotConfigs: {
    list: {
      componentName: 'RecordList',
      staticConfig: { columns: [{ component: 'RunActivity', target: 'act_note_jobs' }, { component: 'OpenPage', target: 'pages/job', label: 'Open' }] },
      dynamicProps: {},
      callbacks: {},
    },
    report: { componentName: 'OpenPage', staticConfig: { label: 'Report', target: 'pages/report' }, dynamicProps: { record: 'context.record.id' }, callbacks: {} },
    picks: { componentName: 'Contributions', staticConfig: {}, dynamicProps: {}, callbacks: { onSelect: SELECT } },
    computed: { componentName: 'Text', staticConfig: {}, dynamicProps: {}, callbacks: { onClick: 'services.page.open(context.page.which, null)' } },
    quoted: { componentName: 'Text', staticConfig: {}, dynamicProps: {}, callbacks: { onClick: "let s = 'services.page.open(''pages/job'')'" } },
  },
};

let db: Db;
const open = () => appRouter.createCaller({ db });
const app = (operationId: string, pageId: string, label: string, definition = '{}') =>
  open().apps.put({ operationId, pageId, label, roleIds: ['role_crew'], definition }).then((r) => r.id);
let jobsApp: string, jobApp: string, reportApp: string, twoJobsApp: string;

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'Step 6');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Step 6');
  await ensureOperation(db, TWO, SOL, 'Step 6, two schedulers');
  // The job page links nowhere, but its component list still names OpenPage.
  const jobPage = { componentDependencies: [{ name: 'OpenPage', version: '1.0.0' }, { name: 'OpenApp', version: '1.0.0' }] };
  for (const [path, def] of [['pages/jobs', jobsPage], ['pages/job', jobPage], ['pages/report', {}]] as const) {
    await open().pages.put({ solutionId: SOL, path, def });
    await open().pages.publish({ solutionId: SOL, path, readme: 'v1' });
  }
  // The draft runs ahead of what is published: the new version comes from v1.
  await open().pages.put({ solutionId: SOL, path: 'pages/jobs', def: { ...jobsPage, draftOnly: true } });
  jobsApp = await app(OP, 'pages/jobs', 'Jobs', '{"network":"water"}');
  jobApp = await app(OP, 'pages/job', 'Job');
  reportApp = await app(OP, 'pages/report', 'Report');
  // Two apps made from one page, and none from the report: nothing to choose by.
  twoJobsApp = await app(TWO, 'pages/jobs', 'Jobs');
  await app(TWO, 'pages/job', 'Water job');
  await app(TWO, 'pages/job', 'Sewer job');
});

describe('the step 6 plan — read only', () => {
  it('makes a key from the page linked to', () => {
    expect(keyFor('pages/shift-report')).toBe('shiftReportLinkId');
    expect(keyFor('pages/new page 1')).toBe('newPage1LinkId');
  });

  it('rewrites every literal link, and lists the computed one for the author', async () => {
    const [plan] = (await planStep6(db)).filter((p) => p.solutionId === SOL);
    expect(plan.keys).toEqual({ 'pages/job': 'jobLinkId', 'pages/report': 'reportLinkId' });
    const jobs = plan.pages.find((p) => p.path === 'pages/jobs')!;
    expect(jobs.published?.version).toBe(1);
    // In the order the database keeps the slots.
    expect(jobs.published?.rewrites.map((r) => r.to).sort()).toEqual([
      'OpenApp',
      "OpenApp target 'jobLinkId'",
      "OpenApp target 'reportLinkId'",
      'services.app.open(context.app.definition.jobLinkId, { recordId: callbackData.value })',
    ]);
    expect(jobs.published!.def.componentDependencies).toEqual([{ name: 'RecordList', version: '1.0.0' }, { name: 'OpenApp', version: '1.0.0' }]);
    const slots = jobs.published!.def.slotConfigs!;
    expect(slots.list!.staticConfig!.columns).toEqual([
      { component: 'RunActivity', target: 'act_note_jobs' },
      { component: 'OpenApp', target: 'jobLinkId', label: 'Open' },
    ]);
    expect(slots.report).toMatchObject({ componentName: 'OpenApp', staticConfig: { label: 'Report', target: 'reportLinkId' }, dynamicProps: { record: 'context.record.id' } });
    expect(slots.picks!.callbacks!.onSelect).toBe("if callbackData.value <> null { services.app.open(context.app.definition.jobLinkId, { recordId: callbackData.value }) }");
    // A string that only spells the call is left alone.
    expect(slots.quoted!.callbacks!.onClick).toBe(jobsPage.slotConfigs.quoted.callbacks.onClick);
    expect(slots.computed!.callbacks!.onClick).toBe('services.page.open(context.page.which, null)');
    expect(plan.unresolved.filter((u) => u.startsWith('pages/jobs'))).toEqual([
      'pages/jobs — Text (computed) onClick: services.page.open(context.page.which, null) — its page is computed; rewrite it to services.app.open(context.app.definition.<key>, { recordId })',
    ]);
  });

  it('swaps OpenPage out of a component list in the draft alone when nothing else changes', async () => {
    const [plan] = (await planStep6(db)).filter((p) => p.solutionId === SOL);
    const job = plan.pages.find((p) => p.path === 'pages/job')!;
    expect(job.published).toBeNull();
    expect(job.draft?.rewrites).toEqual([{ where: 'component list', from: 'OpenPage', to: '(dropped — OpenApp is listed already)' }]);
    expect(job.draft?.def.componentDependencies).toEqual([{ name: 'OpenApp', version: '1.0.0' }]);
  });

  it("fills each operation's definitions with the only app made from the page linked to, and says where there is none or several", async () => {
    const [plan] = (await planStep6(db)).filter((p) => p.solutionId === SOL);
    expect(plan.definitions).toHaveLength(1);
    expect(plan.definitions[0]).toMatchObject({ operationId: OP, before: '{"network":"water"}' });
    expect(JSON.parse(plan.definitions[0].after)).toEqual({ network: 'water', jobLinkId: jobApp, reportLinkId: reportApp });
    expect(plan.unresolved).toContain(`${TWO} · "Jobs": 2 apps are made from pages/job ("Water job", "Sewer job") — set jobLinkId in its definition by hand`);
    expect(plan.unresolved).toContain(`${TWO} · "Jobs": no app is made from pages/report — set reportLinkId in its definition by hand`);
  });
});

describe('the step 6 script — written', () => {
  beforeAll(async () => {
    for (const plan of (await planStep6(db)).filter((p) => p.solutionId === SOL)) await applySolutionPlan(db, plan);
  });

  it("writes the definition, leaving a history entry on the app", async () => {
    const written = await getApp(db, OP, jobsApp);
    expect(JSON.parse(written!.definition)).toEqual({ network: 'water', jobLinkId: jobApp, reportLinkId: reportApp });
    const record = await getAppRecord(db, OP, jobsApp);
    expect(record!.activityHistory.at(-1)).toMatchObject({ activityId: 'sys_migration', author: 'migration' });
    expect((await getApp(db, TWO, twoJobsApp))!.definition).toBe('{}');
  });

  it('publishes a new version made from the latest published, and rewrites the draft', async () => {
    const versions = await db.select().from(pageVersions).where(and(eq(pageVersions.solutionId, SOL), eq(pageVersions.path, 'pages/jobs')));
    const v2 = versions.find((v) => v.version === 2)!;
    expect(v2.publishedBy).toBe('migration');
    expect(v2.def).toMatchObject({ slotConfigs: { report: { componentName: 'OpenApp' } } });
    expect(v2.def).not.toHaveProperty('draftOnly');
    const [draft] = await db.select().from(pages).where(and(eq(pages.solutionId, SOL), eq(pages.path, 'pages/jobs')));
    expect(draft.def).toMatchObject({ draftOnly: true, slotConfigs: { report: { componentName: 'OpenApp' } } });
  });

  it('changes only the draft of a page whose only change is its component list', async () => {
    const versions = await db.select().from(pageVersions).where(and(eq(pageVersions.solutionId, SOL), eq(pageVersions.path, 'pages/job')));
    expect(versions.map((v) => v.version)).toEqual([1]);
    const [draft] = await db.select().from(pages).where(and(eq(pages.solutionId, SOL), eq(pages.path, 'pages/job')));
    expect(draft.def).toEqual({ componentDependencies: [{ name: 'OpenApp', version: '1.0.0' }] });
  });

  it('does nothing on a second run but list what is still left', async () => {
    const [plan] = (await planStep6(db)).filter((p) => p.solutionId === SOL);
    expect(plan.pages).toEqual([]);
    expect(plan.definitions).toEqual([]);
    expect(plan.unresolved).toEqual([
      'pages/jobs — Text (computed) onClick: services.page.open(context.page.which, null) — its page is computed; rewrite it to services.app.open(context.app.definition.<key>, { recordId })',
    ]);
  });
});
