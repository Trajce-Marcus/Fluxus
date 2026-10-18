// A test's way into an operation through an app (APPS_AND_INSTANCES §2.3):
// since apps Part 2 step 2, a call that names no app is an operation admin's,
// so a test about what a user with roles may read or do goes through an app
// those roles may run. Publishes a page for it if the solution has none yet.

import type { Db } from '../src/db/client';
import { appRouter } from '../src/router';

export async function appFor(db: Db, opts: { solutionId: string; operationId: string; roleIds: string[]; pageId?: string }): Promise<string> {
  const open = appRouter.createCaller({ db });
  const pageId = opts.pageId ?? 'pages/test-app';
  const published = await open.pages.publishedPaths({ solutionId: opts.solutionId });
  if (!published.includes(pageId)) {
    await open.pages.put({ solutionId: opts.solutionId, path: pageId, def: {} });
    await open.pages.publish({ solutionId: opts.solutionId, path: pageId, readme: 'test app' });
  }
  const { id } = await open.apps.put({ operationId: opts.operationId, pageId, label: 'Test app', roleIds: opts.roleIds, definition: '{}' });
  return id;
}
