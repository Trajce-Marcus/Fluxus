// Prod entry: the same Hono app under AWS Lambda (API Gateway / function
// URL). DATABASE_URL must point at the real Postgres (Neon) — PGlite state
// inside a Lambda sandbox would be an accidental per-instance database.

import { handle } from 'hono/aws-lambda';
import { createDb } from './db/client';
import { createApp } from './app';

if (!process.env.DATABASE_URL) {
  throw new Error('@fluxus/server on Lambda requires DATABASE_URL (Neon connection string)');
}

const db = await createDb();
const app = createApp({ db });

export const handler = handle(app);
