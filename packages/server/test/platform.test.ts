// The platform tier (ruled 2026-08-03) — us, the vendor, above every org.
//
// Two things are being pinned here, and both are load-bearing:
//
//   1. Registering an org and creating its owner are ONE act. An org whose
//      first admin is a second step is an org nobody can enter, which is the
//      whole reason `bootstrapOrgAdmin` had to exist outside the request path.
//   2. The platform gate does NOT fall open when auth is unconfigured, unlike
//      every other check in the router. The others guard one org's data from
//      that org's own people; this one guards every org from everyone.

import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import { getOrg, getUser, listOrgs } from '../src/host';
import { appRouter } from '../src/router';
import { createDbRolesResolver, isPlatformAdmin } from '../src/auth';
import type { ContextUser } from '@fluxus/engine';

const vendor: ContextUser = { id: 'auth-vendor', name: 'Vendor', email: 'vendor@fluxus.dev', roles: [] };
const outsider: ContextUser = { id: 'auth-outsider', name: 'Outsider', email: 'someone@example.com', roles: [] };

let db: Db;

const as = (user: ContextUser) =>
  appRouter.createCaller({ db, user, roles: createDbRolesResolver(db), authConfigured: true });
/** Auth unconfigured — every OTHER gate in the router is open in this posture. */
const stub = () => appRouter.createCaller({ db });

beforeEach(async () => {
  db = await createDb();
  process.env.FLUXUS_PLATFORM_ADMINS = 'vendor@fluxus.dev';
});

describe('platform admin recognition', () => {
  it('reads the env allowlist, case- and space-insensitively', () => {
    expect(isPlatformAdmin('vendor@fluxus.dev', { FLUXUS_PLATFORM_ADMINS: 'vendor@fluxus.dev' })).toBe(true);
    expect(isPlatformAdmin('  VENDOR@Fluxus.dev ', { FLUXUS_PLATFORM_ADMINS: 'vendor@fluxus.dev' })).toBe(true);
    expect(isPlatformAdmin('vendor@fluxus.dev', { FLUXUS_PLATFORM_ADMINS: 'a@x.com, vendor@fluxus.dev ' })).toBe(true);
    expect(isPlatformAdmin('other@fluxus.dev', { FLUXUS_PLATFORM_ADMINS: 'vendor@fluxus.dev' })).toBe(false);
  });

  it('admits nobody when the allowlist is unset or empty', () => {
    expect(isPlatformAdmin('vendor@fluxus.dev', {})).toBe(false);
    expect(isPlatformAdmin('vendor@fluxus.dev', { FLUXUS_PLATFORM_ADMINS: '' })).toBe(false);
    expect(isPlatformAdmin(null, { FLUXUS_PLATFORM_ADMINS: 'vendor@fluxus.dev' })).toBe(false);
  });
});

describe('the gate', () => {
  it('refuses an ordinary user', async () => {
    await expect(as(outsider).platform.listOrgs()).rejects.toThrow(/Requires platform admin/);
    await expect(
      as(outsider).platform.registerOrg({ id: 'acme', name: 'Acme', ownerEmail: 'owner@acme.com' }),
    ).rejects.toThrow(/Requires platform admin/);
  });

  it('refuses an ORG admin — the org tier is the root of authority inside an org, not above it', async () => {
    await as(vendor).platform.registerOrg({ id: 'acme', name: 'Acme', ownerEmail: 'owner@acme.com' });
    const owner: ContextUser = { id: 'auth-owner', name: 'Owner', email: 'owner@acme.com', roles: [] };
    await expect(as(owner).platform.listOrgs()).rejects.toThrow(/Requires platform admin/);
  });

  it('stays SHUT in demo posture, unlike every other gate', async () => {
    // The contrast is the point: with auth unconfigured the org-admin surface
    // is wide open, and the platform surface still is not.
    await expect(stub().users.list()).resolves.toBeDefined();
    await expect(stub().platform.listOrgs()).rejects.toThrow(/Requires platform admin/);
  });
});

describe('registerOrg', () => {
  it('creates the org and its owner as one act', async () => {
    await as(vendor).platform.registerOrg({
      id: 'acme',
      name: 'Acme Corp',
      ownerEmail: 'Owner@Acme.com',
      ownerName: 'Ada Owner',
    });

    const org = await getOrg(db, 'acme');
    expect(org).toMatchObject({ id: 'acme', name: 'Acme Corp', plan: 'free', status: 'active' });
    // The org row itself answers "whose is this" — one email column, since
    // `contact_email` was dropped (0018) as a duplicate of this one.
    expect(org.ownerEmail).toBe('owner@acme.com');

    // ...and the owner is the org's FIRST USER, in `acme`, not in 'default'.
    // Nobody invites the owner — there is nobody there to do it — so the act
    // that creates the org creates the person.
    const owner = await getUser(db, { email: 'owner@acme.com', orgId: 'acme' });
    expect(owner).toMatchObject({ status: 'invited', name: 'Ada Owner' });
    expect(await getUser(db, { email: 'owner@acme.com', orgId: 'default' })).toBeNull();

    // Deliberately NOT an org admin: the owner appoints them, and appoints
    // themselves one if they mean to do ordinary org-admin work.
    const { listOrgAdmins } = await import('../src/host');
    expect(await listOrgAdmins(db, 'acme')).toEqual([]);
  });

  it('lets the owner into the Console of their own org, and nowhere else', async () => {
    await as(vendor).platform.registerOrg({ id: 'acme', name: 'Acme', ownerEmail: 'owner@acme.com' });
    const owner: ContextUser = { id: 'auth-owner', name: 'Owner', email: 'owner@acme.com', roles: [] };

    // The point of the whole exercise: no bootstrap script, no second step.
    // Console access is derived from ownership, which is what makes the first
    // appointment reachable on an org where nobody holds a grant yet.
    await expect(as(owner).me({ orgId: 'acme' })).resolves.toMatchObject({ orgOwner: true, orgAdmin: false, console: true });
    // And the org key is a real boundary — the default org is somebody else's.
    await expect(as(owner).me({ orgId: 'default' })).resolves.toMatchObject({ orgOwner: false, console: false });
  });

  it('is where the first org admin comes from — the owner appoints, we do not', async () => {
    await as(vendor).platform.registerOrg({ id: 'acme', name: 'Acme', ownerEmail: 'owner@acme.com' });
    const owner: ContextUser = { id: 'auth-owner', name: 'Owner', email: 'owner@acme.com', roles: [] };
    const { listOrgAdmins } = await import('../src/host');

    // Invite, then appoint — two acts, as everywhere else.
    await as(owner).users.invite({ email: 'second@acme.com', orgId: 'acme' });
    await as(owner).orgAdmins.appoint({ email: 'second@acme.com', orgId: 'acme' });
    expect((await listOrgAdmins(db, 'acme')).map((r) => r.email)).toEqual(['second@acme.com']);

    // The new org admin cannot appoint a third — no tier appoints its own tier.
    const second: ContextUser = { id: 'auth-second', name: 'Second', email: 'second@acme.com', roles: [] };
    await as(owner).users.invite({ email: 'third@acme.com', orgId: 'acme' });
    await expect(as(second).orgAdmins.appoint({ email: 'third@acme.com', orgId: 'acme' }))
      .rejects.toThrow(/organisation owner/);
  });

  it('refuses a duplicate id', async () => {
    await as(vendor).platform.registerOrg({ id: 'acme', name: 'Acme', ownerEmail: 'owner@acme.com' });
    await expect(
      as(vendor).platform.registerOrg({ id: 'acme', name: 'Acme Again', ownerEmail: 'other@acme.com' }),
    ).rejects.toThrow(/already exists/);
  });

  it('refuses an id that could not survive being a URL segment', async () => {
    // The id IS the URL — the Console and Runtime read their org from
    // `/o/<orgId>/…`, so anything needing escaping cannot be an org id.
    for (const id of ['Acme', 'acme corp', 'demo/sdm', '-acme', 'acme_corp']) {
      await expect(
        as(vendor).platform.registerOrg({ id, name: 'X', ownerEmail: 'owner@acme.com' }),
      ).rejects.toThrow();
    }
  });
});

// Registering a second org turned `org_id` from decoration into a boundary.
// These are the holes that opened the moment there was more than one org: gates
// that asked "are you an admin?" without asking "of WHICH org?", and operations
// that silently landed in 'default' whatever their solution belonged to.
describe('the org key as a boundary', () => {
  const dflt: ContextUser = { id: 'auth-d', name: 'Default Admin', email: 'boss@default.com', roles: [] };
  const owner: ContextUser = { id: 'auth-o', name: 'Owner', email: 'owner@acme.com', roles: [] };

  beforeEach(async () => {
    await as(vendor).platform.registerOrg({ id: 'acme', name: 'Acme', ownerEmail: 'owner@acme.com' });
    const { inviteUser, appointOrgAdmin } = await import('../src/host');
    await inviteUser(db, { email: 'boss@default.com' });
    await appointOrgAdmin(db, { email: 'boss@default.com' }); // admin of 'default'
    // The owner is not implicitly an org admin, so acme's owner appoints
    // themselves — the ordinary first move on a new organisation.
    await appointOrgAdmin(db, { email: 'owner@acme.com', orgId: 'acme' });
  });

  it("an admin of 'default' cannot create solutions in another org", async () => {
    await expect(
      as(dflt).solutions.create({ id: 'acme/thing', name: 'Thing', orgId: 'acme' }),
    ).rejects.toThrow(/Requires organisation admin/);
    await expect(as(owner).solutions.create({ id: 'acme/thing', name: 'Thing', orgId: 'acme' })).resolves.toBeDefined();
  });

  it("an admin of 'default' cannot rename, delete or staff another org's solution", async () => {
    await as(owner).solutions.create({ id: 'acme/thing', name: 'Thing', orgId: 'acme' });
    await expect(as(dflt).solutions.update({ solutionId: 'acme/thing', name: 'Mine now' })).rejects.toThrow(/organisation admin/);
    await expect(as(dflt).solAdmins.list({ solutionId: 'acme/thing' })).rejects.toThrow(/organisation admin/);
    await expect(
      as(dflt).solAdmins.appoint({ solutionId: 'acme/thing', email: 'boss@default.com' }),
    ).rejects.toThrow(/organisation admin/);
  });

  it('an operation inherits its solution\'s org rather than landing in "default"', async () => {
    await as(owner).solutions.create({ id: 'acme/thing', name: 'Thing', orgId: 'acme' });
    await as(owner).operations.create({ id: 'acme/live', solutionId: 'acme/thing', name: 'Live' });

    const { getOperation } = await import('../src/host');
    expect((await getOperation(db, 'acme/live')).orgId).toBe('acme');
    // ...and creating it was the acme admin's call, not the default admin's.
    await expect(
      as(dflt).operations.create({ id: 'acme/other', solutionId: 'acme/thing', name: 'Other' }),
    ).rejects.toThrow(/organisation admin/);
  });
});

describe('listOrgs', () => {
  it('is the one cross-org read', async () => {
    await as(vendor).platform.registerOrg({ id: 'beta', name: 'Beta', ownerEmail: 'b@beta.com' });
    await as(vendor).platform.registerOrg({ id: 'alpha', name: 'Alpha', ownerEmail: 'a@alpha.com' });

    // Exactly the two just registered: a database starts with no orgs at all
    // (the migration stopped installing a 'default' one on 2026-08-05).
    const rows = await as(vendor).platform.listOrgs();
    expect(rows.map((r) => r.id)).toEqual(['alpha', 'beta']); // by name
    expect(await listOrgs(db)).toHaveLength(2);
  });
});
