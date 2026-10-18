// An operation's apps list (APPS_AND_INSTANCES Part 2 §2.4–§2.6): apps are
// records of the platform's `rt_sys_apps`, set up by the operation's admins in
// the Console, every change leaving a history entry, and kept out of every
// general read.

import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '../src/db/client';
import { addOpUser, appointOpAdmin, appointSolAdmin, ensureOperation, ensureSolution, inviteUser, putConfig, putUserRoles } from '../src/host';
import { appRouter } from '../src/router';
import { records, rptActivities } from '../src/db/schema';
import { createDbRolesResolver } from '../src/auth';
import type { ActivityRawDef, ContextUser, SolutionConfig } from '@fluxus/engine';

const SOL = 'test/apps';
const OP = 'test/apps';
const OTHER_OP = 'test/apps-other';

const act = (id: string, record_map: ActivityRawDef['record_map']): ActivityRawDef => ({
  id, name: id, description: '', record_map, attributes: [], before_hook: null, after_hook: null,
});

const config: SolutionConfig = {
  access: { roles: [{ id: 'role_admin', name: 'Admin' }, { id: 'role_crew', name: 'Crew' }] },
  attributes: [{ key: 'ledger', label: 'Ledger', description: '', type: 'reference', type_config: { fk_record_type: 'rt_ledgers' } }],
  recordTypes: [
    { id: 'rt_jobs', name: 'Jobs', description: '', workflow_ref: 'wf_jobs', custom_fields: [{ key: 'note', type: 'text' }], access: { read: ['role_admin', 'role_crew'] } },
    // Read by admins only: a crew member may not send one back.
    { id: 'rt_ledgers', name: 'Ledgers', description: '', workflow_ref: 'wf_ledgers', custom_fields: [{ key: 'note', type: 'text' }], access: { read: ['role_admin'] } },
  ],
  activities: [
    act('act_create_jobs', 'CREATE'),
    act('act_note_jobs', 'UPDATE'),
    { ...act('act_link_jobs', 'UPDATE'), attributes: [{ attribute_ref: 'ledger' }] },
    { ...act('act_list_jobs', 'GET'), returns: 'records.jobs' },
  ],
  workflows: [
    { id: 'wf_jobs', name: 'Jobs', description: '', activities: ['act_create_jobs', 'act_note_jobs', 'act_link_jobs', 'act_list_jobs'].map((activity_ref) => ({ activity_ref })) },
    { id: 'wf_ledgers', name: 'Ledgers', description: '', activities: [] },
  ],
};

let db: Db;
const opBoss: ContextUser = { id: 'u-opboss', name: 'Op Boss', email: 'opboss@example.com', roles: [] };
const solBoss: ContextUser = { id: 'u-solboss', name: 'Sol Boss', email: 'solboss@example.com', roles: [] };
const crew: ContextUser = { id: 'u-crew', name: 'Crew', email: 'crew@example.com', roles: [] };

const as = (user: ContextUser) => appRouter.createCaller({ db, user, roles: createDbRolesResolver(db), authConfigured: true });
const open = () => appRouter.createCaller({ db });

const water = { pageId: 'pages/scheduler', label: 'Water scheduler', roleIds: ['role_crew'], definition: '{"network":"water"}' };

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'Apps');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Apps');
  await ensureOperation(db, OTHER_OP, SOL, 'Apps, other');
  for (const path of ['pages/scheduler', 'pages/board']) {
    await open().pages.put({ solutionId: SOL, path, def: {} });
    await open().pages.publish({ solutionId: SOL, path, readme: 'seed' });
  }
  await open().pages.put({ solutionId: SOL, path: 'pages/draft-only', def: {} });
  for (const email of ['opboss@example.com', 'solboss@example.com', 'crew@example.com']) await inviteUser(db, { email });
  await appointOpAdmin(db, { operationId: OP, email: 'opboss@example.com' });
  await appointSolAdmin(db, { solutionId: SOL, email: 'solboss@example.com' });
  await addOpUser(db, { operationId: OP, email: 'crew@example.com' });
  await putUserRoles(db, { operationId: OP, email: 'crew@example.com', roleIds: ['role_crew'] });
  await db.insert(records).values([
    { operationId: OP, id: 'J1', typeRef: 'rt_jobs', customFields: { note: '' }, activityHistory: [] },
    { operationId: OP, id: 'L1', typeRef: 'rt_ledgers', customFields: { note: '' }, activityHistory: [] },
  ]);
});

describe('apps.put — adding and changing apps', () => {
  it('adds an app, and its first history entry carries every field', async () => {
    const { id } = await as(opBoss).apps.put({ operationId: OP, ...water });
    const app = await as(opBoss).apps.get({ operationId: OP, appId: id });
    expect(app).toMatchObject({ id, ...water });
    expect(app.activityHistory).toHaveLength(1);
    expect(app.activityHistory[0]).toMatchObject({
      activityId: 'sys_console_edit',
      activityName: 'Changed in the Console',
      author: 'u-opboss',
      capturedAttributes: { page_id: 'pages/scheduler', label: 'Water scheduler', role_ids: '["role_crew"]', definition: '{"network":"water"}' },
    });
    // With every other history: the reporting row lands too.
    const rows = await db.select().from(rptActivities).where(and(eq(rptActivities.operationId, OP), eq(rptActivities.recordId, id)));
    expect(rows.map((r) => [r.recordType, r.activityId])).toEqual([['rt_sys_apps', 'sys_console_edit']]);
  });

  it('records only the changed fields, and a change that changes nothing writes nothing', async () => {
    const { id } = await as(opBoss).apps.put({ operationId: OP, ...water, label: 'Water' });
    await as(opBoss).apps.put({ operationId: OP, id, ...water, label: 'Water', roleIds: ['role_admin', 'role_crew'] });
    await as(opBoss).apps.put({ operationId: OP, id, ...water, label: 'Water', roleIds: ['role_admin', 'role_crew'] });
    const app = await as(opBoss).apps.get({ operationId: OP, appId: id });
    expect(app.activityHistory.map((e) => e.capturedAttributes)).toEqual([
      { page_id: 'pages/scheduler', label: 'Water', role_ids: '["role_crew"]', definition: '{"network":"water"}' },
      { role_ids: '["role_admin","role_crew"]' },
    ]);
  });

  it('makes two apps from one page, each with its own name, roles and history', async () => {
    const a = await as(opBoss).apps.put({ operationId: OP, ...water, label: 'Water 2' });
    const b = await as(opBoss).apps.put({ operationId: OP, pageId: 'pages/scheduler', label: 'Sewer scheduler', roleIds: ['role_admin'], definition: '' });
    expect(a.id).not.toBe(b.id);
    const sewer = await as(opBoss).apps.get({ operationId: OP, appId: b.id });
    expect(sewer).toMatchObject({ label: 'Sewer scheduler', roleIds: ['role_admin'], definition: '{}' });
    expect(sewer.activityHistory).toHaveLength(1);
  });

  it('checks what it saves', async () => {
    const put = (app: Partial<typeof water>) => as(opBoss).apps.put({ operationId: OP, ...water, ...app });
    await expect(put({ pageId: 'pages/draft-only' })).rejects.toThrow(/no published page 'pages\/draft-only'/);
    await expect(put({ roleIds: ['role_ghost'] })).rejects.toThrow(/unknown role 'role_ghost'/);
    await expect(put({ label: '  ' })).rejects.toThrow(/give the app a name/);
    await expect(put({ definition: '{ nope' })).rejects.toThrow(/not JSON/);
    await expect(as(opBoss).apps.put({ operationId: OP, id: 'J1', ...water })).rejects.toThrow(/not set up for this operation/);
  });

  it('lists the apps without their history', async () => {
    const { apps } = await as(opBoss).apps.list({ operationId: OP });
    expect(apps.length).toBeGreaterThanOrEqual(4);
    expect(apps.every((a) => !('activityHistory' in a))).toBe(true);
  });
});

describe('who sets up apps — the operation\'s admins', () => {
  it('refuses a user of the operation who is not its admin, and a solution admin who is not', async () => {
    await expect(as(crew).apps.list({ operationId: OP })).rejects.toThrow(/admin of operation/);
    await expect(as(crew).apps.put({ operationId: OP, ...water })).rejects.toThrow(/admin of operation/);
    await expect(as(solBoss).apps.list({ operationId: OP })).rejects.toThrow(/admin of operation/);
  });

  it('keeps each operation\'s apps its own', async () => {
    await expect(as(opBoss).apps.list({ operationId: OTHER_OP })).rejects.toThrow(/admin of operation/);
    const { id } = await open().apps.put({ operationId: OTHER_OP, ...water });
    await expect(open().apps.get({ operationId: OP, appId: id })).rejects.toThrow(/not set up for this operation/);
  });
});

describe('operation admins in the Console (§2.6)', () => {
  it('lets an operation admin read the model and the published pages, but not change the model', async () => {
    await expect(as(opBoss).config.get({ solutionId: SOL })).resolves.toMatchObject({ recordTypes: [{ id: 'rt_jobs' }, { id: 'rt_ledgers' }] });
    await expect(as(opBoss).pages.publishedPaths({ solutionId: SOL })).resolves.toEqual(['pages/board', 'pages/scheduler']);
    await expect(as(opBoss).config.put({ solutionId: SOL, config })).rejects.toThrow(/admin of this solution/);
    await expect(as(opBoss).pages.list({ solutionId: SOL })).rejects.toThrow(/admin of this solution/);
  });

  it('still refuses someone who administers neither', async () => {
    await expect(as(crew).config.get({ solutionId: SOL })).rejects.toThrow(/admin of this solution or of one of its operations/);
    await expect(as(crew).pages.publishedPaths({ solutionId: SOL })).rejects.toThrow(/admin of this solution or of one of its operations/);
  });

  it('a solution admin keeps designing', async () => {
    await expect(as(solBoss).config.get({ solutionId: SOL })).resolves.toBeDefined();
    await expect(as(solBoss).pages.list({ solutionId: SOL })).resolves.toHaveLength(3);
  });
});

describe('apps are kept out of every general read (§2.4)', () => {
  let appId: string;
  beforeAll(async () => {
    ({ id: appId } = await open().apps.put({ operationId: OP, ...water, label: 'Hidden' }));
  });

  it('never in the partition or a list by type, even with sign-in off', async () => {
    const partition = await open().records.partition({ operationId: OP });
    expect(partition.some((r) => r.typeRef === 'rt_sys_apps')).toBe(false);
    expect(partition.map((r) => r.id)).toContain('J1');
    await expect(open().records.list({ operationId: OP, typeId: 'rt_sys_apps' })).resolves.toEqual([]);
  });

  it('refuses a call that sends an app\'s id as its record', async () => {
    await expect(open().records.get({ operationId: OP, recordId: appId })).rejects.toThrow(/Record access denied/);
    await expect(open().activities.run({ operationId: OP, activityId: 'act_note_jobs', recordId: appId })).rejects.toThrow(/Record access denied/);
    const [answer] = await open().page.activities({ operationId: OP, items: [{ recordId: appId }] });
    expect(answer).toEqual([]);
    const script = await open().scripts.query({ operationId: OP, source: 'context.record', recordId: appId });
    expect(script.error?.message).toBe('Record access denied');
  });

  it('does not count as a stray record type when the model is saved', async () => {
    await expect(open().config.putRecordType({ solutionId: SOL, def: config.recordTypes[0] })).resolves.toEqual({ ok: true });
  });

  it('reserves the platform\'s ids', async () => {
    await expect(open().config.putActivity({ solutionId: SOL, def: act('sys_console_edit', 'UPDATE') })).rejects.toThrow(/reserved by the platform/);
    await expect(open().config.putWorkflow({ solutionId: SOL, def: { id: 'wf_sys_apps', name: 'X', description: '', activities: [] } })).rejects.toThrow(/reserved by the platform/);
  });
});

describe('the Runtime through apps (§2.3, §2.5, §2.7)', () => {
  const USER_OP = 'test/apps-user';
  let water: string;
  let sewer: string;
  let board: string;
  const boss: ContextUser = { id: 'u-boss', name: 'Boss', email: 'boss@example.com', roles: [] };
  beforeAll(async () => {
    await ensureOperation(db, USER_OP, SOL, 'Apps, users');
    await inviteUser(db, { email: 'boss@example.com' });
    for (const [email, role] of [['crew@example.com', 'role_crew'], ['boss@example.com', 'role_admin']]) {
      await addOpUser(db, { operationId: USER_OP, email });
      await putUserRoles(db, { operationId: USER_OP, email, roleIds: [role] });
    }
    ({ id: water } = await open().apps.put({ operationId: USER_OP, pageId: 'pages/scheduler', label: 'Water scheduler', roleIds: ['role_crew'], definition: '{"network":"water"}' }));
    ({ id: sewer } = await open().apps.put({ operationId: USER_OP, pageId: 'pages/scheduler', label: 'Sewer scheduler', roleIds: ['role_admin'], definition: '{"network":"sewer"}' }));
    ({ id: board } = await open().apps.put({ operationId: USER_OP, pageId: 'pages/board', label: 'Board', roleIds: ['role_crew', 'role_admin'], definition: '{}' }));
    await open().operations.putConfig({
      operationId: USER_OP,
      config: { menu: [{ id: 'g1', label: 'Schedulers', items: [{ id: 'm1', appId: water }, { id: 'm2', appId: sewer }] }, { id: 'm3', appId: board }] },
    });
    await db.insert(records).values([
      { operationId: USER_OP, id: 'J2', typeRef: 'rt_jobs', customFields: { note: '' }, activityHistory: [] },
      { operationId: USER_OP, id: 'L2', typeRef: 'rt_ledgers', customFields: { note: '' }, activityHistory: [] },
    ]);
  });

  it('sends each user the apps they may run and a menu built from them', async () => {
    const mine = await as(crew).apps.user({ operationId: USER_OP });
    expect(mine.apps.map((a) => a.label)).toEqual(['Water scheduler', 'Board']);
    expect(mine.apps[0]).toEqual({ id: water, label: 'Water scheduler', pageId: 'pages/scheduler', definition: '{"network":"water"}' });
    expect(mine.menu).toEqual([{ id: 'g1', label: 'Schedulers', items: [{ id: 'm1', appId: water }] }, { id: 'm3', appId: board }]);
    expect(mine.pages.map((p) => p.path).sort()).toEqual(['pages/board', 'pages/scheduler']);
    // Two apps from the scheduler page, so it has no only app; the board has one.
    expect(mine.appIdByPageId).toEqual({ 'pages/board': board });

    const bosses = await as(boss).apps.user({ operationId: USER_OP });
    expect(bosses.menu).toEqual([{ id: 'g1', label: 'Schedulers', items: [{ id: 'm2', appId: sewer }] }, { id: 'm3', appId: board }]);
  });

  it('a group that keeps no leaf goes, and someone with no role sees nothing', async () => {
    const nobody: ContextUser = { id: 'u-nobody', name: 'Nobody', email: 'nobody@example.com', roles: [] };
    await inviteUser(db, { email: 'nobody@example.com' });
    await addOpUser(db, { operationId: USER_OP, email: 'nobody@example.com' });
    await expect(as(nobody).apps.user({ operationId: USER_OP })).resolves.toMatchObject({ apps: [], menu: [], pages: [] });
  });

  it('no longer sends the menu with the operation', async () => {
    const op = await as(crew).operations.get({ operationId: USER_OP });
    expect(op.config).toEqual({});
    expect((await open().operations.list()).every((o) => !('menu' in o.config))).toBe(true);
  });

  it('runs a call through an app the caller may run', async () => {
    await expect(as(crew).activities.run({ operationId: USER_OP, appId: water, activityId: 'act_note_jobs', recordId: 'J2' }))
      .resolves.toMatchObject({ status: 'done' });
    await expect(as(crew).records.get({ operationId: USER_OP, appId: water, recordId: 'J2' })).resolves.toMatchObject({ id: 'J2' });
    await expect(as(crew).activities.query({ operationId: USER_OP, appId: water, activityId: 'act_list_jobs' })).resolves.toBeDefined();
  });

  it('refuses a call naming an app the caller holds no role on, or no app of this operation', async () => {
    await expect(as(crew).activities.run({ operationId: USER_OP, appId: sewer, activityId: 'act_note_jobs', recordId: 'J2' }))
      .rejects.toThrow(/may not run 'Sewer scheduler'/);
    await expect(as(crew).activities.query({ operationId: USER_OP, appId: sewer, activityId: 'act_list_jobs' }))
      .rejects.toThrow(/may not run/);
    await expect(as(crew).records.get({ operationId: USER_OP, appId: sewer, recordId: 'J2' })).rejects.toThrow(/may not run/);
    await expect(as(crew).activities.run({ operationId: USER_OP, appId: 'ghost', activityId: 'act_note_jobs', recordId: 'J2' }))
      .rejects.toThrow(/not set up for this operation/);
    // An app of another operation is not this operation's.
    const elsewhere = (await open().apps.list({ operationId: OP })).apps[0].id;
    await expect(as(crew).records.get({ operationId: USER_OP, appId: elsewhere, recordId: 'J2' })).rejects.toThrow(/not set up for this operation/);
  });

  it('answers the offered actions empty for an app the caller may not run', async () => {
    const [ok] = await as(crew).page.activities({ operationId: USER_OP, appId: water, items: [{ recordId: 'J2' }] });
    expect(ok.length).toBeGreaterThan(0);
    const [none] = await as(crew).page.activities({ operationId: USER_OP, appId: sewer, items: [{ recordId: 'J2' }] });
    expect(none).toEqual([]);
  });

  it('refuses a run whose reference field names a record the caller may not read', async () => {
    await expect(as(crew).activities.run({ operationId: USER_OP, appId: water, activityId: 'act_link_jobs', recordId: 'J2', attributes: { ledger: 'L2' } }))
      .rejects.toThrow(/Ledger: Record access denied/);
    await expect(as(boss).activities.run({ operationId: USER_OP, appId: board, activityId: 'act_link_jobs', recordId: 'J2', attributes: { ledger: 'L2' } }))
      .resolves.toMatchObject({ status: 'done' });
  });

  it('checks file calls through the app too', async () => {
    const get = (user: ContextUser, appId: string) => as(user).files.presignGet({ solutionId: SOL, operationId: USER_OP, appId, key: 'k' });
    await expect(get(crew, sewer)).rejects.toThrow(/may not run/);
    // Past the checks, this test server has no blob store.
    await expect(get(crew, water)).rejects.toThrow(/not configured/);
    await expect(as(crew).files.presignGet({ solutionId: 'demo/sdm', operationId: USER_OP, appId: water, key: 'k' }))
      .rejects.toThrow(/does not run solution/);
  });
});
