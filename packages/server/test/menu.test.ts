// M4: page access control (published pages.list filters to openable versions)
// + operation-menu validation at save (pages must be published, roles must
// exist, one nesting level max).

import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import { ensureOperation, ensureSolution, putConfig, putRoleAssignment } from '../src/host';
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
