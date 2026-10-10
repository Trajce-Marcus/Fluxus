// One-off, 2026-10-10, asked for by name: sample data for the inspections
// solution's `inspections-dev` operation. Run after `inspections-model.ts`.
//
// **Everything goes through activities** — the server's own `activities.run`
// via the tRPC caller, the path a browser takes, so every gate, before hook
// and after hook applies and every record has its history. Nothing is written
// to records directly.
//
// Two parts:
//   1. Master data — the six files in solutions/inspections/docs/sample-data/,
//      loaded through each type's create activity; only what is missing.
//   2. Sample jobs — ten jobs at different stages, with findings. The
//      customers, addresses and findings are **invented**; emails are at
//      example.com. A job whose address is already in the operation is
//      skipped, so a later run adds only new sample jobs.
//
// No photos: a photo arrives by browser upload, which a script cannot do.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { appRouter } from '../src/router';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const OPERATION = 'inspections-dev';
const DATA = fileURLToPath(new URL('../../../solutions/inspections/docs/sample-data/', import.meta.url));

const db = await createDb();
const caller = appRouter.createCaller({ db });

type Attrs = Record<string, unknown>;
async function run(activityId: string, attributes: Attrs = {}, recordId?: string): Promise<string> {
  const result = await caller.activities.run({ operationId: OPERATION, activityId, attributes, ...(recordId ? { recordId } : {}) });
  if (result.status !== 'done') throw new Error(`${activityId}: ${result.status} — ${result.warnings.join('; ')}`);
  return result.recordId!;
}
async function query<T>(activityId: string, attributes: Attrs = {}): Promise<T[]> {
  const result = await caller.activities.query({ operationId: OPERATION, activityId, attributes });
  return result.data as T[];
}

/** RFC 4180-ish: quoted fields, doubled quotes, commas inside quotes. */
function csv(file: string): Record<string, string>[] {
  const text = readFileSync(DATA + file, 'utf8');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// ── 1. master data ──────────────────────────────────────────────────────────

const areaIds = new Map<string, string>();     // A01 → id
const defectIds = new Map<string, string>();   // D01 → id
const categoryIds = new Map<string, string>(); // Major defect → id
const codeRefIds = new Map<string, string>();  // R01 → id

// Resumable: each dataset loads only what is missing, so a run cut short (a
// dropped connection) is finished by running the script again.
for (const c of await query<{ id: string; name: string }>('act_list_defect_categories')) categoryIds.set(c.name, c.id);
for (const a of await query<{ id: string; code: string }>('act_list_inspection_areas')) areaIds.set(a.code, a.id);
for (const d of await query<{ id: string; code: string }>('act_list_defects')) defectIds.set(d.code, d.id);
for (const r of await query<{ id: string; code: string }>('act_list_code_references')) codeRefIds.set(r.code, r.id);
const areaDefects = new Set((await query<{ area_code: string; defect_code: string }>('act_list_area_defects')).map((m) => `${m.area_code}|${m.defect_code}`));
const defectCodeRefs = new Set((await query<{ defect_code: string; code_reference: string }>('act_list_defect_code_references')).map((m) => `${m.defect_code}|${m.code_reference}`));

let n = 0;
for (const r of csv('defect_categories.csv')) {
  if (categoryIds.has(r.name)) continue;
  categoryIds.set(r.name, await run('act_create_defect_categories', { name: r.name, meaning: r.meaning }));
  n++;
}
console.log(`  + ${n} defect categories (${categoryIds.size} in all)`);

// Safety hazard stopped being a category on 2026-10-11 — it is a flag on a
// finding now. Expired, never deleted: old findings keep it as history.
const safety = (await query<{ id: string; name: string; meaning: string | null; expires_on: string | null }>('act_list_defect_categories'))
  .find((c) => c.name === 'Safety hazard');
if (safety && !safety.expires_on) {
  await run('act_update_defect_categories', { name: safety.name, ...(safety.meaning ? { meaning: safety.meaning } : {}), expires_on: '2026-10-11' }, safety.id);
  console.log('  ~ Safety hazard category expired');
}

const restrictionIds = new Map<string, string>(); // name → id
for (const r of await query<{ id: string; name: string }>('act_list_access_restrictions')) restrictionIds.set(r.name, r.id);
n = 0;
for (const r of csv('access_restrictions.csv')) {
  if (restrictionIds.has(r.name)) continue;
  restrictionIds.set(r.name, await run('act_create_access_restrictions', { name: r.name }));
  n++;
}
console.log(`  + ${n} access restrictions (${restrictionIds.size} in all)`);

n = 0;
for (const r of csv('inspection_areas.csv')) {
  if (areaIds.has(r.code)) continue;
  areaIds.set(r.code, await run('act_create_inspection_areas', { code: r.code, name: r.name, sequence: r.sequence }));
  n++;
}
console.log(`  + ${n} inspection areas (${areaIds.size} in all)`);

n = 0;
for (const r of csv('defects.csv')) {
  if (defectIds.has(r.code)) continue;
  const category = categoryIds.get(r.default_category);
  if (!category) throw new Error(`defect ${r.code}: unknown category '${r.default_category}'`);
  defectIds.set(r.code, await run('act_create_defects', { code: r.code, name: r.name, description: r.description, default_category: category }));
  n++;
}
console.log(`  + ${n} defects (${defectIds.size} in all)`);

n = 0;
for (const r of csv('code_references.csv')) {
  if (codeRefIds.has(r.code)) continue;
  codeRefIds.set(r.code, await run('act_create_code_references', {
    code: r.code, source: r.source, clause: r.clause, title: r.title, extract: r.extract, attribution: r.attribution, link: r.link,
  }));
  n++;
}
console.log(`  + ${n} code references (${codeRefIds.size} in all)`);

n = 0;
for (const r of csv('area_defects.csv')) {
  if (areaDefects.has(`${r.area_code}|${r.defect_code}`)) continue;
  await run('act_create_area_defects', { area: areaIds.get(r.area_code), area_map_defect: defectIds.get(r.defect_code) });
  n++;
}
console.log(`  + ${n} area defect mappings`);

n = 0;
for (const r of csv('defect_code_references.csv')) {
  if (defectCodeRefs.has(`${r.defect_code}|${r.code_reference_code}`)) continue;
  await run('act_create_defect_code_references', { code_map_defect: defectIds.get(r.defect_code), code_reference: codeRefIds.get(r.code_reference_code) });
  n++;
}
console.log(`  + ${n} defect code reference mappings`);

// ── 2. sample jobs ──────────────────────────────────────────────────────────

// Resumable by address: a job already in the operation is left alone, so new
// sample jobs can be added later without touching the ones people have used.
const existingAddresses = new Set((await query<{ address: string }>('act_list_jobs')).map((j) => j.address));

type Access = 'Fully inspected' | 'Restricted' | 'Not inspected' | 'Not applicable';
type Finding = {
  area: string; location: string; defect?: string; category?: 'Major defect' | 'Minor defect';
  safety?: boolean; access?: Access; restriction?: string; comments?: string;
};
type Facts = {
  building_type: string; construction: string; roof_cladding: string; footings: string; storeys: string; year_built?: string;
  occupied: 'true' | 'false'; furnished: string; people_present?: string;
  water_connected?: 'true' | 'false'; electricity_connected?: 'true' | 'false'; gas_connected?: 'true' | 'false';
  concealment?: 'true' | 'false'; concealment_note?: string;
};
type Assessment = { major_incidence: string; minor_incidence: string; overall_condition: string; overall_assessment: string };
// Used for the earlier sample jobs, which were written before property facts
// and the assessment existed — on a fresh database they still need answers.
const DEFAULT_FACTS: Facts = {
  building_type: 'House', construction: 'Brick veneer', roof_cladding: 'Concrete tiles', footings: 'Concrete slab', storeys: '1',
  occupied: 'true', furnished: 'Fully furnished', water_connected: 'true', electricity_connected: 'true', gas_connected: 'true',
};
const DEFAULT_ASSESSMENT: Assessment = {
  major_incidence: 'Typical', minor_incidence: 'Typical', overall_condition: 'Average',
  overall_assessment: 'In fair condition for its age, with the defects listed.',
};
type Stage = 'Requested' | 'Quoted' | 'Accepted' | 'Scheduled' | 'In Progress' | 'Inspected' | 'Cancelled';
type SampleJob = {
  stage: Stage; customer: string; email: string; address: string; details?: string; notes?: string;
  quote?: string; quoteNotes?: string; scheduledAt?: string; inspector?: string; instructions?: string;
  access?: string; weather?: string; checklist?: string; findings?: Finding[]; cancelReason?: string;
  facts?: Facts; assessment?: Assessment;
};

const NO_DEFECTS = (area: string, location: string, comments?: string): Finding => ({ area, location, ...(comments ? { comments } : {}) });

const JOBS: SampleJob[] = [
  {
    stage: 'Requested', customer: 'Priya Raman', email: 'priya.raman@example.com',
    address: '14 Banksia Street, Heidelberg VIC 3084',
    details: 'Three-bedroom brick veneer, built about 1975. Auction Saturday week.',
    notes: 'Buyer prefers a morning inspection.',
  },
  {
    stage: 'Quoted', customer: 'Tom Kostas', email: 'tom.kostas@example.com',
    address: '7/22 Station Road, Rosanna VIC 3084',
    details: 'Two-bedroom unit, second floor, 1990s.', quote: '395.00', quoteNotes: 'Unit rate. Roof void access through common area to be confirmed.',
  },
  {
    stage: 'Accepted', customer: 'Mei Lin Chen', email: 'meilin.chen@example.com',
    address: '3 Wattle Grove, Eltham VIC 3095',
    details: 'Four-bedroom weatherboard on a sloping block, 1984. Pool and deck.', quote: '545.00', quoteNotes: 'Larger home with pool area and deck.',
  },
  {
    stage: 'Scheduled', customer: 'James O\'Brien', email: 'james.obrien@example.com',
    address: '58 Grandview Grove, Bundoora VIC 3083',
    details: 'Double-storey brick, 2002.', quote: '495.00',
    scheduledAt: '2026-10-16T09:00:00+11:00', inspector: 'Nick Petrovski', instructions: 'Agent will meet at the property with keys.',
  },
  {
    stage: 'In Progress', customer: 'Sarah Nguyen', email: 'sarah.nguyen@example.com',
    address: '21 Lower Plenty Road, Viewbank VIC 3084',
    details: 'Three-bedroom brick veneer, about 1968, renovated kitchen.', quote: '495.00',
    scheduledAt: '2026-10-10T10:00:00+11:00', inspector: 'Nick Petrovski', instructions: 'Vendor at home.',
    access: 'Full access to house and garage. Roof void hatch in hallway.', weather: 'Fine, 19°C',
    checklist: 'PPE, ladder, torch, moisture meter, camera — all checked.',
    findings: [
      { area: 'A01', location: 'Rear yard', defect: 'D21', category: 'Minor defect', comments: 'Ground falls towards the rear wall; ponding near laundry door after recent rain.' },
      NO_DEFECTS('A02', 'Whole roof', 'Concrete tiles in fair condition for age.'),
      { area: 'A04', location: 'North wall', defect: 'D02', category: 'Major defect', comments: 'Stepped cracking through mortar joints, up to 3 mm, from window sill to ground.' },
      { area: 'A07', location: 'Bedroom 2', defect: 'D01', category: 'Minor defect', comments: 'Hairline crack above the door frame.' },
    ],
  },
  {
    stage: 'Inspected', customer: 'David Walsh', email: 'david.walsh@example.com',
    address: '9 Mountain View Road, Montmorency VIC 3094',
    details: 'Three-bedroom weatherboard, 1960s, single carport.', quote: '450.00',
    scheduledAt: '2026-10-08T09:30:00+11:00', inspector: 'Nick Petrovski',
    access: 'Full access. Subfloor not inspected — no access hatch found.', weather: 'Overcast, 15°C',
    checklist: 'PPE, ladder, torch, moisture meter, camera — all checked.',
    findings: [
      NO_DEFECTS('A01', 'Front and rear yards'),
      { area: 'A02', location: 'Rear valley', defect: 'D19', category: 'Minor defect', comments: 'Gutter corroded at the downpipe outlet.' },
      NO_DEFECTS('A03', 'Hot water unit, side path', 'Gas storage unit, about 8 years old.'),
      { area: 'A04', location: 'East wall', defect: 'D28', category: 'Minor defect', comments: 'Two weatherboards decayed near the ground line.' },
      NO_DEFECTS('A05', 'Carport'),
      NO_DEFECTS('A06', 'Front porch'),
      { area: 'A07', location: 'Lounge', defect: 'D01', category: 'Minor defect', comments: 'Cornice crack along the north wall.' },
      { area: 'A08', location: 'Main bathroom', defect: 'D10', category: 'Major defect', comments: 'Moisture readings high at the base of the shower wall; tiles drummy.' },
      NO_DEFECTS('A09', 'Kitchen and laundry'),
      { area: 'A10', location: 'Roof void', defect: 'D36', category: 'Major defect', comments: 'Water staining on the timbers below the rear valley.' },
    ],
  },
  {
    stage: 'Inspected', customer: 'Aisha Rahman', email: 'aisha.rahman@example.com',
    address: '112 Bolton Street, Eltham VIC 3095',
    details: 'Four-bedroom mud brick, 1979, on acreage.', quote: '595.00', quoteNotes: 'Acreage and outbuildings.',
    scheduledAt: '2026-10-06T08:30:00+11:00', inspector: 'Nick Petrovski',
    access: 'Full access to house; shed locked.', weather: 'Fine, 22°C',
    checklist: 'PPE, ladder, torch, moisture meter, camera — all checked.',
    findings: [
      { area: 'A01', location: 'Driveway', defect: 'D21', category: 'Major defect', comments: 'Surface water from the driveway runs towards the house; no grated drain.' },
      NO_DEFECTS('A02', 'Whole roof'),
      NO_DEFECTS('A03', 'Hot water unit, laundry'),
      NO_DEFECTS('A04', 'All elevations', 'Mud brick in good condition for age.'),
      NO_DEFECTS('A05', 'Double garage'),
      { area: 'A06', location: 'Rear deck', defect: 'D26', category: 'Minor defect', safety: true, comments: 'Handrail loose; deck about 1.5 m above ground.' },
      NO_DEFECTS('A07', 'Throughout'),
      NO_DEFECTS('A08', 'Ensuite and main bathroom'),
      NO_DEFECTS('A09', 'Kitchen and laundry'),
      NO_DEFECTS('A10', 'Roof void'),
    ],
  },
  {
    stage: 'In Progress', customer: 'Grace Whitfield', email: 'grace.whitfield@example.com',
    address: '33 Rattray Road, Montmorency VIC 3094',
    details: 'Three-bedroom weatherboard on stumps, about 1958, rear deck.', quote: '475.00',
    scheduledAt: '2026-10-11T09:00:00+11:00', inspector: 'Nick Petrovski',
    access: 'House and yard. No roof void hatch found.', weather: 'Showers, 14°C',
    checklist: 'PPE, ladder, torch, moisture meter, camera — all checked.',
    facts: {
      building_type: 'House', construction: 'Weatherboard', roof_cladding: 'Metal sheet', footings: 'Stumps', storeys: '1', year_built: '1958',
      occupied: 'false', furnished: 'Unfurnished', people_present: 'Selling agent',
      water_connected: 'true', electricity_connected: 'true', gas_connected: 'false',
    },
    findings: [
      NO_DEFECTS('A01', 'Front and rear yards'),
      { area: 'A02', location: 'Whole roof', access: 'Restricted', restriction: 'Wet or slippery surfaces', defect: 'D17', category: 'Minor defect', comments: 'Viewed from a ladder only. Rust to flashings at the chimney.' },
      { area: 'A04', location: 'Rear wall', defect: 'D39', category: 'Minor defect', comments: 'Lattice and two posts in contact with soil.' },
      { area: 'A06', location: 'Rear deck stairs', defect: 'D26', category: 'Minor defect', safety: true, comments: 'Handrail loose at the bottom post.' },
      { area: 'A10', location: 'Roof void', access: 'Not inspected', restriction: 'No access hatch', comments: 'No hatch found; recommend access be provided.' },
    ],
  },
  {
    stage: 'Inspected', customer: 'Marco Bianchi', email: 'marco.bianchi@example.com',
    address: '17 Yarra Street, Heidelberg VIC 3084',
    details: 'Three-bedroom brick veneer, about 1985, double carport.', quote: '495.00',
    scheduledAt: '2026-10-09T13:00:00+11:00', inspector: 'Nick Petrovski',
    access: 'Full access except where noted.', weather: 'Fine, 21°C',
    checklist: 'PPE, ladder, torch, moisture meter, camera — all checked.',
    facts: {
      building_type: 'House', construction: 'Brick veneer', roof_cladding: 'Concrete tiles', footings: 'Concrete slab', storeys: '1', year_built: '1985',
      occupied: 'true', furnished: 'Fully furnished', people_present: 'Vendor',
      water_connected: 'true', electricity_connected: 'true', gas_connected: 'true',
      concealment: 'true', concealment_note: 'Fresh paint over a patch of the laundry ceiling.',
    },
    findings: [
      { area: 'A01', location: 'Side path', defect: 'D40', category: 'Minor defect', comments: 'Paving laid over the slab edge along the south side.' },
      NO_DEFECTS('A02', 'Whole roof'),
      NO_DEFECTS('A03', 'Hot water unit, side path'),
      { area: 'A04', location: 'Rear wall near laundry', defect: 'D37', category: 'Major defect', comments: 'Mud leads on the brickwork below the laundry window.' },
      { area: 'A05', location: 'Double carport', access: 'Restricted', restriction: 'Vehicles', comments: 'Two cars parked; floor partly seen. No defects in the areas seen.' },
      { area: 'A06', location: '—', access: 'Not applicable', comments: 'No stairs, pergola, balcony or deck.' },
      { area: 'A07', location: 'Hallway', defect: 'D30', category: 'Minor defect', safety: true, comments: 'Smoke alarm did not sound when tested.' },
      { area: 'A08', location: 'Main bathroom', defect: 'D12', category: 'Minor defect', comments: 'Grout cracked along the shower base.' },
      NO_DEFECTS('A09', 'Kitchen and laundry'),
      { area: 'A10', location: 'Roof void', access: 'Restricted', restriction: 'Insulation', defect: 'D34', category: 'Minor defect', comments: 'Batts displaced above the hallway.' },
    ],
    assessment: {
      major_incidence: 'Typical', minor_incidence: 'Typical', overall_condition: 'Average',
      overall_assessment: 'A sound home for its age. The termite workings on the rear wall need a timber pest inspection before the contract becomes binding.',
    },
  },
  {
    stage: 'Cancelled', customer: 'Liam Murphy', email: 'liam.murphy@example.com',
    address: '41 Cartmell Street, Heidelberg VIC 3084',
    details: 'Period home, about 1925.', quote: '550.00',
    cancelReason: 'Buyer withdrew after the vendor accepted another offer.',
  },
];

// The order each stage needs, as activities.
const ORDER: Stage[] = ['Requested', 'Quoted', 'Accepted', 'Scheduled', 'In Progress', 'Inspected'];
const reached = (job: SampleJob, stage: Stage) =>
  job.stage === 'Cancelled' ? ORDER.indexOf(stage) <= ORDER.indexOf('Quoted') : ORDER.indexOf(stage) <= ORDER.indexOf(job.stage);

for (const job of JOBS) {
  if (existingAddresses.has(job.address)) continue;
  const id = await run('act_create_jobs', {
    customer_name: job.customer, customer_email: job.email, address: job.address,
    ...(job.details ? { details: job.details } : {}), ...(job.notes ? { notes: job.notes } : {}),
  });
  if (reached(job, 'Quoted')) await run('act_quote_jobs', { quoted_amount: job.quote, ...(job.quoteNotes ? { quote_notes: job.quoteNotes } : {}) }, id);
  if (reached(job, 'Accepted')) await run('act_accept_jobs', {}, id);
  if (reached(job, 'Scheduled')) await run('act_schedule_jobs', { scheduled_at: job.scheduledAt, inspector: job.inspector, ...(job.instructions ? { instructions: job.instructions } : {}) }, id);
  if (reached(job, 'In Progress')) await run('act_start_jobs', { access: job.access, weather: job.weather, checklist: job.checklist, ...(job.facts ?? DEFAULT_FACTS) }, id);
  for (const f of job.findings ?? []) {
    const defect = f.defect ? defectIds.get(f.defect) : undefined;
    if (f.defect && !defect) throw new Error(`${job.address}: unknown defect ${f.defect}`);
    const access = f.access ?? 'Fully inspected';
    const inspected = access === 'Fully inspected' || access === 'Restricted';
    const restriction = f.restriction ? restrictionIds.get(f.restriction) : undefined;
    if (f.restriction && !restriction) throw new Error(`${job.address}: unknown restriction ${f.restriction}`);
    await run('act_add_findings', {
      job: id, area: areaIds.get(f.area), location: f.location, area_access: access,
      ...(restriction ? { restriction } : {}),
      ...(inspected ? { has_defect: defect ? 'true' : 'false' } : {}),
      ...(defect ? { defect, category: categoryIds.get(f.category!), safety_hazard: f.safety ? 'true' : 'false' } : {}),
      ...(f.comments ? { comments: f.comments } : {}),
    });
  }
  if (reached(job, 'Inspected')) {
    await run('act_assess_jobs', { ...(job.assessment ?? DEFAULT_ASSESSMENT) }, id);
    await run('act_finish_jobs', { declaration_confirmed: 'true' }, id);
  }
  if (job.stage === 'Cancelled') await run('act_cancel_jobs', { cancel_reason: job.cancelReason }, id);
  console.log(`  + ${job.stage.padEnd(11)} ${job.address}${job.findings ? ` (${job.findings.length} findings)` : ''}`);
}

console.log('sample data loaded');
await closeDb(db);
