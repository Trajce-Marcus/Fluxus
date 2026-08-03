// The admin tiers (RBAC_COMPACT "Administration", ruled 2026-08-02).
//
// Authority has one root — the org admin — and flows DOWNWARD ONLY. No tier
// appoints its own tier, and there is no sideways delegation. The governing
// split is identity vs authorization: the org admin controls who exists and who
// gets in; the op admin controls what they may do once inside. So an org admin
// deliberately does NOT manage roles, which is the surprising half of this file
// and the half most likely to be "fixed" by someone who has not read the spec.
//
// The cast:
//   boss      — org admin
//   opBoss    — op admin of OP, plain org user
//   solBoss   — sol user with 'write' on SOL, plain org user
//   worker    — plain user everywhere

import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import {
  addOpUser,
  ensureOperation,
  ensureSolution,
  inviteOrgUser,
  listOpUsers,
  putConfig,
  putSolUser,
  setOrgUserStatus,
} from '../src/host';
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
const boss: ContextUser = { id: 'auth-boss', name: 'Boss', email: 'boss@example.com', roles: [] };
const opBoss: ContextUser = { id: 'auth-opboss', name: 'Op Boss', email: 'opboss@example.com', roles: [] };
const solBoss: ContextUser = { id: 'auth-solboss', name: 'Sol Boss', email: 'solboss@example.com', roles: [] };
const worker: ContextUser = { id: 'auth-worker', name: 'Worker', email: 'worker@example.com', roles: [] };

const as = (user: ContextUser) =>
  appRouter.createCaller({ db, user, roles: createDbRolesResolver(db), authConfigured: true });
const stub = () => appRouter.createCaller({ db }); // auth unconfigured ⇒ open

const emails = (rows: { email: string }[]) => rows.map((r) => r.email);
const forbidden = /Requires (organisation admin|admin of operation)/;

beforeEach(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'Tiers');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Tiers');

  await inviteOrgUser(db, { email: 'boss@example.com', level: 'admin' });
  await inviteOrgUser(db, { email: 'opboss@example.com' });
  await inviteOrgUser(db, { email: 'solboss@example.com' });
  await inviteOrgUser(db, { email: 'worker@example.com' });

  await addOpUser(db, { operationId: OP, email: 'boss@example.com' });
  await addOpUser(db, { operationId: OP, email: 'opboss@example.com', level: 'admin' });
  await addOpUser(db, { operationId: OP, email: 'worker@example.com' });
  await putSolUser(db, { solutionId: SOL, email: 'solboss@example.com', level: 'write' });
});

describe('org admin owns identity', () => {
  it('only an org admin sees the pool', async () => {
    await expect(as(boss).users.listOrg({})).resolves.toHaveLength(4);
    await expect(as(opBoss).users.listOrg({})).rejects.toThrow(forbidden);
    await expect(as(solBoss).users.listOrg({})).rejects.toThrow(forbidden);
    await expect(as(worker).users.listOrg({})).rejects.toThrow(forbidden);
  });

  it('only an org admin invites, suspends and removes', async () => {
    await expect(as(boss).users.invite({ email: 'new@example.com' })).resolves.toEqual({ ok: true });
    await expect(as(opBoss).users.invite({ email: 'other@example.com' })).rejects.toThrow(forbidden);
    await expect(as(boss).users.setStatus({ email: 'worker@example.com', status: 'suspended' })).resolves.toEqual({ ok: true });
    await expect(as(opBoss).users.setStatus({ email: 'worker@example.com', status: 'active' })).rejects.toThrow(forbidden);
    await expect(as(opBoss).users.removeOrg({ email: 'worker@example.com' })).rejects.toThrow(forbidden);
    await expect(as(boss).users.removeOrg({ email: 'worker@example.com' })).resolves.toEqual({ ok: true });
  });

  it('only an org admin creates solutions and operations', async () => {
    await expect(as(solBoss).solutions.create({ id: 'test/nope', name: 'Nope' })).rejects.toThrow(forbidden);
    await expect(as(opBoss).operations.create({ id: 'test/nope', solutionId: SOL, name: 'Nope' })).rejects.toThrow(forbidden);
    await expect(as(boss).solutions.create({ id: 'test/new', name: 'New' })).resolves.toEqual({ ok: true });
    await expect(as(boss).operations.create({ id: 'test/new-op', solutionId: SOL, name: 'New Op' })).resolves.toEqual({ ok: true });
  });

  it('only an org admin appoints sol users', async () => {
    // The design plane governs no people — a sol user cannot appoint another.
    await expect(as(solBoss).solUsers.put({ solutionId: SOL, email: 'worker@example.com', level: 'write' }))
      .rejects.toThrow(forbidden);
    await expect(as(boss).solUsers.put({ solutionId: SOL, email: 'worker@example.com', level: 'write' }))
      .resolves.toEqual({ ok: true });
  });

  it('only an org admin renames or deletes a solution', async () => {
    // Moved off the design plane 2026-08-02 — the org admin creates solutions,
    // so destroying one is the inverse of a call they already own. This is what
    // let sol_users.level collapse to read|write.
    await expect(as(solBoss).solutions.update({ solutionId: SOL, name: 'Nope' })).rejects.toThrow(forbidden);
    await expect(as(boss).solutions.update({ solutionId: SOL, name: 'Tiers' })).resolves.toEqual({ ok: true });
  });

  it('a sol user gets no user visibility at all', async () => {
    // Not even the sol-user list, which since the rekey carries real emails.
    await expect(as(solBoss).solUsers.list({ solutionId: SOL })).rejects.toThrow(forbidden);
    await expect(as(solBoss).users.listOp({ operationId: OP })).rejects.toThrow(forbidden);
    await expect(as(solBoss).userRoles.list({ operationId: OP })).rejects.toThrow(forbidden);
  });

  it('a suspended org admin is not an admin', async () => {
    await setOrgUserStatus(db, { email: 'boss@example.com', status: 'suspended' });
    await expect(as(boss).users.listOrg({})).rejects.toThrow(forbidden);
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
    await as(boss).users.addOp({ operationId: OP, email: 'boss@example.com', level: 'admin' });
    await expect(as(boss).userRoles.list({ operationId: OP })).resolves.toBeDefined();
  });

  it('the operation menu override is the op admin\'s, not the sol user\'s', async () => {
    // Menus stay split: `default_menu` is design-plane, this override is not.
    await expect(as(opBoss).operations.putConfig({ operationId: OP, config: { menu: [] } })).resolves.toEqual({ ok: true });
    await expect(as(solBoss).operations.putConfig({ operationId: OP, config: { menu: [] } })).rejects.toThrow(forbidden);
  });

  it('only an op admin removes from their operation', async () => {
    await expect(as(worker).users.removeOp({ operationId: OP, email: 'worker@example.com' })).rejects.toThrow(forbidden);
    await expect(as(opBoss).users.removeOp({ operationId: OP, email: 'worker@example.com' })).resolves.toEqual({ ok: true });
  });

  it('an op admin of ANOTHER operation has no authority here', async () => {
    await ensureOperation(db, 'test/other', SOL, 'Other');
    await addOpUser(db, { operationId: 'test/other', email: 'worker@example.com', level: 'admin' });
    await expect(as(worker).userRoles.list({ operationId: OP })).rejects.toThrow(forbidden);
    await expect(as(worker).userRoles.list({ operationId: 'test/other' })).resolves.toBeDefined();
  });

  it('an op admin suspended in the pool loses the grant', async () => {
    await setOrgUserStatus(db, { email: 'opboss@example.com', status: 'suspended' });
    await expect(as(opBoss).userRoles.list({ operationId: OP })).rejects.toThrow(forbidden);
  });
});

describe('the escalation rule (users.addOp)', () => {
  // One branch, one place: adding someone to an operation is an identity
  // question, so either tier may do it — but the LEVEL being written decides
  // who. An op admin can staff their operation and can never mint a peer.

  it('an op admin may add plain users', async () => {
    await inviteOrgUser(db, { email: 'new@example.com' });
    await expect(as(opBoss).users.addOp({ operationId: OP, email: 'new@example.com' })).resolves.toEqual({ ok: true });
    expect(emails(await listOpUsers(db, OP))).toContain('new@example.com');
  });

  it('an org admin may add plain users too — entry is an identity question', async () => {
    await inviteOrgUser(db, { email: 'new@example.com' });
    await expect(as(boss).users.addOp({ operationId: OP, email: 'new@example.com' })).resolves.toEqual({ ok: true });
  });

  it('an OP ADMIN CAN NEVER MINT AN OP ADMIN', async () => {
    await inviteOrgUser(db, { email: 'new@example.com' });
    await expect(as(opBoss).users.addOp({ operationId: OP, email: 'new@example.com', level: 'admin' }))
      .rejects.toThrow(/Requires organisation admin/);
  });

  it('nor can they promote an existing op user to admin', async () => {
    await expect(as(opBoss).users.addOp({ operationId: OP, email: 'worker@example.com', level: 'admin' }))
      .rejects.toThrow(/Requires organisation admin/);
    expect((await listOpUsers(db, OP)).find((u) => u.email === 'worker@example.com')?.level).toBe('user');
  });

  it('an org admin mints op admins', async () => {
    await expect(as(boss).users.addOp({ operationId: OP, email: 'worker@example.com', level: 'admin' }))
      .resolves.toEqual({ ok: true });
    expect((await listOpUsers(db, OP)).find((u) => u.email === 'worker@example.com')?.level).toBe('admin');
  });

  it('a plain user may add nobody', async () => {
    await inviteOrgUser(db, { email: 'new@example.com' });
    await expect(as(worker).users.addOp({ operationId: OP, email: 'new@example.com' })).rejects.toThrow(forbidden);
  });

  it('the pool still bounds it — neither tier can add a stranger', async () => {
    await expect(as(boss).users.addOp({ operationId: OP, email: 'nobody@example.com' }))
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
    await inviteOrgUser(db, { email: 'lonely@example.com', level: 'admin' });
    const lonely: ContextUser = { id: 'auth-lonely', name: 'Lonely', email: 'lonely@example.com', roles: [] };
    await expect(as(lonely).me({ operationId: OP })).rejects.toThrow(/not a user of operation/i);
    await expect(as(lonely).me({})).resolves.toMatchObject({ orgAdmin: true, console: true });
  });

  it('reports each caller\'s tiers, so the Console gates on what the server enforces', async () => {
    await expect(as(boss).me({ operationId: OP })).resolves.toMatchObject({ orgAdmin: true, opAdmin: false, console: true });
    await expect(as(opBoss).me({ operationId: OP })).resolves.toMatchObject({ orgAdmin: false, opAdmin: true, console: false });
    await expect(as(worker).me({ operationId: OP })).resolves.toMatchObject({ orgAdmin: false, opAdmin: false, console: false });
  });

  it('Console access is derived: being a sol user on any solution is enough', async () => {
    // Never a stored flag — a separate bit could contradict the grants above.
    await addOpUser(db, { operationId: OP, email: 'solboss@example.com' });
    await expect(as(solBoss).me({ operationId: OP })).resolves.toMatchObject({ orgAdmin: false, console: true });
  });
});

describe('demo posture', () => {
  it('auth unconfigured leaves every tier open', async () => {
    // With no identity there is nothing to gate on, and local dev would be
    // unusable otherwise. Same posture as every other check.
    await expect(stub().users.listOrg({})).resolves.toBeDefined();
    await expect(stub().users.addOp({ operationId: OP, email: 'worker@example.com', level: 'admin' })).resolves.toEqual({ ok: true });
    await expect(stub().userRoles.list({ operationId: OP })).resolves.toBeDefined();
    await expect(stub().me({ operationId: OP })).resolves.toMatchObject({ orgAdmin: true, opAdmin: true, console: true });
  });
});
