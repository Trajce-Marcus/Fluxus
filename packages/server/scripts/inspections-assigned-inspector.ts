// One-off, 2026-10-11. Inspectors, step 4: the inspection steps run only for
// the job's assigned inspector or an Admin — Start Inspection, Inspection
// Details, Assessment, Finish Inspection, Update Finding and Remove Finding as
// availability conditions (the server now decides which actions are offered,
// docs/ACTIONS_OFFERED_BY_SERVER.md), and Add Finding — a CREATE, which runs
// with no record — in its before hook, against the job named.
//
// The new definitions come from `inspections-model.ts`; everything else on the
// live activities is kept as the user left it. One activity at a time, and
// only where the live field is still what the model had before this step — a
// field someone has since edited in the Console is reported, not overwritten.
// Pass --dry to check without writing.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { configCollections, getSolutionConfig, putConfigEntity } from '../src/host';
import { CONFIG } from './inspections-model';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'inspections';
const dry = process.argv.includes('--dry');

const joined = (script: string | string[] | null | undefined) => (Array.isArray(script) ? script.join('\n') : script ?? null);

// What each field was before this step, as it stands live today.
const IN_PROGRESS = "context.record.status = 'In Progress'";
const CONDITIONS: Record<string, string> = {
  act_start_jobs: "context.record.status = 'Scheduled'",
  act_update_jobs: IN_PROGRESS,
  act_assess_jobs: IN_PROGRESS,
  act_finish_jobs: IN_PROGRESS,
  act_update_findings: "context.record.job.status = 'In Progress'",
  act_remove_findings: "context.record.job.status = 'In Progress'",
};
// Add Finding's hook before this step is the new one without the check.
const ADD_CHECK = /\nif not \('role_admin' in context\.user\.roles[^\n]*\{\n  fail\('Only the inspector assigned[^\n]*\n\}/;

const db = await createDb();
try {
  const live = (await getSolutionConfig(db, SOLUTION)).activities!;
  const model = CONFIG.activities ?? [];
  const find = <T extends { id: string }>(list: T[], id: string) => list.find((a) => a.id === id)!;

  for (const [id, before] of Object.entries(CONDITIONS)) {
    const current = find(live, id);
    const next = find(model, id).show_condition!;
    if (current.show_condition === next) {
      console.log(`  = ${id}: already set`);
    } else if (current.show_condition !== before) {
      console.log(`  ! ${id}: live condition was edited since — left alone:\n      ${current.show_condition}`);
    } else if (dry) {
      console.log(`  would set ${id} show_condition to:\n      ${next}`);
    } else {
      await putConfigEntity(db, SOLUTION, configCollections.activities, { ...current, show_condition: next });
      console.log(`  ~ ${id}: assigned inspector or Admin`);
    }
  }

  const current = find(live, 'act_add_findings');
  const next = joined(find(model, 'act_add_findings').before_hook)!;
  const before = next.replace(ADD_CHECK, '');
  if (before === next) throw new Error('the model has no assigned-inspector check on act_add_findings');
  if (joined(current.before_hook) === next) {
    console.log('  = act_add_findings: already set');
  } else if (joined(current.before_hook) !== before) {
    console.log(`  ! act_add_findings: live before hook was edited since — left alone:\n${joined(current.before_hook)}`);
  } else if (dry) {
    console.log(`  would set act_add_findings before hook to:\n${next}`);
  } else {
    await putConfigEntity(db, SOLUTION, configCollections.activities, { ...current, before_hook: next });
    console.log('  ~ act_add_findings: before hook refuses anyone but the assigned inspector or an Admin');
  }
} finally {
  await closeDb(db);
}
