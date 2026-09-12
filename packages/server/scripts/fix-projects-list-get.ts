// One-off, 2026-09-12. Widens `act_list_projects` to the fields added with the
// sample data.
//
// A GET answers with exactly what its `returns` expression selects, so the
// page's table drew empty cells for `client`, `job_type`, `target_start`,
// `target_completion` and `approved_budget` while the workbench — which reads
// whole records — showed them. Nothing was wrong with the columns; the read
// never carried the values.
//
// Writes ONE workflow row. Pass --dry to print only.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { configCollections, getSolutionConfig, putConfigEntity } from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const WORKFLOW = 'wf_projects';
const ACTIVITY = 'act_list_projects';
const RETURNS = 'records.projects.orderBy(project_no).select(id, project_no, name, description, status, client, job_type, target_start, target_completion, approved_budget)';

const dry = process.argv.includes('--dry');
const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const config = await getSolutionConfig(db, SOLUTION);
const workflow = structuredClone(config.workflows?.find((w) => w.id === WORKFLOW));
if (!workflow) throw new Error(`${WORKFLOW} not found`);

const activity = workflow.activities?.find((a) => a.id === ACTIVITY);
if (!activity) throw new Error(`${ACTIVITY} not found`);

console.log(`before: ${activity.returns}`);
console.log(`after:  ${RETURNS}`);

if (!dry && activity.returns !== RETURNS) {
  activity.returns = RETURNS;
  await putConfigEntity(db, SOLUTION, configCollections.workflows, workflow);
  console.log('\nwritten');
}

await closeDb(db);
