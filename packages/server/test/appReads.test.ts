// An app's list — reads (APPS_AND_INSTANCES Part 2 step 4, §2.2–§2.3). Through
// an app a GET answers only when it is on the app's list or a listed
// activity's form calls it (a datasource, composite cells and named functions
// included); an item's condition must pass along with the GET's own; a GET
// shared by several types runs with no record. GET parameters stay unchecked,
// and a call with no app is untouched.

import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import { addOpUser, ensureOperation, ensureSolution, inviteUser, putConfig, putUserRoles } from '../src/host';
import { appRouter } from '../src/router';
import { createDbRolesResolver } from '../src/auth';
import { records } from '../src/db/schema';
import type { ActivityRawDef, AttributeDef, ContextUser, SolutionConfig, WorkflowRawDef } from '@fluxus/engine';

const SOL = 'test/app-reads';
const OP = 'test/app-reads';

const get = (id: string, returns = 'records.jobs'): ActivityRawDef => ({
  id, name: id, description: '', record_map: 'GET', attributes: [], before_hook: null, after_hook: null, returns,
});
const act = (id: string, attributes: string[] = []): ActivityRawDef => ({
  id, name: id, description: '', attributes: attributes.map((attribute_ref) => ({ attribute_ref })), before_hook: null, after_hook: null,
});
const list = (key: string, datasource: string): AttributeDef => ({
  key, label: key, description: '', type: 'list', type_config: { datasource, key_field: 'id', display_field: 'id' },
});
const wf = (id: string, refs: (string | { activity_ref: string; show_condition?: string })[]): WorkflowRawDef => ({
  id, name: id, description: '', activities: refs.map((r) => (typeof r === 'string' ? { activity_ref: r } : r)),
});

const config: SolutionConfig = {
  access: { roles: [{ id: 'role_crew', name: 'Crew' }] },
  attributes: [
    list('crew', "invoke('act_list_crews')"),
    list('region', 'regionsfor()'),
    list('cell_crew', "invoke('act_list_cell_crews')"),
    { key: 'shift', label: 'Shift', description: '', type: 'composite', type_config: { attributes: [{ attribute_ref: 'cell_crew' }] } },
    list('secret', "invoke('act_list_secrets')"),
  ],
  functions: [{ id: 'fn_regionsfor', name: 'regionsfor', description: 'd', body: "function regionsfor() { return invoke('act_list_regions') }" }],
  recordTypes: [
    { id: 'rt_jobs', name: 'Jobs', description: '', workflow_ref: 'wf_jobs', custom_fields: [{ key: 'status', type: 'text' }], access: { read: ['role_crew'] } },
    { id: 'rt_notes', name: 'Notes', description: '', workflow_ref: 'wf_notes', custom_fields: [], access: { read: ['role_crew'] } },
  ],
  activities: [
    act('act_assign_jobs', ['crew']), act('act_plan_jobs', ['region', 'shift']), act('act_audit_jobs', ['secret']),
    get('act_list_jobs'), get('act_list_open_jobs'), get('act_list_crews'), get('act_list_regions'), get('act_list_cell_crews'),
    get('act_list_secrets'), get('act_list_everything'), get('act_board_summary'),
  ],
  workflows: [
    wf('wf_jobs', ['act_assign_jobs', 'act_plan_jobs', 'act_audit_jobs', 'act_list_jobs', 'act_list_open_jobs', 'act_list_crews',
      'act_list_regions', 'act_list_cell_crews', 'act_list_secrets', 'act_list_everything']),
    wf('wf_notes', ['act_list_everything']),
    // The board's list; the app's own GET and the item's condition are added
    // once a page names it (only an app's list may carry them).
    wf('wf_app_board', ['act_assign_jobs', 'act_plan_jobs', 'act_list_jobs', 'act_list_open_jobs', 'act_list_everything']),
  ],
};
const boardList = wf('wf_app_board', [
  'act_assign_jobs', 'act_plan_jobs', 'act_list_jobs',
  { activity_ref: 'act_list_open_jobs', show_condition: "context.record.status = 'new'" },
  'act_list_everything', 'act_board_summary',
]);

let db: Db;
let appId: string;
const crew: ContextUser = { id: 'u-crew', name: 'Crew', email: 'crew@example.com', roles: [] };
const as = () => appRouter.createCaller({ db, user: crew, roles: createDbRolesResolver(db), authConfigured: true });
const open = () => appRouter.createCaller({ db });
const query = (activityId: string, recordId?: string, app = appId) =>
  as().activities.query({ operationId: OP, appId: app, activityId, ...(recordId ? { recordId } : {}) });

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'App reads');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'App reads');
  await open().pages.put({ solutionId: SOL, path: 'pages/board', def: { workflowId: 'wf_app_board' } });
  await open().pages.publish({ solutionId: SOL, path: 'pages/board', readme: 'v1' });
  await open().config.putWorkflow({ solutionId: SOL, def: boardList });
  await open().pages.put({ solutionId: SOL, path: 'pages/bare', def: {} });
  await open().pages.publish({ solutionId: SOL, path: 'pages/bare', readme: 'v1' });
  ({ id: appId } = await open().apps.put({ operationId: OP, pageId: 'pages/board', label: 'Board', roleIds: ['role_crew'], definition: '{}' }));
  await inviteUser(db, { email: 'crew@example.com' });
  await addOpUser(db, { operationId: OP, email: 'crew@example.com' });
  await putUserRoles(db, { operationId: OP, email: 'crew@example.com', roleIds: ['role_crew'] });
  await db.insert(records).values([
    { operationId: OP, id: 'J1', typeRef: 'rt_jobs', customFields: { status: 'new' }, activityHistory: [] },
    { operationId: OP, id: 'J2', typeRef: 'rt_jobs', customFields: { status: 'started' }, activityHistory: [] },
  ]);
});

describe('a GET through an app (check 3)', () => {
  it('answers when it is on the list', async () => {
    await expect(query('act_list_jobs')).resolves.toMatchObject({ data: expect.any(Array) });
  });

  it("answers when a listed activity's form calls it — directly, through a named function, or from a composite cell", async () => {
    for (const id of ['act_list_crews', 'act_list_regions', 'act_list_cell_crews']) {
      await expect(query(id, 'J1')).resolves.toMatchObject({ data: expect.any(Array) });
    }
  });

  it("is refused when it is neither on the list nor called by a listed activity's form", async () => {
    // act_audit_jobs's form calls act_list_secrets, but act_audit_jobs is not on the list.
    await expect(query('act_list_secrets')).rejects.toThrow(/'act_list_secrets' is not on the list of 'Board'/);
  });

  it('a page with no list runs no GETs', async () => {
    const { id: bare } = await open().apps.put({ operationId: OP, pageId: 'pages/bare', label: 'Bare', roleIds: ['role_crew'], definition: '{}' });
    await expect(query('act_list_jobs', undefined, bare)).rejects.toThrow(/not on the list of 'Bare'/);
  });

  it('a call with no app is untouched: an operation admin runs any GET', async () => {
    await expect(open().activities.query({ operationId: OP, activityId: 'act_list_secrets' })).resolves.toMatchObject({ data: expect.any(Array) });
  });
});

describe('the GET and the model (check 4)', () => {
  it('runs a GET shared by several record types with no record', async () => {
    await expect(query('act_list_everything')).resolves.toMatchObject({ data: expect.any(Array) });
  });

  it("refuses the app's own GET until step 5", async () => {
    await expect(query('act_board_summary')).rejects.toThrow(/an app's own activities cannot run yet/);
  });
});

describe("an item's condition on a GET (check 6)", () => {
  it('answers while it passes and is refused while it fails', async () => {
    await expect(query('act_list_open_jobs', 'J1')).resolves.toMatchObject({ data: expect.any(Array) });
    await expect(query('act_list_open_jobs', 'J2')).rejects.toThrow(/not available/);
  });
});
