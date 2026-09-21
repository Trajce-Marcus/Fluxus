// One-off, 2026-09-18. Retires `id_field` from every stored record type.
//
// Every record now gets its own id, issued by the platform (UUIDv7). A record
// type could nominate a field to key on instead, and the projects solution
// keyed the WBS and the CBS on their codes — which made a code load-bearing in
// three ways nobody asked for: a deleted node reserved its code forever against
// the reporting rows that outlive the record, renaming a node left its id
// saying the old code, and two record types picking the same short code
// collided outright ("Record id 'AAA' already exists").
//
// **Existing records keep the ids they have.** An id is a string and nothing
// parses one, so a store holding both old code-shaped ids and new UUIDs is
// consistent — the alternative, re-keying every record and patching every FK
// that points at it, is a migration with real risk and no benefit.
//
// **Uniqueness is deliberately not added here.** A code used to be unique
// because it WAS the id; retiring that removes the guarantee, and the obvious
// repair — `unique: true` on the field — would be wrong for the WBS and the
// CBS, whose codes are unique *within a project* and not across the operation.
// Global uniqueness was an accident of the old scheme that would have refused
// the second project a node coded '1.0'. `rt_projects.project_no` already
// carries `unique: true` and keeps it, which is correct: a project number is
// unique across the operation. The scoped case is raised, not invented here.
//
// Idempotent. Pass --dry to print.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { configCollections, getSolutionConfig, listOrgs, listSolutions, putConfigEntity } from '../src/host';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const dry = process.argv.includes('--dry');

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const seen = new Set<string>();
let changed = 0;

for (const org of await listOrgs(db)) {
  for (const sol of await listSolutions(db, org.id)) {
    if (seen.has(sol.id)) continue;
    seen.add(sol.id);
    const config = await getSolutionConfig(db, sol.id);
    for (const rt of config.recordTypes) {
      const withKey = rt as typeof rt & { id_field?: string };
      if (withKey.id_field === undefined) continue;
      console.log(`${sol.id}  ~ ${rt.id}  (was keyed on '${withKey.id_field}')`);
      changed += 1;
      if (dry) continue;
      const next = structuredClone(rt) as typeof rt & { id_field?: string };
      delete next.id_field;
      await putConfigEntity(db, sol.id, configCollections.recordTypes, next as never);
    }
  }
}

console.log(`\n${changed} record type${changed === 1 ? '' : 's'}${dry ? ' would be' : ''} retired off natural keys.`);
await closeDb(db);
