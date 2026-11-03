// Expiring an app (APPS_AND_INSTANCES Part 3 §3.2): final, and nothing is
// deleted — the app stays in the Console's list with its history, while the
// Runtime no longer gets it and every call naming it is refused.

import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '../src/db/client';
import { addOpUser, ensureOperation, ensureSolution, inviteUser, putModel, putUserRoles } from '../src/host';
import { appRouter } from '../src/router';
import { records } from '../src/db/schema';
import { createDbRolesResolver } from '../src/auth';
import type { ContextUser, SolutionModel } from '@fluxus/engine';
import { pageWithList } from './appFor';

const SOL = 'test/apps-expire';
const OP = 'test/apps-expire';

const config: SolutionModel = {
  access: { roles: [{ id: 'role_crew', name: 'Crew' }] },
  attributes: [],
  recordTypes: [{ id: 'rt_jobs', name: 'Jobs', description: '', workflow_ref: 'wf_jobs', custom_fields: [{ key: 'note', type: 'text' }], access: { read: ['role_crew'] } }],
  activities: [],
  workflows: [{ id: 'wf_jobs', name: 'Jobs', description: '', activities: [] }],
};

let db: Db;
let gone: string;
let kept: string;
const open = () => appRouter.createCaller({ db });
const crew: ContextUser = { id: 'u-crew', name: 'Crew', email: 'crew@example.com', roles: [] };
const as = (user: ContextUser) => appRouter.createCaller({ db, user, roles: createDbRolesResolver(db), authConfigured: true });

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'Apps expire');
  await putModel(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Apps expire');
  await pageWithList(db, SOL, 'pages/board');
  await inviteUser(db, { email: 'crew@example.com' });
  await addOpUser(db, { operationId: OP, email: 'crew@example.com' });
  await putUserRoles(db, { operationId: OP, email: 'crew@example.com', roleIds: ['role_crew'] });
  ({ id: gone } = await open().apps.put({ operationId: OP, pageId: 'pages/board', label: 'Old board', roleIds: ['role_crew'], definition: '{}' }));
  ({ id: kept } = await open().apps.put({ operationId: OP, pageId: 'pages/board', label: 'Board', roleIds: ['role_crew'], definition: '{}' }));
  await open().operations.putMenu({ operationId: OP, menu: [{ id: 'm1', appId: gone }, { id: 'm2', appId: kept }] });
  await db.insert(records).values({ operationId: OP, id: 'J1', typeRef: 'rt_jobs', customFields: { note: '' }, activityHistory: [] });
  await open().apps.expire({ operationId: OP, appId: gone });
});

describe('expiring an app (§3.2)', () => {
  it('keeps it in the list, marked expired, with a history entry', async () => {
    const { apps } = await open().apps.list({ operationId: OP });
    expect(apps.map((a) => [a.label, a.status])).toEqual([['Old board', 'expired'], ['Board', 'active']]);
    const app = await open().apps.get({ operationId: OP, appId: gone });
    expect(app.activityHistory.at(-1)).toMatchObject({ activityId: 'sys_console_edit', capturedAttributes: { status: 'expired' } });
    const [row] = await db.select().from(records).where(and(eq(records.operationId, OP), eq(records.id, gone)));
    expect(row.customFields).toMatchObject({ label: 'Old board', status: 'expired' });
  });

  it('is final: expiring again and changing it are refused', async () => {
    await expect(open().apps.expire({ operationId: OP, appId: gone })).rejects.toThrow(/expired already/);
    await expect(open().apps.put({ operationId: OP, id: gone, pageId: 'pages/board', label: 'Revived', roleIds: ['role_crew'], definition: '{}' })).rejects.toThrow(/has expired/);
  });

  it('is for operation admins', async () => {
    await expect(as(crew).apps.expire({ operationId: OP, appId: kept })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('an app that is not there is not found', async () => {
    await expect(open().apps.expire({ operationId: OP, appId: 'no-such-app' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('an expired app in the Runtime (§3.2)', () => {
  it('apps.user leaves it out, and its menu item with it', async () => {
    const mine = await as(crew).apps.user({ operationId: OP });
    expect(mine.apps.map((a) => a.id)).toEqual([kept]);
    expect(mine.menu).toEqual([{ id: 'm2', appId: kept }]);
  });

  it('a call naming it is refused, saying it expired; page.activities answers empty', async () => {
    await expect(as(crew).records.get({ operationId: OP, appId: gone, recordId: 'J1' })).rejects.toThrow(/has expired/);
    await expect(as(crew).records.get({ operationId: OP, appId: kept, recordId: 'J1' })).resolves.toBeTruthy();
    await expect(as(crew).page.activities({ operationId: OP, appId: gone, items: [{ recordId: 'J1' }] })).resolves.toEqual([[]]);
  });
});

describe('the menu and an expired app (§3.2)', () => {
  it('saving a menu that points at it is refused, naming it', async () => {
    await expect(open().operations.putMenu({ operationId: OP, menu: [{ id: 'm1', appId: gone }] })).rejects.toThrow(/"Old board" has expired/);
    await expect(open().operations.putMenu({ operationId: OP, menu: [{ id: 'm2', appId: kept }] })).resolves.toBeTruthy();
  });
});
