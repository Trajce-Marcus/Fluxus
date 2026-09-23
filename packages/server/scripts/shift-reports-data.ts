// One-off, 2026-09-23. The shift-reports demonstration data — §9 of
// SHIFT_REPORTS.md — on P26-011. The model and pages are already built and
// verified; this writes the actual work groups, catalogue, shift reports,
// resource usage, defects and one amendment.
//
// Written straight to the `records` table, per the standing ruling (§8b):
// demonstration data is not a history worth auditing, so it bypasses
// activities and hooks entirely. Nothing constrains a directly-written field —
// the list attributes (`wg_type`, `res_type`, `shift`, `severity`, and the two
// status sets) enforce only at capture — so every value here must be correct
// by construction. This script replicates by hand what the real hooks would
// have done: report/defect numbering, `work_hours` from
// `services.time.hoursBetween`, resource-line pricing, and the largest-
// remainder split (`services.math.distribute`) that Approve runs.
//
// **Photos are real** (§12): fourteen JPEGs fetched from Wikimedia Commons,
// each uploaded once to R2 through the same presign-then-PUT seam the browser
// uses (`src/services/blob.ts`), hashed and measured from the actual bytes,
// and reused by reference (the same descriptor, many records) across the
// 2–4-per-report and 1-per-defect photo slots — not 280-odd distinct uploads.
// Source, author and licence for each are recorded next to it below. One
// simplification flagged rather than hidden: no photo is thematically a
// "weld defect close-up" or "field-joint coating" shot — Commons search
// turned up nothing suitable — so defect and coating-day photos reuse the
// general pipeline/welding/trench images instead.
//
// Idempotent by refusal: if WG-SPREAD already exists on P26-011 this aborts,
// rather than risking a second, divergent run. Pass --dry to print the plan
// (report count, cost totals, defect/amendment placement) and write nothing —
// this still fetches and hashes the photos (needed to size the plan) but
// never uploads or inserts.

import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { createDb, closeDb } from '../src/db/client';
import { records, attachments } from '../src/db/schema';
import { createBlobStore, makeStorageKey } from '../src/services/blob';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const OPERATION = 'projects-dev';
const PROJECT = 'P26-011';
const dry = process.argv.includes('--dry');
const now = new Date();

// ── small helpers ────────────────────────────────────────────────────────

const round = (n: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
};

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** services.math.distribute, replicated: largest-remainder shares that sum to `total` exactly. */
function distribute(weights: number[], total: number, precision: number): number[] {
  const scale = 10 ** precision;
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW === 0) throw new Error('distribute: zero total weight');
  const totalUnits = total * scale;
  const raw = weights.map((w) => (totalUnits * w) / sumW);
  const floors = raw.map(Math.floor);
  let leftover = Math.round(totalUnits - floors.reduce((a, b) => a + b, 0));
  const order = raw.map((r, i) => ({ i, rem: r - floors[i] })).sort((a, b) => b.rem - a.rem);
  const units = [...floors];
  for (let k = 0; k < order.length && leftover > 0; k += 1, leftover -= 1) units[order[k].i] += 1;
  return units.map((u) => round(u / scale, precision));
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const hoursBetween = (start: string, end: string): number => {
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  return (toMin(end) - toMin(start)) / 60;
};

/** Baseline/progressive JPEG SOF scan — width/height from the real bytes. */
function jpegDimensions(buf: Buffer): { width: number; height: number } {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
  let offset = 2;
  while (offset < buf.length - 1) {
    if (buf[offset] !== 0xff) { offset += 1; continue; }
    const marker = buf[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue; }
    const length = buf.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error('no SOF marker found');
}

// ── the photo pool — Wikimedia Commons, source + licence recorded (§12) ────

const PHOTO_SOURCES: Record<string, { url: string; title: string; author: string; licence: string }> = {
  'welding-pol': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/1/11/Welding_a_section_of_POL_pipeline.jpg',
    title: 'Welding a section of POL pipeline.jpg', author: 'US Army', licence: 'Public domain',
  },
  'pipeline-work': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/c/c9/Pipeline_work.jpg',
    title: 'Pipeline work.jpg', author: 'American Colony Photographic Department', licence: 'CC0',
  },
  'pipeline-under-construction': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/5/5d/Pipeline_under_construction_%286515850717%29.jpg',
    title: 'Pipeline under construction (6515850717).jpg', author: 'PROJECT_MANAGER (Flickr)', licence: 'CC BY-SA 2.0',
  },
  'pipeline-construction-seattle': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bc/Pipeline_construction%2C_Seattle%2C_1990_%2851833085580%29.jpg/1280px-Pipeline_construction%2C_Seattle%2C_1990_%2851833085580%29.jpg',
    title: 'Pipeline construction, Seattle, 1990 (51833085580).jpg', author: 'Seattle Municipal Archives', licence: 'CC BY 2.0',
  },
  'excavators-lowering-trench': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/13/Five_excavators_lowering_pipeline_into_trench_-_geograph.org.uk_-_7218071.jpg/1280px-Five_excavators_lowering_pipeline_into_trench_-_geograph.org.uk_-_7218071.jpg',
    title: 'Five excavators lowering pipeline into trench - geograph.org.uk - 7218071.jpg', author: 'Peter Facey', licence: 'CC BY-SA 2.0',
  },
  'esso-pipeline-trench': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b7/Putting_part_of_the_Esso_Southampton_to_London_pipeline_in_a_trench_%28geograph_7218901%29.jpg/1280px-Putting_part_of_the_Esso_Southampton_to_London_pipeline_in_a_trench_%28geograph_7218901%29.jpg',
    title: 'Putting part of the Esso Southampton to London pipeline in a trench (geograph 7218901).jpg', author: 'Peter Facey', licence: 'CC BY-SA 2.0',
  },
  'stringing-057': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/0/07/W-S_057_stringing_pipe_%286515854293%29.jpg',
    title: 'W-S 057 stringing pipe (6515854293).jpg', author: 'PROJECT_MANAGER (Flickr)', licence: 'CC BY-SA 2.0',
  },
  'stringing-068': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/e/e1/W-S_068_stringing_pipe_%286515854879%29_%282%29.jpg',
    title: 'W-S 068 stringing pipe (6515854879) (2).jpg', author: 'PROJECT_MANAGER (Flickr)', licence: 'CC BY-SA 2.0',
  },
  'stringing-070': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/7/78/W-S_070_stringing_pipe_%286515855605%29.jpg',
    title: 'W-S 070 stringing pipe (6515855605).jpg', author: 'PROJECT_MANAGER (Flickr)', licence: 'CC BY-SA 2.0',
  },
  'rain-exeter': {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9e/Construction_site_in_the_rain%2C_St_Leonard%27s%2C_Exeter_-_geograph.org.uk_-_7440403.jpg/1280px-Construction_site_in_the_rain%2C_St_Leonard%27s%2C_Exeter_-_geograph.org.uk_-_7440403.jpg",
    title: "Construction site in the rain, St Leonard's, Exeter - geograph.org.uk - 7440403.jpg", author: 'unknown (geograph.org.uk)', licence: 'CC BY-SA 2.0',
  },
  'rain-generic': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a3/At_the_construction_site_in_the_rain.jpg/1280px-At_the_construction_site_in_the_rain.jpg',
    title: 'At the construction site in the rain.jpg', author: 'Wikimedia Commons contributor', licence: 'CC BY-SA 4.0',
  },
  'bulldozer-flood': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c8/Bulldozer_by_the_construction_site_flood_-_geograph.org.uk_-_8247428.jpg/1280px-Bulldozer_by_the_construction_site_flood_-_geograph.org.uk_-_8247428.jpg',
    title: 'Bulldozer by the construction site flood - geograph.org.uk - 8247428.jpg', author: 'unknown (geograph.org.uk)', licence: 'CC BY-SA 2.0',
  },
  'bulldozer-cat-d6k2': {
    url: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a2/Caterpillar_D6K2_XL_bulldozer_on_a_job_site.jpg/1280px-Caterpillar_D6K2_XL_bulldozer_on_a_job_site.jpg',
    title: 'Caterpillar D6K2 XL bulldozer on a job site.jpg', author: 'Wikimedia Commons contributor', licence: 'CC BY-SA 4.0',
  },
  'pipelines-under-construction-2': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/5/54/Pipelines_under_construction_%286515839207%29.jpg',
    title: 'Pipelines under construction (6515839207).jpg', author: 'PROJECT_MANAGER (Flickr)', licence: 'CC BY-SA 2.0',
  },
};

const THEME_POOL: Record<string, string[]> = {
  clearing: ['esso-pipeline-trench', 'pipeline-construction-seattle'],
  stringing: ['stringing-057', 'stringing-068', 'stringing-070'],
  trench: ['excavators-lowering-trench', 'esso-pipeline-trench', 'pipeline-under-construction'],
  backfill: ['bulldozer-flood', 'bulldozer-cat-d6k2', 'excavators-lowering-trench'],
  welding: ['welding-pol', 'pipeline-work', 'pipeline-under-construction'],
  coating: ['pipeline-construction-seattle', 'pipelines-under-construction-2'],
  tie: ['pipeline-under-construction', 'esso-pipeline-trench', 'pipelines-under-construction-2'],
  rain: ['rain-exeter', 'rain-generic'],
};

const UA = 'FluxusDemoDataLoader/1.0 (internal tooling; contact: trajce.toshevski@gmail.com)';

interface PhotoDescriptor {
  storage_key: string; name: string; mime: string; size: number; hash: string;
  width: number; height: number;
}

// ── the resource catalogue (§9: roughly fifteen entries) ────────────────────

interface ResourceDef { code: string; description: string; res_type: string; unit: string; rate: number; cbs: string }
const RESOURCES: ResourceDef[] = [
  { code: 'PLT-EX30', description: '30t excavator + operator', res_type: 'PLT', unit: 'hr', rate: 185, cbs: '4100' },
  { code: 'PLT-EX20', description: '20t excavator + operator', res_type: 'PLT', unit: 'hr', rate: 150, cbs: '4100' },
  { code: 'PLT-DZ', description: 'D6 dozer + operator', res_type: 'PLT', unit: 'hr', rate: 195, cbs: '4100' },
  { code: 'PLT-SB1', description: 'Sideboom pipelayer', res_type: 'PLT', unit: 'hr', rate: 260, cbs: '4200' },
  { code: 'PLT-SB2', description: 'Sideboom pipelayer', res_type: 'PLT', unit: 'hr', rate: 260, cbs: '4200' },
  { code: 'PLT-CRANE', description: '50t mobile crane', res_type: 'PLT', unit: 'hr', rate: 310, cbs: '4200' },
  { code: 'PLT-UTE', description: 'Site ute', res_type: 'PLT', unit: 'hr', rate: 22, cbs: '4300' },
  { code: 'PLT-WTR', description: 'Water cart', res_type: 'PLT', unit: 'hr', rate: 85, cbs: '4300' },
  { code: 'PLT-FUEL', description: 'Diesel bowser & fuel', res_type: 'PLT', unit: 'hr', rate: 60, cbs: '3100' },
  { code: 'LAB-WELD', description: 'Certified pipeline welder', res_type: 'LAB', unit: 'hr', rate: 95, cbs: '1300' },
  { code: 'LAB-WELDOP', description: 'Welding rig operator', res_type: 'LAB', unit: 'hr', rate: 88, cbs: '1300' },
  { code: 'LAB-COAT', description: 'Coating technician', res_type: 'LAB', unit: 'hr', rate: 72, cbs: '1300' },
  { code: 'LAB-LAB', description: 'General labourer', res_type: 'LAB', unit: 'hr', rate: 55, cbs: '1300' },
  { code: 'LAB-SUP', description: 'Site supervisor', res_type: 'LAB', unit: 'hr', rate: 115, cbs: '1200' },
  { code: 'SUB-NDT', description: 'NDT/AUT inspection crew', res_type: 'SUB', unit: 'hr', rate: 140, cbs: '5100' },
  // §3: MAT exists so the catalogue can hold materials; nothing here consumes it.
  { code: 'MAT-SLEEVE', description: 'Heat-shrink sleeve stock', res_type: 'MAT', unit: 'ea', rate: 45, cbs: '3100' },
];

// ── work groups (§9) ─────────────────────────────────────────────────────

interface WgDef { code: string; name: string; manager: string; wg_type: string; parent: string | null; standard: { resource: string; qty: number }[] }
const WORK_GROUPS: WgDef[] = [
  { code: 'WG-SPREAD', name: 'Mainline spread', manager: 'Hughie', wg_type: 'Crew', parent: null, standard: [] },
  { code: 'WG-TRENCH', name: 'Trenching & excavation crew', manager: 'Dave Kowalski', wg_type: 'Crew', parent: 'WG-SPREAD', standard: [
    { resource: 'PLT-EX30', qty: 3 }, { resource: 'PLT-DZ', qty: 2 }, { resource: 'PLT-WTR', qty: 1 },
    { resource: 'LAB-LAB', qty: 4 }, { resource: 'LAB-SUP', qty: 1 }, { resource: 'PLT-FUEL', qty: 2 },
  ] },
  { code: 'WG-WELD', name: 'Mainline welding crew', manager: 'Sina Petelo', wg_type: 'Crew', parent: 'WG-SPREAD', standard: [
    { resource: 'LAB-WELD', qty: 8 }, { resource: 'LAB-WELDOP', qty: 3 }, { resource: 'PLT-SB1', qty: 2 },
    { resource: 'PLT-SB2', qty: 2 }, { resource: 'LAB-SUP', qty: 2 }, { resource: 'PLT-FUEL', qty: 2 },
  ] },
  { code: 'WG-COAT', name: 'Field joint coating crew', manager: 'Priya Nair', wg_type: 'Crew', parent: 'WG-SPREAD', standard: [
    { resource: 'LAB-COAT', qty: 6 }, { resource: 'LAB-LAB', qty: 3 }, { resource: 'PLT-UTE', qty: 2 },
    { resource: 'LAB-SUP', qty: 1 }, { resource: 'PLT-FUEL', qty: 1 },
  ] },
  { code: 'WG-TIE', name: 'Tie-ins & river crossing crew', manager: 'Tom Reddy', wg_type: 'Crew', parent: null, standard: [
    { resource: 'PLT-CRANE', qty: 2 }, { resource: 'PLT-EX20', qty: 2 }, { resource: 'LAB-WELD', qty: 3 },
    { resource: 'LAB-LAB', qty: 3 }, { resource: 'LAB-SUP', qty: 2 }, { resource: 'PLT-WTR', qty: 2 }, { resource: 'PLT-FUEL', qty: 1 },
  ] },
  { code: 'WG-PLANT', name: 'Shared plant', manager: 'Grant Sione', wg_type: 'Shared plant', parent: null, standard: [
    { resource: 'PLT-CRANE', qty: 1 }, { resource: 'PLT-DZ', qty: 1 }, { resource: 'PLT-WTR', qty: 1 }, { resource: 'PLT-FUEL', qty: 2 },
  ] },
];

// ── the 24 working days (Mon–Sat, four weeks from 2026-10-05) ──────────────

const DAYS: string[] = [];
{
  let cursor = '2026-10-05'; // Monday
  for (let week = 0; week < 4; week += 1) {
    for (let d = 0; d < 6; d += 1) DAYS.push(addDays(cursor, week * 7 + d));
  }
}
// DAYS[0] is day-index 1, ..., DAYS[23] is day-index 24 throughout the comments.

const WBS_TARGET: Record<string, { unit: string; qty: number }> = {
  '3.1': { unit: 'm cleared', qty: 250 },
  '3.2': { unit: 'joints strung', qty: 18 },
  '3.4': { unit: 'welds completed', qty: 9 },
  '3.5': { unit: 'welds inspected', qty: 9 },
  '3.6': { unit: 'joints coated', qty: 11 },
  '3.7': { unit: 'm trenched', qty: 140 },
  '3.8': { unit: 'm lowered-in', qty: 130 },
  '3.9': { unit: 'm HDD pullback', qty: 60 },
  '3.10': { unit: 'm backfilled', qty: 150 },
};
const qtyFor = (node: string, hours: number, mult = 1): number => round(WBS_TARGET[node].qty * (hours / 10) * mult, 1);

type Status = 'Draft' | 'Submitted' | 'Approved';

interface ExtraLine { resource: string; quantity: number; note: string }
interface WbsRowPlan { wbs: string; hours?: number; notes?: string }
interface ReportPlan {
  group: string; dayIndex: number; date: string;
  startTime: string; endTime: string; breakHours: number; hoursLost: number; weather: string;
  wbsRows: WbsRowPlan[]; extra: ExtraLine[]; status: Status;
  summary: string; siteNotes: string; photoTheme: string; photoCount: number;
}

const WET_DAY = 5;       // 2026-10-09 — all four groups lose 4 hours to rain.
const NDT_ROUTINE = 7;   // 2026-10-12 — WG-WELD, routine NDT pass, approved.
const CLEAN_A = 2;       // 2026-10-06
const CLEAN_B = 9;       // 2026-10-14
const NDT_REPAIR = 10;   // 2026-10-15 — WG-WELD, NDT finds a repair, defect raised, left Submitted.
const TIE_DAY = 17;      // 2026-10-23 — WG-TIE, river-crossing tie-in.
const BACKFILL_DAY = 19; // 2026-10-26 — WG-TRENCH, heavy backfill.
const HOLE_DAY = 20;     // 2026-10-27 — WG-COAT files nothing (the deliberate gap).
const SUBMITTED_DAY = 23;// 2026-10-30 — every group, filed and awaiting approval.
const DRAFT_DAY = 24;    // 2026-10-31 — every group, still being compiled.

const CONDUIT_DEFECT_DAY = 4; // WG-TRENCH, 2026-10-08.
const COATING_DEFECT_DAY = 1; // WG-COAT, 2026-10-05.

const plans: ReportPlan[] = [];

for (let dayIndex = 1; dayIndex <= 24; dayIndex += 1) {
  const date = DAYS[dayIndex - 1];
  const isWet = dayIndex === WET_DAY;
  const status: Status = dayIndex === DRAFT_DAY ? 'Draft' : dayIndex === SUBMITTED_DAY ? 'Submitted' : 'Approved';

  const base = (group: string, wbsRows: WbsRowPlan[], summary: string, siteNotes: string, photoTheme: string, extra: ExtraLine[] = [], statusOverride?: Status): ReportPlan => {
    const startTime = '06:00';
    const endTime = isWet ? '12:30' : '16:30';
    const breakHours = 0.5;
    return {
      group, dayIndex, date, startTime, endTime, breakHours,
      hoursLost: isWet ? 4 : 0, weather: isWet ? 'Rain' : 'Fine',
      wbsRows, extra, status: statusOverride ?? status,
      summary, siteNotes, photoTheme,
      photoCount: 2 + ((dayIndex + group.length) % 3),
    };
  };

  // WG-TRENCH: 3.1 (day 1) → 3.2 (day 2) → 3.7 (days 3–18) → 3.10 (days 19–24).
  if (dayIndex === 1) {
    plans.push(base('WG-TRENCH', [{ wbs: '3.1' }],
      'ROW clearing ahead of the spread — grading and fencing to chainage 2+000.', '', 'clearing'));
  } else if (dayIndex === CLEAN_A) {
    plans.push(base('WG-TRENCH', [{ wbs: '3.2' }], 'Clean shift — pipe stringing on schedule, no delays or incidents.', '', 'stringing'));
  } else if (dayIndex >= 3 && dayIndex <= 16) {
    plans.push(base('WG-TRENCH', [{ wbs: '3.7' }],
      dayIndex === CLEAN_B ? 'Clean shift — trenching on schedule, no incidents.' : isWet
        ? 'Rain stopped work mid-afternoon; ditcher stood down for four hours.'
        : 'Continuous wheel-ditcher trenching, base padding behind.',
      '', isWet ? 'rain' : 'trench'));
  } else if (dayIndex === BACKFILL_DAY) {
    plans.push(base('WG-TRENCH', [{ wbs: '3.10' }],
      'Heavy backfill day — hired a second, smaller excavator to clear a padding backlog before the next lower-in.',
      'PLT-EX20 hired for the day, not part of the standard set.', 'backfill',
      [{ resource: 'PLT-EX20', quantity: 8, note: 'Hired excavator, heavy backfill catch-up' }]));
  } else if (dayIndex >= 17 && dayIndex <= 24) {
    plans.push(base('WG-TRENCH', [{ wbs: '3.10' }], 'Backfilling and lift compaction behind the coating crew.', '', 'backfill'));
  }

  // WG-WELD: 3.4 throughout, split with 3.5 on the two NDT days.
  if (dayIndex === NDT_ROUTINE) {
    plans.push(base('WG-WELD', [{ wbs: '3.4', hours: 8 }, { wbs: '3.5', hours: 2 }] as WbsRowPlan[],
      'Routine AUT pass behind the welding front — all welds clear.', '', 'welding'));
  } else if (dayIndex === NDT_REPAIR) {
    plans.push(base('WG-WELD', [{ wbs: '3.4', hours: 6 }, { wbs: '3.5', hours: 4 }] as WbsRowPlan[],
      'AUT scan flagged incomplete fusion on GW-114 — cut-out and re-weld scheduled; defect raised.',
      'NDT subcontractor on site the full afternoon, outside the standard set.', 'welding',
      [{ resource: 'SUB-NDT', quantity: 4, note: 'AUT inspection, repair investigation' }], 'Submitted'));
  } else {
    plans.push(base('WG-WELD', [{ wbs: '3.4' }],
      isWet ? 'Rain stopped work mid-afternoon; root passes suspended four hours early.' : 'Automated welding runs, root to cap, on schedule.',
      '', isWet ? 'rain' : 'welding'));
  }

  // WG-COAT: 3.6 (days 1–18) → 3.8 (days 19–24), except the deliberate hole.
  if (dayIndex === HOLE_DAY) {
    // Nothing filed — the deliberate gap (§9).
  } else if (dayIndex <= 18) {
    plans.push(base('WG-COAT', [{ wbs: '3.6' }],
      isWet ? 'Rain stopped work mid-afternoon; blasting and wrap suspended four hours early.' : 'Surface blast, induction heat, heat-shrink sleeve wrap.',
      '', isWet ? 'rain' : 'coating'));
  } else {
    plans.push(base('WG-COAT', [{ wbs: '3.8' }], 'Coating complete on this section — crew moved to lower-in support.', '', 'coating'));
  }

  // WG-TIE: 3.9 throughout.
  if (dayIndex === TIE_DAY) {
    plans.push(base('WG-TIE', [{ wbs: '3.9' }],
      'River-crossing tie-in day — final golden weld made connecting the HDD pull section to the mainline.',
      'Crane and both excavators on the crossing all shift.', 'tie'));
  } else {
    plans.push(base('WG-TIE', [{ wbs: '3.9' }],
      isWet ? 'Rain stopped work mid-afternoon; HDD pullback suspended four hours early.' : 'HDD pullback and tie-in welding on the river crossing.',
      '', isWet ? 'rain' : 'tie'));
  }
}

// Fill in `hours` on WBS rows that did not specify one — the report's full work_hours.
for (const p of plans) {
  const workHours = round(hoursBetween(p.startTime, p.endTime) - p.breakHours, 2);
  for (const row of p.wbsRows) if (row.hours === undefined) row.hours = workHours;
}

// ── build: connect, guard, upload photos, then write everything ────────────

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const existing = await db.select().from(records).where(and(eq(records.operationId, OPERATION), eq(records.typeRef, 'rt_work_groups')));
if (existing.some((r) => (r.customFields as Record<string, unknown>).wg_code === 'WG-SPREAD')) {
  throw new Error('WG-SPREAD already exists on P26-011 — demonstration data has already been written. Aborting rather than risk a second, divergent run.');
}

console.log(`plan: ${plans.length} shift reports across ${DAYS.length} days, ${plans.filter((p) => p.status === 'Approved').length} approved, ` +
  `${plans.filter((p) => p.status === 'Submitted').length} submitted, ${plans.filter((p) => p.status === 'Draft').length} draft.\n`);

// Photos — fetched and hashed regardless of --dry (needed to size the plan);
// uploaded to R2 only for real.
console.log('photos:');
const blobStore = createBlobStore();
const photoDescriptors: Record<string, PhotoDescriptor> = {};
const attachmentRows: (typeof attachments.$inferInsert)[] = [];
for (const [key, src] of Object.entries(PHOTO_SOURCES)) {
  const res = await fetch(src.url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`fetch failed for ${key}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const hash = createHash('sha256').update(buf).digest('hex');
  const { width, height } = jpegDimensions(buf);
  const { storageKey } = makeStorageKey(src.title, now);
  console.log(`   ${key.padEnd(30)} ${width}x${height}  ${(buf.length / 1024).toFixed(0)}KB  ${src.licence}, ${src.author}`);
  photoDescriptors[key] = { storage_key: storageKey, name: src.title, mime: 'image/jpeg', size: buf.length, hash, width, height };
  attachmentRows.push({ storageKey, size: buf.length, mime: 'image/jpeg', hash, width, height, status: 'committed' });
  if (!dry) {
    const uploadUrl = await blobStore.presignUpload(storageKey, 'image/jpeg');
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: buf });
    if (!put.ok) throw new Error(`R2 upload failed for ${key}: HTTP ${put.status}`);
  }
}

const pickPhotos = (themeKey: string, count: number, seed: number): PhotoDescriptor[] => {
  const pool = THEME_POOL[themeKey];
  const out: PhotoDescriptor[] = [];
  for (let i = 0; i < count; i += 1) out.push(photoDescriptors[pool[(seed + i) % pool.length]]);
  return out;
};

// ── work groups, catalogue, standard sets ───────────────────────────────────

const wgId = new Map<string, string>();
for (const wg of WORK_GROUPS) wgId.set(wg.code, uuidv7());

const resId = new Map<string, string>();
for (const r of RESOURCES) resId.set(r.code, uuidv7());

const rowsToInsert: (typeof records.$inferInsert)[] = [];

for (const wg of WORK_GROUPS) {
  rowsToInsert.push({
    operationId: OPERATION, id: wgId.get(wg.code)!, typeRef: 'rt_work_groups', activityHistory: [],
    customFields: {
      wg_code: wg.code, parent_id: wg.parent ? wgId.get(wg.parent)! : '', name: wg.name, project_id: PROJECT,
      manager: wg.manager, wg_type: wg.wg_type, active: 'true', expired: 'false',
    },
  });
}

for (const r of RESOURCES) {
  rowsToInsert.push({
    operationId: OPERATION, id: resId.get(r.code)!, typeRef: 'rt_resources', activityHistory: [],
    customFields: { code: r.code, description: r.description, res_type: r.res_type, unit: r.unit, rate: r.rate, cbs_id: r.cbs, project_id: PROJECT, expired: 'false' },
  });
}

for (const wg of WORK_GROUPS) {
  for (const std of wg.standard) {
    rowsToInsert.push({
      operationId: OPERATION, id: uuidv7(), typeRef: 'rt_wg_resources', activityHistory: [],
      customFields: { wg_id: wgId.get(wg.code)!, resource_id: resId.get(std.resource)!, quantity: std.qty, rate: '', cbs_id: '', expired: 'false' },
    });
  }
}

// ── shift reports, WBS rows, resource usage, WBS-posted cost ───────────────

let reportSeq = 0;
const nextReportNo = () => { reportSeq += 1; return `SR-${pad(reportSeq, 4)}`; };
let defectSeq = 0;
const nextDefectNo = () => { defectSeq += 1; return `DEF-${pad(defectSeq, 3)}`; };

const reportIdByGroupDay = new Map<string, string>(); // `${group}#${dayIndex}` -> report id

let approvedTotal = 0;
const nodeTotals: Record<string, number> = {};

for (const p of plans) {
  const reportId = uuidv7();
  reportIdByGroupDay.set(`${p.group}#${p.dayIndex}`, reportId);
  const workHours = round(hoursBetween(p.startTime, p.endTime) - p.breakHours, 2);
  const seeded = p.status !== 'Draft'; // Draft reports are still mid-filing — not yet Calculated.
  const approvedDate = p.status === 'Approved' ? `${addDays(p.date, 1)}T09:00:00.000Z` : '';
  const parentWg = WORK_GROUPS.find((w) => w.code === p.group)!;
  const approvedBy = p.status === 'Approved' ? (parentWg.parent ? WORK_GROUPS.find((w) => w.code === parentWg.parent)!.manager : parentWg.manager) : '';

  rowsToInsert.push({
    operationId: OPERATION, id: reportId, typeRef: 'rt_shift_reports', activityHistory: [],
    customFields: {
      report_no: nextReportNo(), project_id: PROJECT, wg_id: wgId.get(p.group)!,
      report_date: p.date, shift: 'Day', start_time: p.startTime, end_time: p.endTime,
      break_hours: p.breakHours, work_hours: workHours, hours_lost: p.hoursLost || '',
      weather: p.weather, work_summary: p.summary, site_notes: p.siteNotes,
      report_photos: pickPhotos(p.photoTheme, p.photoCount, p.dayIndex),
      status: p.status, approved_by: approvedBy, approved_date: approvedDate,
      amended_report_id: '', expired: 'false',
    },
  });

  // WBS rows.
  for (const row of p.wbsRows) {
    rowsToInsert.push({
      operationId: OPERATION, id: uuidv7(), typeRef: 'rt_shift_wbs', activityHistory: [],
      customFields: {
        report_id: reportId, wbs_id: row.wbs, hours: row.hours,
        qty_completed: qtyFor(row.wbs, row.hours, p.dayIndex === BACKFILL_DAY ? 1.3 : 1),
        qty_unit: WBS_TARGET[row.wbs].unit, notes: row.notes ?? '', expired: 'false',
      },
    });
  }

  // Resource usage lines — the group's standard set, priced at work_hours, plus any ad hoc line.
  const group = WORK_GROUPS.find((w) => w.code === p.group)!;
  const lines: { id: string; resource: string; quantity: number; note?: string }[] = group.standard.map((s) => ({
    id: uuidv7(), resource: s.resource, quantity: round(workHours * s.qty, 2),
  }));
  for (const extra of p.extra) lines.push({ id: uuidv7(), resource: extra.resource, quantity: extra.quantity, note: extra.note });

  for (const line of lines) {
    const res = RESOURCES.find((r) => r.code === line.resource)!;
    const trackedCost = round(line.quantity * res.rate, 2);
    rowsToInsert.push({
      operationId: OPERATION, id: line.id, typeRef: 'rt_shift_report_resource_usage', activityHistory: [],
      customFields: {
        report_id: reportId, resource_id: resId.get(line.resource)!, description: res.description,
        notes: line.note ?? '', quantity: line.quantity, wbs_id: '',
        calculated: seeded ? 'true' : 'false', unit: res.unit, rate: res.rate, cbs_id: res.cbs,
        tracked_cost: seeded ? trackedCost : '', expired: 'false',
      },
    });

    if (p.status === 'Approved') {
      const weights = p.wbsRows.map((r) => r.hours);
      const qtyShares = distribute(weights, line.quantity, 2);
      const costShares = distribute(weights, trackedCost, 2);
      p.wbsRows.forEach((row, idx) => {
        rowsToInsert.push({
          operationId: OPERATION, id: uuidv7(), typeRef: 'rt_wbs_resource_usage', activityHistory: [],
          customFields: {
            project_id: PROJECT, report_id: reportId, source_line_id: line.id, wbs_id: row.wbs, cbs_id: res.cbs,
            usage_date: p.date, quantity: qtyShares[idx], tracked_cost: costShares[idx], expired: 'false',
          },
        });
        approvedTotal += costShares[idx];
        nodeTotals[row.wbs] = (nodeTotals[row.wbs] ?? 0) + costShares[idx];
      });
    }
  }
}

// ── defects (three, different states, each with a photo) ───────────────────

const defectPlans = [
  {
    group: 'WG-COAT', dayIndex: COATING_DEFECT_DAY, wbs: '3.6', severity: 'Minor', photo: 'coating',
    location: 'Joint J-0032', description: 'Coating holiday detected by spark tester.',
    assignedTo: 'Priya Nair', status: 'Closed' as const,
    rectifiedDate: addDays(DAYS[COATING_DEFECT_DAY - 1], 1), rectificationNotes: 'Sleeve reapplied and re-tested; zero holidays on retest.',
    verifiedDate: addDays(DAYS[COATING_DEFECT_DAY - 1], 2), verifiedBy: 'Mel Tran (QA)',
  },
  {
    group: 'WG-TRENCH', dayIndex: CONDUIT_DEFECT_DAY, wbs: '3.7', severity: 'Major', photo: 'trench',
    location: 'Chainage 4+120', description: 'Existing fibre conduit exposed and nicked during trenching.',
    assignedTo: 'Dave Kowalski', status: 'Rectified' as const,
    rectifiedDate: addDays(DAYS[CONDUIT_DEFECT_DAY - 1], 3), rectificationNotes: "Conduit re-sleeved and protected per utility owner's instruction; inspected by site engineer.",
    verifiedDate: '', verifiedBy: '',
  },
  {
    group: 'WG-WELD', dayIndex: NDT_REPAIR, wbs: '3.5', severity: 'Major', photo: 'welding',
    location: 'Chainage 12+450, girth weld GW-114', description: 'AUT scan flagged incomplete fusion on the root pass; weld requires cut-out and re-weld.',
    assignedTo: 'Sina Petelo', status: 'Open' as const,
    rectifiedDate: '', rectificationNotes: '', verifiedDate: '', verifiedBy: '',
  },
];

for (const d of defectPlans) {
  const reportId = reportIdByGroupDay.get(`${d.group}#${d.dayIndex}`)!;
  const raisedDate = DAYS[d.dayIndex - 1];
  rowsToInsert.push({
    operationId: OPERATION, id: uuidv7(), typeRef: 'rt_defects', activityHistory: [],
    customFields: {
      defect_no: nextDefectNo(), project_id: PROJECT, wbs_id: d.wbs, report_id: reportId,
      raised_date: raisedDate, raised_by: WORK_GROUPS.find((w) => w.code === d.group)!.manager,
      location: d.location, def_description: d.description, severity: d.severity,
      defect_photos: pickPhotos(d.photo, 1, defectSeq),
      assigned_to: d.assignedTo, rectified_date: d.rectifiedDate, rectification_notes: d.rectificationNotes,
      verified_date: d.verifiedDate, verified_by: d.verifiedBy, status: d.status, expired: 'false',
    },
  });
}

// ── one amendment against an approved report ────────────────────────────────
// WG-TRENCH's day-1 report (3.1, ROW clearing) — approved — corrected: the
// excavator logged 10 hours but the crew stood down after 8 for a service
// locate. Left Submitted (not approved) so the dashboard reads amber for that
// day despite the underlying report already being green (§8, §9).

const amendedReportId = reportIdByGroupDay.get('WG-TRENCH#1')!;
const amendmentId = uuidv7();
const amendQty = -2;
const amendRate = RESOURCES.find((r) => r.code === 'PLT-EX30')!.rate;
rowsToInsert.push({
  operationId: OPERATION, id: amendmentId, typeRef: 'rt_shift_reports', activityHistory: [],
  customFields: {
    report_no: nextReportNo(), project_id: PROJECT, wg_id: wgId.get('WG-TRENCH')!,
    report_date: '', shift: '', start_time: '', end_time: '', break_hours: '', work_hours: '', hours_lost: '',
    weather: '', work_summary: '', site_notes: 'Excavator hours overstated by 2 — crew stood down after 8h for a service locate; corrected below. Signed off by D. Kowalski.',
    report_photos: '', status: 'Submitted', approved_by: '', approved_date: '',
    amended_report_id: amendedReportId, expired: 'false',
  },
});
rowsToInsert.push({
  operationId: OPERATION, id: uuidv7(), typeRef: 'rt_shift_report_resource_usage', activityHistory: [],
  customFields: {
    report_id: amendmentId, resource_id: resId.get('PLT-EX30')!, description: 'Excavator hours overstated — service locate stand-down',
    notes: 'Signed correction: -2h at the standard rate.', quantity: amendQty, wbs_id: '3.1',
    calculated: 'false', unit: 'hr', rate: amendRate, cbs_id: '4100',
    tracked_cost: round(amendQty * amendRate, 2), expired: 'false',
  },
});

// ── write ────────────────────────────────────────────────────────────────

const wbsPostedCount = rowsToInsert.filter((r) => r.typeRef === 'rt_wbs_resource_usage').length;
console.log(`\n${rowsToInsert.length} records to write (work groups, catalogue, standard sets, ${plans.length} shift reports and their WBS/resource lines, ` +
  `${wbsPostedCount} approved WBS-posted cost rows, 3 defects, 1 amendment).`);
console.log(`approved cost, if all held: $${round(approvedTotal, 2).toLocaleString()} across ${Object.keys(nodeTotals).length} WBS nodes.`);
for (const [node, total] of Object.entries(nodeTotals).sort()) console.log(`   ${node}  $${round(total, 2).toLocaleString()}`);

if (dry) {
  console.log('\nDRY RUN — nothing written.');
  await closeDb(db);
  process.exit(0);
}

const CHUNK = 200;
for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
  await db.insert(records).values(rowsToInsert.slice(i, i + CHUNK));
}
if (attachmentRows.length > 0) await db.insert(attachments).values(attachmentRows);

console.log('\ndemonstration data written.');
await closeDb(db);
