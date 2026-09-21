// One-off, 2026-09-22. Gives a project a place: a location description a person
// reads, and a `geopoint` for the centre of the works, so the Map component has
// something real to draw.
//
// Two parts:
//   1. the model — `location` (text) and `geo_point` (geopoint) as pool
//      attributes, fields of rt_projects, and attributes of Create and Modify
//      Project. Idempotent: anything already there is left alone.
//   2. the eleven existing projects — location, coordinate, and a description
//      written from the project's name, which is where the place was hiding
//      (every name carries a Victorian suburb; none of the descriptions did).
//
// **The data half writes to the records directly**, which the platform's first
// rule forbids. The user ruled it for this demo backfill (2026-09-22): these
// are demonstration rows, and how they came about is not worth an audit entry
// per project. It is not a precedent — every real change still runs an
// activity. A description already written is kept; the script never overwrites
// prose it did not author.
//
// Coordinates are suburb centres to four decimals (~11 m), which is the right
// grain for "where is this project". P26-011 has no place in its name at all —
// a cross-country pipeline — so it is given a plausible Gippsland start point.
//
// Pass --dry to print what it would do and write nothing.

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { records } from '../src/db/schema';
import { configCollections, getSolutionConfig, putConfigEntity } from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const OPERATION = 'projects-dev';
const dry = process.argv.includes('--dry');

const NEW_FIELDS = [
  { key: 'location', type: 'text', label: 'Location', description: 'Where the works are, in plain words.' },
  { key: 'geo_point', type: 'geopoint', label: 'GPS coordinate', description: 'Centre point of the works (WGS 84).' },
] as const;

interface Place {
  location: string;
  lat: number;
  lng: number;
  description: string;
}

const PLACES: Record<string, Place> = {
  'P25-014': {
    location: 'Werribee, VIC',
    lat: -37.8996, lng: 144.6614,
    description: 'New recycled water pump station serving the Werribee irrigation network, including pumps, switchroom and site works.',
  },
  'P26-002': {
    location: 'Bacchus Marsh, VIC',
    lat: -37.6760, lng: 144.4400,
    description: 'Upgrade of the intersection at Bacchus Marsh — signals, turning lanes, kerb and channel, and service relocations.',
  },
  'P26-004': {
    location: 'Ballarat East, VIC',
    lat: -37.5560, lng: 143.8770,
    description: 'Aeration upgrade at the Ballarat East wastewater treatment plant: blowers, diffuser grids and control system.',
  },
  'P26-009': {
    location: 'Kilmore, VIC',
    lat: -37.2950, lng: 144.9500,
    description: 'Replacement wastewater pump station at Kilmore, including wet well, rising main connection and odour control.',
  },
  'P26-010': {
    location: 'Traralgon North, VIC',
    lat: -38.1600, lng: 146.5300,
    description: 'Drainage network augmentation through Traralgon North — pits, pipes and outfall works to relieve local flooding.',
  },
  'P26-001': {
    location: 'Lilydale, VIC',
    lat: -37.7560, lng: 145.3480,
    description: 'Upgrade of the Lilydale sewer main, relining and partial replacement to lift capacity through the town centre.',
  },
  'P25-025': {
    location: 'Werribee South, VIC',
    lat: -37.9330, lng: 144.6760,
    description: 'Horizontal directional drill taking the pipeline beneath the Werribee River, with entry and exit pits either bank.',
  },
  'P26-003': {
    location: 'Torquay, VIC',
    lat: -38.3320, lng: 144.3160,
    description: 'New potable water trunk main through Torquay, servicing growth on the western edge of the township.',
  },
  'P24-042': {
    location: 'Dandenong South, VIC',
    lat: -38.0170, lng: 145.2100,
    description: 'Industrial drainage outfall for the Dandenong South estate — trunk drain, headwall and water quality treatment.',
  },
  'P26-011': {
    location: 'Longford, VIC',
    lat: -38.2170, lng: 147.0800,
    description: '', // already written; the coordinate is a nominated start point
  },
  'P25-004': {
    location: 'Point Cook, VIC',
    lat: -37.9150, lng: 144.7500,
    description: 'Enabling works for the Point Cook Road duplication: service proving, relocations and drainage ahead of the road build.',
  },
};

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

// ── 2. the records, written directly ─────────────────────────────────────────

const rows = await db.select().from(records).where(and(
  eq(records.operationId, OPERATION),
  eq(records.typeRef, 'rt_projects'),
));

let written = 0;
for (const row of rows) {
  const fields = row.customFields as Record<string, unknown>;
  const projectNo = String(fields.project_no ?? '');
  const place = PLACES[projectNo];
  if (!place) {
    console.log(`skip       ? ${projectNo || row.id} — no place for this project`);
    continue;
  }
  const existingDescription = String(fields.description ?? '').trim();
  const description = existingDescription !== '' ? existingDescription : place.description;
  const next = {
    ...fields,
    location: place.location,
    geo_point: { lat: place.lat, lng: place.lng },
    description,
  };
  console.log(`${dry ? 'would set  ' : 'set        '}${projectNo}  ${place.location.padEnd(22)} ${place.lat}, ${place.lng}`);
  if (existingDescription !== '') console.log(`           (description kept: "${existingDescription.slice(0, 60)}…")`);
  if (!dry) {
    await db.update(records)
      .set({ customFields: next, updatedAt: new Date() })
      .where(and(eq(records.operationId, OPERATION), eq(records.id, row.id)));
  }
  written += 1;
}

console.log(`\n${written} of ${rows.length} projects ${dry ? 'would be ' : ''}updated`);
await closeDb(db);
