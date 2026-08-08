// Per-entity model writes (model storage split, step 1): `config.putAttribute`
// and its nine siblings, plus `config.putDefaultMenu`.
//
// The point of the exercise is the concurrency fix — two sol admins editing two
// different entities have no logical conflict, and must both keep their work.
// `config.put` cannot give them that: it writes the whole graph, so the second
// save silently overwrites the first. Everything else here guards the property
// that makes the narrower write safe: the *write* unit narrows to one entity,
// the *consistency* unit stays the whole graph.

import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import {
  appointSolAdmin,
  ensureOperation,
  ensureOrg,
  ensureSolution,
  getSolutionConfig,
  inviteUser,
  putConfig,
} from '../src/host';
import { appRouter } from '../src/router';
import { createDbRolesResolver } from '../src/auth';
import type { ContextUser, SolutionConfig } from '@fluxus/engine';

const SOL = 'test/entities';
const OP = 'test/entities';

/** A small but complete model: one attribute, one workflow that captures it,
 *  one record type bound to that workflow. Every dangling-reference case below
 *  is one deletion away from here. */
const config: SolutionConfig = {
  attributes: [{ key: 'name', label: 'Name', description: '', type: 'text' }],
  recordTypes: [{ id: 'rt_assets', name: 'Assets', description: '', workflow_ref: 'wf_assets', custom_fields: [] }],
  workflows: [{
    id: 'wf_assets',
    name: 'Assets',
    description: '',
    activities: [{
      id: 'act_create_assets',
      name: 'Create asset',
      description: '',
      sort_order: 0,
      record_map: 'CREATE',
      attributes: [{ attribute_ref: 'name' }],
      before_hook: null,
      after_hook: null,
    }],
  }],
  access: { roles: [{ id: 'role_crew', name: 'Crew' }] },
};

let db: Db;
const admin: ContextUser = { id: 'admin', name: 'A', email: 'admin@example.com', roles: [] };
const outsider: ContextUser = { id: 'outsider', name: 'O', email: 'outsider@example.com', roles: [] };
const as = (user: ContextUser) => appRouter.createCaller({ db, user, roles: createDbRolesResolver(db), authConfigured: true });
const stub = () => appRouter.createCaller({ db }); // auth unconfigured ⇒ open

beforeEach(async () => {
  db = await createDb();
  await ensureOrg(db, 'default', 'Entities Org');
  await inviteUser(db, { email: 'admin@example.com' });
  await inviteUser(db, { email: 'outsider@example.com' });
  await ensureSolution(db, SOL, 'Entities');
  await appointSolAdmin(db, { email: 'admin@example.com', solutionId: SOL });
  await putConfig(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Entities');
});

describe('the lost update this replaces', () => {
  it('two admins editing two different entities both keep their work', async () => {
    // Both read the same starting model — the situation config.put resolves by
    // dropping whichever save lands second.
    const before = await getSolutionConfig(db, SOL);
    expect(before.attributes).toHaveLength(1);

    await stub().config.putAttribute({
      solutionId: SOL,
      def: { key: 'serial', label: 'Serial', description: '', type: 'text' },
    });
    await stub().config.putRecordType({
      solutionId: SOL,
      def: { ...before.recordTypes[0], name: 'Plant assets' },
    });

    const after = await getSolutionConfig(db, SOL);
    expect(after.attributes.map((a) => a.key)).toEqual(['name', 'serial']);
    expect(after.recordTypes[0].name).toBe('Plant assets');
  });

  it('the whole-config door still works — it is the import path', async () => {
    await stub().config.put({ solutionId: SOL, config: { ...config, functions: [] } });
    expect((await getSolutionConfig(db, SOL)).recordTypes).toHaveLength(1);
  });
});

describe('put', () => {
  it('replaces an entity in place, by the identity its def carries', async () => {
    await stub().config.putAttribute({
      solutionId: SOL,
      def: { key: 'name', label: 'Asset name', description: '', type: 'text' },
    });
    const after = await getSolutionConfig(db, SOL);
    expect(after.attributes).toHaveLength(1);
    expect(after.attributes[0].label).toBe('Asset name');
  });

  it('rejects a def with no identity', async () => {
    await expect(stub().config.putAttribute({ solutionId: SOL, def: { label: 'Nameless' } }))
      .rejects.toThrow(/carries no 'key'/);
  });

  it('creates the config row for a solution that has none', async () => {
    await ensureSolution(db, 'test/blank', 'Blank');
    await stub().config.putWorkflow({
      solutionId: 'test/blank',
      def: { id: 'wf_a', name: 'A', description: '', activities: [] },
    });
    const created = await getSolutionConfig(db, 'test/blank');
    expect(created.workflows.map((w) => w.id)).toEqual(['wf_a']);
    expect(created.recordTypes).toEqual([]);
  });

  it('writes functions and roles too', async () => {
    await stub().config.putFunction({
      solutionId: SOL,
      def: { id: 'fn_double', name: 'double', description: 'Twice n', body: 'function double(n) {\n  return n * 2\n}' },
    });
    await stub().config.putRole({ solutionId: SOL, def: { id: 'role_leads', name: 'Leads' } });
    const after = await getSolutionConfig(db, SOL);
    expect(after.functions?.map((f) => f.id)).toEqual(['fn_double']);
    expect(after.access?.roles?.map((r) => r.id)).toEqual(['role_crew', 'role_leads']);
  });
});

describe('delete', () => {
  it('removes an entity nothing references', async () => {
    await stub().config.putRole({ solutionId: SOL, def: { id: 'role_leads', name: 'Leads' } });
    await stub().config.deleteRole({ solutionId: SOL, id: 'role_leads' });
    expect((await getSolutionConfig(db, SOL)).access?.roles?.map((r) => r.id)).toEqual(['role_crew']);
  });

  it('is idempotent — an id already gone is a delete that already happened', async () => {
    await stub().config.deleteFunction({ solutionId: SOL, id: 'fn_never' });
    expect((await getSolutionConfig(db, SOL)).functions ?? []).toEqual([]);
  });

  it('refuses an attribute an activity still captures, and rolls back', async () => {
    await expect(stub().config.deleteAttribute({ solutionId: SOL, key: 'name' })).rejects.toThrow();
    expect((await getSolutionConfig(db, SOL)).attributes.map((a) => a.key)).toEqual(['name']);
  });

  it('refuses a workflow a record type still points at, and rolls back', async () => {
    await expect(stub().config.deleteWorkflow({ solutionId: SOL, id: 'wf_assets' })).rejects.toThrow();
    expect((await getSolutionConfig(db, SOL)).workflows.map((w) => w.id)).toEqual(['wf_assets']);
  });

  it('refuses a record type stored records still reference', async () => {
    await stub().activities.run({
      operationId: OP,
      activityId: 'act_create_assets',
      attributes: { name: 'Pump 1' },
    });
    await expect(stub().config.deleteRecordType({ solutionId: SOL, id: 'rt_assets' }))
      .rejects.toThrow(/stored records still reference/);
    expect((await getSolutionConfig(db, SOL)).recordTypes).toHaveLength(1);
  });
});

describe('the graph is validated on every entity write', () => {
  it('an entity that dangles is rejected whole', async () => {
    await expect(stub().config.putWorkflow({
      solutionId: SOL,
      def: {
        id: 'wf_ghost',
        name: 'Ghost',
        description: '',
        activities: [{
          id: 'act_ghost',
          name: 'Ghost',
          description: '',
          sort_order: 0,
          attributes: [{ attribute_ref: 'nope' }],
          before_hook: null,
          after_hook: null,
        }],
      },
    })).rejects.toThrow();
    expect((await getSolutionConfig(db, SOL)).workflows.map((w) => w.id)).toEqual(['wf_assets']);
  });
});

describe('the default menu', () => {
  it('saves, and drops the key when emptied', async () => {
    await stub().pages.put({ solutionId: SOL, path: 'pages/home', def: {} });
    await stub().pages.publish({ solutionId: SOL, path: 'pages/home', readme: 'v1' });
    await stub().config.putDefaultMenu({
      solutionId: SOL,
      menu: [{ label: 'Home', page: 'pages/home', roles: ['role_crew'] }],
    });
    const withMenu = await getSolutionConfig(db, SOL) as SolutionConfig & { default_menu?: unknown[] };
    expect(withMenu.default_menu).toHaveLength(1);

    await stub().config.putDefaultMenu({ solutionId: SOL, menu: [] });
    const emptied = await getSolutionConfig(db, SOL) as SolutionConfig & { default_menu?: unknown[] };
    expect(emptied.default_menu).toBeUndefined();
  });

  it('rejects a menu naming an unpublished page or an unknown role', async () => {
    await expect(stub().config.putDefaultMenu({ solutionId: SOL, menu: [{ label: 'X', page: 'pages/ghost' }] }))
      .rejects.toThrow(/no published page/);
    await expect(stub().config.putDefaultMenu({ solutionId: SOL, menu: [{ label: 'X', roles: ['role_zzz'] }] }))
      .rejects.toThrow(/unknown role/);
  });

  it('holds the menu to the model — deleting a role it names fails', async () => {
    await stub().config.putDefaultMenu({ solutionId: SOL, menu: [{ label: 'Crew', roles: ['role_crew'] }] });
    await expect(stub().config.deleteRole({ solutionId: SOL, id: 'role_crew' })).rejects.toThrow(/unknown role/);
    expect((await getSolutionConfig(db, SOL)).access?.roles).toHaveLength(1);
  });
});

describe('the gate is sol admin, exactly like config.put', () => {
  it('lets the appointed sol admin through', async () => {
    await expect(as(admin).config.putAttribute({
      solutionId: SOL,
      def: { key: 'serial', label: 'Serial', description: '', type: 'text' },
    })).resolves.toEqual({ ok: true });
  });

  it('refuses everyone else, on put and on delete', async () => {
    await expect(as(outsider).config.putAttribute({
      solutionId: SOL,
      def: { key: 'serial', label: 'Serial', description: '', type: 'text' },
    })).rejects.toThrow(/admin of this solution/);
    await expect(as(outsider).config.deleteAttribute({ solutionId: SOL, key: 'name' }))
      .rejects.toThrow(/admin of this solution/);
    await expect(as(outsider).config.putDefaultMenu({ solutionId: SOL, menu: [] }))
      .rejects.toThrow(/admin of this solution/);
  });
});
