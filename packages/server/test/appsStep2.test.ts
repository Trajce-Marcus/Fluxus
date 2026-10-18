// The apps Part 2 step 2 script (APPS_AND_INSTANCES §2.8), run against an
// in-memory database shaped like dev: a solution default menu with a group,
// items carrying no roles, a page on two items and one that opens nothing; one
// operation inheriting it, one with an old-shape menu of its own, and one whose
// solution has no pages.

import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '../src/db/client';
import { addOpUser, ensureOperation, ensureSolution, inviteUser, putConfig, putUserRoles } from '../src/host';
import { appRouter } from '../src/router';
import { createDbRolesResolver } from '../src/auth';
import { operations, records, sdmMenus } from '../src/db/schema';
import { applyPlan, planStep2 } from '../scripts/apps-step2';
import type { ContextUser, SolutionConfig } from '@fluxus/engine';

const SOL = 'test/step2';
const INHERITS = 'test/step2-inherits';
const OWN_MENU = 'test/step2-own-menu';
const EMPTY_SOL = 'test/step2-empty';
const EMPTY_OP = 'test/step2-empty-op';

const config: SolutionConfig = {
  access: { roles: [{ id: 'role_admin', name: 'Admin' }, { id: 'role_inspector', name: 'Inspector' }] },
  attributes: [], recordTypes: [], workflows: [],
};

let db: Db;
const open = () => appRouter.createCaller({ db });
const inspector: ContextUser = { id: 'u-insp', name: 'Insp', email: 'insp@example.com', roles: [] };

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'Step 2');
  await putConfig(db, SOL, config);
  const publish = async (path: string, open?: string[]) => {
    await appRouter.createCaller({ db }).pages.put({ solutionId: SOL, path, def: open ? { access: { open } } : {} });
    await appRouter.createCaller({ db }).pages.publish({ solutionId: SOL, path, readme: 'seed' });
  };
  await publish('pages/jobs', ['role_admin', 'role_inspector']);
  await publish('pages/job', ['role_admin', 'role_inspector']); // on no menu
  await publish('pages/inspectors', ['role_admin']);
  await publish('pages/defects', ['role_admin', 'role_gone']); // a role the solution no longer declares
  await publish('pages/demo'); // names no roles
  // Written straight in: a default menu with an item that opens nothing could
  // not be saved through config.put any more.
  await db.insert(sdmMenus).values({
    solutionId: SOL,
    def: [
      { id: 'm-jobs', label: 'Jobs', page: 'pages/jobs', roles: ['role_admin', 'role_inspector'] },
      { id: 'g-admin', label: 'Admin', roles: ['role_admin'], items: [
        { id: 'm-insp', label: 'Inspectors', page: 'pages/inspectors', roles: ['role_admin'] },
        { id: 'm-def', label: 'Defects', page: 'pages/defects', roles: [] },
      ] },
      { id: 'm-again', label: 'Jobs again', page: 'pages/jobs' },
      { id: 'm-dead', label: 'Dead' },
    ],
  });
  await ensureOperation(db, INHERITS, SOL, 'Inherits');
  await ensureOperation(db, OWN_MENU, SOL, 'Own menu');
  await db.update(operations).set({ config: { menu: [{ label: 'Board', page: 'pages/job', roles: ['role_inspector'] }] as never } })
    .where(eq(operations.id, OWN_MENU));
  await ensureSolution(db, EMPTY_SOL, 'No pages');
  await putConfig(db, EMPTY_SOL, config);
  await ensureOperation(db, EMPTY_OP, EMPTY_SOL, 'No pages');
  await inviteUser(db, { email: 'insp@example.com' });
  await addOpUser(db, { operationId: INHERITS, email: 'insp@example.com' });
  await putUserRoles(db, { operationId: INHERITS, email: 'insp@example.com', roleIds: ['role_inspector'] });
});

const planOf = async (operationId: string) => (await planStep2(db)).find((p) => p.operation.id === operationId)!;

describe('the step 2 plan — read only', () => {
  it('makes an app for every published page, named from the menu, with its page\'s roles', async () => {
    const plan = await planOf(INHERITS);
    expect(plan.skipped).toBeUndefined();
    expect(plan.apps).toEqual([
      { pageId: 'pages/defects', label: 'Defects', roleIds: ['role_admin'] },
      { pageId: 'pages/demo', label: 'pages/demo', roleIds: [] },
      { pageId: 'pages/inspectors', label: 'Inspectors', roleIds: ['role_admin'] },
      { pageId: 'pages/job', label: 'pages/job', roleIds: ['role_admin', 'role_inspector'] },
      { pageId: 'pages/jobs', label: 'Jobs', roleIds: ['role_admin', 'role_inspector'] },
    ]);
    // Nothing written by planning.
    expect(await db.select().from(records).where(and(eq(records.operationId, INHERITS), eq(records.typeRef, 'rt_sys_apps')))).toEqual([]);
  });

  it('rebuilds the menu from it, keeping groups and order, dropping roles, and says what it drops', async () => {
    const plan = await planOf(INHERITS);
    expect(plan.menu).toEqual([
      { id: 'm-jobs', appId: 'page:pages/jobs' },
      { id: 'g-admin', label: 'Admin', items: [{ id: 'm-insp', appId: 'page:pages/inspectors' }, { id: 'm-def', appId: 'page:pages/defects' }] },
    ]);
    expect(plan.notes).toEqual(expect.arrayContaining([
      expect.stringMatching(/"Jobs again" → 'pages\/jobs' is on the menu already — dropped/),
      expect.stringMatching(/"Dead" opens nothing — dropped/),
      expect.stringMatching(/pages\/defects: role 'role_gone' is not declared/),
      expect.stringMatching(/pages\/demo: its page named no roles/),
    ]));
  });

  it('follows an operation\'s own menu over the default', async () => {
    const plan = await planOf(OWN_MENU);
    expect(plan.apps.find((a) => a.pageId === 'pages/job')?.label).toBe('Board');
    expect(plan.apps.find((a) => a.pageId === 'pages/jobs')?.label).toBe('pages/jobs');
    expect(plan.menu).toEqual([{ id: expect.any(String), appId: 'page:pages/job' }]);
  });

  it('skips an operation whose solution has no published pages', async () => {
    expect((await planOf(EMPTY_OP)).skipped).toBe('its solution has no published pages');
  });
});

describe('the step 2 script — written', () => {
  beforeAll(async () => {
    for (const plan of await planStep2(db)) await applyPlan(db, plan);
  });

  it('creates the apps, each with a sys_migration history entry', async () => {
    const { apps, menu } = await open().apps.list({ operationId: INHERITS });
    expect(apps.map((a) => a.label).sort()).toEqual(['Defects', 'Inspectors', 'Jobs', 'pages/demo', 'pages/job']);
    const jobs = apps.find((a) => a.label === 'Jobs')!;
    const withHistory = await open().apps.get({ operationId: INHERITS, appId: jobs.id });
    expect(withHistory.activityHistory).toMatchObject([{ activityId: 'sys_migration', activityName: 'Created by the migration', author: 'migration' }]);
    expect(menu[0]).toEqual({ id: 'm-jobs', appId: jobs.id });
  });

  it('leaves every user the menu their roles reach, and every link between pages working', async () => {
    const mine = await appRouter.createCaller({ db, user: inspector, roles: createDbRolesResolver(db), authConfigured: true })
      .apps.user({ operationId: INHERITS });
    expect(mine.apps.map((a) => a.label).sort()).toEqual(['Jobs', 'pages/job']);
    expect(mine.menu).toEqual([{ id: 'm-jobs', appId: mine.apps.find((a) => a.label === 'Jobs')!.id }]);
    // One app per page in every operation, so the old way opens each one.
    expect(Object.keys(mine.appIdByPageId).sort()).toEqual(['pages/defects', 'pages/demo', 'pages/inspectors', 'pages/job', 'pages/jobs']);
  });

  it('does nothing on a second run', async () => {
    const plans = await planStep2(db);
    expect(plans.find((p) => p.operation.id === INHERITS)?.skipped).toBe('already has apps');
    expect(plans.find((p) => p.operation.id === OWN_MENU)?.skipped).toBe('already has apps');
  });
});
