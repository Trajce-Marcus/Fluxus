// Dev-time seeding: load the sdm workbench's demo SDM into the server's
// database through the same putConfig path the API uses (validation
// included). The cross-package import is deliberate dev tooling — the server
// RUNTIME never depends on a peer host; config distribution stays an open
// thread (root ROADMAP) and this script is its stopgap.

import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeDb, createDb } from '../src/db/client';
import { ensureOperation, ensureSolution, listPageVersions, publishPage, putConfig, putPage, seedOperationRecords } from '../src/host';
import { DEFAULT_OPERATION, DEFAULT_SOLUTION } from '../src/router';
import { config } from '../../sdm/src/config';

// Match the dev server: seed the DATABASE_URL from .env (Neon) when present,
// else PGlite. Run `npm run seed` and it targets whatever `npm run dev` does.
if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* no .env → PGlite */ }
}

// The demo bundle: one id is both the solution (config + pages) and the
// operation (records). `npm run seed <solutionId> <operationId>` overrides.
const solutionId = process.argv[2] ?? DEFAULT_SOLUTION;
const operationId = process.argv[3] ?? DEFAULT_OPERATION;
const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });

await ensureSolution(db, solutionId, 'Demo');
await putConfig(db, solutionId, config);
await ensureOperation(db, operationId, solutionId, 'Demo');
await seedOperationRecords(db, operationId, config);

// Page files ride the same deploy: every *.json under page-builder/pages/ is
// upserted, its page path = the file's path relative to packages/page-builder
// minus the extension (pages/work-orders-demo.json → 'pages/work-orders-demo').
// Unconditional upsert by design — deploying pages = deploying files, so the
// files win over live edits; unlike record seeds, pages are never user data.
const pagesDir = fileURLToPath(new URL('../../page-builder/pages', import.meta.url));
const pageFiles = readdirSync(pagesDir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.json'));
for (const file of pageFiles) {
  const pagePath = `pages/${file.slice(0, -'.json'.length)}`;
  await putPage(db, solutionId, pagePath, JSON.parse(readFileSync(join(pagesDir, file), 'utf8')));
  // Runtime renders published-only (M3), so publish the seeded draft once —
  // idempotent: skip if the page already has a version (re-seeds don't stack).
  const existing = await listPageVersions(db, solutionId, pagePath);
  if (existing.length === 0) await publishPage(db, solutionId, pagePath, 'Seed import', 'seed');
}

console.log(`Seeded solution '${solutionId}' (config + ${pageFiles.length} page(s), published) and operation '${operationId}' (records for empty types).`);
await closeDb(db);
process.exit(0);
