// One-off, 2026-09-13. The Cross-Country Steel Pipeline Project: one project,
// its seven-line CBS, and a WBS of twenty-seven activities under five phases —
// the first hierarchical recordset the platform has held, and what the nested
// `RecordList` (design §4.11) is looked at with.
//
// Three things, in order:
//   1. the model — a **new record type `rt_wbs_nodes`** with its workflow,
//      mirroring `rt_cbs_nodes` line for line (same id field, same access, same
//      five activities) because a WBS is the same shape of thing as a CBS: a
//      code, a name, a parent, and a project. Plus `description` on the CBS,
//      which had nowhere to put "Inclusions & Operational Scope", and one new
//      pool attribute, `cbs_codes`, for the WBS→CBS mapping.
//   2. the project, through `act_create_projects` then `act_modify_projects`,
//      because create does not take a status.
//   3. the CBS and the WBS, through their own create activities, parents
//      before children so a child's `parent_id` names a record that exists.
//
// Records go in through the activities: there is no second way a record comes
// into being, so each one's history starts with "created" like any other.
//
// Idempotent on the model (anything already there is left alone); NOT on the
// data — `code` is the id field, so a second run collides on P26-011 and on
// every code. Pass --dry to print what it would do and write nothing.
//
// **Invented, and flagged rather than hidden**: the client, the two dates and
// the status. The supplied matrix gave neither, and a project row with holes in
// it would look like a bug in the loader. The budget is the CBS total, $30M.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
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
const PROJECT = 'P26-011';
const dry = process.argv.includes('--dry');

// ── the data ─────────────────────────────────────────────────────────────────

const PROJECT_ROW = {
  project_no: PROJECT,
  name: 'Cross-Country Steel Pipeline Project',
  description: '50 km of 32" API 5L X70 transmission pipeline, cross-country spread.',
  client: 'APA Group',
  job_type: 'Capital Project',
  status: 'Active',
  target_start: '2026-10-01',
  target_completion: '2028-03-31',
  approved_budget: '30000000',
};

/** The operational CBS: resource groups, not phases. Flat, as supplied. */
const CBS: { code: string; name: string; description: string; budget: string }[] = [
  { code: '1000', name: 'Direct Internal Labor',   description: 'Project managers, HSE officers, QC inspectors, surveyors, supervisors', budget: '2400000' },
  { code: '2000', name: 'Permanent Materials',     description: '50 km of 32" X70 steel line pipe, induction bends, isolation valves',   budget: '12600000' },
  { code: '3000', name: 'Consumable Materials',    description: 'Welding wire/flux gases, Heat Shrinkable Sleeves, sand padding, fuel',  budget: '1800000' },
  { code: '4000', name: 'Heavy Machinery & Plant', description: 'Sideboom pipelayers, automated welding rigs, padding machines, trenchers', budget: '4500000' },
  { code: '5000', name: 'Specialist Subcontracts', description: 'HDD drilling contractor, AUT inspection crews, Hydro-test providers',  budget: '5700000' },
  { code: '6000', name: 'Indirects & Compliance',  description: 'Landowner easements, environmental permits, site camp infrastructure', budget: '1200000' },
  { code: '7000', name: 'Project Contingency',     description: 'Unanticipated rock anomalies, weather delays, material price escalations', budget: '1800000' },
];

/** The WBS: phases with their activities beneath them. `cbs` is the mapping. */
const WBS: { code: string; parent: string | null; name: string; description: string; cbs: string }[] = [
  { code: '1.0',  parent: null,  name: 'Project Management & Engineering', description: 'Front-End Development & Governance', cbs: '' },
  { code: '1.1',  parent: '1.0', name: 'Detailed Engineering Design',      description: 'Pipeline alignment sheets, stress analysis, crossing profiles.', cbs: '1200' },
  { code: '1.2',  parent: '1.0', name: 'Permitting & Land Easements',      description: 'Environmental approvals, cultural heritage clearance, ROW acquisition.', cbs: '6000' },
  { code: '1.3',  parent: '1.0', name: 'Project Controls & QA/QC',         description: 'Integrated master scheduling, budget tracking, quality plan setup.', cbs: '1000' },

  { code: '2.0',  parent: null,  name: 'Procurement & Logistics',          description: 'Supply Chain & Material Handling', cbs: '' },
  { code: '2.1',  parent: '2.0', name: 'Line Pipe Sourcing',               description: 'Procurement of 50 km of 32" API 5L X70 steel pipe (3LPE coated).', cbs: '2000' },
  { code: '2.2',  parent: '2.0', name: 'Valves & Fittings',                description: 'Mainline isolation valves, induction bends, pigging traps.', cbs: '2000' },
  { code: '2.3',  parent: '2.0', name: 'Logistics & Pipe Yard Prep',       description: 'Freight, unloading, stringing yard setup, stockpiling.', cbs: '4000 | 1000' },

  { code: '3.0',  parent: null,  name: 'Pipeline Execution (Mainline Spread)', description: 'Core Linear Field Construction Sequence', cbs: '' },
  { code: '3.1',  parent: '3.0', name: 'Right-of-Way (ROW) Clearing',      description: 'Clearing, grubbing, topsoil preservation, grading, fencing.', cbs: '4000 | 1400' },
  { code: '3.2',  parent: '3.0', name: 'Pipe Stringing',                   description: 'Hauling pipe joints from yards, placing layout along the ROW.', cbs: '4000 | 1400' },
  { code: '3.3',  parent: '3.0', name: 'Field Bending',                    description: 'Hydraulic cold-bending of pipe joints to match terrain topography.', cbs: '4000 | 1300' },
  { code: '3.4',  parent: '3.0', name: 'Mechanized Welding',               description: 'Automated internal/external welding runs (root to cap passes).', cbs: '1300 | 3000' },
  { code: '3.5',  parent: '3.0', name: 'Non-Destructive Testing (NDT)',    description: '100% Automated Ultrasonic Testing (AUT) and radiographic inspection.', cbs: '5000' },
  { code: '3.6',  parent: '3.0', name: 'Field Joint Coating (FJC)',        description: 'Surface blasting, induction heating, Heat Shrinkable Sleeve wrap.', cbs: '3000 | 1300' },
  { code: '3.7',  parent: '3.0', name: 'Trenching & Excavation',           description: 'Continuous wheel ditcher operations, rock saw cuts, base padding.', cbs: '4000 | 1400' },
  { code: '3.8',  parent: '3.0', name: 'Lowering-In & Buoyancy',           description: 'Coordinated sideboom pipelaying, concrete saddle weight placement.', cbs: '4000 | 2000' },
  { code: '3.9',  parent: '3.0', name: 'Tie-Ins & River Crossing (HDD)',   description: 'Trenchless Horizontal Directional Drilling under waterways & roads.', cbs: '5000' },
  { code: '3.10', parent: '3.0', name: 'Backfilling & Padding',            description: 'Screened native soil padding, trench backfill, lift compaction.', cbs: '4000 | 1400' },

  { code: '4.0',  parent: null,  name: 'Testing & Commissioning',          description: 'Integrity Verification & Acceptance', cbs: '' },
  { code: '4.1',  parent: '4.0', name: 'Hydrostatic Testing',              description: 'Filling pipeline sections, pressure strength/tightness testing.', cbs: '5000 | 3000' },
  { code: '4.2',  parent: '4.0', name: 'Dewatering & Drying',              description: 'Pumping water out, super-dry air purging, caliper pigging runs.', cbs: '5000' },
  { code: '4.3',  parent: '4.0', name: 'Final Valve Tie-ins',              description: 'Final golden welds, enclosure hook-ups, cathode protection tie-in.', cbs: '1300 | 2000' },

  { code: '5.0',  parent: null,  name: 'ROW Restoration & Closeout',       description: 'Environmental Handback & Contract Finalisation', cbs: '' },
  { code: '5.1',  parent: '5.0', name: 'Re-contouring & Topsoil',          description: 'Returning saved topsoil, grading to match original topography.', cbs: '4000 | 1400' },
  { code: '5.2',  parent: '5.0', name: 'Revegetation & Seeding',           description: 'Hydro-seeding, erosion control blanket installation.', cbs: '3000 | 1400' },
  { code: '5.3',  parent: '5.0', name: 'As-Built Documentation',           description: 'Final GIS survey mapping, weld logs, and structural handover.', cbs: '1200' },
];

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

// ── 1. the model ─────────────────────────────────────────────────────────────

const config = await getSolutionConfig(db, SOLUTION);
const ROLES = ['role_project_admin', 'role_project_user'];

// One new pool attribute. `description` is already there and is reused rather
// than a second near-identical key being invented.
if (!config.attributes?.some((a) => a.key === 'cbs_codes')) {
  console.log('attribute  + cbs_codes (text)');
  if (!dry) {
    await putConfigEntity(db, SOLUTION, configCollections.attributes, {
      key: 'cbs_codes', type: 'text', label: 'CBS codes',
      description: 'The CBS resource codes this activity spends against, as supplied.',
    });
  }
}

// The CBS gains a description: the supplied table has an "Inclusions &
// Operational Scope" line per code and the record type had nowhere to keep it.
const cbsType = structuredClone(config.recordTypes?.find((r) => r.id === 'rt_cbs_nodes'));
const cbsFlow = structuredClone(config.workflows?.find((w) => w.id === 'wf_cbs_nodes'));
if (!cbsType || !cbsFlow) throw new Error('rt_cbs_nodes / wf_cbs_nodes not found');

if (!cbsType.custom_fields.some((f) => f.key === 'description')) {
  console.log('field      + rt_cbs_nodes.description (text)');
  // After name, so the record reads the way the supplied table does.
  cbsType.custom_fields.splice(2, 0, { key: 'description', type: 'text', label: 'Description', default: '' });
  for (const activity of cbsFlow.activities ?? []) {
    if (activity.id !== 'act_create_cbs_nodes' && activity.id !== 'act_modify_cbs_nodes') continue;
    if (!activity.attributes?.some((a) => a.attribute_ref === 'description')) {
      console.log(`activity   + ${activity.id}.description`);
      activity.attributes.push({ attribute_ref: 'description' });
    }
  }
  const get = cbsFlow.activities?.find((a) => a.id === 'act_list_cbs_nodes');
  if (get?.returns && !get.returns.includes('description')) {
    get.returns = get.returns.replace('.select(id, code, name', '.select(id, code, name, description');
    console.log('activity   ~ act_list_cbs_nodes returns description');
  }
  if (!dry) {
    await putConfigEntity(db, SOLUTION, configCollections.recordTypes, cbsType);
    await putConfigEntity(db, SOLUTION, configCollections.workflows, cbsFlow);
  }
}

// The WBS type, mirroring the CBS one: same id field, same access, same five
// activities. A WBS is the same shape of thing — a code, a name, a parent and a
// project — so it is the same shape of record type, not a new idea.
if (!config.recordTypes?.some((r) => r.id === 'rt_wbs_nodes')) {
  console.log('record type + rt_wbs_nodes, workflow + wf_wbs_nodes');
  const wbsType = {
    id: 'rt_wbs_nodes',
    name: 'WBS Nodes',
    access: { read: ROLES },
    id_field: 'code',
    description: "A node in a project's work breakdown structure — the scope spine, phase then activity.",
    workflow_ref: 'wf_wbs_nodes',
    custom_fields: [
      { key: 'code',        type: 'text',   label: 'Code',        default: '', indexed: true, required: true },
      { key: 'name',        type: 'text',   label: 'Name',        default: '', required: true },
      { key: 'description', type: 'text',   label: 'Description', default: '' },
      { key: 'project_id',  type: 'fk_ref', label: 'Project',     default: '', indexed: true, required: true, fk_record_type: 'rt_projects',  fk_display_field: 'project_no' },
      { key: 'parent_id',   type: 'fk_ref', label: 'Parent',      default: '', indexed: true, fk_record_type: 'rt_wbs_nodes', fk_display_field: 'code' },
      { key: 'cbs_codes',   type: 'text',   label: 'CBS codes',   default: '' },
      { key: 'expired',     type: 'text',   label: 'Expired',     default: 'false', indexed: true },
    ],
  };
  const wbsFlow = {
    id: 'wf_wbs_nodes',
    name: 'WBS Nodes',
    activities: [
      {
        id: 'act_create_wbs_nodes', name: 'Create WBS Node', record_map: 'CREATE', sort_order: 0,
        description: 'Adds a node under a phase, or at the root when no parent is given.',
        before_hook: null, after_hook: null,
        attributes: ['project_id', 'parent_id', 'code', 'name', 'description', 'cbs_codes'].map((attribute_ref) => ({ attribute_ref })),
      },
      {
        id: 'act_modify_wbs_nodes', name: 'Modify WBS Node', record_map: 'UPDATE', sort_order: 1,
        description: "Changes a node's code, name, scope description or CBS mapping.",
        before_hook: null, after_hook: null,
        attributes: ['code', 'name', 'description', 'cbs_codes'].map((attribute_ref) => ({ attribute_ref })),
      },
      {
        id: 'act_move_wbs_nodes', name: 'Move WBS Node', record_map: 'UPDATE', sort_order: 2,
        description: 'Re-parents a node within its project.',
        before_hook: null, after_hook: null, attributes: [{ attribute_ref: 'parent_id' }],
      },
      {
        id: 'act_delete_wbs_nodes', name: 'Delete WBS Node', record_map: 'UPDATE', sort_order: 3,
        description: 'Retires a node. Platform delete is deferred, so this expires it.',
        before_hook: null, after_hook: null, attributes: [{ attribute_ref: 'expired' }],
      },
      {
        id: 'act_list_wbs_nodes', name: 'List WBS Nodes', record_map: 'GET', sort_order: 4,
        description: "A project's whole WBS, for the table that nests it.",
        returns: "records.wbs_nodes.where(project_id = attributes.project_id and expired <> 'true').orderBy(code).select(id, code, name, description, cbs_codes, parent_id)",
        before_hook: null, after_hook: null, attributes: [{ attribute_ref: 'project_id' }],
      },
    ],
  };
  if (!dry) {
    // Three writes for two entities, because each end needs the other:
    // `sdm_record_types.workflow_ref` is a real foreign key, so the workflow
    // must land first — but the GET's `returns` names `records.wbs_nodes`, and
    // that does not resolve until the record type exists. So the workflow goes
    // in without its GET, the type follows, and the GET arrives on the third
    // write with everything it names already there.
    const get = wbsFlow.activities.find((a) => a.id === 'act_list_wbs_nodes');
    await putConfigEntity(db, SOLUTION, configCollections.workflows, {
      ...wbsFlow, activities: wbsFlow.activities.filter((a) => a !== get),
    } as never);
    await putConfigEntity(db, SOLUTION, configCollections.recordTypes, wbsType as never);
    await putConfigEntity(db, SOLUTION, configCollections.workflows, wbsFlow as never);
  }
}
if (!dry) console.log('model written\n');

// ── 2 & 3. the project, its CBS and its WBS — all through the activities ─────

if (dry) {
  console.log(`create     + ${PROJECT} "${PROJECT_ROW.name}"`);
  for (const c of CBS) console.log(`create     + cbs ${c.code.padEnd(5)} ${c.name}`);
  for (const w of WBS) console.log(`create     + wbs ${w.code.padEnd(5)} ${w.parent ? `under ${w.parent}  ` : 'root      '}${w.name}`);
  await closeDb(db);
  process.exit(0);
}

// A user with the roles the model's `access.read` asks for, or the record types
// arrive trimmed and the run has nothing to write to.
const user = { id: 'script', name: 'pipeline loader', email: null, roles: ['role_project_admin'] };
const host = await loadOperationHost(db, OPERATION, undefined, user);
const run = (id: string, attrs: Record<string, string>, anchor: unknown, what: string) => {
  const activity = findActivity(host, id);
  if (!activity) throw new Error(`${id} not found`);
  const result = host.engine.runActivity(activity, attrs, anchor as never);
  if (result.status !== 'done') throw new Error(`${what}: ${JSON.stringify(result)}`);
};

run('act_create_projects', {
  project_no: PROJECT_ROW.project_no,
  name: PROJECT_ROW.name,
  description: PROJECT_ROW.description,
  client: PROJECT_ROW.client,
  job_type: PROJECT_ROW.job_type,
  target_start: PROJECT_ROW.target_start,
  target_completion: PROJECT_ROW.target_completion,
  approved_budget: PROJECT_ROW.approved_budget,
}, null, `create ${PROJECT}`);

// Status is the modify activity's to set — create leaves it at its default,
// and nothing writes the field directly.
run('act_modify_projects', {
  name: PROJECT_ROW.name,
  description: PROJECT_ROW.description,
  status: PROJECT_ROW.status,
  client: PROJECT_ROW.client,
  job_type: PROJECT_ROW.job_type,
  target_start: PROJECT_ROW.target_start,
  target_completion: PROJECT_ROW.target_completion,
  approved_budget: PROJECT_ROW.approved_budget,
}, host.adapter.getRecord(PROJECT), `modify ${PROJECT}`);
console.log(`created    ${PROJECT}  ${PROJECT_ROW.name}`);

for (const c of CBS) {
  run('act_create_cbs_nodes', {
    project_id: PROJECT, parent_id: '', code: c.code, name: c.name,
    description: c.description, budget_cost: c.budget, budget_qty: '', unit: '',
  }, null, `create cbs ${c.code}`);
  console.log(`created    cbs ${c.code.padEnd(5)} ${c.name}`);
}

// Parents before children, so a child's `parent_id` names a record that exists.
for (const w of WBS) {
  run('act_create_wbs_nodes', {
    project_id: PROJECT, parent_id: w.parent ?? '', code: w.code,
    name: w.name, description: w.description, cbs_codes: w.cbs,
  }, null, `create wbs ${w.code}`);
  console.log(`created    wbs ${w.code.padEnd(5)} ${w.name}`);
}

await writeBack(db, host);
console.log(`\n1 project, ${CBS.length} CBS nodes, ${WBS.length} WBS nodes loaded`);
await closeDb(db);
