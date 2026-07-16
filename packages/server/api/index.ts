// Vercel entry: the same Hono app as a Vercel serverless function. Hosting
// decision + seam rules in docs/DEPLOYMENT.md (Vercel now; src/lambda.ts is
// the kept-warm raw-AWS exit). DATABASE_URL must point at the real Postgres
// (Neon) — serverless instance state would make PGlite an accidental
// per-instance database.

import { handle } from 'hono/vercel';
import { createDb } from '../src/db/client';
import { createApp } from '../src/app';

if (!process.env.DATABASE_URL) {
  throw new Error('@fluxus/server on Vercel requires DATABASE_URL (Neon pooled connection string)');
}

const db = await createDb();
const app = createApp({ db });

export default handle(app);
