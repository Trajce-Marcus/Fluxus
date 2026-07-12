// Local entry: Hono under Node. With no DATABASE_URL, storage is PGlite
// persisted to .data/ — a real Postgres in-process, so the Drizzle schema and
// queries are byte-identical to the Neon deployment.

import { serve } from '@hono/node-server';
import { createDb } from './db/client';
import { createApp } from './app';
import { getScopeConfig } from './host';
import { DEFAULT_SCOPE } from './router';

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
const app = createApp({ db });

try {
  await getScopeConfig(db, DEFAULT_SCOPE);
} catch {
  console.log(`No SDM config stored for '${DEFAULT_SCOPE}' yet — run \`npm run seed\` to load the demo SDM.`);
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`@fluxus/server listening on http://localhost:${port} (tRPC at /trpc)`);

export { app, db };
// Type-only surface for @fluxus/client (erased at compile time — importing
// the type never boots this entry).
export type { AppRouter } from './router';
