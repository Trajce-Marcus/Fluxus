// One-off, 2026-09-13. Rebuilds `projects · pages/cbs` on `RecordList`.
//
// The tree component is retired (RECORD_LIST_DESIGN §4.11): hierarchy is row
// order, so a nested table is the same table with `parentKey` set, and this was
// the last page still wired to `RecordTree`. What the page gains by moving is
// everything the tree never had — column types and formats, sorting, the search
// box, a filter per column, selection — and what it loses is nothing.
//
// The five callbacks become **action columns**, which is the step-2 shape: an
// act over one row is a column that draws a button, not a callback on the
// table. "Add child" is `RunActivity` with `attribute: parent_id`, so the row
// fills the new node's parent rather than anchoring the run — the case that
// property was built for.
//
// Drafts only. The published versions are left exactly as they are: a page
// becomes live by being published, never by a script reaching past it.
// Pass --dry to print only.

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { pages } from '../src/db/schema';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'projects';
const PATH = 'pages/cbs';
const SLOT = 'slot-tree';
const dry = process.argv.includes('--dry');

const slot = {
  componentName: 'RecordList',
  dynamicProps: {
    rows: "invoke('act_list_cbs_nodes', { project_id: context.record.id })",
  },
  callbacks: {
    onNew: "services.activities.run('act_create_cbs_nodes', null)",
  },
  staticConfig: {
    title: 'Cost Breakdown Structure',
    // The money spine reads as a tree even where this project's is flat: the
    // property is what the page declares, not what today's rows happen to be.
    parentKey: 'parent_id',
    search: true,
    sortable: true,
    columnFilters: true,
    newLabel: 'New node',
    emptyMessage: 'No cost codes yet.',
    columns: [
      { key: 'code',        label: 'Code',  width: 90 },
      { key: 'name',        label: 'Resource Category' },
      { key: 'description', label: 'Inclusions & Operational Scope' },
      { key: 'budget_cost', label: 'Budget', type: 'decimal', format: 'C0', currency: 'AUD', width: 130 },
      { label: 'Edit',      component: 'RunActivity', target: 'act_modify_cbs_nodes' },
      // The row fills the new node's parent instead of anchoring the run.
      { label: 'Add child', component: 'RunActivity', target: 'act_create_cbs_nodes', attribute: 'parent_id' },
      { label: 'Move',      component: 'RunActivity', target: 'act_move_cbs_nodes' },
      { label: 'Delete',    component: 'RunActivity', target: 'act_delete_cbs_nodes' },
    ],
  },
};

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const row = (await db.select().from(pages).where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, PATH))))[0];
if (!row) throw new Error(`${SOLUTION} ${PATH} not found`);

const def = structuredClone(row.def) as {
  slotConfigs?: Record<string, { componentName?: string }>;
  componentDependencies?: { name: string; version: string }[];
};
const was = def.slotConfigs?.[SLOT]?.componentName;
console.log(`${PATH} · ${SLOT}: ${was} → RecordList`);

def.slotConfigs = { ...def.slotConfigs, [SLOT]: slot };
def.componentDependencies = (def.componentDependencies ?? [])
  .filter((d) => d.name !== 'RecordTree')
  .concat(def.componentDependencies?.some((d) => d.name === 'RecordList') ? [] : [{ name: 'RecordList', version: '1.0.0' }]);

if (!dry) {
  await db.update(pages).set({ def }).where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, PATH)));
  console.log('page written');
}
await closeDb(db);
