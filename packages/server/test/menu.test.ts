// Published pages, the operation's app menu checked at save (APPS_AND_INSTANCES
// §2.5 — it replaced page access control and the role-gated menu override), and
// the solution's default menu until step 3 drops it.

import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import { addOpUser, ensureOperation, ensureOrg, ensureSolution, inviteUser, putConfig, putUserRoles } from '../src/host';
import { operations } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { appRouter } from '../src/router';
import { createDbRolesResolver } from '../src/auth';
import type { SolutionConfig, ContextUser } from '@fluxus/engine';

const SOL = 'test/menu';
const OP = 'test/menu';

const config: SolutionConfig = {
  access: { roles: [{ id: 'role_a', name: 'As' }, { id: 'role_b', name: 'Bs' }] },
  attributes: [{ key: 'id', label: 'ID', description: '', type: 'text' }],
  recordTypes: [], workflows: [],
};

let db: Db;
// An op user of OP: entry is a separate gate from page access, and this case is
// about the second one (RBAC_COMPACT "Users").
const u1: ContextUser = { id: 'u1', name: 'U1', email: 'u1@example.com', roles: [] };
const enforced = (user: ContextUser) => appRouter.createCaller({ db, user, roles: createDbRolesResolver(db), authConfigured: true });
const open = () => appRouter.createCaller({ db });

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'Menu');
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Menu');
  // Publish three pages with different open-access.
  const pub = async (path: string, openRoles?: string[]) => {
    await appRouter.createCaller({ db }).pages.put({ solutionId: SOL, path, def: openRoles ? { access: { open: openRoles } } : {} });
    await appRouter.createCaller({ db }).pages.publish({ solutionId: SOL, path, readme: 'seed' });
  };
  await pub('pages/p1', ['role_a']);
  await pub('pages/p2', ['role_b']);
  await pub('pages/p3'); // no access.open → default deny when active
  await putUserRoles(db, { operationId: OP, email: 'u1@example.com', roleIds: ['role_a'] });
  await inviteUser(db, { email: 'u1@example.com' });
  await addOpUser(db, { operationId: OP, email: 'u1@example.com' });
});

describe('published pages (APPS_AND_INSTANCES §2.2)', () => {
  it('lists every published page — who may open one is the app\'s to say, not the page\'s', async () => {
    const pages = await enforced(u1).pages.list({ solutionId: SOL, operationId: OP, published: true });
    expect(pages.map((p) => p.path).sort()).toEqual(['pages/p1', 'pages/p2', 'pages/p3']);
  });

  it('draft mode is the design plane: solution admins only (APPS_AND_INSTANCES §2.3)', async () => {
    await expect(enforced(u1).pages.list({ solutionId: SOL })).rejects.toThrow(/admin of this solution/i);
    const pages = await open().pages.list({ solutionId: SOL });
    expect(pages.map((p) => p.path).sort()).toEqual(['pages/p1', 'pages/p2', 'pages/p3']);
  });
});

describe('the app menu, checked at save (APPS_AND_INSTANCES §2.5)', () => {
  let home: string;
  let admin: string;
  beforeAll(async () => {
    ({ id: home } = await open().apps.put({ operationId: OP, pageId: 'pages/p1', label: 'Home', roleIds: ['role_a'], definition: '{}' }));
    ({ id: admin } = await open().apps.put({ operationId: OP, pageId: 'pages/p2', label: 'Admin', roleIds: ['role_b'], definition: '{}' }));
  });

  it('accepts leaves pointing at the operation\'s apps, and groups of them', async () => {
    const menu = [{ id: 'm1', appId: home }, { id: 'g1', label: 'Admin', items: [{ id: 'm2', appId: admin }] }];
    await expect(open().operations.putConfig({ operationId: OP, config: { menu } })).resolves.toEqual({ ok: true });
    expect((await open().apps.list({ operationId: OP })).menu).toEqual(menu);
  });

  it('accepts a group that is still empty — one is made before it is filled', async () => {
    await expect(open().operations.putConfig({ operationId: OP, config: { menu: [{ id: 'g1', label: 'Admin', items: [] }] } }))
      .resolves.toEqual({ ok: true });
  });

  it('rejects a leaf that points at no app of this operation', async () => {
    await expect(open().operations.putConfig({ operationId: OP, config: { menu: [{ id: 'm1', appId: 'nope' }] } }))
      .rejects.toThrow(/not an app of this operation/);
  });

  it('rejects an app on the menu twice', async () => {
    await expect(open().operations.putConfig({
      operationId: OP,
      config: { menu: [{ id: 'm1', appId: home }, { id: 'g1', label: 'More', items: [{ id: 'm2', appId: home }] }] },
    })).rejects.toThrow(/on the menu more than once/);
  });

  it('rejects duplicate item ids, a group with no name, and the old shape', async () => {
    await expect(open().operations.putConfig({ operationId: OP, config: { menu: [{ id: 'm1', appId: home }, { id: 'm1', appId: admin }] } }))
      .rejects.toThrow(/duplicate item id/);
    await expect(open().operations.putConfig({ operationId: OP, config: { menu: [{ id: 'g1', label: ' ', items: [] }] } }))
      .rejects.toThrow();
    // A page and roles on an item are the menu before apps Part 2.
    await expect(open().operations.putConfig({ operationId: OP, config: { menu: [{ label: 'Home', page: 'pages/p1', roles: ['role_a'] }] as never } }))
      .rejects.toThrow();
  });

  it('nests one level only — a group holds leaves', async () => {
    await expect(open().operations.putConfig({
      operationId: OP,
      config: { menu: [{ id: 'g1', label: 'A', items: [{ id: 'g2', label: 'B', items: [] }] }] as never },
    })).rejects.toThrow();
  });

  it('is the op admin\'s', async () => {
    await expect(enforced(u1).operations.putConfig({ operationId: OP, config: { menu: [] } })).rejects.toThrow(/admin of operation/);
  });
});

// M10 (§5 amended): the solution ships a default_menu in its config artifact,
// validated at config.put with the same §5 rules — roles read from the config
// being saved. The operation's config.menu is the whole-menu override; the
// inherit fallback itself is resolved client-side at connect.
describe('solution default_menu validation at config.put (§5, M10)', () => {
  it('accepts a default_menu of published pages + roles from the incoming config', async () => {
    const res = await open().config.put({
      solutionId: SOL,
      config: { ...config, default_menu: [{ label: 'Home', page: 'pages/p1', roles: ['role_a'] }] },
    });
    expect(res.ok).toBe(true);
  });

  it('rejects an unpublished page reference', async () => {
    await expect(open().config.put({
      solutionId: SOL,
      config: { ...config, default_menu: [{ label: 'X', page: 'pages/ghost' }] },
    })).rejects.toThrow(/no published page/i);
  });

  it('validates roles against the incoming config, not the stored one', async () => {
    // role_c exists only in the config being saved — must pass.
    await expect(open().config.put({
      solutionId: SOL,
      config: {
        ...config,
        access: { roles: [...(config.access?.roles ?? []), { id: 'role_c', name: 'Cs' }] },
        default_menu: [{ label: 'C', page: 'pages/p1', roles: ['role_c'] }],
      },
    })).resolves.toEqual({ ok: true });
    // role_zzz exists nowhere — must fail even though the stored config now has role_c.
    await expect(open().config.put({
      solutionId: SOL,
      config: { ...config, default_menu: [{ label: 'X', page: 'pages/p1', roles: ['role_zzz'] }] },
    })).rejects.toThrow(/unknown role/i);
  });

  it('rejects a default_menu that is not a menu shape', async () => {
    await expect(open().config.put({
      solutionId: SOL,
      config: { ...config, default_menu: [{ page: 'pages/p1' }] },
    })).rejects.toThrow(/default_menu is not a menu/i);
  });
});

// M13: the Runtime header's identity line — org · solution … operation. The
// three names all arrive on operations.get, which connect() calls first.
describe('runtime header names (M13)', () => {
  it('carries org, solution and operation display names', async () => {
    await ensureOrg(db, 'default', 'Northwind Utilities');
    const op = await open().operations.get({ operationId: OP });
    expect(op.orgName).toBe('Northwind Utilities');
    expect(op.solutionName).toBe('Menu');
    expect(op.name).toBe('Menu');
  });

  it('falls back to the org id when no orgs row exists', async () => {
    await ensureOperation(db, 'test/menu-orphan', SOL, 'Orphan');
    await db.update(operations).set({ orgId: 'no-such-org' }).where(eq(operations.id, 'test/menu-orphan'));
    const op = await open().operations.get({ operationId: 'test/menu-orphan' });
    expect(op.orgName).toBe('no-such-org'); // boot must not break on a missing name
  });
});

// M14: the org tier — profile reads/edits. No create (registration waits on
// user → org resolution) and no plan/status writes (ours to set, not theirs).
describe('org profile (M14)', () => {
  it('reads the profile with plan defaults', async () => {
    await ensureOrg(db, 'default', 'Northwind Utilities');
    const org = await open().orgs.get({ orgId: 'default' });
    expect(org.name).toBe('Northwind Utilities');
    expect(org.plan).toBe('free');
    expect(org.status).toBe('active');
  });

  it('edits the name — the only field the org owns about itself', async () => {
    await open().orgs.putProfile({ orgId: 'default', name: 'Northwind Water' });
    const org = await open().orgs.get({ orgId: 'default' });
    expect(org.name).toBe('Northwind Water');
    await open().orgs.putProfile({ orgId: 'default', name: 'Northwind Utilities' });
  });

  it('cannot write the owner — that is a transfer, not a profile edit', async () => {
    // An org admin who could write this column would promote themselves to the
    // root that appoints org admins. The field is not in the input at all.
    const { orgs } = await import('../src/db/schema');
    const { eq } = await import('drizzle-orm');
    await db.update(orgs).set({ ownerEmail: 'owner@northwind.example' }).where(eq(orgs.id, 'default'));
    await open().orgs.putProfile({ orgId: 'default', name: 'Northwind Utilities' });
    expect((await open().orgs.get({ orgId: 'default' })).ownerEmail).toBe('owner@northwind.example');
  });

  it('rejects an unknown org', async () => {
    await expect(open().orgs.putProfile({ orgId: 'no-such-org', name: 'X' })).rejects.toThrow(/not onboarded/i);
  });

  it('returns a synthetic row for an org with no record', async () => {
    const org = await open().orgs.get({ orgId: 'ghost' });
    expect(org).toMatchObject({ id: 'ghost', name: 'ghost', plan: 'free', createdAt: null });
  });
});
