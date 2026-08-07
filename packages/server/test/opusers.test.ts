// The entry gate (USERS.md §4): `op_users` decides whether a caller may open an
// operation AT ALL — a separate question from what roles let them see inside.
//
// **Strict, not dormant.** An operation with nobody in it admits nobody.
// Deliberately unlike the record-type/page surfaces, which are
// dormant-until-declared: those ask "what may you see", and staying visible
// until configured is a reasonable adoption default. This asks "may you enter",
// and an operation with no users listed has, literally, no users.
//
// An **op-admin row implies entry** (2026-08-04): an administrator who cannot
// open the thing they administer would be nonsense, so the gate reads both
// tables and callers never ask which one answered.

import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import {
  addOpUser,
  appointOpAdmin,
  appointOrgAdmin,
  appointSolAdmin,
  bindAuthUser,
  bootstrapOrgAdmin,
  ensureOperation,
  ensureOrg,
  ensureSolution,
  getOwnerEmail,
  inviteUser,
  isOpUser,
  listOpAdmins,
  listOpUsers,
  listOrgAdmins,
  listUsers,
  putConfig,
  putUserRoles,
  expireUser,
  removeOpUser,
  setUserStatus,
  unexpireUser,
} from '../src/host';
import { appRouter } from '../src/router';
import { createDbRolesResolver } from '../src/auth';
import type { SolutionConfig, ContextUser } from '@fluxus/engine';

const SOL = 'test/opusers';
const OP = 'test/opusers';

const config: SolutionConfig = {
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
  // Nothing installs an org any more, so the tenancy under test is built here.
  await ensureOrg(db, 'default', 'Op Users Org');
  await ensureSolution(db, SOL, 'Op users');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Op users');
});

describe('the pool is the only way in', () => {
  it('adding an uninvited email to an operation is refused', async () => {
    await expect(addOpUser(db, { operationId: OP, email: 'nobody@example.com' })).rejects.toThrow(/not in this organisation/i);
  });

  it('an invited user can be added, and appears in the op list', async () => {
    await inviteUser(db, { email: 'user@example.com', name: 'Op User' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    expect(await listOpUsers(db, OP)).toEqual([{ email: 'user@example.com' }]);
  });

  it('email is normalised, so one person cannot become two', async () => {
    await inviteUser(db, { email: '  User@Example.COM ', name: 'Op User' });
    await inviteUser(db, { email: 'user@example.com', name: 'Op User Again' });
    const pool = await listUsers(db);
    expect(pool).toHaveLength(1);
    expect(pool[0].email).toBe('user@example.com');
  });

  it('being in the pool grants nothing anywhere', async () => {
    // The whole point of the split: the pool row answers "does this person
    // exist to us" and no other question. Every capability is a grant elsewhere.
    await inviteUser(db, { email: 'user@example.com' });
    expect(await listOrgAdmins(db)).toEqual([]);
    expect(await listOpUsers(db, OP)).toEqual([]);
    expect(await listOpAdmins(db, OP)).toEqual([]);
    await expect(enforced(opUser).records.partition({ operationId: OP })).rejects.toThrow(/not a user of operation/i);
  });

  it('a re-invite updates the name and disturbs no grant', async () => {
    await inviteUser(db, { email: 'user@example.com' });
    await appointOrgAdmin(db, { email: 'user@example.com' });
    await inviteUser(db, { email: 'user@example.com', name: 'Renamed' });
    expect((await listUsers(db))[0]).toMatchObject({ name: 'Renamed' });
    expect(emails(await listOrgAdmins(db))).toEqual(['user@example.com']);
  });
});

describe('the entry gate', () => {
  it('an operation with no users admits nobody', async () => {
    await expect(enforced(stranger).records.partition({ operationId: OP })).rejects.toThrow(/not a user of operation/i);
  });

  it('refuses a non-user once any user is declared', async () => {
    await inviteUser(db, { email: 'user@example.com' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    await expect(enforced(stranger).records.partition({ operationId: OP })).rejects.toThrow(/not a user of operation/i);
  });

  it('admits a declared user, who then sees nothing without roles', async () => {
    await inviteUser(db, { email: 'user@example.com' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    const rows = await enforced(opUser).records.partition({ operationId: OP });
    expect(rows).toEqual([]); // entered, but no roles ⇒ nothing readable
  });

  it('roles can be granted before the person has ever signed in', async () => {
    // What the email rekey (0015) bought: the invite-first flow end to end —
    // invite, add, grant roles, and only then do they first authenticate.
    await inviteUser(db, { email: 'user@example.com' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    await putUserRoles(db, { operationId: OP, email: 'user@example.com', roleIds: ['role_a'] });
    expect((await listUsers(db))[0].authUserId).toBeNull(); // never signed in
    const me = await enforced(opUser).me({ operationId: OP });
    expect(me.roles).toEqual(['role_a']);
  });

  it('roles WITHOUT op membership never grant entry', async () => {
    await inviteUser(db, { email: 'user@example.com' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    // The stranger holds a role in this operation but was never added to it.
    await putUserRoles(db, { operationId: OP, email: 'stranger@example.com', roleIds: ['role_a'] });
    await expect(enforced(stranger).records.partition({ operationId: OP })).rejects.toThrow(/not a user of operation/i);
  });

  it('a sol admin gets no bypass — they are added like anyone else', async () => {
    await inviteUser(db, { email: 'stranger@example.com' });
    await appointSolAdmin(db, { solutionId: SOL, email: 'stranger@example.com' });
    await expect(enforced(stranger).records.partition({ operationId: OP })).rejects.toThrow(/not a user of operation/i);
  });

  it('does not apply in the demo posture (auth unconfigured)', async () => {
    await inviteUser(db, { email: 'user@example.com' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    await expect(open(stranger).records.partition({ operationId: OP })).resolves.toBeDefined();
  });
});

describe('expiry closes the door, and keeps the person', () => {
  it('removing from the operation clears roles there too', async () => {
    await inviteUser(db, { email: 'user@example.com' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    await putUserRoles(db, { operationId: OP, email: 'user@example.com', roleIds: ['role_a'] });
    await removeOpUser(db, { operationId: OP, email: 'user@example.com' });
    expect(await listOpUsers(db, OP)).toEqual([]);
    // Actually clears since the rekey — while user_roles was keyed on the auth
    // id this deleted nothing and a re-added user got their old roles back.
    const { listUserRoles } = await import('../src/host');
    expect(await listUserRoles(db, OP)).toEqual([]);
  });

  it('expiring drops every operation, and keeps the person', async () => {
    await inviteUser(db, { email: 'user@example.com' });
    await addOpUser(db, { operationId: OP, email: 'user@example.com' });
    await expireUser(db, { email: 'user@example.com' });
    expect(await listOpUsers(db, OP)).toEqual([]);
    // The row survives, and that is the point: `author` on a history entry is
    // an auth id, and this row is the only bridge from that id to a name.
    const [row] = await listUsers(db);
    expect(row).toMatchObject({ email: 'user@example.com', status: 'expired' });
    expect(row.expiredAt).toBeInstanceOf(Date);
  });

  it('expiring strips every grant, at every tier', async () => {
    // The terminal counterpart to suspension: no grant survives to be
    // reinstated. Suspension keeps them all, which is the whole difference.
    const { listSolAdmins } = await import('../src/host');
    await inviteUser(db, { email: 'user@example.com' });
    await appointOrgAdmin(db, { email: 'user@example.com' });
    await appointSolAdmin(db, { solutionId: SOL, email: 'user@example.com' });
    await appointOpAdmin(db, { operationId: OP, email: 'user@example.com' });
    await putUserRoles(db, { operationId: OP, email: 'user@example.com', roleIds: ['role_a'] });

    await expireUser(db, { email: 'user@example.com' });

    const { listUserRoles } = await import('../src/host');
    expect(await listSolAdmins(db, SOL)).toEqual([]);
    expect(await listOrgAdmins(db)).toEqual([]);
    expect(await listOpAdmins(db, OP)).toEqual([]);
    expect(await listUserRoles(db, OP)).toEqual([]);
  });

  it('unexpiring brings the person back with NO grants', async () => {
    // Expiry kept nothing to restore, so whoever needs them appoints them
    // again — the same invite-then-appoint order everyone else follows.
    await inviteUser(db, { email: 'user@example.com' });
    await appointOrgAdmin(db, { email: 'user@example.com' });
    await expireUser(db, { email: 'user@example.com' });
    await unexpireUser(db, { email: 'user@example.com' });

    const [row] = await listUsers(db);
    expect(row).toMatchObject({ status: 'invited', expiredAt: null });
    expect(await listOrgAdmins(db)).toEqual([]);
  });

  it('unexpiring returns someone who had signed in to active, not invited', async () => {
    await inviteUser(db, { email: 'user@example.com' });
    await bindAuthUser(db, { email: 'user@example.com', authUserId: 'auth-1' });
    await expireUser(db, { email: 'user@example.com' });
    await unexpireUser(db, { email: 'user@example.com' });
    expect((await listUsers(db))[0].status).toBe('active');
  });

  it('signing in does not resurrect an expired person', async () => {
    // They hold no grants either way, but the status must not lie about where
    // they stand — a live session must not undo an administrator's decision.
    await inviteUser(db, { email: 'user@example.com' });
    await expireUser(db, { email: 'user@example.com' });
    await bindAuthUser(db, { email: 'user@example.com', authUserId: 'auth-1' });
    expect((await listUsers(db))[0]).toMatchObject({ status: 'expired', authUserId: null });
  });

  it('an expired person is no admin anywhere, even if a grant survived', async () => {
    // Belt and braces: expiry drops the grants, and the tier checks re-read the
    // pool row anyway, so a row written by any other path still grants nothing.
    const { appointOrgAdmin: appoint, isOrgAdmin } = await import('../src/host');
    await inviteUser(db, { email: 'user@example.com' });
    await expireUser(db, { email: 'user@example.com' });
    await appoint(db, { email: 'user@example.com' });
    expect(await isOrgAdmin(db, { email: 'user@example.com' })).toBe(false);
  });

  it('suspension is refused on an expired person — unexpire is the way back', async () => {
    await inviteUser(db, { email: 'user@example.com' });
    await expireUser(db, { email: 'user@example.com' });
    await setUserStatus(db, { email: 'user@example.com', status: 'active' });
    expect((await listUsers(db))[0].status).toBe('expired');
  });
});

describe('first sign-in binds the auth id', () => {
  it('binds and activates an invited user', async () => {
    await inviteUser(db, { email: 'user@example.com', name: 'Op User' });
    expect((await listUsers(db))[0]).toMatchObject({ authUserId: null, status: 'invited' });
    await bindAuthUser(db, { email: 'user@example.com', authUserId: 'auth-1' });
    expect((await listUsers(db))[0]).toMatchObject({ authUserId: 'auth-1', status: 'active' });
  });

  it('does nothing for an email that was never invited — showing up is not joining', async () => {
    await bindAuthUser(db, { email: 'stranger@example.com', authUserId: 'auth-2' });
    expect(await listUsers(db)).toEqual([]);
  });

  it('never rebinds an already-bound row', async () => {
    await inviteUser(db, { email: 'user@example.com' });
    await bindAuthUser(db, { email: 'user@example.com', authUserId: 'auth-1' });
    await bindAuthUser(db, { email: 'user@example.com', authUserId: 'imposter' });
    expect((await listUsers(db))[0].authUserId).toBe('auth-1');
  });
});

describe('bootstrap: the first org admin', () => {
  // The chain cannot start itself — no signup, and the strict gate means a
  // freshly migrated operation admits nobody, including the Console, which
  // reaches an operation through the same gate as the Runtime. Something
  // outside the request path has to write the first row.

  it('writes the pool row, the org-admin appointment and entry to ungoverned operations', async () => {
    const result = await bootstrapOrgAdmin(db, { email: 'boss@example.com' });
    expect(result.operationsOpened).toEqual([OP]);
    expect((await listUsers(db))[0]).toMatchObject({ email: 'boss@example.com', status: 'invited' });
    expect(emails(await listOrgAdmins(db))).toEqual(['boss@example.com']);
    // Op ADMIN, not op user — the row that implies entry, so recovery leaves
    // somebody able to run the operation rather than merely walk into it.
    expect(await listOpAdmins(db, OP)).toEqual([{ email: 'boss@example.com' }]);
    expect(await isOpUser(db, { operationId: OP, email: 'boss@example.com' })).toBe(true);
  });

  it('refuses an organisation that does not exist rather than inventing one', async () => {
    // Recovery promotes someone inside a tenancy; creating the tenancy is
    // platform.registerOrg's job. Nothing prepopulates an org, so bootstrapping
    // into a missing one has to fail loudly instead of reporting success after
    // updating no rows.
    await expect(bootstrapOrgAdmin(db, { email: 'boss@example.com', orgId: 'no-such-org' }))
      .rejects.toThrow(/does not exist/i);
  });

  it('claims ownership only of an organisation that has none', async () => {
    // Without an owner nobody may appoint org admins — the tier above is empty,
    // so recovery has to fill it. An org that HAS one is left alone: transfer is
    // a deliberate act, never a side effect of re-running it.
    await bootstrapOrgAdmin(db, { email: 'boss@example.com' });
    expect(await getOwnerEmail(db)).toBe('boss@example.com');
    const second = await bootstrapOrgAdmin(db, { email: 'other@example.com' });
    expect(second.claimedOwnership).toBe(false);
    expect(await getOwnerEmail(db)).toBe('boss@example.com');
  });

  it('re-running never re-opens an operation that someone already administers', async () => {
    // What makes it safe as a recovery tool: run it against production twice and
    // the second run cannot hand you an operation somebody else is governing.
    await inviteUser(db, { email: 'user@example.com' });
    await appointOpAdmin(db, { operationId: OP, email: 'user@example.com' });
    const result = await bootstrapOrgAdmin(db, { email: 'boss@example.com' });
    expect(result.operationsOpened).toEqual([]);
    expect(emails(await listOpAdmins(db, OP))).toEqual(['user@example.com']);
  });

  it('appoints an existing pool user rather than duplicating them', async () => {
    await inviteUser(db, { email: 'user@example.com', name: 'Op User' });
    await bootstrapOrgAdmin(db, { email: 'User@Example.com' });
    const pool = await listUsers(db);
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({ email: 'user@example.com', name: 'Op User' });
    expect(emails(await listOrgAdmins(db))).toEqual(['user@example.com']);
  });
});
