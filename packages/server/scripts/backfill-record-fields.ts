// One-off, 2026-09-14. Adds the keys that `wbs-lifecycle.ts` declared on the
// model to the records that predate them.
//
// **Why this has to exist at all** — the gap found while verifying the
// lifecycle, and worth a decision of its own:
//
//   Adding a field to a record type does not touch existing records. Their
//   `custom_fields` jsonb simply has no such key. Field *defaults* are applied
//   in `MemoryAdapter.buildRecord` — the create path — and nowhere else. And
//   the DSL, reading a record, looks only in that jsonb map: an absent key
//   throws `'wbs_nodes' has no field 'baseline_budget'` (evaluator.ts:615)
//   rather than reading as null. So one new field broke every GET, every
//   availability condition and every total that named it, for every row loaded
//   before today.
//
// This backfills, which is what a migration would do. The deeper fix is the
// user's call: a **declared** field that is absent from a row should read as
// its default, because the validator has already proved the name is real at
// save time — the runtime throw can only fire for sparse rows, never for a
// typo. Recorded in the page spec §8.
//
// Writes records directly. There is no activity for "the model grew a field",
// and inventing one would put a migration in the audit trail as business
// history. Scoped to one operation and the types named below; every changed row
// is printed. Pass --dry to print only.

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { getOperation, getSolutionConfig } from '../src/host';
import { records } from '../src/db/schema';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const OPERATION = 'projects-dev';
const TYPES = ['rt_wbs_nodes', 'rt_projects'];
const dry = process.argv.includes('--dry');

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const op = await getOperation(db, OPERATION);
const config = await getSolutionConfig(db, op.solutionId);

let changed = 0;
for (const typeId of TYPES) {
  const rt = config.recordTypes.find((r) => r.id === typeId);
  if (!rt) throw new Error(`${typeId} not found`);
  const rows = await db.select().from(records).where(and(eq(records.operationId, OPERATION), eq(records.typeRef, typeId)));

  for (const row of rows) {
    const fields = { ...(row.customFields as Record<string, unknown>) };
    const missing = rt.custom_fields.filter((f) => !(f.key in fields));
    if (missing.length === 0) continue;
    for (const f of missing) fields[f.key] = f.default ?? '';
    console.log(`${typeId.padEnd(14)} ${String(row.id).padEnd(10)} + ${missing.map((f) => f.key).join(', ')}`);
    changed += 1;
    if (!dry) {
      await db.update(records).set({ customFields: fields })
        .where(and(eq(records.operationId, OPERATION), eq(records.id, row.id)));
    }
  }
}

console.log(`\n${changed} record${changed === 1 ? '' : 's'} ${dry ? 'would be ' : ''}backfilled`);
await closeDb(db);
