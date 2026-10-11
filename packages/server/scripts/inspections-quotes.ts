// One-off, 2026-10-12. A job's quote becomes its own record, read by Admins
// only, so an inspector is never sent it (the user's design: "apply the roles
// access to that record"). The Job page gets a Quote tab, where an inspector
// sees "Record access denied" and is offered no Quote action.
//
// Applied per entity against the **live** model, never by rerunning
// `inspections-model.ts` / `inspections-pages.ts` (the user's roles and page
// access live only in the database). New definitions are imported from those
// scripts; everything else is read live and kept.
//
//   1. The model, ordered so each write validates alone: `rt_quotes` (read:
//      Admin) and its workflow, `quote` on jobs beside the old fields, the
//      Quote activity on quotes, Create Job's hook making each job's quote,
//      `act_quote_jobs` out of the jobs' workflow and the pool.
//   2. The data — the user has been testing on this operation, so nothing is
//      deleted: each job gets its quote record, carrying the amount and notes
//      it holds, written directly as the job-number backfill was; the job's
//      `quote` points at it and its own quote fields go. Their history keeps
//      what was entered then.
//   3. Jobs lose `quoted_amount` and `quote_notes`.
//   4. The Job page, checked with `validatePage`: the quote rows leave the Job
//      tab, and a Quote tab follows it.
//
// One transaction: a failure anywhere leaves nothing changed. Pass --dry to run
// it all and roll back.

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { MemoryAdapter } from '@fluxus/engine';
import { createDb, closeDb } from '../src/db/client';
import { records } from '../src/db/schema';
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
const ADMIN = 'role_admin';
const dry = process.argv.includes('--dry');

class DryRun extends Error {}

const model = {
  activity: (id: string) => (CONFIG.activities ?? []).find((a) => a.id === id)!,
  recordType: (id: string) => CONFIG.recordTypes.find((rt) => rt.id === id)!,
  workflow: (id: string) => CONFIG.workflows!.find((w) => w.id === id)!,
};

const db = await createDb();
try {
  const live = await getSolutionConfig(db, SOLUTION);
  if (live.recordTypes.some((rt) => rt.id === 'rt_quotes')) {
    console.log('rt_quotes already exists — nothing to do');
    process.exit(0);
  }
  const liveJobs = live.recordTypes.find((rt) => rt.id === 'rt_jobs')!;

  await db.transaction(async (tx) => {
    const t = tx as unknown as typeof db;
    const put = <T>(collection: Parameters<typeof putConfigEntity<T>>[2], entity: T) => putConfigEntity(t, SOLUTION, collection, entity);

    // ── 1. the model ──
    await put(configCollections.workflows, { ...model.workflow('wf_quotes'), activities: [] });
    await put(configCollections.recordTypes, { ...model.recordType('rt_quotes'), access: { read: [ADMIN] } });
    const quoteField = model.recordType('rt_jobs').custom_fields.find((cf) => cf.key === 'quote')!;
    await put(configCollections.recordTypes, { ...liveJobs, custom_fields: [...liveJobs.custom_fields, quoteField] });
    console.log('  + rt_quotes (read: Admin), wf_quotes; + rt_jobs.quote');

    await put(configCollections.activities, model.activity('act_update_quotes'));
    await put(configCollections.workflows, model.workflow('wf_quotes'));
    const create = live.activities!.find((a) => a.id === 'act_create_jobs')!;
    await put(configCollections.activities, { ...create, after_hook: model.activity('act_create_jobs').after_hook });
    const wfJobs = live.workflows!.find((w) => w.id === 'wf_jobs')!;
    await put(configCollections.workflows, { ...wfJobs, activities: wfJobs.activities.filter((r) => r.activity_ref !== 'act_quote_jobs') });
    await deleteConfigEntity(t, SOLUTION, configCollections.activities, 'act_quote_jobs');
    console.log('  + act_update_quotes (Quote, Admin only); ~ act_create_jobs makes the quote; - act_quote_jobs');

    // ── 2. the data ──
    const jobs = await t.select().from(records)
      .where(and(eq(records.operationId, OPERATION), eq(records.typeRef, 'rt_jobs')));
    for (const job of jobs) {
      const { quoted_amount, quote_notes, ...rest } = job.customFields;
      const id = uuidv7();
      await t.insert(records).values({
        operationId: OPERATION, id, typeRef: 'rt_quotes', activityHistory: [],
        customFields: { job: job.id, quoted_amount: quoted_amount ?? null, quote_notes: quote_notes ?? null },
      });
      await t.update(records)
        .set({ customFields: { ...rest, quote: id }, updatedAt: new Date() })
        .where(and(eq(records.operationId, OPERATION), eq(records.id, job.id)));
      console.log(`  + quote for ${String(job.customFields.job_no)}${quoted_amount != null ? ` (${String(quoted_amount)})` : ''}`);
    }

    // ── 3. jobs lose their own quote fields ──
    await put(configCollections.recordTypes, { ...liveJobs, custom_fields: model.recordType('rt_jobs').custom_fields });
    console.log('  - rt_jobs.quoted_amount, rt_jobs.quote_notes');

    // ── 4. the Job page ──
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
    const liveJob = (await listPages(t, SOLUTION)).find((p) => p.path === 'pages/job')!.def as { access?: unknown };
    const job = { ...PAGES['pages/job'], access: liveJob.access };
    const errors = validatePage(host as never, job as never).filter((f) => f.diagnostic.severity === 'error');
    if (errors.length > 0) throw new Error(`pages/job: ${errors.map((e) => `${e.where}: ${e.diagnostic.message}`).join('; ')}`);
    await putPage(t, SOLUTION, 'pages/job', job);
    const { version } = await publishPage(t, SOLUTION, 'pages/job', 'Quote tab — the quote is its own record, Admins only (2026-10-12).', PUBLISHED_BY);
    console.log(`  ~ pages/job v${version}: Quote tab`);

    if (dry) throw new DryRun();
  });
  console.log('done');
} catch (err) {
  if (!(err instanceof DryRun)) throw err;
  console.log('dry run — rolled back');
} finally {
  await closeDb(db);
}
