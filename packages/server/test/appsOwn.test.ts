// An app's own activities (APPS_AND_INSTANCES Part 2 step 5, §2.2–§2.4). An
// activity on a page's list that no record type's workflow lists runs only
// through its app, names no type and no record, and runs on the app's record —
// its history entry lands there, and its hook changes other records, reading
// `context.app.definition`. Its GETs leave no entry. Two apps made from one
// page keep separate histories. The browser gets these activities with the
// model, and `page.activities` offers them for an empty `{}`.

import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '../src/db/client';
import { addOpUser, ensureOperation, ensureSolution, inviteUser, putConfig, putUserRoles } from '../src/host';
import { appRouter } from '../src/router';
import { createDbRolesResolver } from '../src/auth';
import { records } from '../src/db/schema';
import type { ActivityHistoryEntry, ActivityRawDef, ContextUser, SolutionConfig, WorkflowRawDef } from '@fluxus/engine';

const SOL = 'test/apps-own';
const OP = 'test/apps-own';

const act = (id: string, over: Partial<ActivityRawDef> = {}): ActivityRawDef => ({
  id, name: id, description: '', attributes: [], before_hook: null, after_hook: null, ...over,
});
const wf = (id: string, refs: (string | { activity_ref: string; show_condition?: string })[]): WorkflowRawDef => ({
  id, name: id, description: '', activities: refs.map((r) => (typeof r === 'string' ? { activity_ref: r } : r)),
});

const planDay = act('act_plan_day', { after_hook: 'records.jobs.create({ region: context.app.definition.region })' });
const config: SolutionConfig = {
  access: { roles: [{ id: 'role_crew', name: 'Crew' }, { id: 'role_other', name: 'Other' }] },
  attributes: [],
  recordTypes: [
    { id: 'rt_jobs', name: 'Jobs', description: '', workflow_ref: 'wf_jobs', custom_fields: [{ key: 'region', type: 'text' }], access: { read: ['role_crew'] } },
  ],
  activities: [
    act('act_create_jobs', { record_map: 'CREATE' }),
    act('act_list_jobs', { record_map: 'GET', returns: 'records.jobs' }),
    planDay,
    act('act_count_regions', { record_map: 'GET', returns: 'records.jobs.where(region = context.app.definition.region).count' }),
    act('act_hidden_step'),
  ],
  workflows: [
    wf('wf_jobs', ['act_create_jobs', 'act_list_jobs']),
    // The board's list; its own activities and conditions are added once a
    // page names it (only an app's list may hold them).
    wf('wf_app_board', ['act_create_jobs', 'act_list_jobs']),
  ],
};
const boardList = wf('wf_app_board', [
  { activity_ref: 'act_create_jobs', show_condition: "context.app.definition.region = 'north'" },
  'act_list_jobs', 'act_plan_day', 'act_count_regions',
  { activity_ref: 'act_hidden_step', show_condition: 'false' },
]);

let db: Db;
let north: string;
let south: string;
const crew: ContextUser = { id: 'u-crew', name: 'Crew', email: 'crew@example.com', roles: [] };
const as = () => appRouter.createCaller({ db, user: crew, roles: createDbRolesResolver(db), authConfigured: true });
const open = () => appRouter.createCaller({ db });
const historyOf = async (id: string) =>
  ((await db.select().from(records).where(and(eq(records.operationId, OP), eq(records.id, id))))[0].activityHistory as ActivityHistoryEntry[])
    .map((e) => e.activityId);
const regions = async () => (await db.select().from(records).where(and(eq(records.operationId, OP), eq(records.typeRef, 'rt_jobs'))))
  .map((r) => r.customFields.region).sort();

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'Apps own');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Apps own');
  await open().pages.put({ solutionId: SOL, path: 'pages/board', def: { workflowId: 'wf_app_board' } });
  await open().pages.publish({ solutionId: SOL, path: 'pages/board', readme: 'v1' });
  await open().config.putWorkflow({ solutionId: SOL, def: boardList });
  // Two apps from one page: a north board and a south board.
  ({ id: north } = await open().apps.put({ operationId: OP, pageId: 'pages/board', label: 'North board', roleIds: ['role_crew'], definition: '{"region":"north"}' }));
  ({ id: south } = await open().apps.put({ operationId: OP, pageId: 'pages/board', label: 'South board', roleIds: ['role_crew'], definition: '{"region":"south"}' }));
  await inviteUser(db, { email: 'crew@example.com' });
  await addOpUser(db, { operationId: OP, email: 'crew@example.com' });
  await putUserRoles(db, { operationId: OP, email: 'crew@example.com', roleIds: ['role_crew'] });
  await db.insert(records).values({ operationId: OP, id: 'J0', typeRef: 'rt_jobs', customFields: { region: 'west' }, activityHistory: [] });
});

describe("an app's own activity runs on its app", () => {
  it("lands its entry on the app, and its hook changes other records reading context.app.definition", async () => {
    await expect(as().activities.run({ operationId: OP, appId: north, activityId: 'act_plan_day' })).resolves.toMatchObject({ status: 'done' });
    await expect(as().activities.run({ operationId: OP, appId: south, activityId: 'act_plan_day' })).resolves.toMatchObject({ status: 'done' });
    expect(await regions()).toEqual(['north', 'south', 'west']);
  });

  it('two apps made from one page keep separate histories', async () => {
    expect((await historyOf(north)).filter((id) => !id.startsWith('sys_'))).toEqual(['act_plan_day']);
    expect((await historyOf(south)).filter((id) => !id.startsWith('sys_'))).toEqual(['act_plan_day']);
  });

  it('is refused on any other record, naming a type, and without its app', async () => {
    await expect(as().activities.run({ operationId: OP, appId: north, activityId: 'act_plan_day', recordId: 'J0' })).rejects.toThrow(/names no record type and no record/);
    await expect(as().activities.run({ operationId: OP, appId: north, activityId: 'act_plan_day', typeId: 'rt_jobs' })).rejects.toThrow(/names no record type and no record/);
    await expect(as().activities.run({ operationId: OP, appId: north, activityId: 'act_plan_day', recordId: south })).rejects.toThrow(/names no record type and no record/);
    await expect(open().activities.run({ operationId: OP, activityId: 'act_plan_day' })).rejects.toThrow(/runs only through its app/);
  });

  it("is refused while its item's condition fails", async () => {
    await expect(as().activities.run({ operationId: OP, appId: north, activityId: 'act_hidden_step' })).rejects.toThrow(/not available/);
  });

  it('may not change the app: a hook that tries is refused at model save', async () => {
    await expect(open().config.putActivity({ solutionId: SOL, def: { ...planDay, after_hook: "context.record.update({ label: 'renamed' })" } }))
      .rejects.toThrow(/sys_apps records never change through a script/);
  });
});

describe("an app's own GET", () => {
  it('answers on the app, reading context.app, and leaves no entry', async () => {
    const before = await historyOf(north);
    await expect(as().activities.query({ operationId: OP, appId: north, activityId: 'act_count_regions' })).resolves.toMatchObject({ data: 1 });
    expect(await historyOf(north)).toEqual(before);
  });

  it('is refused with a record, and without its app', async () => {
    await expect(as().activities.query({ operationId: OP, appId: north, activityId: 'act_count_regions', recordId: 'J0' })).rejects.toThrow(/names no record type and no record/);
    await expect(open().activities.query({ operationId: OP, activityId: 'act_count_regions' })).rejects.toThrow(/runs only through its app/);
  });
});

describe('what an app offers', () => {
  const offered = async (items: ({ recordId: string } | { typeId: string } | Record<string, never>)[], appId?: string) =>
    (await as().page.activities({ operationId: OP, ...(appId ? { appId } : {}), items })).map((list) => list.map((a) => a.id));

  it('answers an empty {} with its own activities whose conditions pass — never its GETs', async () => {
    expect(await offered([{}], north)).toEqual([['act_plan_day']]);
  });

  it('answers {} with nothing for a call with no app', async () => {
    expect((await open().page.activities({ operationId: OP, items: [{}] })).map((l) => l.map((a) => a.id))).toEqual([[]]);
  });

  it("lets conditions read context.app: the north board offers a create the south board does not", async () => {
    expect(await offered([{ typeId: 'rt_jobs' }], north)).toEqual([['act_create_jobs']]);
    expect(await offered([{ typeId: 'rt_jobs' }], south)).toEqual([[]]);
  });
});

describe('the model a Runtime user receives', () => {
  it("holds the own activities of the apps they may run, in their lists", async () => {
    const model = await as().config.getForOperation({ operationId: OP });
    const list = model.workflows.find((w) => w.id === 'wf_app_board');
    expect(list?.activities.map((u) => u.activity_ref)).toEqual(['act_plan_day', 'act_count_regions', 'act_hidden_step']);
    expect(model.activities.map((a) => a.id)).toEqual(expect.arrayContaining(['act_plan_day', 'act_count_regions']));
  });

  it('holds none for a user who may run no app', async () => {
    await putUserRoles(db, { operationId: OP, email: 'crew@example.com', roleIds: ['role_other'] });
    const model = await as().config.getForOperation({ operationId: OP });
    expect(model.workflows.map((w) => w.id)).not.toContain('wf_app_board');
    expect(model.activities.map((a) => a.id)).not.toContain('act_plan_day');
    await putUserRoles(db, { operationId: OP, email: 'crew@example.com', roleIds: ['role_crew'] });
  });
});
