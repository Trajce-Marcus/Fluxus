// The entry gate (RBAC_COMPACT "Users", ruled 2026-08-02): op_users decides
// whether a caller may open an operation AT ALL — a separate question from what
// roles let them see once inside.
//
// **Strict, not dormant.** An operation with no op_users admits nobody.
// Deliberately unlike the record-type/page/sol-user surfaces, which are
// dormant-until-declared: those ask "what may you see", and staying visible
// until configured is a reasonable adoption default. This asks "may you enter",
// and an operation with no users listed has, literally, no users.

import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import {
  addOpUser,
  bindAuthUser,
  bootstrapOrgAdmin,
  ensureOperation,
  ensureSolution,
  inviteOrgUser,
  listOpUsers,
  listOrgUsers,
  putConfig,
  putSolUser,
  putUserRoles,
  removeOpUser,
  removeOrgUser,
} from '../src/host';
import { appRouter } from '../src/router';
import { createDbRolesResolver } from '../src/auth';
import type { ConfigRaw, ContextUser } from '@fluxus/engine';

const SOL = 'test/opusers';
const OP = 'test/opusers';

const config: ConfigRaw = {
  access: { roles: [{ id: 'role_a', name: 'As' }] },
  attributes: [{ key: 'id', label: 'ID', description: '', type: 'text' }],
  recordTypes: [
    { id: 'rt_alpha', name: 'Alpha', description: '', workflow_ref: 'wf_alpha', custom_fields: [], access: { read: ['role_a'] } },
  ],
  workflows: [{ id: 'wf_alpha', name: 'Alpha', description: '', activities: [] }],
};

let db: Db;
const opUser: ContextUser = { id: 'auth-1', name: 'Op User', email: 'user@example.com', roles: [] };
const stranger: ContextUser = { id: 'auth-2', name: 'Stranger', email: 'stranger@example.com', roles: [] };

const enforced = (user: ContextUser) =>
  appRouter.createCaller({ db, user, roles: createDbRolesResolver(db), authConfigured: true });
const open = (user: ContextUser) => appRouter.createCaller({ db, user });

const emails = (rows: { email: string }[]) => rows.map((r) => r.email);

beforeEach(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'Op users');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Op users');
});

describe('the pool is the only way in', () => {
  it('adding an uninvited email to an operation is refused', async () => {
    await expect(addOpUser(db, { operationId: OP, email: 'nobody@example.com' })).rejects.toThrow(/not in this organisation/i);
  });

  it('an invited user can be added, and appears in the op list', async () => {
    await inviteOrgUser(db, { email: 'user@example.com', name: 'Op User' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    expect(await listOpUsers(db, OP)).toEqual([{ email: 'user@example.com', level: 'user' }]);
  });

  it('email is normalised, so one person cannot become two', async () => {
    await inviteOrgUser(db, { email: '  User@Example.COM ', name: 'Op User' });
    await inviteOrgUser(db, { email: 'user@example.com', name: 'Op User Again' });
    const pool = await listOrgUsers(db);
    expect(pool).toHaveLength(1);
    expect(pool[0].email).toBe('user@example.com');
  });

  it('a new pool user is a plain user, never an admin, at both layers', async () => {
    await inviteOrgUser(db, { email: 'user@example.com' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    expect((await listOrgUsers(db))[0].level).toBe('user');
    expect((await listOpUsers(db, OP))[0].level).toBe('user');
  });

  it('a plain re-invite never silently demotes an existing admin', async () => {
    await inviteOrgUser(db, { email: 'user@example.com', level: 'admin' });
    await inviteOrgUser(db, { email: 'user@example.com', name: 'Renamed' });
    expect((await listOrgUsers(db))[0]).toMatchObject({ level: 'admin', name: 'Renamed' });
  });
});

describe('the entry gate', () => {
  it('an operation with no users admits nobody', async () => {
    await expect(enforced(stranger).records.partition({ operationId: OP })).rejects.toThrow(/not a user of operation/i);
  });

  it('refuses a non-user once any user is declared', async () => {
    await inviteOrgUser(db, { email: 'user@example.com' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    await expect(enforced(stranger).records.partition({ operationId: OP })).rejects.toThrow(/not a user of operation/i);
  });

  it('admits a declared user, who then sees nothing without roles', async () => {
    await inviteOrgUser(db, { email: 'user@example.com' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    const rows = await enforced(opUser).records.partition({ operationId: OP });
    expect(rows).toEqual([]); // entered, but no roles ⇒ nothing readable
  });

  it('roles can be granted before the person has ever signed in', async () => {
    // What the email rekey (0015) bought: the invite-first flow end to end —
    // invite, add, grant roles, and only then do they first authenticate.
    await inviteOrgUser(db, { email: 'user@example.com' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    await putUserRoles(db, { operationId: OP, email: 'user@example.com', roleIds: ['role_a'] });
    expect((await listOrgUsers(db))[0].authUserId).toBeNull(); // never signed in
    const me = await enforced(opUser).me({ operationId: OP });
    expect(me.roles).toEqual(['role_a']);
  });

  it('roles WITHOUT op membership never grant entry', async () => {
    await inviteOrgUser(db, { email: 'user@example.com' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    // The stranger holds a role in this operation but was never added to it.
    await putUserRoles(db, { operationId: OP, email: 'stranger@example.com', roleIds: ['role_a'] });
    await expect(enforced(stranger).records.partition({ operationId: OP })).rejects.toThrow(/not a user of operation/i);
  });

  it('a sol user gets no bypass — they are added like anyone else', async () => {
    await inviteOrgUser(db, { email: 'stranger@example.com' });
    await putSolUser(db, { solutionId: SOL, email: 'stranger@example.com', level: 'write' });
    await expect(enforced(stranger).records.partition({ operationId: OP })).rejects.toThrow(/not a user of operation/i);
  });

  it('does not apply in the demo posture (auth unconfigured)', async () => {
    await inviteOrgUser(db, { email: 'user@example.com' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    await expect(open(stranger).records.partition({ operationId: OP })).resolves.toBeDefined();
  });
});

describe('removal closes the door', () => {
  it('removing from the operation clears roles there too', async () => {
    await inviteOrgUser(db, { email: 'user@example.com' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    await putUserRoles(db, { operationId: OP, email: 'user@example.com', roleIds: ['role_a'] });
    await removeOpUser(db, { operationId: OP, email: 'user@example.com' });
    expect(await listOpUsers(db, OP)).toEqual([]);
    // Actually clears since the rekey — while user_roles was keyed on the auth
    // id this deleted nothing and a re-added user got their old roles back.
    const { listUserRoles } = await import('../src/host');
    expect(await listUserRoles(db, OP)).toEqual([]);
  });

  it('removing from the org pool removes them from every operation', async () => {
    await inviteOrgUser(db, { email: 'user@example.com' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    await removeOrgUser(db, { email: 'user@example.com' });
    expect(await listOrgUsers(db)).toEqual([]);
    expect(await listOpUsers(db, OP)).toEqual([]);
  });

  it('removing from the org pool also strips their sol-user rows', async () => {
    // Only reachable since the rekey — while these were keyed on the auth id,
    // removing someone from the pool left their design-plane access behind.
    const { listSolUsers } = await import('../src/host');
    await inviteOrgUser(db, { email: 'user@example.com' });
    await putSolUser(db, { solutionId: SOL, email: 'user@example.com', level: 'write' });
    await removeOrgUser(db, { email: 'user@example.com' });
    expect(await listSolUsers(db, SOL)).toEqual([]);
  });
});

describe('first sign-in binds the auth id', () => {
  it('binds and activates an invited user', async () => {
    await inviteOrgUser(db, { email: 'user@example.com', name: 'Op User' });
    expect((await listOrgUsers(db))[0]).toMatchObject({ authUserId: null, status: 'invited' });
    await bindAuthUser(db, { email: 'user@example.com', authUserId: 'auth-1' });
    expect((await listOrgUsers(db))[0]).toMatchObject({ authUserId: 'auth-1', status: 'active' });
  });

  it('does nothing for an email that was never invited — showing up is not joining', async () => {
    await bindAuthUser(db, { email: 'stranger@example.com', authUserId: 'auth-2' });
    expect(await listOrgUsers(db)).toEqual([]);
  });

  it('never rebinds an already-bound row', async () => {
    await inviteOrgUser(db, { email: 'user@example.com' });
    await bindAuthUser(db, { email: 'user@example.com', authUserId: 'auth-1' });
    await bindAuthUser(db, { email: 'user@example.com', authUserId: 'imposter' });
    expect((await listOrgUsers(db))[0].authUserId).toBe('auth-1');
  });
});

describe('bootstrap: the first org admin', () => {
  // The chain cannot start itself — no signup, and the strict gate means a
  // freshly migrated operation admits nobody, including the Console, which
  // reaches an operation through the same gate as the Runtime. Something
  // outside the request path has to write the first row.

  it('creates an org admin and lets them into every operation that had none', async () => {
    const result = await bootstrapOrgAdmin(db, { email: 'boss@example.com' });
    expect(result.operationsOpened).toEqual([OP]);
    expect((await listOrgUsers(db))[0]).toMatchObject({ email: 'boss@example.com', level: 'admin', status: 'invited' });
    expect(await listOpUsers(db, OP)).toEqual([{ email: 'boss@example.com', level: 'admin' }]);
  });

  it('re-running never re-opens an operation that already has users', async () => {
    // This is what makes it safe as a recovery tool: run it against production
    // twice and the second run cannot hand you entry to an operation somebody
    // else is already governing.
    await inviteOrgUser(db, { email: 'user@example.com' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    const result = await bootstrapOrgAdmin(db, { email: 'boss@example.com' });
    expect(result.operationsOpened).toEqual([]);
    expect(emails(await listOpUsers(db, OP))).toEqual(['user@example.com']);
  });

  it('promotes an existing pool user rather than duplicating them', async () => {
    await inviteOrgUser(db, { email: 'user@example.com', name: 'Op User' });
    await bootstrapOrgAdmin(db, { email: 'User@Example.com' });
    const pool = await listOrgUsers(db);
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({ email: 'user@example.com', name: 'Op User', level: 'admin' });
  });
});
