// A new app's starting values (APPS_AND_INSTANCES Part 3 §3.1, §3.3): a page
// carries an example definition (JSON text, checked when published) and
// default roles; `pages.appDefaults` reads both from the latest published
// version, and neither reaches the Runtime through `apps.user`.

import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import { addOpUser, ensureOperation, ensureSolution, inviteUser, putModel, putUserRoles } from '../src/host';
import { appRouter } from '../src/router';
import { createDbRolesResolver } from '../src/auth';
import type { ContextUser, SolutionModel } from '@fluxus/engine';

const SOL = 'test/app-defaults';
const OP = 'test/app-defaults';

const config: SolutionModel = {
  access: { roles: [{ id: 'role_crew', name: 'Crew' }, { id: 'role_boss', name: 'Boss' }] },
  attributes: [],
  recordTypes: [],
  activities: [],
  workflows: [{ id: 'wf_page_list', name: 'List', description: '', activities: [] }],
};

let db: Db;
const open = () => appRouter.createCaller({ db });
const crew: ContextUser = { id: 'u-crew', name: 'Crew', email: 'crew@example.com', roles: [] };
const as = (user: ContextUser) => appRouter.createCaller({ db, user, roles: createDbRolesResolver(db), authConfigured: true });

async function publish(path: string, def: Record<string, unknown>): Promise<void> {
  await open().pages.put({ solutionId: SOL, path, def: { workflowId: 'wf_page_list', ...def } });
  await open().pages.publish({ solutionId: SOL, path, readme: 'test' });
}

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'App defaults');
  await putModel(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'App defaults');
  await inviteUser(db, { email: 'crew@example.com' });
  await addOpUser(db, { operationId: OP, email: 'crew@example.com' });
  await putUserRoles(db, { operationId: OP, email: 'crew@example.com', roleIds: ['role_crew'] });
});

describe("the page's example definition (§3.1)", () => {
  it('publishing refuses an example that is not JSON, and takes a blank one', async () => {
    await open().pages.put({ solutionId: SOL, path: 'pages/bad', def: { workflowId: 'wf_page_list', exampleDefinition: '{ region: north' } });
    await expect(open().pages.publish({ solutionId: SOL, path: 'pages/bad', readme: 'x' })).rejects.toThrow(/not JSON/);
    await publish('pages/blank', { exampleDefinition: '  ' });
    await expect(open().pages.appDefaults({ solutionId: SOL, path: 'pages/blank' })).resolves.toEqual({ definition: null, roleIds: [] });
  });

  it('appDefaults reads the latest published version, not the draft', async () => {
    await publish('pages/scheduler', { exampleDefinition: '{"network":"water"}' });
    await open().pages.put({ solutionId: SOL, path: 'pages/scheduler', def: { workflowId: 'wf_page_list', exampleDefinition: '{"network":"draft"}' } });
    await expect(open().pages.appDefaults({ solutionId: SOL, path: 'pages/scheduler' })).resolves.toMatchObject({ definition: '{"network":"water"}' });
  });

  it('a path never published is not found', async () => {
    await expect(open().pages.appDefaults({ solutionId: SOL, path: 'pages/ghost' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rollback brings an old version back with its own example, or none', async () => {
    await publish('pages/rolled', {});
    await publish('pages/rolled', { exampleDefinition: '{"a":1}' });
    await open().pages.rollback({ solutionId: SOL, path: 'pages/rolled', version: 1, readme: 'back' });
    await expect(open().pages.appDefaults({ solutionId: SOL, path: 'pages/rolled' })).resolves.toEqual({ definition: null, roleIds: [] });
  });
});

describe('appDefaults roles and gate (§3.3)', () => {
  it('sends only the default roles the solution still declares', async () => {
    await publish('pages/roles', { roleIds: ['role_boss', 'role_gone'] });
    await expect(open().pages.appDefaults({ solutionId: SOL, path: 'pages/roles' })).resolves.toEqual({ definition: null, roleIds: ['role_boss'] });
  });

  it('is for the admins who set up apps, not their users', async () => {
    await expect(as(crew).pages.appDefaults({ solutionId: SOL, path: 'pages/scheduler' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('neither reaches the Runtime (§3.1–3.3)', () => {
  it('the version history is for sol admins: a role holder reads neither field there', async () => {
    await publish('pages/history', { exampleDefinition: '{"secret":1}', roleIds: ['role_crew'] });
    await expect(as(crew).pages.getVersion({ solutionId: SOL, path: 'pages/history', version: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(as(crew).pages.versions({ solutionId: SOL, path: 'pages/history' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(as(crew).model.versions({ solutionId: SOL })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('apps.user sends the page without its example or default roles', async () => {
    await publish('pages/runtime', { exampleDefinition: '{"x":1}', roleIds: ['role_crew'] });
    await open().apps.put({ operationId: OP, pageId: 'pages/runtime', label: 'Runtime app', roleIds: ['role_crew'], definition: '{}' });
    const mine = await as(crew).apps.user({ operationId: OP });
    const page = mine.pages.find((p) => p.path === 'pages/runtime');
    expect(page?.def).toEqual({ workflowId: 'wf_page_list' });
  });
});
