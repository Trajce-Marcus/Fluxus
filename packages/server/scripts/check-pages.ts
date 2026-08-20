// Read-only. Lists every stored page's dynamic props and says which of them
// reach records directly rather than naming a GET activity — the reads that
// resolve to nothing in a host holding no records (DATA_THROUGH_ACTIVITIES
// step 5). SELECTs only; nothing is written.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { listOrgs, listSolutions } from '../src/host';
import { pages } from '../src/db/schema';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });

console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}\n`);

const rows = await db.select().from(pages);
const solutions = new Set<string>();
for (const org of await listOrgs(db)) {
  for (const sol of await listSolutions(db, org.id)) solutions.add(sol.id);
}

let inline = 0;
let named = 0;
for (const row of rows) {
  const def = row.def as {
    record?: unknown;
    slotConfigs?: Record<string, { componentName?: string; dynamicProps?: Record<string, string> }>;
  };
  console.log(`── ${row.solutionId} · ${row.path}${def.record ? '  (record: ' + JSON.stringify(def.record) + ')' : ''}`);
  for (const [slot, config] of Object.entries(def.slotConfigs ?? {})) {
    for (const [prop, source] of Object.entries(config?.dynamicProps ?? {})) {
      const usesGet = source.includes('invoke(');
      const readsRecords = /(^|[^\w.])records\./.test(source);
      if (usesGet) named++;
      if (readsRecords && !usesGet) inline++;
      const mark = usesGet ? 'GET   ' : readsRecords ? 'INLINE' : '      ';
      console.log(`   ${mark} ${slot}.${prop} (${config?.componentName ?? '?'}): ${source}`);
    }
  }
}

console.log(`\n${rows.length} pages across ${solutions.size} solutions — ${inline} inline record reads, ${named} named GETs.`);
await closeDb();
