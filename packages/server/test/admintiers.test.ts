// The admin tiers (USERS.md §3).
//
// Authority has one root — the org OWNER — and flows DOWNWARD ONLY. No tier
// appoints its own tier, and there is no sideways delegation. The governing
// split is identity vs authorization: the org admin controls who exists and who
// gets in; the op admin controls what they may do once inside. So an org admin
// deliberately does NOT manage roles, which is the surprising half of this file
// and the half most likely to be "fixed" by someone who has not read the spec.
//
// The cast:
//   owner     — the org's root. Appoints org admins and nothing else.
//   boss      — org admin
//   opBoss    — op admin of OP, plain org user
//   solBoss   — sol admin of SOL, plain org user
//   worker    — plain user everywhere

import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import {
  addOpUser,
  appointOpAdmin,
  appointOrgAdmin,
  appointSolAdmin,
  ensureOperation,
  ensureOrg,
  ensureSolution,
  inviteUser,
  listOpAdmins,
  listOpUsers,
  listOrgAdmins,
  listSolAdmins,
  putConfig,
  setUserStatus,
} from '../src/host';
import { orgs } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { appRouter } from '../src/router';
import { createDbRolesResolver } from '../src/auth';
import type { ConfigRaw, ContextUser } from '@fluxus/engine';

const SOL = 'test/tiers';
const OP = 'test/tiers';

const config: ConfigRaw = {
  access: { roles: [{ id: 'role_a', name: 'As' }] },
  attributes: [{ key: 'id', label: 'ID', description: '', type: 'text' }],
  recordTypes: [],
  workflows: [],
};

let db: Db;
const owner: ContextUser = { id: 'auth-owner', name: 'Owner', email: 'owner@example.com', roles: [] };
const boss: ContextUser = { id: 'auth-boss', name: 'Boss', email: 'boss@example.com', roles: [] };
const opBoss: ContextUser = { id: 'auth-opboss', name: 'Op Boss', email: 'opboss@example.com', roles: [] };
const solBoss: ContextUser = { id: 'auth-solboss', name: 'Sol Boss', email: 'solboss@example.com', roles: [] };
const worker: ContextUser = { id: 'auth-worker', name: 'Worker', email: 'worker@example.com', roles: [] };

const as = (user: ContextUser) =>
  appRouter.createCaller({ db, user, roles: createDbRolesResolver(db), authConfigured: true });
const stub = () => appRouter.createCaller({ db }); // auth unconfigured ⇒ open

const emails = (rows: { email: string }[]) => rows.map((r) => r.email);
const forbidden = /Requires (organisation admin|admin of operation|the organisation owner)/;

beforeEach(async () => {
  db = await createDb();
  // No migration invents an org any more, so the tenancy under test is built
  // here — ownership hangs off this row.
  await ensureOrg(db, 'default', 'Tiers Org');
  await ensureSolution(db, SOL, 'Tiers');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Tiers');

  await inviteUser(db, { email: 'owner@example.com' });
  await inviteUser(db, { email: 'boss@example.com' });
  await inviteUser(db, { email: 'opboss@example.com' });
  await inviteUser(db, { email: 'solboss@example.com' });
  await inviteUser(db, { email: 'worker@example.com' });

  await db.update(orgs).set({ ownerEmail: 'owner@example.com' }).where(eq(orgs.id, 'default'));
  await appointOrgAdmin(db, { email: 'boss@example.com' });
  await appointOpAdmin(db, { operationId: OP, email: 'opboss@example.com' });
  await appointSolAdmin(db, { solutionId: SOL, email: 'solboss@example.com' });
  await addOpUser(db, { operationId: OP, email: 'worker@example.com' });
});

describe('the owner is the root, and appoints only org admins', () => {
  it('the owner alone appoints and removes org admins', async () => {
    // The rule the tier exists for: an org admin cannot mint a peer. It is the
    // one appointment that has to come from outside the tier, so it comes from
    // the root.
    await expect(as(boss).orgAdmins.appoint({ email: 'worker@example.com' })).rejects.toThrow(/organisation owner/);
    await expect(as(owner).orgAdmins.appoint({ email: 'worker@example.com' })).resolves.toEqual({ ok: true });
    expect(emails(await listOrgAdmins(db))).toContain('worker@example.com');
    await expect(as(boss).orgAdmins.remove({ email: 'worker@example.com' })).rejects.toThrow(/organisation owner/);
    await expect(as(owner).orgAdmins.remove({ email: 'worker@example.com' })).resolves.toEqual({ ok: true });
  });

  it('the owner is NOT implicitly an org admin', async () => {
    // Deliberate: the root delegates, it does not do the work. An owner who
    // wants org-admin surfaces appoints themselves, and that grant is explicit.
    await expect(as(owner).users.list({})).rejects.toThrow(/organisation admin/);
    await as(owner).orgAdmins.appoint({ email: 'owner@example.com' });
    await expect(as(owner).users.list({})).resolves.toBeDefined();
  });

  it('appointment refuses anyone who is not in the organisation', async () => {
    // Invite, then appoint. Enforced everywhere, so no grant table can name
    // somebody the organisation does not know.
    await expect(as(owner).orgAdmins.appoint({ email: 'nobody@example.com' }))
      .rejects.toThrow(/not in this organisation/i);
  });
});

describe('org admin owns identity', () => {
  it('only an org admin sees the pool', async () => {
    await expect(as(boss).users.list({})).resolves.toHaveLength(5);
    await expect(as(opBoss).users.list({})).rejects.toThrow(forbidden);
    await expect(as(solBoss).users.list({})).rejects.toThrow(forbidden);
    await expect(as(worker).users.list({})).rejects.toThrow(forbidden);
  });

  it('invites carry no admin connotation — they only add to the pool', async () => {
    await expect(as(boss).users.invite({ email: 'new@example.com' })).resolves.toEqual({ ok: true });
    expect(emails(await listOrgAdmins(db))).not.toContain('new@example.com');
    expect(emails(await listOpUsers(db, OP))).not.toContain('new@example.com');
  });

  it('whoever may appoint may invite; a sol admin never may', async () => {
    // The op admin places people in their operation, so they must be able to
    // bring someone into the organisation to place. A sol admin appoints
    // nobody, so they invite nobody.
    await expect(as(opBoss).users.invite({ email: 'viaop@example.com', operationId: OP })).resolves.toEqual({ ok: true });
    await expect(as(owner).users.invite({ email: 'viaowner@example.com' })).resolves.toEqual({ ok: true });
    await expect(as(solBoss).users.invite({ email: 'nope@example.com' })).rejects.toThrow(/may appoint/);
    await expect(as(worker).users.invite({ email: 'nope@example.com' })).rejects.toThrow(/may appoint/);
  });

  it('only an org admin suspends and expires', async () => {
    await expect(as(boss).users.setStatus({ email: 'worker@example.com', status: 'suspended' })).resolves.toEqual({ ok: true });
    await expect(as(opBoss).users.setStatus({ email: 'worker@example.com', status: 'active' })).rejects.toThrow(forbidden);
    await expect(as(opBoss).users.expire({ email: 'worker@example.com' })).rejects.toThrow(forbidden);
    await expect(as(boss).users.expire({ email: 'worker@example.com' })).resolves.toEqual({ ok: true });
    await expect(as(opBoss).users.unexpire({ email: 'worker@example.com' })).rejects.toThrow(forbidden);
  });

  it('only an org admin creates solutions and operations', async () => {
    await expect(as(solBoss).solutions.create({ id: 'test/nope', name: 'Nope' })).rejects.toThrow(forbidden);
    await expect(as(opBoss).operations.create({ id: 'test/nope', solutionId: SOL, name: 'Nope' })).rejects.toThrow(forbidden);
    await expect(as(boss).solutions.create({ id: 'test/new', name: 'New' })).resolves.toEqual({ ok: true });
    await expect(as(boss).operations.create({ id: 'test/new-op', solutionId: SOL, name: 'New Op' })).resolves.toEqual({ ok: true });
  });

  it('only an org admin appoints sol admins', async () => {
    // The design plane governs no people — a sol admin cannot appoint another.
    await expect(as(solBoss).solAdmins.appoint({ solutionId: SOL, email: 'worker@example.com' }))
      .rejects.toThrow(forbidden);
    await expect(as(boss).solAdmins.appoint({ solutionId: SOL, email: 'worker@example.com' }))
      .resolves.toEqual({ ok: true });
    expect(emails(await listSolAdmins(db, SOL))).toContain('worker@example.com');
  });

  it('only an org admin renames or deletes a solution', async () => {
    // Off the design plane: the org admin creates solutions, so destroying one
    // is the inverse of a call they already own. This is what let the sol-admin
    // grade collapse to a single value.
    await expect(as(solBoss).solutions.update({ solutionId: SOL, name: 'Nope' })).rejects.toThrow(forbidden);
    await expect(as(boss).solutions.update({ solutionId: SOL, name: 'Tiers' })).resolves.toEqual({ ok: true });
  });

  it('a sol admin gets no user visibility at all', async () => {
    // Not even the sol-admin list, which carries real emails.
    await expect(as(solBoss).solAdmins.list({ solutionId: SOL })).rejects.toThrow(forbidden);
    await expect(as(solBoss).opUsers.list({ operationId: OP })).rejects.toThrow(forbidden);
    await expect(as(solBoss).userRoles.list({ operationId: OP })).rejects.toThrow(forbidden);
  });

  it('a suspended org admin is not an admin', async () => {
    await setUserStatus(db, { email: 'boss@example.com', status: 'suspended' });
    await expect(as(boss).users.list({})).rejects.toThrow(forbidden);
  });
});

describe('op admin owns authorization', () => {
  it('roles are the op admin\'s, and the ORG admin is refused', async () => {
    // The surprising one, and it is deliberate. The org admin controls who gets
    // in, not what they may do inside. They may appoint themselves op admin —
    // a speed bump, not a wall — and that grant is then explicit and auditable.
    await expect(as(opBoss).userRoles.put({ operationId: OP, email: 'worker@example.com', roleIds: ['role_a'] }))
      .resolves.toEqual({ ok: true });
    await expect(as(boss).userRoles.put({ operationId: OP, email: 'worker@example.com', roleIds: ['role_a'] }))
      .rejects.toThrow(forbidden);
    await expect(as(worker).userRoles.list({ operationId: OP })).rejects.toThrow(forbidden);
  });

  it('the org admin can climb the speed bump by appointing themselves', async () => {
    await expect(as(boss).userRoles.list({ operationId: OP })).rejects.toThrow(forbidden);
    await as(boss).opAdmins.appoint({ operationId: OP, email: 'boss@example.com' });
    await expect(as(boss).userRoles.list({ operationId: OP })).resolves.toBeDefined();
  });

  it('an op-admin row implies entry — no separate op-user row needed', async () => {
    // An administrator who cannot open the thing they administer would be
    // nonsense, so the entry gate reads both tables.
    expect(emails(await listOpUsers(db, OP))).not.toContain('opboss@example.com');
    await expect(as(opBoss).records.partition({ operationId: OP })).resolves.toBeDefined();
  });

  it('the operation menu override is the op admin\'s, not the sol admin\'s', async () => {
    // Menus stay split: `default_menu` is design-plane, this override is not.
    await expect(as(opBoss).operations.putConfig({ operationId: OP, config: { menu: [] } })).resolves.toEqual({ ok: true });
    await expect(as(solBoss).operations.putConfig({ operationId: OP, config: { menu: [] } })).rejects.toThrow(forbidden);
  });

  it('only an op admin removes from their operation', async () => {
    await expect(as(worker).opUsers.remove({ operationId: OP, email: 'worker@example.com' })).rejects.toThrow(forbidden);
    await expect(as(opBoss).opUsers.remove({ operationId: OP, email: 'worker@example.com' })).resolves.toEqual({ ok: true });
  });

  it('an op admin of ANOTHER operation has no authority here', async () => {
    await ensureOperation(db, 'test/other', SOL, 'Other');
    await appointOpAdmin(db, { operationId: 'test/other', email: 'worker@example.com' });
    await expect(as(worker).userRoles.list({ operationId: OP })).rejects.toThrow(forbidden);
    await expect(as(worker).userRoles.list({ operationId: 'test/other' })).resolves.toBeDefined();
  });

  it('an op admin suspended in the pool loses the grant', async () => {
    await setUserStatus(db, { email: 'opboss@example.com', status: 'suspended' });
    await expect(as(opBoss).userRoles.list({ operationId: OP })).rejects.toThrow(forbidden);
  });
});

describe('no tier appoints its own tier', () => {
  it('AN OP ADMIN CAN NEVER MINT AN OP ADMIN', async () => {
    await inviteUser(db, { email: 'new@example.com' });
    await expect(as(opBoss).opAdmins.appoint({ operationId: OP, email: 'new@example.com' }))
      .rejects.toThrow(/Requires organisation admin/);
    await expect(as(opBoss).opAdmins.appoint({ operationId: OP, email: 'worker@example.com' }))
      .rejects.toThrow(/Requires organisation admin/);
    expect(emails(await listOpAdmins(db, OP))).toEqual(['opboss@example.com']);
  });

  it('an org admin mints op admins', async () => {
    await expect(as(boss).opAdmins.appoint({ operationId: OP, email: 'worker@example.com' }))
      .resolves.toEqual({ ok: true });
    expect(emails(await listOpAdmins(db, OP))).toContain('worker@example.com');
  });

  it('an op admin staffs their operation with plain users', async () => {
    await inviteUser(db, { email: 'new@example.com' });
    await expect(as(opBoss).opUsers.add({ operationId: OP, email: 'new@example.com' })).resolves.toEqual({ ok: true });
    expect(emails(await listOpUsers(db, OP))).toContain('new@example.com');
  });

  it('an org admin may add plain users too — entry is an identity question', async () => {
    await inviteUser(db, { email: 'new@example.com' });
    await expect(as(boss).opUsers.add({ operationId: OP, email: 'new@example.com' })).resolves.toEqual({ ok: true });
  });

  it('a plain user may add nobody', async () => {
    await inviteUser(db, { email: 'new@example.com' });
    await expect(as(worker).opUsers.add({ operationId: OP, email: 'new@example.com' })).rejects.toThrow(forbidden);
  });

  it('the pool still bounds it — no tier can add a stranger', async () => {
    // What the op admin sees when they type an address nobody has invited: they
    // cannot browse the pool, so the server answers for it.
    await expect(as(opBoss).opUsers.add({ operationId: OP, email: 'nobody@example.com' }))
      .rejects.toThrow(/not in this organisation/i);
    await expect(as(boss).opUsers.add({ operationId: OP, email: 'nobody@example.com' }))
      .rejects.toThrow(/not in this organisation/i);
  });
});

describe('what `me` reports', () => {
  it('answers the org-level question with no operation named', async () => {
    // The Organisation → Users screen has no operation in hand. Routing it
    // through an arbitrary operation's entry gate would make org administration
    // depend on op membership — the exact coupling the identity/authorization
    // split exists to prevent — and would hide the screen from the one person
    // it is for. `opAdmin` is false unscoped: it is not a question about no
    // operation in particular.
    await expect(as(boss).me({})).resolves.toMatchObject({ orgAdmin: true, opAdmin: false, console: true });
    await expect(as(worker).me({})).resolves.toMatchObject({ orgAdmin: false, opAdmin: false, console: false });
  });

  it('an org admin who is in no operation still gets their org answer', async () => {
    // The failure the optional operationId exists to prevent.
    await inviteUser(db, { email: 'lonely@example.com' });
    await appointOrgAdmin(db, { email: 'lonely@example.com' });
    const lonely: ContextUser = { id: 'auth-lonely', name: 'Lonely', email: 'lonely@example.com', roles: [] };
    await expect(as(lonely).me({ operationId: OP })).rejects.toThrow(/not a user of operation/i);
    await expect(as(lonely).me({})).resolves.toMatchObject({ orgAdmin: true, console: true });
  });

  it('reports each caller\'s tiers, so the Console gates on what the server enforces', async () => {
    // Scoped to an operation, `me` passes the entry gate like every other
    // operation-scoped call — and an org admin is NOT implicitly in one, so
    // they have to be added before they can ask a question about it.
    await expect(as(boss).me({ operationId: OP })).rejects.toThrow(/not a user of operation/i);
    await addOpUser(db, { operationId: OP, email: 'boss@example.com' });
    await expect(as(boss).me({ operationId: OP })).resolves.toMatchObject({ orgOwner: false, orgAdmin: true, opAdmin: false, console: true });
    await expect(as(opBoss).me({ operationId: OP })).resolves.toMatchObject({ orgAdmin: false, opAdmin: true, console: false });
    await expect(as(worker).me({ operationId: OP })).resolves.toMatchObject({ orgAdmin: false, opAdmin: false, console: false });
  });

  it('Console access is derived: owner, org admin, or sol admin of anything', async () => {
    // Never a stored flag — a separate bit could contradict the grants above.
    // The owner's derivation is the one that matters on a fresh organisation:
    // they hold no grants, and without it nobody could open the screen that
    // appoints the first org admin.
    await expect(as(owner).me({})).resolves.toMatchObject({ orgOwner: true, orgAdmin: false, console: true });
    await addOpUser(db, { operationId: OP, email: 'solboss@example.com' });
    await expect(as(solBoss).me({ operationId: OP })).resolves.toMatchObject({ orgAdmin: false, console: true });
  });
});

describe('demo posture', () => {
  it('auth unconfigured leaves every tier open', async () => {
    // With no identity there is nothing to gate on, and local dev would be
    // unusable otherwise. Same posture as every other check.
    await expect(stub().users.list({})).resolves.toBeDefined();
    await expect(stub().opAdmins.appoint({ operationId: OP, email: 'worker@example.com' })).resolves.toEqual({ ok: true });
    await expect(stub().userRoles.list({ operationId: OP })).resolves.toBeDefined();
    await expect(stub().me({ operationId: OP })).resolves.toMatchObject({ orgOwner: true, orgAdmin: true, opAdmin: true, console: true });
  });
});
