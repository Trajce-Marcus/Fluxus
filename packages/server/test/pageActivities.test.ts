// `page.activities` — which actions the server offers each item, decided with
// the real user (ACTIONS_OFFERED_BY_SERVER). The rule itself is the engine's
// (engine/test/offeredActivities.test.ts); these cases are what the call adds
// around it: the caller's resolved roles, the read check on a record, and the
// batch.

import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import { addOpUser, ensureOperation, ensureSolution, inviteUser, putConfig, putUserRoles } from '../src/host';
import { appRouter } from '../src/router';
import { records } from '../src/db/schema';
import { createDbRolesResolver } from '../src/auth';
import type { ActivityRawDef, ContextUser, SolutionConfig } from '@fluxus/engine';

const SOL = 'test/page-activities';
const OP = 'test/page-activities';

const act = (id: string, record_map: ActivityRawDef['record_map'], show_condition?: string): ActivityRawDef => ({
  id, name: id, description: '', record_map,
  ...(show_condition ? { show_condition } : {}),
  attributes: [], before_hook: null, after_hook: null,
  ...(record_map === 'GET' ? { returns: 'records.jobs' } : {}),
});

const config: SolutionConfig = {
  access: { roles: [{ id: 'role_admin', name: 'Admin' }, { id: 'role_inspector', name: 'Inspector' }] },
  attributes: [],
  recordTypes: [
    {
      id: 'rt_jobs', name: 'Jobs', description: '', workflow_ref: 'wf_jobs',
      custom_fields: [{ key: 'inspector_email', type: 'text' }],
      access: { read: ['role_admin', 'role_inspector'] },
    },
    {
      id: 'rt_ledgers', name: 'Ledgers', description: '', workflow_ref: 'wf_ledgers',
      custom_fields: [{ key: 'note', type: 'text' }],
      access: { read: ['role_admin'] },
    },
  ],
  activities: [
    act('act_create_jobs', 'CREATE', 'context.record is null'),
    act('act_list_jobs', 'GET'),
    act('act_start_jobs', 'UPDATE', 'lower(context.record.inspector_email) = lower(context.user.email)'),
    act('act_cancel_jobs', 'UPDATE', "'role_admin' in context.user.roles"),
    act('act_note_jobs', 'UPDATE'),
    act('act_close_ledgers', 'UPDATE'),
  ],
  workflows: [
    { id: 'wf_jobs', name: 'Jobs', description: '', activities: ['act_create_jobs', 'act_list_jobs', 'act_start_jobs', 'act_cancel_jobs', 'act_note_jobs'].map((activity_ref) => ({ activity_ref })) },
    { id: 'wf_ledgers', name: 'Ledgers', description: '', activities: [{ activity_ref: 'act_close_ledgers' }] },
  ],
};

let db: Db;
const nick: ContextUser = { id: 'u1', name: 'Nick', email: 'nick@example.com', roles: [] };
const ann: ContextUser = { id: 'u2', name: 'Ann', email: 'ann@example.com', roles: [] };
const boss: ContextUser = { id: 'u3', name: 'Boss', email: 'boss@example.com', roles: [] };

const as = (user: ContextUser) => appRouter.createCaller({ db, user, roles: createDbRolesResolver(db), authConfigured: true });
const ids = (offered: { id: string }[]) => offered.map((a) => a.id);
const offered = async (user: ContextUser, item: { recordId: string } | { typeId: string }) =>
  ids((await as(user).page.activities({ operationId: OP, items: [item] }))[0]);

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'Page activities');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Page activities');
  await db.insert(records).values([
    { operationId: OP, id: 'J1', typeRef: 'rt_jobs', customFields: { inspector_email: 'Nick@Example.com' }, activityHistory: [] },
    { operationId: OP, id: 'L1', typeRef: 'rt_ledgers', customFields: { note: '' }, activityHistory: [] },
  ]);
  for (const [email, role] of [['nick@example.com', 'role_inspector'], ['ann@example.com', 'role_inspector'], ['boss@example.com', 'role_admin']]) {
    await inviteUser(db, { email });
    await addOpUser(db, { operationId: OP, email });
    await putUserRoles(db, { operationId: OP, email, roleIds: [role] });
  }
});

describe('page.activities — with the real user', () => {
  it('offers the assigned inspector their action, and not another inspector', async () => {
    expect(await offered(nick, { recordId: 'J1' })).toEqual(['act_start_jobs', 'act_note_jobs']);
    expect(await offered(ann, { recordId: 'J1' })).toEqual(['act_note_jobs']);
  });

  // One rule: what is not offered is refused when run.
  it('refuses the other inspector when run', async () => {
    await expect(as(ann).activities.run({ operationId: OP, activityId: 'act_start_jobs', recordId: 'J1' }))
      .rejects.toThrow(/not available/);
  });

  it('offers a role\'s action only to its holders', async () => {
    expect(await offered(boss, { recordId: 'J1' })).toContain('act_cancel_jobs');
    expect(await offered(nick, { recordId: 'J1' })).not.toContain('act_cancel_jobs');
  });

  it('never offers a GET', async () => {
    expect(await offered(boss, { recordId: 'J1' })).not.toContain('act_list_jobs');
  });
});

describe('page.activities — records and record types', () => {
  // `context.record is null` keeps a create action off a record's own page.
  it('lets a CREATE condition see the record it is asked about', async () => {
    expect(await offered(boss, { recordId: 'J1' })).not.toContain('act_create_jobs');
  });

  it('answers a record type with its CREATEs, seeing no record', async () => {
    expect(await offered(nick, { typeId: 'rt_jobs' })).toEqual(['act_create_jobs']);
  });

  it('answers an unknown record type with an empty list', async () => {
    expect(await offered(boss, { typeId: 'rt_nothing' })).toEqual([]);
  });
});

describe('page.activities — what the caller may not read', () => {
  it('answers an unreadable record exactly as a missing one: an empty list', async () => {
    expect(await offered(nick, { recordId: 'L1' })).toEqual([]);
    expect(await offered(nick, { recordId: 'NO_SUCH' })).toEqual([]);
    expect(await offered(boss, { recordId: 'L1' })).toEqual(['act_close_ledgers']);
  });

  it('refuses a caller who is not a user of the operation', async () => {
    const stranger: ContextUser = { id: 'u9', name: 'S', email: 'stranger@example.com', roles: [] };
    await expect(as(stranger).page.activities({ operationId: OP, items: [{ recordId: 'J1' }] })).rejects.toThrow(/not a user/i);
  });
});

describe('page.activities — several items', () => {
  it('answers each item on its own, in the order asked', async () => {
    const answers = await as(nick).page.activities({
      operationId: OP,
      items: [{ recordId: 'L1' }, { typeId: 'rt_jobs' }, { recordId: 'J1' }],
    });
    expect(answers.map(ids)).toEqual([[], ['act_create_jobs'], ['act_start_jobs', 'act_note_jobs']]);
  });
});
