// Local entry: Hono under Node. With no DATABASE_URL, storage is PGlite
// persisted to .data/ — a real Postgres in-process, so the Drizzle schema and
// queries are byte-identical to the Neon deployment.

import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createDb } from './db/client';
import { createApp } from './app';
import { createAuth } from './auth';
import { getSolutionConfig } from './host';
import { DEFAULT_SOLUTION } from './router';
import { createBlobStore } from './services/blob';

// Local dev convenience: load packages/server/.env if present so `npm run dev`
// targets the DATABASE_URL (Neon) declared there. Absent → PGlite fallback.
// Prod (lambda.ts) never does this — it reads the real environment.
if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* no .env → PGlite */ }
}

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
const auth = createAuth();
const app = createApp({ db, blob: createBlobStore(), auth });

try {
  await getSolutionConfig(db, DEFAULT_SOLUTION);
} catch {
  console.log(`No SDM config stored for solution '${DEFAULT_SOLUTION}' yet — run \`npm run seed\` to load the demo SDM.`);
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`@fluxus/server listening on http://localhost:${port} (tRPC at /trpc)`);
console.log(`Storage: ${process.env.DATABASE_URL ? 'Postgres via DATABASE_URL (Neon)' : 'PGlite .data/'}`);
console.log(`Auth: ${auth.configured ? 'Neon Auth via NEON_AUTH_URL — session required' : 'unconfigured — demo stub, everything open'}`);

export { app, db };
// Type-only surface for @fluxus/client (erased at compile time — importing
// the type never boots this entry).
export type { AppRouter } from './router';
