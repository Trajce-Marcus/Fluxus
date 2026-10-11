// One-off, 2026-10-11. Inspectors, step 3: the Jobs list shows an Admin every
// job and anyone else only the jobs assigned to them (the inspector whose
// email they signed in with). The new `returns` comes from
// `inspections-model.ts`; the rest of the live activity is kept as the user
// left it. Pass --dry to check without writing.

import { fileURLToPath } from 'node:url';
import { createDb, closeDb } from '../src/db/client';
import { configCollections, getSolutionConfig, putConfigEntity } from '../src/host';
import { CONFIG } from './inspections-model';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const SOLUTION = 'inspections';
const dry = process.argv.includes('--dry');

const db = await createDb();
try {
  const live = (await getSolutionConfig(db, SOLUTION)).activities!.find((a) => a.id === 'act_list_jobs')!;
  const next = (CONFIG.activities ?? []).find((a) => a.id === 'act_list_jobs')!;
  if (live.returns === next.returns) {
    console.log('act_list_jobs already filters — nothing to do');
  } else if (dry) {
    console.log(`would set act_list_jobs returns to:\n  ${next.returns}`);
  } else {
    await putConfigEntity(db, SOLUTION, configCollections.activities, { ...live, description: next.description, returns: next.returns });
    console.log('  ~ act_list_jobs: Admin sees every job, anyone else only their own');
  }
} finally {
  await closeDb(db);
}
