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
  attributes: [],
  recordTypes: [
    { id: 'rt_jobs', name: 'Jobs', description: '', workflow_ref: 'wf_jobs', custom_fields: [{ key: 'note', type: 'text' }], access: { read: ['role_admin', 'role_crew'] } },
  ],
  activities: [act('act_create_jobs', 'CREATE'), act('act_note_jobs', 'UPDATE')],
  workflows: [{ id: 'wf_jobs', name: 'Jobs', description: '', activities: [{ activity_ref: 'act_create_jobs' }, { activity_ref: 'act_note_jobs' }] }],
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
  await db.insert(records).values({ operationId: OP, id: 'J1', typeRef: 'rt_jobs', customFields: { note: '' }, activityHistory: [] });
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
    await expect(as(opBoss).config.get({ solutionId: SOL })).resolves.toMatchObject({ recordTypes: [{ id: 'rt_jobs' }] });
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
