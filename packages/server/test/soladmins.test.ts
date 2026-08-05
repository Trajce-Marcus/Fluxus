// M5 design plane: `sol_admins` gates the Console write surfaces (config.put,
// pages.*, publish).
//
// **Strict, not dormant** (ruled 2026-08-02): you build a solution only if you
// are appointed to it, exactly as with an operation. One rule covers both —
// "you belong to a thing, or you do not" — replacing the adoption posture where
// an unconfigured solution stayed open to everyone. The bootstrap that follows
// is the same shape too: `solutions.create` appoints its creator, and
// `bootstrapOrgAdmin` covers solutions that already have nobody. Env stub (auth
// unconfigured) stays open.
//
// **One grade** (2026-08-04, migration 0016): the read/write split is gone. It
// guarded nothing once appointment moved onto the admin tiers — `read` could
// look at the model, which is what opening the solution already means. So the
// question is binary, and everything a grade used to guard (solutions.
// update/delete, appointing builders, operations, roles) is admin work covered
// in admintiers.test.ts.
//
// Keyed on EMAIL (migration 0012): sol admins are appointed from the pool, whose
// people typically have not signed in yet, so there is no auth id to key on.
// Callers here carry emails, and a caller with none can never match a row.

import { beforeAll, describe, expect, it } from 'vitest';
import { appointOrgAdmin, appointSolAdmin, ensureOperation, ensureOrg, ensureSolution, inviteUser, putConfig } from '../src/host';
import { createDb, type Db } from '../src/db/client';
import { appRouter } from '../src/router';
import { createDbRolesResolver } from '../src/auth';
import type { ConfigRaw, ContextUser } from '@fluxus/engine';

const SOL = 'test/impl';
const OP = 'test/impl';
const config: ConfigRaw = { attributes: [{ key: 'id', label: 'ID', description: '', type: 'text' }], recordTypes: [], workflows: [] };

let db: Db;
const builder: ContextUser = { id: 'builder', name: 'B', email: 'builder@example.com', roles: [] };
const outsider: ContextUser = { id: 'outsider', name: 'O', email: 'outsider@example.com', roles: [] };
const anonymous: ContextUser = { id: 'anon', name: 'A', email: null, roles: [] };
const boss: ContextUser = { id: 'boss', name: 'B', email: 'boss@example.com', roles: [] };

const as = (user: ContextUser) => appRouter.createCaller({ db, user, roles: createDbRolesResolver(db), authConfigured: true });
const stub = () => appRouter.createCaller({ db }); // no authConfigured ⇒ open
const denied = /admin of this solution/;

beforeAll(async () => {
  db = await createDb();
  // Nothing installs an org any more, so the tenancy under test is built here.
  await ensureOrg(db, 'default', 'Sol Admins Org');
  // Invite first, appoint second — the order is the model, and appointment
  // refuses anyone the organisation does not know.
  await inviteUser(db, { email: 'boss@example.com' });
  await appointOrgAdmin(db, { email: 'boss@example.com' }); // creates solutions
  await inviteUser(db, { email: 'builder@example.com' });
  await ensureSolution(db, SOL, 'Impl');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Impl');
});

describe('sol-admin enforcement', () => {
  it('strict: a solution nobody builds admits nobody to the design plane', async () => {
    // The old posture let an unconfigured solution stay open to everyone. That
    // is gone — this asks "do you belong to this", and an empty list answers it.
    await expect(as(builder).config.put({ solutionId: SOL, config })).rejects.toThrow(denied);
    await expect(as(outsider).config.put({ solutionId: SOL, config })).rejects.toThrow(denied);
  });

  it('once appointed, they build; everyone else is still refused', async () => {
    await appointSolAdmin(db, { solutionId: SOL, email: 'builder@example.com' });

    await expect(as(builder).config.put({ solutionId: SOL, config })).resolves.toEqual({ ok: true });
    await expect(as(builder).pages.put({ solutionId: SOL, path: 'pages/x', def: {} })).resolves.toEqual({ ok: true });
    await expect(as(builder).pages.publish({ solutionId: SOL, path: 'pages/x', readme: 'v1' })).resolves.toMatchObject({ version: 1 });

    await expect(as(outsider).config.put({ solutionId: SOL, config })).rejects.toThrow(denied);
  });

  it('reading the model is the same grant as building it', async () => {
    // What the retired `read` grade would have bought. Someone who may open the
    // solution may look at it; someone who may not, may not.
    await expect(as(builder).config.get({ solutionId: SOL })).resolves.toBeDefined();
  });

  it('a caller with no email can never match a row', async () => {
    // The key is the email; an auth id alone has nothing to match against. This
    // is why the rekey had to come with the pool — identity arrives by
    // invitation, and an invitation is an email.
    await expect(as(anonymous).config.put({ solutionId: SOL, config })).rejects.toThrow(denied);
  });

  it('rows are matched case-insensitively, like every other email key', async () => {
    await expect(
      as({ ...builder, email: 'BUILDER@Example.com' }).config.put({ solutionId: SOL, config }),
    ).resolves.toEqual({ ok: true });
  });

  it('creating a solution appoints its creator, or nobody could build it', async () => {
    // The bootstrap that strictness forces. Creating a solution and appointing
    // its first admin are one act — the rule the org tier already follows.
    await as(boss).solutions.create({ id: 'test/fresh', name: 'Fresh' });
    await expect(as(boss).config.put({ solutionId: 'test/fresh', config })).resolves.toEqual({ ok: true });
    await expect(as(outsider).config.put({ solutionId: 'test/fresh', config })).rejects.toThrow(denied);
  });

  it('bootstrapOrgAdmin opens solutions that already have nobody', async () => {
    // The recovery path for solutions that predate the rule.
    const { bootstrapOrgAdmin, ensureSolution: ensureSol } = await import('../src/host');
    await ensureSol(db, 'test/orphan', 'Orphan');
    const result = await bootstrapOrgAdmin(db, { email: 'boss@example.com' });
    expect(result.solutionsOpened).toContain('test/orphan');
  });

  it('sol admins see no user list at all — not even their own', async () => {
    // Zero user visibility is the point of the tier: they build the model, they
    // govern nobody, and these rows carry real identities.
    await expect(as(builder).solAdmins.list({ solutionId: SOL })).rejects.toThrow(/organisation admin/);
    await expect(as(builder).users.list({})).rejects.toThrow(/organisation admin/);
  });

  it('the env stub (no auth) keeps the design plane open', async () => {
    await expect(stub().config.put({ solutionId: SOL, config })).resolves.toEqual({ ok: true });
  });
});
