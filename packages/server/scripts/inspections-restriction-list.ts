// One-off, 2026-10-11. A finding's Restriction becomes a pick list instead of a
// reference to its own record type. The user asked for a pick list on
// 2026-10-10; it was built as `rt_access_restrictions` with a page, which was
// more than a list of names needed.
//
// Applied per entity against the **live** model, not by rerunning
// `inspections-model.ts` / `inspections-pages.ts`: the user has set up roles,
// page access and menu roles in the Console since, and the scripts know none of
// it. Each def is read from the database and only the restriction parts change.
//
//   1. the `restriction` attribute becomes a list of the eleven reasons;
//   2. `act_list_findings` returns the restriction as it is stored — before
//      the field changes, or the save refuses `restriction.name` on text;
//   3. `rt_findings.restriction` becomes a text field;
//   4. the four findings that have one get the reason's name in place of the
//      record's id — written directly, as the job-number backfill was. Their
//      history keeps the id that was entered then;
//   5. the eleven restriction records go, with their reporting rows;
//   6. `rt_access_restrictions`, `wf_access_restrictions` and its four
//      activities are deleted;
//   7. the menu item goes; the Finding page reads the name; the Access
//      Restrictions page is deleted, draft and published versions, as
//      `retire-cbs-page.ts` did for "remove the page altogether".
//
// One transaction: a failure anywhere leaves nothing changed. Pass --dry to run
// it all and roll back.

import { fileURLToPath } from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { pages, pageVersions, records, rptActivities, rptAttributes } from '../src/db/schema';
import {
  configCollections, deleteConfigEntity, getSolutionConfig, listPages, publishPage, putConfigEntity, putDefaultMenu, putPage,
} from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'inspections';
const OPERATION = 'inspections-dev';
const PUBLISHED_BY = 't_tosevski@yahoo.com.au';
const DEAD_PAGE = 'pages/access-restrictions';
const DEAD_ACTIVITIES = [
  'act_create_access_restrictions', 'act_update_access_restrictions',
  'act_list_access_restrictions', 'act_search_access_restrictions',
];
const REASONS = [
  'Furniture and belongings', 'Stored goods', 'Vehicles', 'Insulation', 'Ducting', 'Low clearance',
  'Height or safety', 'Vegetation', 'Locked or no key', 'No access hatch', 'Wet or slippery surfaces',
];
const dry = process.argv.includes('--dry');

class DryRun extends Error {}

const db = await createDb();
try {
  const config = await getSolutionConfig(db, SOLUTION);
  const attr = config.attributes.find((a) => a.key === 'restriction');
  if (attr?.type !== 'reference') {
    console.log(`restriction is already '${attr?.type}' — nothing to do`);
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    const t = tx as unknown as typeof db;

    // ── the model ──
    await putConfigEntity(t, SOLUTION, configCollections.attributes, {
      key: attr.key, label: attr.label, description: attr.description, type: 'list',
      type_config: { datasource: `[${REASONS.map((r) => `'${r}'`).join(', ')}]` },
    });
    console.log('  ~ attribute restriction → list of', REASONS.length);

    const list = config.activities!.find((a) => a.id === 'act_list_findings')!;
    const returns = list.returns!.replace('restriction: restriction.name', 'restriction');
    if (returns === list.returns) throw new Error('act_list_findings: restriction.name not found in returns');
    await putConfigEntity(t, SOLUTION, configCollections.activities, { ...list, returns });
    console.log('  ~ act_list_findings returns the restriction as stored');

    const findings = config.recordTypes.find((rt) => rt.id === 'rt_findings')!;
    await putConfigEntity(t, SOLUTION, configCollections.recordTypes, {
      ...findings,
      custom_fields: findings.custom_fields.map((cf) =>
        cf.key === 'restriction' ? { key: 'restriction', type: 'text', label: cf.label } : cf),
    });
    console.log('  ~ rt_findings.restriction → text');

    const menu = (config as { default_menu?: { id: string }[] }).default_menu ?? [];
    await putDefaultMenu(t, SOLUTION, menu.filter((m) => m.id !== 'menu-access-restrictions') as never);
    console.log('  - menu item Access Restrictions');

    // ── the data ── (before the type goes, while its records still resolve)
    const reasons = await t.select().from(records)
      .where(and(eq(records.operationId, OPERATION), eq(records.typeRef, 'rt_access_restrictions')));
    const nameById = new Map(reasons.map((r) => [r.id, String(r.customFields.name)]));
    const rows = await t.select().from(records)
      .where(and(eq(records.operationId, OPERATION), eq(records.typeRef, 'rt_findings')));
    for (const f of rows) {
      const id = f.customFields.restriction;
      if (id == null) continue;
      const name = nameById.get(String(id));
      if (!name || !REASONS.includes(name)) throw new Error(`finding ${f.id}: restriction ${String(id)} is not one of the reasons`);
      await t.update(records)
        .set({ customFields: { ...f.customFields, restriction: name }, updatedAt: new Date() })
        .where(and(eq(records.operationId, OPERATION), eq(records.id, f.id)));
      console.log(`  ~ finding ${f.id}: ${name}`);
    }

    const ids = reasons.map((r) => r.id);
    if (ids.length > 0) {
      const runs = await t.select({ id: rptActivities.id }).from(rptActivities)
        .where(and(eq(rptActivities.operationId, OPERATION), inArray(rptActivities.recordId, ids)));
      if (runs.length > 0) {
        await t.delete(rptAttributes).where(inArray(rptAttributes.activityRowId, runs.map((r) => r.id)));
        await t.delete(rptActivities).where(inArray(rptActivities.id, runs.map((r) => r.id)));
      }
      await t.delete(records).where(and(eq(records.operationId, OPERATION), inArray(records.id, ids)));
      console.log(`  - ${ids.length} restriction records, ${runs.length} reporting rows`);
    }

    // ── the record type, its workflow and activities ── Each delete is
    // validated alone and the three point at each other (the type at its
    // workflow, the workflow at its activities, the activities' scripts at the
    // type), so the workflow is emptied first, then each goes.
    const wf = config.workflows!.find((w) => w.id === 'wf_access_restrictions')!;
    await putConfigEntity(t, SOLUTION, configCollections.workflows, { ...wf, activities: [] });
    for (const a of DEAD_ACTIVITIES) await deleteConfigEntity(t, SOLUTION, configCollections.activities, a);
    await deleteConfigEntity(t, SOLUTION, configCollections.recordTypes, 'rt_access_restrictions');
    await deleteConfigEntity(t, SOLUTION, configCollections.workflows, 'wf_access_restrictions');
    console.log(`  - rt_access_restrictions, wf_access_restrictions, ${DEAD_ACTIVITIES.length} activities`);

    // ── the pages ──
    const finding = (await listPages(t, SOLUTION)).find((p) => p.path === 'pages/finding')!;
    const def = JSON.stringify(finding.def);
    const next = def.replace('context.record.restriction.name', 'context.record.restriction');
    if (next === def) throw new Error('pages/finding: restriction.name not found');
    await putPage(t, SOLUTION, 'pages/finding', JSON.parse(next));
    const { version } = await publishPage(t, SOLUTION, 'pages/finding',
      'Restriction is a pick list (2026-10-11) — shows the stored reason.', PUBLISHED_BY);
    console.log(`  ~ pages/finding v${version}`);

    const versions = await t.delete(pageVersions)
      .where(and(eq(pageVersions.solutionId, SOLUTION), eq(pageVersions.path, DEAD_PAGE))).returning();
    await t.delete(pages).where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, DEAD_PAGE)));
    console.log(`  - ${DEAD_PAGE} (draft and ${versions.length} published versions)`);

    if (dry) throw new DryRun();
  });
  console.log('done');
} catch (err) {
  if (!(err instanceof DryRun)) throw err;
  console.log('dry run — rolled back');
} finally {
  await closeDb(db);
}
