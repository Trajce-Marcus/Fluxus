// One-off, 2026-10-12. Findings become two levels: an **area inspection** (one
// area at one location, and its outcome — replacing Access and "Any
// defects?") with the **findings** (one defect each) under it. The user's
// design, agreed 2026-10-12; spec in solutions/inspections/docs/SPEC.md.
//
// Applied per entity against the **live** model, never by rerunning
// `inspections-model.ts` / `inspections-pages.ts`: the user's roles, page access,
// menu and Job page edits live only in the database. The new definitions are
// imported from those scripts; everything else is read live and kept.
//
//   1. The data goes first — every job and finding in the operation, with their
//      reporting rows (the user's call: delete them, new samples follow from
//      `inspections-sample-data.ts`). Master data, inspectors and users stay.
//   2. The model, ordered so each write validates alone: the new record type
//      and its workflow, the new attributes, the defect search, findings with
//      old and new fields both, the count function, the area inspection
//      activities, the finding activities, Finish Inspection's hook, findings
//      with the new fields only, and last the two retired attributes.
//   3. The pages, checked with the page builder's `validatePage` against the
//      model just written: the Job page keeps the user's live layout and only
//      its Findings tab changes; the Area Inspection page is new; the Finding
//      page shows a defect. Each is published.
//
// One transaction: a failure anywhere leaves nothing changed. Pass --dry to run
// it all and roll back.

import { fileURLToPath } from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';
import { MemoryAdapter } from '@fluxus/engine';
import { createDb, closeDb } from '../src/db/client';
import { records, rptActivities, rptAttributes } from '../src/db/schema';
import { configCollections, deleteConfigEntity, getSolutionConfig, listPages, publishPage, putConfigEntity, putPage } from '../src/host';
import { validatePage } from '../../page-runtime/src/validatePage';
import { validatePageCallback, validatePageExpression, validatePageExpressionWithoutRecords } from '../../page-runtime/src/pageHost';
import { CONFIG } from './inspections-model';
import { PAGES } from './inspections-pages';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'inspections';
const OPERATION = 'inspections-dev';
const PUBLISHED_BY = 't_tosevski@yahoo.com.au';
const NOTE = 'Area inspections with findings under them (2026-10-12).';
const dry = process.argv.includes('--dry');

class DryRun extends Error {}

const model = {
  attribute: (key: string) => CONFIG.attributes.find((a) => a.key === key)!,
  activity: (id: string) => (CONFIG.activities ?? []).find((a) => a.id === id)!,
  recordType: (id: string) => CONFIG.recordTypes.find((rt) => rt.id === id)!,
  workflow: (id: string) => CONFIG.workflows!.find((w) => w.id === id)!,
};
const AREA_ACTS = model.workflow('wf_area_inspections').activities.map((r) => r.activity_ref);
const FINDING_ACTS = model.workflow('wf_findings').activities.map((r) => r.activity_ref);

const db = await createDb();
try {
  const live = await getSolutionConfig(db, SOLUTION);
  if (live.recordTypes.some((rt) => rt.id === 'rt_area_inspections')) {
    console.log('rt_area_inspections already exists — nothing to do');
    process.exit(0);
  }
  const liveFindings = live.recordTypes.find((rt) => rt.id === 'rt_findings')!;

  await db.transaction(async (tx) => {
    const t = tx as unknown as typeof db;

    // ── 1. the data ──
    const doomed = await t.select({ id: records.id, typeRef: records.typeRef }).from(records)
      .where(and(eq(records.operationId, OPERATION), inArray(records.typeRef, ['rt_findings', 'rt_jobs'])));
    const ids = doomed.map((r) => r.id);
    if (ids.length > 0) {
      const runs = await t.select({ id: rptActivities.id }).from(rptActivities)
        .where(and(eq(rptActivities.operationId, OPERATION), inArray(rptActivities.recordId, ids)));
      if (runs.length > 0) {
        await t.delete(rptAttributes).where(inArray(rptAttributes.activityRowId, runs.map((r) => r.id)));
        await t.delete(rptActivities).where(inArray(rptActivities.id, runs.map((r) => r.id)));
      }
      await t.delete(records).where(and(eq(records.operationId, OPERATION), inArray(records.id, ids)));
      const count = (type: string) => doomed.filter((r) => r.typeRef === type).length;
      console.log(`  - ${count('rt_jobs')} jobs, ${count('rt_findings')} findings, ${runs.length} reporting rows`);
    }

    // ── 2. the model ──
    const put = <T>(collection: Parameters<typeof putConfigEntity<T>>[2], entity: T) => putConfigEntity(t, SOLUTION, collection, entity);

    await put(configCollections.workflows, { ...model.workflow('wf_area_inspections'), activities: [] });
    // Read as findings are: by Admin and Inspector.
    await put(configCollections.recordTypes, { ...model.recordType('rt_area_inspections'), access: liveFindings.access });
    console.log(`  + rt_area_inspections (read: ${(liveFindings.access?.read ?? []).join(', ')}), wf_area_inspections`);

    for (const key of ['area_inspection', 'outcome']) await put(configCollections.attributes, model.attribute(key));
    await put(configCollections.activities, model.activity('act_search_area_defects'));
    for (const key of ['defect', 'restriction', 'job']) await put(configCollections.attributes, model.attribute(key));
    console.log('  + attributes area_inspection, outcome; ~ defect (searches by area inspection), restriction, job; ~ act_search_area_defects');

    const finalFindings = model.recordType('rt_findings');
    const added = finalFindings.custom_fields.filter((cf) => !liveFindings.custom_fields.some((l) => l.key === cf.key));
    await put(configCollections.recordTypes, { ...liveFindings, custom_fields: [...liveFindings.custom_fields, ...added] });

    for (const fn of CONFIG.functions ?? []) await put(configCollections.functions, fn);
    console.log(`  + functions ${(CONFIG.functions ?? []).map((f) => f.name).join(', ')}`);

    for (const id of AREA_ACTS) await put(configCollections.activities, model.activity(id));
    await put(configCollections.workflows, model.workflow('wf_area_inspections'));
    console.log(`  + ${AREA_ACTS.join(', ')}`);

    for (const id of FINDING_ACTS) await put(configCollections.activities, model.activity(id));
    const wfFindings = live.workflows!.find((w) => w.id === 'wf_findings')!;
    await put(configCollections.workflows, { ...wfFindings, description: model.workflow('wf_findings').description });
    console.log(`  ~ ${FINDING_ACTS.join(', ')}`);

    const finish = live.activities!.find((a) => a.id === 'act_finish_jobs')!;
    const nextFinish = model.activity('act_finish_jobs');
    await put(configCollections.activities, { ...finish, description: nextFinish.description, before_hook: nextFinish.before_hook });
    console.log('  ~ act_finish_jobs: every area needs an area inspection');

    await put(configCollections.recordTypes, { ...liveFindings, description: finalFindings.description, custom_fields: finalFindings.custom_fields });
    console.log(`  ~ rt_findings: ${finalFindings.custom_fields.map((cf) => cf.key).join(', ')}`);

    for (const key of ['area_access', 'has_defect']) await deleteConfigEntity(t, SOLUTION, configCollections.attributes, key);
    console.log('  - attributes area_access, has_defect');

    // ── 3. the pages ──
    const config = await getSolutionConfig(t, SOLUTION);
    const adapter = new MemoryAdapter(config);
    const host = {
      validateExpression: (s: string) => validatePageExpression(config, s),
      validateExpressionWithoutRecords: (s: string) => validatePageExpressionWithoutRecords(config, s),
      validateCallback: (s: string) => validatePageCallback(config, s),
      findActivity: (id: string) => {
        const a = config.activities!.find((x) => x.id === id);
        return a ? { activity: a } : null;
      },
      findRecordType: (id: string) => {
        try { return adapter.getRecordTypeDef(id) as never; } catch { return null; }
      },
    };
    const livePages = new Map((await listPages(t, SOLUTION)).map((p) => [p.path, p.def as Record<string, unknown>]));

    // The Job page as the user left it, with only the Findings tab's two slots
    // replaced.
    const jobLive = livePages.get('pages/job')! as { slotConfigs: Record<string, unknown>; access?: unknown };
    const jobNext = PAGES['pages/job'] as unknown as { slotConfigs: Record<string, unknown> };
    const job = {
      ...jobLive,
      slotConfigs: { ...jobLive.slotConfigs, 'slot-findings-new': jobNext.slotConfigs['slot-findings-new'], 'slot-findings': jobNext.slotConfigs['slot-findings'] },
    };
    const findingAccess = (livePages.get('pages/finding') as { access?: unknown }).access;
    const writes: [string, unknown][] = [
      ['pages/job', job],
      ['pages/area-inspection', { ...PAGES['pages/area-inspection'], access: findingAccess }],
      ['pages/finding', { ...PAGES['pages/finding'], access: findingAccess }],
    ];

    let errors = 0;
    for (const [path, def] of writes) {
      for (const f of validatePage(host as never, def as never)) {
        console.log(`  ${path}: ${f.diagnostic.severity} ${f.where}: ${f.diagnostic.message}`);
        if (f.diagnostic.severity === 'error') errors++;
      }
    }
    if (errors > 0) throw new Error(`${errors} page error(s) — nothing written`);

    for (const [path, def] of writes) {
      await putPage(t, SOLUTION, path, def);
      const { version } = await publishPage(t, SOLUTION, path, NOTE, PUBLISHED_BY);
      console.log(`  ${path === 'pages/area-inspection' ? '+' : '~'} ${path} v${version} (opens to ${JSON.stringify(findingAccess)})`);
    }

    if (dry) throw new DryRun();
  });
  console.log('done');
} catch (err) {
  if (!(err instanceof DryRun)) throw err;
  console.log('dry run — rolled back');
} finally {
  await closeDb(db);
}
