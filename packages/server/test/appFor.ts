// A test's way into an operation through an app (APPS_AND_INSTANCES §2.3):
// since apps Part 2 step 2, a call that names no app is an operation admin's,
// so a test about what a user with roles may read or do goes through an app
// those roles may run. Since step 3 an app offers only what its page's list
// holds, so the page is published with one — by default every activity the
// solution's record types' workflows list, which is what a page offered before
// lists existed.

import type { Db } from '../src/db/client';
import { getSolutionModel } from '../src/host';
import { appRouter } from '../src/router';

export async function appFor(db: Db, opts: { solutionId: string; operationId: string; roleIds: string[]; pageId?: string; activities?: string[] }): Promise<string> {
  const open = appRouter.createCaller({ db });
  const pageId = opts.pageId ?? 'pages/test-app';
  await pageWithList(db, opts.solutionId, pageId, opts.activities);
  const { id } = await open.apps.put({ operationId: opts.operationId, pageId, label: 'Test app', roleIds: opts.roleIds, definition: '{}' });
  return id;
}

/** Publish a page whose list holds `activities` (default: every activity a
 *  record type's workflow lists), unless it is published already. */
export async function pageWithList(db: Db, solutionId: string, pageId: string, activities?: string[]): Promise<void> {
  const open = appRouter.createCaller({ db });
  const published = await open.pages.publishedPaths({ solutionId });
  if (published.includes(pageId)) return;
  const config = await getSolutionModel(db, solutionId);
  const typed = new Set(config.recordTypes.map((rt) => rt.workflow_ref));
  const ids = activities ?? [...new Set(config.workflows.filter((w) => typed.has(w.id)).flatMap((w) => w.activities.map((u) => u.activity_ref)))];
  const workflowId = `wf_app_${pageId.replace(/[^A-Za-z0-9_]/g, '_')}`;
  await open.model.putWorkflow({ solutionId, def: { id: workflowId, name: pageId, description: 'A test page\'s list', activities: ids.map((activity_ref) => ({ activity_ref })) } });
  await open.pages.put({ solutionId, path: pageId, def: { workflowId } });
  await open.pages.publish({ solutionId, path: pageId, readme: 'test app' });
}
