// An app's list (APPS_AND_INSTANCES Part 2 step 3, §2.2–§2.3): an app offers
// and runs only what its page's list holds, each item may carry the app's own
// condition, a run names the record type it is about, and a page's list is
// protected and checked when the page is published.

import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '../src/db/client';
import { addOpUser, ensureOperation, ensureSolution, getSolutionModel, inviteUser, putModel, putUserRoles } from '../src/host';
import { appRouter } from '../src/router';
import { createDbRolesResolver } from '../src/auth';
import { pageVersions, records } from '../src/db/schema';
import type { ActivityRawDef, ContextUser, SolutionModel, WorkflowRawDef } from '@fluxus/engine';

const SOL = 'test/app-lists';
const OP = 'test/app-lists';

const act = (id: string, record_map?: ActivityRawDef['record_map']): ActivityRawDef => ({
  id, name: id, description: '', ...(record_map ? { record_map } : {}), attributes: [], before_hook: null, after_hook: null,
  ...(record_map === 'GET' ? { returns: 'records.jobs' } : {}),
});
const wf = (id: string, refs: (string | { activity_ref: string; show_condition?: string })[]): WorkflowRawDef => ({
  id, name: id, description: '', activities: refs.map((r) => (typeof r === 'string' ? { activity_ref: r } : r)),
});

const config: SolutionModel = {
  access: { roles: [{ id: 'role_crew', name: 'Crew' }] },
  attributes: [],
  recordTypes: [
    { id: 'rt_jobs', name: 'Jobs', description: '', workflow_ref: 'wf_jobs', custom_fields: [{ key: 'status', type: 'text' }], access: { read: ['role_crew'] } },
    { id: 'rt_notes', name: 'Notes', description: '', workflow_ref: 'wf_notes', custom_fields: [], access: { read: ['role_crew'] } },
  ],
  activities: [
    act('act_create_jobs', 'CREATE'), act('act_start_jobs'), act('act_close_jobs'), act('act_list_jobs', 'GET'),
    act('act_create_notes', 'CREATE'), act('act_touch_notes'),
  ],
  workflows: [
    wf('wf_jobs', ['act_create_jobs', 'act_start_jobs', 'act_close_jobs', 'act_list_jobs']),
    wf('wf_notes', ['act_create_notes', 'act_touch_notes']),
    // The board's list. Its condition is added once a page names it (below):
    // only an app's list may carry one.
    wf('wf_app_board', ['act_create_jobs', 'act_start_jobs', 'act_touch_notes']),
  ],
};
// Two of the jobs' acts and a note's; start only while a job is new.
const boardList = wf('wf_app_board', ['act_create_jobs', { activity_ref: 'act_start_jobs', show_condition: "context.record.status = 'new'" }, 'act_touch_notes']);

let db: Db;
let appId: string;
const crew: ContextUser = { id: 'u-crew', name: 'Crew', email: 'crew@example.com', roles: [] };
const as = () => appRouter.createCaller({ db, user: crew, roles: createDbRolesResolver(db), authConfigured: true });
const open = () => appRouter.createCaller({ db });
const offered = async (item: { recordId: string } | { typeId: string }, app = appId) =>
  (await as().page.activities({ operationId: OP, appId: app, items: [item] }))[0].map((a) => a.id);

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'App lists');
  await putModel(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'App lists');
  await open().pages.put({ solutionId: SOL, path: 'pages/board', def: { workflowId: 'wf_app_board' } });
  await open().pages.publish({ solutionId: SOL, path: 'pages/board', readme: 'v1' });
  await open().model.putWorkflow({ solutionId: SOL, def: boardList });
  await open().pages.put({ solutionId: SOL, path: 'pages/bare', def: {} });
  await open().pages.publish({ solutionId: SOL, path: 'pages/bare', readme: 'v1' });
  ({ id: appId } = await open().apps.put({ operationId: OP, pageId: 'pages/board', label: 'Board', roleIds: ['role_crew'], definition: '{}' }));
  await inviteUser(db, { email: 'crew@example.com' });
  await addOpUser(db, { operationId: OP, email: 'crew@example.com' });
  await putUserRoles(db, { operationId: OP, email: 'crew@example.com', roleIds: ['role_crew'] });
  await db.insert(records).values([
    { operationId: OP, id: 'J1', typeRef: 'rt_jobs', customFields: { status: 'new' }, activityHistory: [] },
    { operationId: OP, id: 'J2', typeRef: 'rt_jobs', customFields: { status: 'started' }, activityHistory: [] },
    { operationId: OP, id: 'N1', typeRef: 'rt_notes', customFields: {}, activityHistory: [] },
  ]);
});

describe('an app offers only what its list holds (check 3)', () => {
  it('offers its listed activities on a record, and its listed CREATEs on a type', async () => {
    // A CREATE is offered beside a record too (ACTIONS_OFFERED_BY_SERVER §2.1);
    // act_close_jobs is not on the list.
    expect(await offered({ recordId: 'J1' })).toEqual(['act_create_jobs', 'act_start_jobs']);
    expect(await offered({ typeId: 'rt_jobs' })).toEqual(['act_create_jobs']);
    expect(await offered({ typeId: 'rt_notes' })).toEqual([]); // act_create_notes is not on the list
  });

  it('does not offer an activity added to the record type\'s workflow afterwards', async () => {
    await open().model.putActivity({ solutionId: SOL, def: act('act_hold_jobs') });
    await open().model.putWorkflow({ solutionId: SOL, def: wf('wf_jobs', ['act_create_jobs', 'act_start_jobs', 'act_close_jobs', 'act_list_jobs', 'act_hold_jobs']) });
    expect(await offered({ recordId: 'J1' })).not.toContain('act_hold_jobs');
  });

  it('refuses running an activity not on the list', async () => {
    await expect(as().activities.run({ operationId: OP, appId, activityId: 'act_close_jobs', typeId: 'rt_jobs', recordId: 'J1' }))
      .rejects.toThrow(/not on the list of 'Board'/);
  });

  it('a page with no list offers nothing and runs nothing', async () => {
    const { id: bare } = await open().apps.put({ operationId: OP, pageId: 'pages/bare', label: 'Bare', roleIds: ['role_crew'], definition: '{}' });
    expect(await offered({ recordId: 'J1' }, bare)).toEqual([]);
    await expect(as().activities.run({ operationId: OP, appId: bare, activityId: 'act_start_jobs', typeId: 'rt_jobs', recordId: 'J1' }))
      .rejects.toThrow(/not on the list/);
  });
});

describe('an item\'s condition (check 6)', () => {
  it('hides an activity until it passes, and the run is refused while it fails', async () => {
    expect(await offered({ recordId: 'J2' })).toEqual(['act_create_jobs']); // started, so start is not offered
    await expect(as().activities.run({ operationId: OP, appId, activityId: 'act_start_jobs', typeId: 'rt_jobs', recordId: 'J2' }))
      .rejects.toThrow(/not available/);
    await expect(as().activities.run({ operationId: OP, appId, activityId: 'act_start_jobs', typeId: 'rt_jobs', recordId: 'J1' }))
      .resolves.toMatchObject({ status: 'done' });
  });

  it('applies through the app only — the Console, naming no app, follows the record type\'s rules', async () => {
    await expect(open().activities.run({ operationId: OP, activityId: 'act_start_jobs', recordId: 'J2' })).resolves.toMatchObject({ status: 'done' });
  });
});

describe('a run names the record type it is about (check 4)', () => {
  it('refuses a run through an app that names no type', async () => {
    await expect(as().activities.run({ operationId: OP, appId, activityId: 'act_start_jobs', recordId: 'J1' })).rejects.toThrow(/names the record type/);
  });

  it('refuses a record of another type than the one named, and a type whose workflow lacks the activity', async () => {
    await expect(as().activities.run({ operationId: OP, appId, activityId: 'act_touch_notes', typeId: 'rt_notes', recordId: 'J1' }))
      .rejects.toThrow(/The record is a rt_jobs, not a rt_notes/);
    await expect(as().activities.run({ operationId: OP, appId, activityId: 'act_start_jobs', typeId: 'rt_notes', recordId: 'N1' }))
      .rejects.toThrow(/not in rt_notes's workflow/);
  });

  it('runs a CREATE naming its type and no record', async () => {
    await expect(as().activities.run({ operationId: OP, appId, activityId: 'act_create_jobs', typeId: 'rt_jobs' })).resolves.toMatchObject({ status: 'done' });
  });
});

describe('the app-list rules at model save, for workflows pages name', () => {
  it('refuses a condition on a workflow no page names', async () => {
    await expect(open().model.putWorkflow({ solutionId: SOL, def: wf('wf_notes', ['act_create_notes', { activity_ref: 'act_touch_notes', show_condition: 'true' }]) }))
      .rejects.toThrow(/only an app's list may/);
  });

  it('checks an item\'s condition as the activity\'s own is checked', async () => {
    await expect(open().model.putWorkflow({ solutionId: SOL, def: wf('wf_app_board', ['act_create_jobs', { activity_ref: 'act_start_jobs', show_condition: 'context.record.no_such_field = 1' }, 'act_touch_notes']) }))
      .rejects.toThrow(/act_start_jobs' condition/);
  });

  it('lets the app\'s own activity only log or read', async () => {
    await open().model.putActivity({ solutionId: SOL, def: act('act_wipe', 'DELETE') });
    await expect(open().model.putWorkflow({ solutionId: SOL, def: wf('wf_app_board', ['act_create_jobs', 'act_start_jobs', 'act_touch_notes', 'act_wipe']) }))
      .rejects.toThrow(/may only log or read — not DELETE/);
  });

  it('refuses pointing a record type at a page\'s list, and re-pointing one elsewhere works as before', async () => {
    const rt = (await getSolutionModel(db, SOL)).recordTypes.find((r) => r.id === 'rt_notes')!;
    await expect(open().model.putRecordType({ solutionId: SOL, def: { ...rt, workflow_ref: 'wf_app_board' } })).rejects.toThrow(/names as its app's list/);
    await open().model.putWorkflow({ solutionId: SOL, def: wf('wf_notes_2', ['act_create_notes', 'act_touch_notes']) });
    await expect(open().model.putRecordType({ solutionId: SOL, def: { ...rt, workflow_ref: 'wf_notes_2' } })).resolves.toEqual({ ok: true });
  });
});

describe('a page\'s list is protected, and checked when the page is published', () => {
  it('refuses deleting a workflow a page names, naming the page', async () => {
    await expect(open().model.deleteWorkflow({ solutionId: SOL, id: 'wf_app_board' })).rejects.toThrow(/list of pages\/board/);
  });

  it('refuses a model rollback that would remove one', async () => {
    // Importing a model that lacks the list is what a rollback to an older
    // version does (rollback goes through the same import).
    const { version } = await open().model.publish({ solutionId: SOL, readme: 'with the list' });
    const current = await getSolutionModel(db, SOL);
    await expect(open().model.put({ solutionId: SOL, model: { ...current, workflows: current.workflows.filter((w) => w.id !== 'wf_app_board') } }))
      .rejects.toThrow(/list of pages\/board/);
    expect(version).toBeGreaterThan(0);
  });

  it('refuses publishing a page whose list does not exist, or is a record type\'s workflow', async () => {
    await open().pages.put({ solutionId: SOL, path: 'pages/odd', def: { workflowId: 'wf_ghost' } });
    await expect(open().pages.publish({ solutionId: SOL, path: 'pages/odd', readme: 'x' })).rejects.toThrow(/no such workflow/);
    await open().pages.put({ solutionId: SOL, path: 'pages/odd', def: { workflowId: 'wf_jobs' } });
    await expect(open().pages.publish({ solutionId: SOL, path: 'pages/odd', readme: 'x' })).rejects.toThrow(/workflow of rt_jobs/);
  });

  it('carries the current list forward when a page rolls back to a version from before lists', async () => {
    await open().pages.put({ solutionId: SOL, path: 'pages/old', def: {} });
    await open().pages.publish({ solutionId: SOL, path: 'pages/old', readme: 'v1, no list' });
    await open().pages.put({ solutionId: SOL, path: 'pages/old', def: { workflowId: 'wf_app_board' } });
    await open().pages.publish({ solutionId: SOL, path: 'pages/old', readme: 'v2, the list' });
    const { version } = await open().pages.rollback({ solutionId: SOL, path: 'pages/old', version: 1 });
    const [row] = await db.select().from(pageVersions)
      .where(and(eq(pageVersions.solutionId, SOL), eq(pageVersions.path, 'pages/old'), eq(pageVersions.version, version)));
    expect(row.def).toEqual({ workflowId: 'wf_app_board' });
  });
});
