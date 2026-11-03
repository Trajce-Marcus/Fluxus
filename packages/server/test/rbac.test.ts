// RBAC stage 1 (M2): record-type read enforcement + the live roles resolver.
// A record type is readable only to roles its `access.read` lists (default
// deny), but ONLY once auth is configured AND the solution declares roles —
// the env stub keeps everything open. Assignments come from the governance
// store (user_roles), resolved into context.user.roles per operation.

import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import { addOpUser, ensureOperation, ensureSolution, inviteUser, putModel, putUserRoles } from '../src/host';
import { appRouter } from '../src/router';
import { records } from '../src/db/schema';
import { createDbRolesResolver } from '../src/auth';
import type { SolutionModel, ContextUser } from '@fluxus/engine';
import { appFor } from './appFor';
import { appointOpAdmin } from '../src/host';

const SOL = 'test/rbac';
const OP = 'test/rbac';

const touch = (id: string) => ({
  id, name: 'Touch', description: '', sort_order: 1,
  attributes: [{ attribute_ref: 'note' }], before_hook: null, after_hook: null,
});

const config: SolutionModel = {
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
// Both are op users of OP — entry and roles are separate questions (the entry
// gate, RBAC_COMPACT "Users"), and these cases are all about the second one:
// what a caller sees once inside. u2 enters and sees nothing.
const u1: ContextUser = { id: 'u1', name: 'U1', email: 'u1@example.com', roles: [] }; // will hold role_a
const u2: ContextUser = { id: 'u2', name: 'U2', email: 'u2@example.com', roles: [] }; // no assignment

// Enforced caller: auth configured + the live resolver.
const enforced = (user: ContextUser) => appRouter.createCaller({ db, user, roles: createDbRolesResolver(db), authConfigured: true });
// Env-stub caller: no authConfigured ⇒ everything open.
const open = () => appRouter.createCaller({ db });
// Reads by role go through an app both roles may run (APPS_AND_INSTANCES §2.3).
let appId: string;
const admin: ContextUser = { id: 'u-admin', name: 'Admin', email: 'admin@example.com', roles: [] }; // op admin, no roles

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'RBAC');
  await putModel(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'RBAC');
  await db.insert(records).values([
    { operationId: OP, id: 'A1', typeRef: 'rt_alpha', customFields: {}, activityHistory: [] },
    { operationId: OP, id: 'B1', typeRef: 'rt_beta', customFields: {}, activityHistory: [] },
    { operationId: OP, id: 'G1', typeRef: 'rt_gamma', customFields: {}, activityHistory: [] },
  ]);
  await putUserRoles(db, { operationId: OP, email: 'u1@example.com', roleIds: ['role_a'] });
  for (const email of ['u1@example.com', 'u2@example.com']) {
    await inviteUser(db, { email });
    await addOpUser(db, { operationId: OP, email });
  }
  await inviteUser(db, { email: 'admin@example.com' });
  await appointOpAdmin(db, { operationId: OP, email: 'admin@example.com' });
  appId = await appFor(db, { solutionId: SOL, operationId: OP, roleIds: ['role_a', 'role_b'] });
});

describe('record-type read filter (default deny, enforced when configured)', () => {
  // Access denied, not not-found, since 2026-10-12 (the user's ruling: showing
  // nothing misleads more than saying access is denied).
  it('get refuses an unreadable record as access denied, and a missing one as not found', async () => {
    await expect(enforced(u1).records.get({ operationId: OP, appId, recordId: 'B1' })).rejects.toThrow('Record access denied');
    await expect(enforced(u1).records.get({ operationId: OP, appId, recordId: 'NO_SUCH' })).rejects.toThrow(/not found/i);
    const a = await enforced(u1).records.get({ operationId: OP, appId, recordId: 'A1' });
    expect(a.id).toBe('A1');
  });

  it('a type with no access.read is denied (default deny)', async () => {
    await expect(enforced(u1).records.get({ operationId: OP, appId, recordId: 'G1' })).rejects.toThrow('Record access denied');
  });

  it('running an activity on an unreadable anchor is access denied (before the gate)', async () => {
    await expect(
      enforced(u1).activities.run({ operationId: OP, appId, activityId: 'act_touch_beta', typeId: 'rt_beta', recordId: 'B1', attributes: { note: 'x' } }),
    ).rejects.toThrow('Record access denied');
  });

  it('running an activity on a readable anchor proceeds', async () => {
    const res = await enforced(u1).activities.run({ operationId: OP, appId, activityId: 'act_touch_alpha', typeId: 'rt_alpha', recordId: 'A1', attributes: { note: 'x' } });
    expect(res.status).toBe('done');
  });

  it('an unassigned user may run no app, so reads nothing', async () => {
    await expect(enforced(u2).records.get({ operationId: OP, appId, recordId: 'A1' })).rejects.toThrow(/may not run/);
  });

  it('the env stub (auth unconfigured) leaves everything open', async () => {
    const rows = await open().records.partition({ operationId: OP });
    expect(rows.map((r) => r.id).sort()).toEqual(['A1', 'B1', 'G1']);
  });
});

// A call with no app (APPS_AND_INSTANCES §2.3, ruled 2026-10-17): an admin of
// the operation, who reads every record in it whatever their roles; refused
// for anyone else.
describe('calls with no app — operation admins only', () => {
  it('lets an operation admin with no roles read every record type', async () => {
    const rows = await enforced(admin).records.partition({ operationId: OP });
    expect(rows.map((r) => r.id).sort()).toEqual(['A1', 'B1', 'G1']);
    expect((await enforced(admin).records.list({ operationId: OP, typeId: 'rt_beta' })).map((r) => r.id)).toEqual(['B1']);
    await expect(enforced(admin).records.get({ operationId: OP, recordId: 'G1' })).resolves.toMatchObject({ id: 'G1' });
    await expect(enforced(admin).activities.run({ operationId: OP, activityId: 'act_touch_beta', typeId: 'rt_beta', recordId: 'B1', attributes: { note: 'x' } }))
      .resolves.toMatchObject({ status: 'done' });
  });

  it('refuses anyone else, whatever their roles', async () => {
    const noApp = /names no app, so it is for admins of operation/;
    await expect(enforced(u1).records.partition({ operationId: OP })).rejects.toThrow(noApp);
    await expect(enforced(u1).records.list({ operationId: OP, typeId: 'rt_alpha' })).rejects.toThrow(noApp);
    await expect(enforced(u1).records.get({ operationId: OP, recordId: 'A1' })).rejects.toThrow(noApp);
    await expect(enforced(u1).activities.run({ operationId: OP, activityId: 'act_touch_alpha', typeId: 'rt_alpha', recordId: 'A1', attributes: { note: 'x' } })).rejects.toThrow(noApp);
    await expect(enforced(u1).page.activities({ operationId: OP, items: [{ recordId: 'A1' }] })).rejects.toThrow(noApp);
    await expect(enforced(u1).scripts.query({ operationId: OP, source: 'records.alpha' })).rejects.toThrow(noApp);
    await expect(enforced(u1).files.presignGet({ solutionId: SOL, operationId: OP, key: 'k' })).rejects.toThrow(noApp);
  });

  it('an operation admin is no admin of another operation', async () => {
    const OTHER = 'test/rbac-other';
    await ensureOperation(db, OTHER, SOL, 'RBAC other');
    await addOpUser(db, { operationId: OTHER, email: 'admin@example.com' });
    await expect(enforced(admin).records.partition({ operationId: OTHER })).rejects.toThrow(/names no app/);
  });
});

// The model was the asymmetry (CLIENT_TRUST_BOUNDARY §2): the data has been
// filtered since M2, while `config.get` handed every runtime user the whole
// SDM. `config.getForOperation` closes it with the same answer that filters the
// partition — projectModel's own cases live in projection.test.ts.
describe('the model is filtered the same way the data is', () => {
  it('ships only what this caller may read, and no hooks', async () => {
    const model = await enforced(u1).model.getForOperation({ operationId: OP });
    expect(model.recordTypes.map((rt) => rt.id)).toEqual(['rt_alpha']);
    expect(model.workflows.map((wf) => wf.id)).toEqual(['wf_alpha']);
    expect(JSON.stringify(model)).not.toContain('_hook');
    expect('access' in model).toBe(false);
  });

  it('an unassigned user gets an empty model, as they get an empty partition', async () => {
    const model = await enforced(u2).model.getForOperation({ operationId: OP });
    expect(model.recordTypes).toEqual([]);
  });

  it('entry is checked before anything is trimmed', async () => {
    const stranger: ContextUser = { id: 'u3', name: 'U3', email: 'u3@example.com', roles: [] };
    await expect(enforced(stranger).model.getForOperation({ operationId: OP })).rejects.toThrow(/not a user/i);
  });

  it('the env stub gets the whole model, minus what never ships', async () => {
    const model = await open().model.getForOperation({ operationId: OP });
    expect(model.recordTypes.map((rt) => rt.id).sort()).toEqual(['rt_alpha', 'rt_beta', 'rt_gamma']);
    expect(JSON.stringify(model)).not.toContain('_hook');
  });
});
