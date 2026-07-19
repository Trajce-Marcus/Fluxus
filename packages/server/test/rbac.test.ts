// RBAC stage 1 (M2): record-type read enforcement + the live roles resolver.
// A record type is readable only to roles its `access.read` lists (default
// deny), but ONLY once auth is configured AND the solution declares roles —
// the env stub keeps everything open. Assignments come from the governance
// store (role_assignments), resolved into context.user.roles per operation.

import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import { ensureOperation, ensureSolution, putConfig, putRoleAssignment } from '../src/host';
import { appRouter } from '../src/router';
import { records } from '../src/db/schema';
import { createDbRolesResolver } from '../src/auth';
import type { ConfigRaw, ContextUser } from '@fluxus/engine';

const SOL = 'test/rbac';
const OP = 'test/rbac';

const touch = (id: string) => ({
  id, name: 'Touch', description: '', sort_order: 1,
  attributes: [{ attribute_ref: 'note' }], before_hook: null, after_hook: null,
});

const config: ConfigRaw = {
  access: { roles: [{ id: 'role_a', name: 'As' }, { id: 'role_b', name: 'Bs' }] },
  attributes: [
    { key: 'id', label: 'ID', description: '', type: 'text' },
    { key: 'note', label: 'Note', description: '', type: 'text' },
  ],
  recordTypes: [
    { id: 'rt_alpha', name: 'Alpha', description: '', workflow_ref: 'wf_alpha', custom_fields: [{ key: 'note', type: 'text' }], access: { read: ['role_a'] } },
    { id: 'rt_beta', name: 'Beta', description: '', workflow_ref: 'wf_beta', custom_fields: [{ key: 'note', type: 'text' }], access: { read: ['role_b'] } },
    { id: 'rt_gamma', name: 'Gamma', description: '', workflow_ref: 'wf_gamma', custom_fields: [{ key: 'note', type: 'text' }] }, // no access.read → default deny
  ],
  workflows: [
    { id: 'wf_alpha', name: 'Alpha', description: '', activities: [touch('act_touch_alpha')] },
    { id: 'wf_beta', name: 'Beta', description: '', activities: [touch('act_touch_beta')] },
    { id: 'wf_gamma', name: 'Gamma', description: '', activities: [touch('act_touch_gamma')] },
  ],
};

let db: Db;
const u1: ContextUser = { id: 'u1', name: 'U1', email: null, roles: [] }; // will hold role_a
const u2: ContextUser = { id: 'u2', name: 'U2', email: null, roles: [] }; // no assignment

// Enforced caller: auth configured + the live resolver.
const enforced = (user: ContextUser) => appRouter.createCaller({ db, user, roles: createDbRolesResolver(db), authConfigured: true });
// Env-stub caller: no authConfigured ⇒ everything open.
const open = () => appRouter.createCaller({ db });

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'RBAC');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'RBAC');
  await db.insert(records).values([
    { operationId: OP, id: 'A1', typeRef: 'rt_alpha', customFields: {}, activityHistory: [] },
    { operationId: OP, id: 'B1', typeRef: 'rt_beta', customFields: {}, activityHistory: [] },
    { operationId: OP, id: 'G1', typeRef: 'rt_gamma', customFields: {}, activityHistory: [] },
  ]);
  await putRoleAssignment(db, { operationId: OP, userId: 'u1', roleIds: ['role_a'] });
});

describe('record-type read filter (default deny, enforced when configured)', () => {
  it('partition returns only the readable type', async () => {
    const rows = await enforced(u1).records.partition({ operationId: OP });
    expect(rows.map((r) => r.id).sort()).toEqual(['A1']); // rt_beta + rt_gamma hidden
  });

  it('get denies an unreadable record as not-found', async () => {
    await expect(enforced(u1).records.get({ operationId: OP, recordId: 'B1' })).rejects.toThrow(/not found/i);
    const a = await enforced(u1).records.get({ operationId: OP, recordId: 'A1' });
    expect(a.id).toBe('A1');
  });

  it('list of an unreadable type is empty, readable type returns rows', async () => {
    expect(await enforced(u1).records.list({ operationId: OP, typeId: 'rt_beta' })).toEqual([]);
    expect((await enforced(u1).records.list({ operationId: OP, typeId: 'rt_alpha' })).map((r) => r.id)).toEqual(['A1']);
  });

  it('a type with no access.read is denied (default deny)', async () => {
    await expect(enforced(u1).records.get({ operationId: OP, recordId: 'G1' })).rejects.toThrow(/not found/i);
  });

  it('running an activity on an unreadable anchor is not-found (before the gate)', async () => {
    await expect(
      enforced(u1).activities.run({ operationId: OP, activityId: 'act_touch_beta', recordId: 'B1', attributes: { note: 'x' } }),
    ).rejects.toThrow(/not found/i);
  });

  it('running an activity on a readable anchor proceeds', async () => {
    const res = await enforced(u1).activities.run({ operationId: OP, activityId: 'act_touch_alpha', recordId: 'A1', attributes: { note: 'x' } });
    expect(res.status).toBe('done');
  });

  it('an unassigned user sees nothing', async () => {
    expect(await enforced(u2).records.partition({ operationId: OP })).toEqual([]);
  });

  it('the env stub (auth unconfigured) leaves everything open', async () => {
    const rows = await open().records.partition({ operationId: OP });
    expect(rows.map((r) => r.id).sort()).toEqual(['A1', 'B1', 'G1']);
  });
});
