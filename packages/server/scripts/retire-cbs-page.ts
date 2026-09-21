// One-off, 2026-09-22. The CBS lives on the project profile page now, so the
// standalone one goes:
//
//   1. the "Cost Breakdown" action column comes off the projects list draft;
//   2. `projects · pages/cbs` is deleted — the draft and its four published
//      versions;
//   3. every attribute in the pool is checked for use, and unused ones in the
//      `projects` solution are deleted.
//
// Written straight to the tables, no activities, as the user ruled for this
// demo cleanup (2026-09-22). Deleting published versions is the part that would
// normally be forbidden outright — published versions are append-only, rollback
// is a republish — and it is done here only because "remove the page
// altogether" means exactly that.
//
// **An attribute counts as used** when an activity names it (`attribute_ref`)
// or a composite lists it as a sub-attribute. Nothing else can reference one: a
// hook reads captured values through `attrs.<key>`, which only works for an
// attribute the activity already declares, and a page binds to record fields,
// not to attributes.
//
// Pass --dry to print and write nothing.

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { pages, pageVersions, sdmAttributes } from '../src/db/schema';
import { getSolutionConfig, listOrgs, listSolutions } from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const LIST_PAGE = 'pages/projects';
const DEAD_PAGE = 'pages/cbs';
const dry = process.argv.includes('--dry');

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

// ── 1. the button ────────────────────────────────────────────────────────────

const [list] = await db.select().from(pages).where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, LIST_PAGE)));
if (!list) throw new Error(`${SOLUTION} has no page at ${LIST_PAGE}`);
const def = structuredClone(list.def) as {
  slotConfigs: Record<string, { staticConfig?: { columns?: { label?: string; target?: string; component?: string }[] } }>;
};

let removed = 0;
for (const [slot, config] of Object.entries(def.slotConfigs)) {
  const columns = config.staticConfig?.columns;
  if (!columns) continue;
  const keep = columns.filter((c) => !(c.component === 'OpenPage' && c.target === DEAD_PAGE));
  if (keep.length !== columns.length) {
    console.log(`column     - ${slot}: "${columns.find((c) => c.target === DEAD_PAGE)?.label}" → ${DEAD_PAGE}`);
    config.staticConfig!.columns = keep;
    removed += columns.length - keep.length;
  }
}
if (removed === 0) console.log(`column     = nothing on ${LIST_PAGE} opens ${DEAD_PAGE}`);
else if (!dry) {
  await db.update(pages).set({ def, updatedAt: new Date() })
    .where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, LIST_PAGE)));
}

// ── 2. the page ──────────────────────────────────────────────────────────────

const versions = await db.select().from(pageVersions)
  .where(and(eq(pageVersions.solutionId, SOLUTION), eq(pageVersions.path, DEAD_PAGE)));
const [draft] = await db.select().from(pages).where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, DEAD_PAGE)));
console.log(`page       - ${DEAD_PAGE}: ${draft ? 'draft' : 'no draft'} + ${versions.length} published version(s)`);
if (!dry) {
  await db.delete(pageVersions).where(and(eq(pageVersions.solutionId, SOLUTION), eq(pageVersions.path, DEAD_PAGE)));
  await db.delete(pages).where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, DEAD_PAGE)));
}

// ── 3. attributes nothing uses ───────────────────────────────────────────────

for (const org of await listOrgs(db)) {
  for (const sol of await listSolutions(db, org.id)) {
    const config = await getSolutionConfig(db, sol.id) as unknown as {
      attributes: { key: string; type?: string; label?: string; type_config?: { attributes?: { attribute_ref?: string }[] } }[];
      workflows: { activities?: { attributes?: { attribute_ref?: string }[] }[] }[];
    };
    const used = new Set<string>();
    for (const wf of config.workflows) {
      for (const activity of wf.activities ?? []) {
        for (const usage of activity.attributes ?? []) if (usage.attribute_ref) used.add(usage.attribute_ref);
      }
    }
    for (const attr of config.attributes) {
      for (const sub of attr.type_config?.attributes ?? []) if (sub.attribute_ref) used.add(sub.attribute_ref);
    }
    const unused = config.attributes.filter((a) => !used.has(a.key));
    const mine = sol.id === SOLUTION;
    console.log(`\n${sol.id}: ${config.attributes.length} attributes, ${unused.length} unused`);
    for (const attr of unused) {
      // Only this solution's pool is cleaned. Another solution's spare
      // attribute is that solution's business, and deleting from the sdm test
      // model on the way past is not what was asked for.
      console.log(`   ${mine ? 'delete' : 'left  '} ${attr.key} | ${attr.type} | ${attr.label ?? ''}`);
      if (mine && !dry) {
        await db.delete(sdmAttributes).where(and(eq(sdmAttributes.solutionId, sol.id), eq(sdmAttributes.key, attr.key)));
      }
    }
  }
}

console.log(dry ? '\nDRY RUN — nothing written' : '\ndone');
await closeDb(db);
