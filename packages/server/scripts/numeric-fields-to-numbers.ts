// One-off, 2026-09-22. Converts every stored `int` / `decimal` field from the
// string it was written as to a real number.
//
// The engine now coerces on the way in (memoryAdapter.coerceFieldValues) —
// this is the data written before that fix, when `runActivity` put the form's
// raw strings straight into the record. `budget_cost` on the CBS roots read
// `"2400000"`; `+` concatenated it, and a money column sorted as text.
//
// Same two rules the engine uses, so old rows and new ones agree: a blank
// stays blank, and a string that is not a number stays exactly as it was typed
// (a typo should stay visible, not become null). Reported per record type.
//
// History entries are NOT touched: `capturedAttributes` is what the person
// submitted, it is append-only, and it is a record of a submission rather than
// a value anything computes with.
//
// Pass --dry to print what it would change and write nothing.

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { records } from '../src/db/schema';
import { getSolutionConfig, listOrgs, listSolutions } from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const dry = process.argv.includes('--dry');
const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

/** Numeric field keys per record type id, across every solution in the org. */
const numericKeys = new Map<string, Set<string>>();
for (const org of await listOrgs(db)) {
  for (const sol of await listSolutions(db, org.id)) {
    const config = await getSolutionConfig(db, sol.id);
    for (const rt of config.recordTypes) {
      const keys = new Set(rt.custom_fields.filter((cf) => cf.type === 'int' || cf.type === 'decimal').map((cf) => cf.key));
      if (keys.size > 0) numericKeys.set(rt.id, new Set([...(numericKeys.get(rt.id) ?? []), ...keys]));
    }
  }
}
console.log('numeric fields by record type:');
for (const [typeId, keys] of numericKeys) console.log(`   ${typeId}: ${[...keys].join(', ')}`);

const rows = await db.select().from(records);
let changedRecords = 0;
let changedValues = 0;
const refused: string[] = [];

for (const row of rows) {
  const keys = numericKeys.get(row.typeRef);
  if (!keys) continue;
  const fields = row.customFields as Record<string, unknown>;
  const next = { ...fields };
  let touched = false;
  for (const key of keys) {
    const value = next[key];
    if (typeof value !== 'string' || value.trim() === '') continue;
    const n = Number(value.trim());
    if (!Number.isFinite(n)) {
      refused.push(`${row.typeRef} ${row.id} ${key}=${JSON.stringify(value)}`);
      continue;
    }
    next[key] = n;
    touched = true;
    changedValues += 1;
  }
  if (!touched) continue;
  changedRecords += 1;
  if (!dry) {
    // (operation, id) is the key — legacy ids like `P26-011` are not unique on
    // their own across operations.
    await db.update(records).set({ customFields: next })
      .where(and(eq(records.operationId, row.operationId), eq(records.id, row.id)));
  }
}

console.log(`\n${changedValues} values in ${changedRecords} records ${dry ? 'would be ' : ''}converted (of ${rows.length} records)`);
if (refused.length > 0) {
  console.log(`\n${refused.length} left as typed — not numbers:`);
  for (const r of refused) console.log(`   ${r}`);
}
await closeDb(db);
