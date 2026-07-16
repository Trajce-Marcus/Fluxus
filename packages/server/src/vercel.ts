// Vercel entry: the same Hono app as a Vercel serverless function. Hosting
// decision + seam rules in docs/DEPLOYMENT.md (Vercel now; src/lambda.ts is
// the kept-warm raw-AWS exit). DATABASE_URL must point at the real Postgres
// (Neon) — serverless instance state would make PGlite an accidental
// per-instance database.
//
// This file is not deployed as-is: `npm run build:vercel` bundles it (esbuild,
// single ESM file) into api/index.mjs, which is what Vercel serves — Node's
// strict ESM resolution can't follow the repo's extensionless imports, and
// bundling also folds in the TS-source workspace deps (engine, dsl).
// migrationsFolder: the bundle lives in api/, so migrations/ is one level up
// (createDb's own default resolves relative to src/db/, wrong from here).

import { fileURLToPath } from 'node:url';
import { handle } from 'hono/vercel';
import { createDb } from './db/client';
import { createApp } from './app';

if (!process.env.DATABASE_URL) {
  throw new Error('@fluxus/server on Vercel requires DATABASE_URL (Neon pooled connection string)');
}

const db = await createDb({
  migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
});
const app = createApp({ db });

export default handle(app);
