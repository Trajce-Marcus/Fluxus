// Bootstrap seeding: bring an EMPTY database up to a working demo — a fresh
// clone, a fresh Neon branch, a PGlite run, CI.
//
// Not a deploy step, and no longer a config/page distribution channel (ruled
// 2026-07-26). The database is the source of truth for solutions: Console
// authors the model and pages, `sdm_config_versions` / `page_versions` hold
// their history. The repo files this script reads are a bootstrap fixture, so
// everything here is **skip-if-present** — re-seeding never overwrites work
// done in Console. Pass --force to overwrite anyway (rebuilding a demo from the
// files on purpose).
//
// The cross-package import is deliberate dev tooling — the server RUNTIME never
// depends on a peer host.

import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeDb, createDb } from '../src/db/client';
import { bootstrapOrgAdmin, ensureOperation, ensureOrg, ensureSolution, getSolutionConfig, listPageVersions, listPages, publishPage, putConfig, putPage, seedOperationRecords } from '../src/host';
import { DEFAULT_OPERATION, DEFAULT_SOLUTION } from '../src/router';
import { config } from '../../runtime/src/config';

// Match the dev server: seed the DATABASE_URL from .env (Neon) when present,
// else PGlite. Run `npm run seed` and it targets whatever `npm run dev` does.
if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* no .env → PGlite */ }
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const positional = args.filter((a) => !a.startsWith('--'));

// The demo bundle: one id is both the solution (config + pages) and the
// operation (records). `npm run seed <solutionId> <operationId>` overrides.
const solutionId = positional[0] ?? DEFAULT_SOLUTION;
const operationId = positional[1] ?? DEFAULT_OPERATION;
const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });

// Dummy tenancy for the demo bundle — the three names the Runtime header
// shows (org · solution … operation). Placeholders until org/solution admin
// names them for real.
await ensureOrg(db, 'default', 'Northwind Utilities');
await ensureSolution(db, solutionId, 'Asset Maintenance');

// Config: only when the solution has none. An existing config is authored
// truth — overwriting it silently is exactly the drift this seed used to cause.
const hasConfig = await getSolutionConfig(db, solutionId).then(() => true).catch(() => false);
const wroteConfig = force || !hasConfig;
if (wroteConfig) await putConfig(db, solutionId, config);

await ensureOperation(db, operationId, solutionId, 'Western Region');
await seedOperationRecords(db, operationId, config);

// Page files: page path = the file's path relative to packages/console
// minus the extension (pages/work-orders-demo.json → 'pages/work-orders-demo').
const pagesDir = fileURLToPath(new URL('../../console/pages', import.meta.url));
const pageFiles = readdirSync(pagesDir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.json'));
const existingPaths = new Set((await listPages(db, solutionId)).map((p) => p.path));
let wrotePages = 0;
for (const file of pageFiles) {
  const pagePath = `pages/${file.slice(0, -'.json'.length)}`;
  if (existingPaths.has(pagePath) && !force) continue;
  await putPage(db, solutionId, pagePath, JSON.parse(readFileSync(join(pagesDir, file), 'utf8')));
  wrotePages++;
  // Runtime renders published-only (M3), so publish the seeded draft once —
  // idempotent: skip if the page already has a version (re-seeds don't stack).
  const existing = await listPageVersions(db, solutionId, pagePath);
  if (existing.length === 0) await publishPage(db, solutionId, pagePath, 'Seed import', 'seed');
}

// The first org admin, when one is named. Creating an org and creating its
// first admin are one act (RBAC_COMPACT "Administration") — and with the strict
// entry gate, a seeded operation with no users would admit nobody, including
// the Console. Same idempotent call as `npm run bootstrap`, which is the one to
// use against an existing database; here it just saves a fresh clone a step.
// Unset ⇒ skipped: in demo posture (auth unconfigured) there is nothing to
// bootstrap, because everything is open.
const adminEmail = process.env.FLUXUS_ORG_ADMIN_EMAIL;
const bootstrapped = adminEmail ? await bootstrapOrgAdmin(db, { email: adminEmail, orgId: 'default' }) : null;

const skipped = pageFiles.length - wrotePages;
console.log(
  `Seeded solution '${solutionId}' (config: ${wroteConfig ? 'written' : 'kept existing'}, ` +
  `pages: ${wrotePages} written${skipped > 0 ? `, ${skipped} kept existing` : ''}) ` +
  `and operation '${operationId}' (records for empty types).` +
  (bootstrapped
    ? `\nOrg admin: '${bootstrapped.email}'${bootstrapped.operationsOpened.length > 0 ? ` (op admin of ${bootstrapped.operationsOpened.join(', ')})` : ''}` +
      `${bootstrapped.solutionsOpened.length > 0 ? ` (write on ${bootstrapped.solutionsOpened.join(', ')})` : ''}.`
    : '\nNo FLUXUS_ORG_ADMIN_EMAIL set — no org admin seeded. With auth configured, run `npm run bootstrap` or nobody can sign in.') +
  (!force && (skipped > 0 || !wroteConfig) ? '\nExisting content was left alone — re-run with --force to overwrite from the repo files.' : ''),
);
await closeDb(db);
process.exit(0);
