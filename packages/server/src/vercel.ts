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
//
// Init is lazy (first request), not top-level: a module-init throw surfaces
// only as Vercel's opaque FUNCTION_INVOCATION_FAILED page, while a request-
// time failure can answer with the actual error — missing env var, Neon
// unreachable — so a curl diagnoses the deployment. Migrations are NOT
// applied here (no migrations/ on disk next to the bundle): deploys run
// `npm run db:migrate` from a dev machine against DATABASE_URL first.

import { Hono } from 'hono';
// Node-runtime adapter (IncomingMessage/ServerResponse bridge) — hono/vercel
// is the Edge-runtime one; on the Node runtime its returned Response is
// ignored and every request hangs.
import { handle } from '@hono/node-server/vercel';
import { createDb } from './db/client';
import { createApp } from './app';

let appReady: Promise<Hono> | undefined;

function getApp(): Promise<Hono> {
  appReady ??= (async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set (or empty) in this deployment\'s environment');
    }
    const db = await createDb({ applyMigrations: false });
    return createApp({ db });
  })();
  // A failed init must not be cached as permanently broken — retry next request.
  appReady.catch(() => { appReady = undefined; });
  return appReady;
}

const outer = new Hono();
outer.all('*', async (c) => {
  try {
    const app = await getApp();
    return await app.fetch(c.req.raw);
  } catch (err) {
    return c.json({ error: 'server init failed', detail: String(err) }, 500);
  }
});

// Vercel's Node runtime pre-parses request bodies by default, consuming the
// stream before the adapter reads it — POSTs then hang forever. Turn it off.
export const config = { api: { bodyParser: false } };

export default handle(outer);
