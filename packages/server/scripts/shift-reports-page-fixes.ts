// One-off, 2026-09-23. Two corrections to pages shift-reports-pages.ts wrote,
// applied to the drafts in place rather than by re-running that script (which
// would overwrite every page it builds, Console edits included):
//
// - pages/project — that script ran twice and appended its additions each
//   time, so the published page carried the links row and every new section
//   twice. Duplicates are dropped, first occurrence kept. (The script is now
//   idempotent, so a re-run cannot do it again.)
// - pages/shift-report — the Details table gains a Status row, after Shift.
//
// Writes drafts only — publish both pages in the Console. `--dry` reports and
// writes nothing.

import { and, eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { pages } from '../src/db/schema';

const SOLUTION = 'projects';
const dry = process.argv.includes('--dry');
const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });

const read = async (path: string) => {
  const row = (await db.select().from(pages).where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, path))))[0];
  if (!row) throw new Error(`no draft for ${path}`);
  return row.def as { layout: { root: Panel }; slotConfigs: Record<string, { dynamicProps?: Record<string, string> }> };
};

type Panel = { id: string; children?: Panel[] };

// Keeps the first panel of each id anywhere in the tree; later ones, and
// everything under them, are dropped.
const seen = new Set<string>();
let dropped = 0;
const dedupe = (panel: Panel): Panel => ({
  ...panel,
  children: (panel.children ?? []).filter((c) => {
    if (seen.has(c.id)) { dropped++; return false; }
    seen.add(c.id);
    return true;
  }).map(dedupe),
});

const project = await read('pages/project');
seen.add(project.layout.root.id);
project.layout.root = dedupe(project.layout.root);
console.log(`pages/project        ${dropped} duplicate panel(s) dropped`);

const report = await read('pages/shift-report');
const details = report.slotConfigs['slot-details'];
const rows = details?.dynamicProps?.rows;
const SHIFT = "value: context.record.shift },";
const STATUS = "\n  { id: 'status',   property: 'Status',        value: context.record.status },";
if (!rows || !rows.includes(SHIFT)) throw new Error('pages/shift-report: Details rows are not the shape this fix expects');
if (rows.includes("id: 'status'")) {
  console.log('pages/shift-report   Status row already there');
} else {
  details.dynamicProps!.rows = rows.replace(SHIFT, SHIFT + STATUS);
  console.log('pages/shift-report   Status row added');
}

if (!dry) {
  for (const [path, def] of [['pages/project', project], ['pages/shift-report', report]] as const) {
    await db.update(pages).set({ def, updatedAt: new Date() })
      .where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, path)));
    console.log(`page written  ${path}  (draft — publish it in the Console)`);
  }
}

await closeDb(db);
