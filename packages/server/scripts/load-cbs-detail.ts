// One-off, 2026-09-14. The CBS gets its second level, per the page spec §4.4.
//
// Three things, all through the activities:
//   1. the seven loaded codes are renamed to the supplied wording (five of them
//      differ) — `act_modify_cbs_nodes`, carrying their existing budgets so a
//      rename does not blank them;
//   2. twenty-one children arrive under them — `act_create_cbs_nodes`. This is
//      also what makes the WBS's `1200 / 1300 / 1400` references resolve: those
//      codes named nothing until now;
//   3. P26-011 moves to status `Created`, because the lifecycle it is about to
//      be driven through starts there and the loader's `Active` was invented in
//      the first place (its own header says so).
//
// (3) needs a detour worth reading: `status` was removed from
// `act_modify_projects` by `wbs-lifecycle.ts`, so there is no longer an
// activity that can set it to `Created` — the transitions only go forward. So
// the script puts the attribute back, runs the modify, and removes it again.
// Three config writes to keep one record change inside the pipeline, which is
// cheaper than the alternative: a direct write that leaves no history.
//
// Budget stays on the seven parents — no split across the children was
// supplied, and inventing one would be inventing numbers.
//
// NOT idempotent: `code` is the record id, so a second run collides on every
// child. Pass --dry to print what it would do.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import {
  configCollections, findActivity, getSolutionConfig, loadOperationHost, putConfigEntity, writeBack,
} from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const OPERATION = 'projects-dev';
const PROJECT = 'P26-011';
const dry = process.argv.includes('--dry');

/** The seven parents, as supplied. Budgets are not touched — they are read off
 *  the records and handed back, because a modify captures the whole set. */
const PARENTS: { code: string; name: string; description: string }[] = [
  { code: '1000', name: 'Direct Internal Labour',          description: 'Your own company PAYG employees on the project' },
  { code: '2000', name: 'Permanent Materials',             description: 'Assets bought and left permanently in the ground or on site' },
  { code: '3000', name: 'Project Consumables',             description: 'Items used up or exhausted entirely on site during execution' },
  { code: '4000', name: 'Plant & Equipment Hire',          description: 'Machinery used to build the work' },
  { code: '5000', name: 'Subcontractors',                  description: 'Third-party fixed-price packages or specialist services' },
  { code: '6000', name: 'Preliminaries & Project Indirects', description: 'The overhead costs required to run the job site' },
  { code: '7000', name: 'Risk & Contingency',              description: 'Monies held to mitigate project exceptions' },
];

const CHILDREN: { code: string; parent: string; name: string; description: string }[] = [
  { code: '1100', parent: '1000', name: 'Project Management & Engineering',        description: 'PMs, site engineers, safety officers' },
  { code: '1200', parent: '1000', name: 'Site Supervision',                        description: 'Superintendents, foremen' },
  { code: '1300', parent: '1000', name: 'Skilled Wages',                           description: 'Coded welders, plant operators, riggers' },
  { code: '1400', parent: '1000', name: 'General Civil Labour',                    description: 'Trades assistants, ground crews, spotters' },

  { code: '2100', parent: '2000', name: 'Primary Bulk Materials',                  description: 'Line pipe, asphalt, structural concrete, steel reinforcement' },
  { code: '2200', parent: '2000', name: 'Precast & Prefabricated Components',      description: 'Pits, culverts, valves, structural skids' },
  { code: '2300', parent: '2000', name: 'Secondary Fixes & Architectural Fittings', description: 'Fasteners, instrumentation components' },

  { code: '3100', parent: '3000', name: 'Fuel, Oils & Lubricants',                 description: 'Diesel for heavy machinery, grease' },
  { code: '3200', parent: '3000', name: 'Trade Consumables',                       description: 'Welding rods, gases, grinding discs, formwork timber' },
  { code: '3300', parent: '3000', name: 'Environmental & Safety Consumables',      description: 'Silt fencing, erosion blankets, PPE, safety tape' },

  { code: '4100', parent: '4000', name: 'Heavy Earthmoving Plant',                 description: 'Excavators, bulldozers, graders, rollers' },
  { code: '4200', parent: '4000', name: 'Specialized Lifting & Access',            description: 'Sidebooms, cranes, pin-booms, scissor lifts' },
  { code: '4300', parent: '4000', name: 'Site Vehicles & Support',                 description: 'Site utes, fuel trucks, water carts, small tools' },

  { code: '5100', parent: '5000', name: 'Trade Subcontractors',                    description: 'Electrical contractors, specialised drilling, concrete placers' },
  { code: '5200', parent: '5000', name: 'Professional Technical Services',         description: 'Surveyors, third-party NDT inspectors, soil testers' },

  { code: '6100', parent: '6000', name: 'Site Mobilisation & Demobilisation',      description: 'Heavy haulage floats, site setup' },
  { code: '6200', parent: '6000', name: 'Site Compound & Facilities',              description: 'Site hut hire, temporary toilets, power and water drop-ins' },
  { code: '6300', parent: '6000', name: 'Compliance & Fees',                       description: 'Council permits, environmental authority filings, land access fees' },

  { code: '7100', parent: '7000', name: 'Unforeseen Site Anomalies',               description: 'Latent ground conditions, rock strikes' },
  { code: '7200', parent: '7000', name: 'Weather & Delay Provisions',              description: 'RDO extensions, wet weather delay overheads' },
];

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

if (dry) {
  for (const p of PARENTS) console.log(`rename     ~ cbs ${p.code} ${p.name}`);
  for (const c of CHILDREN) console.log(`create     + cbs ${c.code} under ${c.parent}  ${c.name}`);
  console.log(`modify     ~ ${PROJECT} status → Created`);
  await closeDb(db);
  process.exit(0);
}

const user = { id: 'script', name: 'cbs detail loader', email: null, roles: ['role_project_admin'] };
const host = await loadOperationHost(db, OPERATION, undefined, user);
const field = (id: string, key: string) =>
  String((host.adapter.getRecord(id)?.customFields as Record<string, unknown>)?.[key] ?? '');

const run = (id: string, attrs: Record<string, string>, anchor: unknown, what: string) => {
  const activity = findActivity(host, id);
  if (!activity) throw new Error(`${id} not found`);
  const result = host.engine.runActivity(activity, attrs, anchor as never);
  if (result.status !== 'done') throw new Error(`${what}: ${JSON.stringify(result)}`);
};

// ── 1. the renames ───────────────────────────────────────────────────────────
for (const p of PARENTS) {
  const record = host.adapter.getRecord(p.code);
  if (!record) throw new Error(`cbs ${p.code} not found`);
  const was = field(p.code, 'name');
  run('act_modify_cbs_nodes', {
    code: p.code, name: p.name, description: p.description,
    budget_cost: field(p.code, 'budget_cost'),
    budget_qty: field(p.code, 'budget_qty'),
    unit: field(p.code, 'unit'),
  }, record, `rename cbs ${p.code}`);
  console.log(`renamed    cbs ${p.code}  ${was === p.name ? '(unchanged) ' : `${was} → `}${p.name}`);
}

// ── 2. the children ──────────────────────────────────────────────────────────
for (const c of CHILDREN) {
  run('act_create_cbs_nodes', {
    project_id: PROJECT, parent_id: c.parent, code: c.code, name: c.name,
    description: c.description, budget_cost: '', budget_qty: '', unit: '',
  }, null, `create cbs ${c.code}`);
  console.log(`created    cbs ${c.code}  under ${c.parent}  ${c.name}`);
}

await writeBack(db, host);

// ── 3. the project's status, through the pipeline ────────────────────────────
const config = await getSolutionConfig(db, SOLUTION);
const flow = structuredClone(config.workflows.find((w) => w.id === 'wf_projects'));
if (!flow) throw new Error('wf_projects not found');
const modify = flow.activities.find((a) => a.id === 'act_modify_projects');
if (!modify) throw new Error('act_modify_projects not found');

const withoutStatus = structuredClone(modify.attributes);
modify.attributes = [...withoutStatus, { attribute_ref: 'status' }];
await putConfigEntity(db, SOLUTION, configCollections.workflows, flow);
console.log('\nstatus     ~ act_modify_projects captures status (temporarily)');

const second = await loadOperationHost(db, OPERATION, undefined, user);
const project = second.adapter.getRecord(PROJECT);
if (!project) throw new Error(`${PROJECT} not found`);
const current = project.customFields as Record<string, unknown>;
const activity = findActivity(second, 'act_modify_projects');
if (!activity) throw new Error('act_modify_projects not found');
const result = second.engine.runActivity(activity, {
  name: String(current.name ?? ''),
  description: String(current.description ?? ''),
  client: String(current.client ?? ''),
  job_type: String(current.job_type ?? ''),
  target_start: String(current.target_start ?? ''),
  target_completion: String(current.target_completion ?? ''),
  approved_budget: String(current.approved_budget ?? ''),
  status: 'Created',
}, project);
if (result.status !== 'done') throw new Error(`status ${PROJECT}: ${JSON.stringify(result)}`);
await writeBack(db, second);
console.log(`modified   ${PROJECT}  status ${current.status} → Created`);

modify.attributes = withoutStatus;
await putConfigEntity(db, SOLUTION, configCollections.workflows, flow);
console.log('status     ~ act_modify_projects no longer captures status');

console.log(`\n${PARENTS.length} renamed, ${CHILDREN.length} CBS children created`);
await closeDb(db);
