// Bootstrap the first org admin — the answer to the chicken-and-egg the strict
// entry gate creates (RBAC_COMPACT "Users" + "Administration", ruled
// 2026-08-02).
//
// There is no signup, and an operation with no op users admits nobody. The
// Console reaches an operation through the same gate as the Runtime, so once
// auth is configured and migration 0010 has run, nobody can open the screen
// that would invite the first person. Something outside the request path has to
// write the first row. This is that something.
//
// Deliberately SEPARATE from `npm run seed`. The seed installs the demo bundle
// (solution, config, pages, records) and is for an empty database; this is safe
// to point at production, because all it writes is one pool row and op-admin
// rows in operations that currently have no users at all. It is idempotent, so
// it doubles as the lockout recovery tool — which is exactly what a migration
// could not be.
//
//   FLUXUS_ORG_ADMIN_EMAIL=you@example.com npm run bootstrap
//   npm run bootstrap -- you@example.com "Your Name"

import { fileURLToPath } from 'node:url';
import { closeDb, createDb } from '../src/db/client';
import { bootstrapOrgAdmin } from '../src/host';
import { DEFAULT_ORG } from '../src/router';

// Match the dev server and the seed: DATABASE_URL from .env (Neon) when
// present, else PGlite.
if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* no .env → PGlite */ }
}

const [emailArg, nameArg, orgArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const email = emailArg ?? process.env.FLUXUS_ORG_ADMIN_EMAIL;
const orgId = orgArg ?? process.env.FLUXUS_ORG_ID ?? DEFAULT_ORG;

if (!email) {
  console.error(
    'No admin email. Set FLUXUS_ORG_ADMIN_EMAIL or pass one:\n' +
    '  npm run bootstrap -- you@example.com "Your Name"',
  );
  process.exit(1);
}

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
const result = await bootstrapOrgAdmin(db, { email, name: nameArg ?? null, orgId });

console.log(
  `Org admin: '${result.email}' in org '${orgId}'.\n` +
  (result.claimedOwnership
    ? `Owner of '${orgId}' — it had none, so recovery claimed it. Ownership is never taken from someone.\n`
    : '') +
  (result.operationsOpened.length > 0
    ? `Op admin of ${result.operationsOpened.length} operation(s) that nobody administered: ${result.operationsOpened.join(', ')}.\n`
    : 'No operations were opened — every operation already has an admin, so none was locked.\n') +
  (result.solutionsOpened.length > 0
    ? `Builds ${result.solutionsOpened.length} solution(s) that nobody built: ${result.solutionsOpened.join(', ')}.`
    : 'No solutions were opened — every solution already has an admin.') +
  '\nThey still have to sign in once for the auth id to bind (status: invited → active).',
);
await closeDb(db);
process.exit(0);
