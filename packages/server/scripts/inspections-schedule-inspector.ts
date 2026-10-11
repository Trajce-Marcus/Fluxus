// One-off, 2026-10-11. Inspectors, step 2: Schedule picks the inspector from
// the current inspectors instead of a typed name.
//
//   1. Nick Petrovski's inspector record, through Create Inspector, with the
//      email the user gave and a start date of 2026-10-04 (when the solution
//      started — every job of his is later);
//   2. the `inspector` attribute becomes a reference whose picker is
//      `act_search_inspectors`, and `rt_jobs.inspector` a reference field;
//   3. the Jobs list shows the inspector's name;
//   4. the seven jobs with "Nick Petrovski" typed in point at his record —
//      written directly, as the job-number backfill was. Their history keeps
//      the name that was typed;
//   5. the Job page shows the inspector's name, published.
//
// Steps 2–5 read the live defs and change only these parts, so the user's
// Console roles and access stay; the new attribute and field come from
// `inspections-model.ts`. One transaction for 2–5 (step 1 is an activity run,
// which commits on its own and is skipped once done). --dry rolls 2–5 back.

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { records } from '../src/db/schema';
import { configCollections, getSolutionConfig, listPages, publishPage, putConfigEntity, putPage } from '../src/host';
import { appRouter } from '../src/router';
import { CONFIG } from './inspections-model';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'inspections';
const OPERATION = 'inspections-dev';
const PUBLISHED_BY = 't_tosevski@yahoo.com.au';
const NICK = { name: 'Nick Petrovski', email: 'trajce.toshevski@gmail.com', start_date: '2026-10-04' };
const dry = process.argv.includes('--dry');

class DryRun extends Error {}

const db = await createDb();
try {
  const live = await getSolutionConfig(db, SOLUTION);
  if (live.attributes.find((a) => a.key === 'inspector')?.type === 'reference') {
    console.log('inspector is already a reference — nothing to do');
    process.exit(0);
  }

  // ── 1. Nick, through the activity ──
  const caller = appRouter.createCaller({ db });
  const listed = await caller.activities.query({ operationId: OPERATION, activityId: 'act_list_inspectors', attributes: {} });
  let nick = (listed.data as { id: string; email: string }[]).find((i) => i.email === NICK.email)?.id;
  if (!nick) {
    if (dry) {
      console.log(`  (dry) would create inspector ${NICK.name}`);
      nick = 'DRY-RUN-ID';
    } else {
      const result = await caller.activities.run({ operationId: OPERATION, activityId: 'act_create_inspectors', attributes: NICK });
      if (result.status !== 'done') throw new Error(`Create Inspector: ${result.status} — ${result.warnings.join('; ')}`);
      nick = result.recordId!;
      console.log(`  + inspector ${NICK.name} (${nick})`);
    }
  }

  await db.transaction(async (tx) => {
    const t = tx as unknown as typeof db;

    // ── 2. the attribute and the field ──
    await putConfigEntity(t, SOLUTION, configCollections.attributes, CONFIG.attributes.find((a) => a.key === 'inspector')!);
    const jobs = live.recordTypes.find((rt) => rt.id === 'rt_jobs')!;
    const field = CONFIG.recordTypes.find((rt) => rt.id === 'rt_jobs')!.custom_fields.find((cf) => cf.key === 'inspector')!;
    await putConfigEntity(t, SOLUTION, configCollections.recordTypes, {
      ...jobs, custom_fields: jobs.custom_fields.map((cf) => (cf.key === 'inspector' ? field : cf)),
    });
    console.log('  ~ inspector → reference to rt_inspectors (picker: act_search_inspectors)');

    // ── 3. the Jobs list ──
    const list = live.activities!.find((a) => a.id === 'act_list_jobs')!;
    const returns = list.returns!.replace(/inspector\)$/, 'inspector: inspector.name)');
    if (returns === list.returns) throw new Error('act_list_jobs: inspector not found at the end of returns');
    await putConfigEntity(t, SOLUTION, configCollections.activities, { ...list, returns });
    console.log('  ~ act_list_jobs returns the inspector\'s name');

    // ── 4. the seven jobs ──
    const rows = await t.select().from(records)
      .where(and(eq(records.operationId, OPERATION), eq(records.typeRef, 'rt_jobs')));
    let moved = 0;
    for (const r of rows) {
      const typed = r.customFields.inspector;
      if (typed == null) continue;
      if (typed !== NICK.name) throw new Error(`job ${r.id}: inspector '${String(typed)}' is not ${NICK.name}`);
      await t.update(records)
        .set({ customFields: { ...r.customFields, inspector: nick }, updatedAt: new Date() })
        .where(and(eq(records.operationId, OPERATION), eq(records.id, r.id)));
      moved++;
    }
    console.log(`  ~ ${moved} jobs → ${NICK.name}'s record`);

    // ── 5. the Job page ──
    const page = (await listPages(t, SOLUTION)).find((p) => p.path === 'pages/job')!;
    const def = JSON.stringify(page.def);
    const next = def.replace('value: context.record.inspector }', 'value: context.record.inspector.name }');
    if (next === def) throw new Error('pages/job: the Inspector row was not found');
    await putPage(t, SOLUTION, 'pages/job', JSON.parse(next));
    const { version } = await publishPage(t, SOLUTION, 'pages/job', "Shows the inspector's name (2026-10-11).", PUBLISHED_BY);
    console.log(`  ~ pages/job v${version}`);

    if (dry) throw new DryRun();
  });
  console.log('done');
} catch (err) {
  if (!(err instanceof DryRun)) throw err;
  console.log('dry run — rolled back');
} finally {
  await closeDb(db);
}
