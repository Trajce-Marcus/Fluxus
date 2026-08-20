// One-off, 2026-08-20. Repoints `pages/work-orders-demo` (demo/sdm) at the GET
// activity that already exists in the model, and drops the third argument its
// callbacks still pass to `services.activities.run` — removed on 2026-08-09
// (DATA_THROUGH_ACTIVITIES §4), and an arity error ever since, so both buttons
// on that page threw.
//
// Writes ONE page row. Prints the before and after; pass --dry to print only.

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { pages } from '../src/db/schema';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'demo/sdm';
const PATH = 'pages/work-orders-demo';
const dry = process.argv.includes('--dry');

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const [row] = await db
  .select()
  .from(pages)
  .where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, PATH)));

if (!row) {
  console.log(`no such page: ${SOLUTION} · ${PATH}`);
  await closeDb(db);
  process.exit(0);
}

interface Slot {
  dynamicProps?: Record<string, string>;
  callbacks?: Record<string, string>;
}
const def = structuredClone(row.def) as { slotConfigs?: Record<string, Slot> };

for (const [slotId, slot] of Object.entries(def.slotConfigs ?? {})) {
  for (const [prop, source] of Object.entries(slot?.dynamicProps ?? {})) {
    if (source.trim() !== 'records.work_orders') continue;
    // The GET declares `status` required, so the board asks for the work it is
    // there to dispatch rather than for everything.
    const next = "invoke('act_get_work_orders', { status: 'Raised' })";
    console.log(`${slotId}.${prop}\n  was: ${source}\n  now: ${next}`);
    slot.dynamicProps![prop] = next;
  }
  for (const [name, source] of Object.entries(slot?.callbacks ?? {})) {
    const next = source.replace(/,\s*callbackData\.data\s*\)/, ')');
    if (next === source) continue;
    console.log(`${slotId}.${name}\n  was: ${source}\n  now: ${next}`);
    slot.callbacks![name] = next;
  }
}

if (JSON.stringify(def) === JSON.stringify(row.def)) {
  console.log('\nnothing to change.');
} else if (dry) {
  console.log('\ndry run — not written.');
} else {
  await db.update(pages).set({ def }).where(and(eq(pages.solutionId, SOLUTION), eq(pages.path, PATH)));
  console.log('\nwritten (draft page; publish from the Console for the Runtime app to see it).');
}

await closeDb(db);
