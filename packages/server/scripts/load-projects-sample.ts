// One-off, 2026-09-12. Puts real data behind the projects page so the
// RecordList work (columns, types, formats, selection, sort, search) can be
// looked at rather than reasoned about.
//
// Three things, in order:
//   1. widens `rt_projects` to the fields of the supplied sample — client,
//      job type, target start, target completion, approved budget — as pool
//      attributes, record-type fields, and attributes of the create and modify
//      activities. Existing fields are left alone.
//   2. removes the headless smoke record PR-2026-001 and the three CBS nodes
//      hanging off it.
//   3. loads the ten sample projects **through `act_create_projects`**, then
//      sets each status through `act_modify_projects`, because create does not
//      take a status and status is not a field anything writes directly.
//
// Records go in through the activities: there is no second way a record comes
// into being, so each one's history starts with "created" like any other. The
// delete in step 2 is the single exception, and only because `record_map:
// DELETE` is deferred and the platform has no delete activity to call.
//
// Idempotent on the model (a field already there is left alone); NOT on the
// data (running it twice would fail on `project_no`, which is unique).
// Pass --dry to print what it would do and write nothing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { records } from '../src/db/schema';
import {
  configCollections,
  findActivity,
  getSolutionConfig,
  loadOperationHost,
  putConfigEntity,
  writeBack,
} from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const OPERATION = 'projects-dev';
const dry = process.argv.includes('--dry');
const samplePath = process.argv.find((a) => a.endsWith('.json'));
if (!samplePath) throw new Error('pass the sample JSON file as an argument');

interface SampleProject {
  projectId: string;
  projectName: string;
  client: string;
  jobType: string;
  status: string;
  targetStart: string;
  targetCompletion: string;
  approvedBudget: number;
}

const sample = JSON.parse(readFileSync(samplePath, 'utf8')) as SampleProject[];

// The sample's camelCase keys become snake_case, which is what every field and
// attribute in this solution already is.
const NEW_FIELDS = [
  { key: 'client',            type: 'text',     label: 'Client',            description: 'Who the work is for.' },
  { key: 'job_type',          type: 'text',     label: 'Job type',          description: 'Capital Project, Maintenance, and so on.' },
  { key: 'target_start',      type: 'datetime', label: 'Target start',      description: 'Planned start date.' },
  { key: 'target_completion', type: 'datetime', label: 'Target completion', description: 'Planned completion date.' },
  { key: 'approved_budget',   type: 'decimal',  label: 'Approved budget',   description: 'Approved budget for the works.' },
] as const;

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

// ── 1. the model ─────────────────────────────────────────────────────────────

const config = await getSolutionConfig(db, SOLUTION);
const recordType = structuredClone(config.recordTypes?.find((r) => r.id === 'rt_projects'));
const workflow = structuredClone(config.workflows?.find((w) => w.id === 'wf_projects'));
if (!recordType || !workflow) throw new Error('rt_projects / wf_projects not found');

for (const field of NEW_FIELDS) {
  if (!config.attributes?.some((a) => a.key === field.key)) {
    console.log(`attribute  + ${field.key} (${field.type})`);
    if (!dry) {
      await putConfigEntity(db, SOLUTION, configCollections.attributes, {
        key: field.key, type: field.type, label: field.label, description: field.description,
      });
    }
  }
  if (!recordType.custom_fields.some((c) => c.key === field.key)) {
    console.log(`field      + rt_projects.${field.key} (${field.type})`);
    recordType.custom_fields.push({ key: field.key, type: field.type, label: field.label, default: '' });
  }
}

for (const activity of workflow.activities ?? []) {
  if (activity.id !== 'act_create_projects' && activity.id !== 'act_modify_projects') continue;
  for (const field of NEW_FIELDS) {
    if (!activity.attributes?.some((a) => a.attribute_ref === field.key)) {
      console.log(`activity   + ${activity.id}.${field.key}`);
      activity.attributes.push({ attribute_ref: field.key });
    }
  }
}

if (!dry) {
  await putConfigEntity(db, SOLUTION, configCollections.recordTypes, recordType);
  await putConfigEntity(db, SOLUTION, configCollections.workflows, workflow);
  console.log('model written\n');
}

// ── 2. the smoke records ─────────────────────────────────────────────────────

const existing = (await db.select().from(records).where(eq(records.operationId, OPERATION)));
for (const row of existing) console.log(`delete     - ${row.typeRef} ${row.id}`);
if (!dry && existing.length > 0) {
  // The one write here that does not go through an activity: there is no
  // delete activity to call, and these are the smoke rows the user asked to
  // scrap. Scoped to this operation and to the ids just listed.
  await db.delete(records).where(and(
    eq(records.operationId, OPERATION),
    inArray(records.id, existing.map((r) => r.id)),
  ));
  console.log(`${existing.length} records deleted\n`);
}

// ── 3. the sample, through the activities ────────────────────────────────────

if (dry) {
  for (const p of sample) console.log(`create     + ${p.projectId} "${p.projectName}" → status ${p.status}`);
  await closeDb(db);
  process.exit(0);
}

// A user with the roles the model's `access.read` asks for, or the record types
// arrive trimmed and the run has nothing to write to.
const user = { id: 'script', name: 'sample loader', email: null, roles: ['role_project_admin'] };
const host = await loadOperationHost(db, OPERATION, undefined, user);
const create = findActivity(host, 'act_create_projects');
const modify = findActivity(host, 'act_modify_projects');
if (!create || !modify) throw new Error('create/modify activity not found');

for (const p of sample) {
  const created = host.engine.runActivity(create, {
    project_no: p.projectId,
    name: p.projectName,
    description: '',
    client: p.client,
    job_type: p.jobType,
    target_start: p.targetStart,
    target_completion: p.targetCompletion,
    approved_budget: String(p.approvedBudget),
  }, null);
  if (created.status !== 'done') throw new Error(`create ${p.projectId}: ${JSON.stringify(created)}`);

  // Status is the modify activity's to set — create leaves it at its default,
  // and nothing writes the field directly.
  const anchor = host.adapter.getRecord(p.projectId);
  const modified = host.engine.runActivity(modify, {
    name: p.projectName,
    description: '',
    status: p.status,
    client: p.client,
    job_type: p.jobType,
    target_start: p.targetStart,
    target_completion: p.targetCompletion,
    approved_budget: String(p.approvedBudget),
  }, anchor);
  if (modified.status !== 'done') throw new Error(`modify ${p.projectId}: ${JSON.stringify(modified)}`);
  console.log(`created    ${p.projectId}  ${p.status.padEnd(10)} ${p.projectName}`);
}

await writeBack(db, host);
console.log(`\n${sample.length} projects loaded`);
await closeDb(db);
