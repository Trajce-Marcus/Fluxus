// M4: page access control (published pages.list filters to openable versions)
// + operation-menu validation at save (pages must be published, roles must
// exist, one nesting level max).

import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import { ensureOperation, ensureOrg, ensureSolution, putConfig, putRoleAssignment } from '../src/host';
import { operations } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { appRouter } from '../src/router';
import { createDbRolesResolver } from '../src/auth';
import type { ConfigRaw, ContextUser } from '@fluxus/engine';

const SOL = 'test/menu';
const OP = 'test/menu';

const config: ConfigRaw = {
  access: { roles: [{ id: 'role_a', name: 'As' }, { id: 'role_b', name: 'Bs' }] },
  attributes: [{ key: 'id', label: 'ID', description: '', type: 'text' }],
  recordTypes: [], workflows: [],
};

let db: Db;
const u1: ContextUser = { id: 'u1', name: 'U1', email: null, roles: [] };
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
  await putRoleAssignment(db, { operationId: OP, userId: 'u1', roleIds: ['role_a'] });
});

describe('published page access filter (§6)', () => {
  it('filters to pages the caller can open', async () => {
    const pages = await enforced(u1).pages.list({ solutionId: SOL, operationId: OP, published: true });
    expect(pages.map((p) => p.path).sort()).toEqual(['pages/p1']); // p2 (role_b), p3 (no open) hidden
  });

  it('the env stub leaves all published pages visible', async () => {
    const pages = await open().pages.list({ solutionId: SOL, published: true });
    expect(pages.map((p) => p.path).sort()).toEqual(['pages/p1', 'pages/p2', 'pages/p3']);
  });

  it('draft mode is unaffected by access', async () => {
    const pages = await enforced(u1).pages.list({ solutionId: SOL });
    expect(pages.map((p) => p.path).sort()).toEqual(['pages/p1', 'pages/p2', 'pages/p3']);
  });
});

describe('operation menu validation at save (§5)', () => {
  it('accepts a menu of published pages + declared roles', async () => {
    const res = await open().operations.putConfig({
      operationId: OP,
      config: { menu: [{ label: 'Home', page: 'pages/p1', roles: ['role_a'] }, { label: 'Admin', roles: ['role_b'], items: [{ label: 'B', page: 'pages/p2', roles: ['role_b'] }] }] },
    });
    expect(res.ok).toBe(true);
  });

  it('rejects an unpublished page reference', async () => {
    await expect(open().operations.putConfig({ operationId: OP, config: { menu: [{ label: 'X', page: 'pages/ghost' }] } }))
      .rejects.toThrow(/no published page/i);
  });

  it('rejects an unknown role', async () => {
    await expect(open().operations.putConfig({ operationId: OP, config: { menu: [{ label: 'X', page: 'pages/p1', roles: ['role_zzz'] }] } }))
      .rejects.toThrow(/unknown role/i);
  });

  it('rejects nesting deeper than one level', async () => {
    await expect(open().operations.putConfig({
      operationId: OP,
      config: { menu: [{ label: 'A', items: [{ label: 'B', items: [{ label: 'C', page: 'pages/p1' }] }] }] },
    })).rejects.toThrow(/nests too deep/i);
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

  it('edits name and contact email', async () => {
    await open().orgs.putProfile({ orgId: 'default', name: 'Northwind Water', contactEmail: 'ops@northwind.example' });
    const org = await open().orgs.get({ orgId: 'default' });
    expect(org.name).toBe('Northwind Water');
    expect(org.contactEmail).toBe('ops@northwind.example');
    await open().orgs.putProfile({ orgId: 'default', name: 'Northwind Utilities', contactEmail: null });
  });

  it('rejects an unknown org and a malformed email', async () => {
    await expect(open().orgs.putProfile({ orgId: 'no-such-org', name: 'X', contactEmail: null })).rejects.toThrow(/not onboarded/i);
    await expect(open().orgs.putProfile({ orgId: 'default', name: 'X', contactEmail: 'nope' })).rejects.toThrow();
  });

  it('returns a synthetic row for an org with no record', async () => {
    const org = await open().orgs.get({ orgId: 'ghost' });
    expect(org).toMatchObject({ id: 'ghost', name: 'ghost', plan: 'free', createdAt: null });
  });
});
