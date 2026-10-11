// One-off, 2026-10-11. Inspectors, step 1: the record type, its four
// activities, its page and its menu item, written to the live model.
//
// The definitions come from `inspections-model.ts` and `inspections-pages.ts`
// (imported; they run only when invoked directly). Written per entity, never
// by rerunning those scripts, because the user has set up roles, page access
// and menu roles in the Console that the scripts know nothing of. The new
// entities get access the same way his others have it:
//
//   - `rt_inspectors` is read by Admin and Inspector — an inspector's Job page
//     shows the inspector's name, and the browser follows `job.inspector`;
//   - the Inspectors page opens to Admin, like the other data pages;
//   - the menu item, after Jobs, shows to Admin.
//
// The record type, its workflow and its activities point at each other (the
// type at its workflow, the workflow at its activities, the activities'
// scripts at the type), and every write is validated alone — so the workflow
// goes in empty first and is filled last.
//
// One transaction. Pass --dry to run it all and roll back.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { configCollections, getSolutionConfig, publishPage, putConfigEntity, putDefaultMenu, putPage } from '../src/host';
import { CONFIG } from './inspections-model';
import { PAGES } from './inspections-pages';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'inspections';
const PUBLISHED_BY = 't_tosevski@yahoo.com.au';
const PAGE = 'pages/inspectors';
const ADMIN = 'role_admin';
const INSPECTOR = 'role_inspector';
const dry = process.argv.includes('--dry');

class DryRun extends Error {}

const attributes = CONFIG.attributes.filter((a) => ['email', 'start_date', 'finish_date'].includes(a.key));
const recordType = CONFIG.recordTypes.find((rt) => rt.id === 'rt_inspectors')!;
const workflow = CONFIG.workflows!.find((w) => w.id === 'wf_inspectors')!;
const activities = (CONFIG.activities ?? []).filter((a) => workflow.activities.some((ref) => ref.activity_ref === a.id));
if (attributes.length !== 3 || activities.length !== 4) throw new Error('inspections-model.ts does not define the inspectors as expected');

const db = await createDb();
try {
  const live = await getSolutionConfig(db, SOLUTION);
  if (live.recordTypes.some((rt) => rt.id === 'rt_inspectors')) {
    console.log('rt_inspectors already exists — nothing to do');
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    const t = tx as unknown as typeof db;

    for (const a of attributes) await putConfigEntity(t, SOLUTION, configCollections.attributes, a);
    console.log(`  + attributes ${attributes.map((a) => a.key).join(', ')}`);

    await putConfigEntity(t, SOLUTION, configCollections.workflows, { ...workflow, activities: [] });
    await putConfigEntity(t, SOLUTION, configCollections.recordTypes, { ...recordType, access: { read: [ADMIN, INSPECTOR] } });
    for (const a of activities) await putConfigEntity(t, SOLUTION, configCollections.activities, a);
    await putConfigEntity(t, SOLUTION, configCollections.workflows, workflow);
    console.log(`  + rt_inspectors (read: Admin, Inspector), wf_inspectors, ${activities.map((a) => a.id).join(', ')}`);

    await putPage(t, SOLUTION, PAGE, { ...PAGES[PAGE], access: { open: [ADMIN] } });
    const { version } = await publishPage(t, SOLUTION, PAGE, 'Inspectors page (2026-10-11).', PUBLISHED_BY);
    console.log(`  + ${PAGE} v${version} (opens to Admin)`);

    // The live menu, his roles and all, with the item added after Jobs.
    const menu = ((live as { default_menu?: { id: string }[] }).default_menu ?? []).filter((m) => m.id !== 'menu-inspectors');
    const at = menu.findIndex((m) => m.id === 'menu-jobs') + 1;
    menu.splice(at, 0, { id: 'menu-inspectors', label: 'Inspectors', page: PAGE, roles: [ADMIN] } as never);
    await putDefaultMenu(t, SOLUTION, menu as never);
    console.log('  + menu item Inspectors, after Jobs (Admin)');

    if (dry) throw new DryRun();
  });
  console.log('done');
} catch (err) {
  if (!(err instanceof DryRun)) throw err;
  console.log('dry run — rolled back');
} finally {
  await closeDb(db);
}
