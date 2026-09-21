// One-off, 2026-09-22. Puts the project's place on the project page: the two
// new fields in the Details table, and a `Map` panel between Details and the
// WBS section.
//
// It **edits the stored draft** rather than rewriting it the way
// `project-page.ts` does: that page has been changed in the Console since it
// was written (the WBS action columns, among others), and a rewrite from the
// script's own literal would quietly undo those changes. So this reads the def,
// touches the two things it is about, and writes it back.
//
// The same check `project-page.ts` runs applies here — a page written by a
// script reaches past `validatePage` — so every expression this adds is
// evaluated through the real engine against a real project before anything is
// written.
//
// A project with no coordinate is the case the expressions are shaped around:
// `.lat` on a blank field throws, which would take the whole Details table down
// with it, so both map props are guarded with `iif`. The Details row passes the
// bag itself — a point draws as degrees in any column (columnFormat).
//
// Pass --dry to print and write nothing.

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { pages } from '../src/db/schema';
import { findActivity, loadOperationHost } from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const OPERATION = 'projects-dev';
const PROJECT = 'P26-011';
const PATH = 'pages/project';
const dry = process.argv.includes('--dry');

/** Details rows: the name first, then Location and the coordinate after Job
 *  type. The name was only ever in the page's subheading — a heading is a
 *  title, not a field, and Details is where someone looks for one. */
const DETAILS_ROWS = [
  "[ { id: 'name',       property: 'Name',              value: context.record.name },",
  "  { id: 'client',     property: 'Client',            value: context.record.client },",
  "  { id: 'job_type',   property: 'Job type',          value: context.record.job_type },",
  "  { id: 'location',   property: 'Location',          value: context.record.location },",
  "  { id: 'geo_point',  property: 'GPS coordinate',    value: context.record.geo_point },",
  "  { id: 'status',     property: 'Status',            value: context.record.status },",
  "  { id: 'wbs_status', property: 'WBS',               value: context.record.wbs_status },",
  "  { id: 'start',      property: 'Target start',      value: context.record.target_start },",
  "  { id: 'finish',     property: 'Target completion', value: context.record.target_completion },",
  "  { id: 'budget',     property: 'Approved budget',   value: context.record.approved_budget },",
  "  { id: 'desc',       property: 'Description',       value: context.record.description } ]",
].join('\n');

const MAP_SLOT = 'slot-map';
const MAP_CONFIG = {
  componentName: 'Map',
  staticConfig: { zoom: 12 },
  dynamicProps: {
    lat: "iif(context.record.geo_point = '', '', context.record.geo_point.lat)",
    lng: "iif(context.record.geo_point = '', '', context.record.geo_point.lng)",
  },
  callbacks: {},
};

// `auto`, so the panel is as tall as the map. A `fixed` panel sets only
// `flex-basis`, and in a scrolling column of content-sized siblings it shrank
// to a 10px strip (found 2026-09-22) — the map states its own shape instead,
// 700px wide and landscape, which is what a map has and a table does not.
const MAP_PANEL = {
  id: MAP_SLOT,
  size: { type: 'auto' },
  children: [],
  direction: 'vertical',
  background: '#ffffff',
  padding: { top: 10, right: 16, bottom: 10, left: 16 },
};

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const [row] = await db.select().from(pages).where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, PATH)));
if (!row) throw new Error(`${SOLUTION} has no page at ${PATH}`);
const def = structuredClone(row.def) as {
  layout: { root: { children: { id: string; children: { id: string }[] }[] } };
  slotConfigs: Record<string, unknown>;
  componentDependencies: { name: string; version: string }[];
};

// ── the details rows ─────────────────────────────────────────────────────────

const details = def.slotConfigs['slot-details'] as { dynamicProps: Record<string, string> } | undefined;
if (!details) throw new Error('the page has no slot-details');
details.dynamicProps.rows = DETAILS_ROWS;
console.log('details    + Location, GPS coordinate');

// ── the map panel ────────────────────────────────────────────────────────────

const body = def.layout.root.children.find((p) => p.id === 'panel-body');
if (!body) throw new Error('the page has no panel-body');
const existing = body.children.find((c) => c.id === MAP_SLOT) as { size?: unknown } | undefined;
if (existing) {
  existing.size = MAP_PANEL.size;
  console.log('panel      = slot-map already there, size set to auto');
} else {
  // Below Details, above the WBS section — and the WBS section starts with its
  // "New node" button, so the map goes before that, not before the table.
  const wbsAt = body.children.findIndex((c) => c.id === 'slot-wbs-new' || c.id === 'slot-wbs');
  const at = wbsAt === -1 ? body.children.length : wbsAt;
  body.children.splice(at, 0, MAP_PANEL as unknown as { id: string; children: { id: string }[] });
  console.log(`panel      + slot-map (before ${body.children[at + 1]?.id ?? 'the end'})`);
}
def.slotConfigs[MAP_SLOT] = MAP_CONFIG;
if (!def.componentDependencies.some((d) => d.name === 'Map')) {
  def.componentDependencies.push({ name: 'Map', version: '1.0.0' });
  def.componentDependencies.sort((a, b) => a.name.localeCompare(b.name));
  console.log('dependency + Map 1.0.0');
}

// ── the check: every expression this adds, through the real engine ───────────

const user = { id: 'script', name: 'page writer', email: null, roles: ['role_project_admin'] };
const host = await loadOperationHost(db, OPERATION, undefined, user);
const anchor = host.adapter.getRecord(PROJECT);
if (!anchor) throw new Error(`${PROJECT} not found`);

let failed = 0;
const evaluate = (where: string, source: string) => {
  try {
    const value = host.engine.evaluate(source, { anchorRecord: anchor });
    const shown = Array.isArray(value) ? `${value.length} rows` : JSON.stringify(value);
    console.log(`ok    ${where.padEnd(22)} ${String(shown).slice(0, 70)}`);
  } catch (err) {
    console.log(`FAIL  ${where.padEnd(22)} ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
};

evaluate('slot-details.rows', DETAILS_ROWS);
for (const [prop, source] of Object.entries(MAP_CONFIG.dynamicProps)) evaluate(`slot-map.${prop}`, source);

// The same guard, against a project that has no coordinate — the case that
// would otherwise only show up the first time someone makes a new project.
const blank = { ...anchor, customFields: { ...anchor.customFields, geo_point: '' } };
for (const [prop, source] of Object.entries(MAP_CONFIG.dynamicProps)) {
  try {
    const value = host.engine.evaluate(source, { anchorRecord: blank });
    console.log(`ok    no-point.${prop.padEnd(13)} ${JSON.stringify(value)}`);
  } catch (err) {
    console.log(`FAIL  no-point.${prop.padEnd(13)} ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}
try {
  host.engine.evaluate(DETAILS_ROWS, { anchorRecord: blank });
  console.log('ok    no-point.rows        the details table survives a project with no coordinate');
} catch (err) {
  console.log(`FAIL  no-point.rows        ${err instanceof Error ? err.message : String(err)}`);
  failed += 1;
}

if (failed > 0) {
  console.log(`\n${failed} failed — nothing written`);
  await closeDb(db);
  process.exit(1);
}

if (dry) {
  console.log('\nDRY RUN — nothing written');
  await closeDb(db);
  process.exit(0);
}

await db.update(pages)
  .set({ def, updatedAt: new Date() })
  .where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, PATH)));
console.log(`\n${PATH} updated (draft)`);
await closeDb(db);
