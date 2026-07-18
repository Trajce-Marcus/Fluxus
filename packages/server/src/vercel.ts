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
// The (req, res) bridge below is hand-rolled on purpose. The off-the-shelf
// adapters both failed here: hono/vercel is Edge-only (its Response is
// ignored on the Node runtime — every request hangs), and
// @hono/node-server/vercel hangs on POSTs because Vercel's runtime pre-parses
// the body, consuming the stream the adapter then waits on (bodyParser:false
// was not honored). This bridge accepts BOTH shapes: a pre-parsed req.body is
// re-serialized, otherwise the raw stream is read.
//
// Init is lazy (first request), not top-level: a module-init throw surfaces
// only as Vercel's opaque FUNCTION_INVOCATION_FAILED page, while a request-
// time failure can answer with the actual error — missing env var, Neon
// unreachable — so a curl diagnoses the deployment. Migrations are NOT
// applied here (no migrations/ on disk next to the bundle): deploys run
// `npm run db:migrate` from a dev machine against DATABASE_URL first.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Hono } from 'hono';
import { createDb } from './db/client';
import { createApp } from './app';
import { createBlobStore } from './services/blob';

let appReady: Promise<Hono> | undefined;

function getApp(): Promise<Hono> {
  appReady ??= (async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set (or empty) in this deployment\'s environment');
    }
    const db = await createDb({ applyMigrations: false });
    return createApp({ db, blob: createBlobStore() });
  })();
  // A failed init must not be cached as permanently broken — retry next request.
  appReady.catch(() => { appReady = undefined; });
  return appReady;
}

type VercelRequest = IncomingMessage & { body?: unknown };

async function readBody(req: VercelRequest): Promise<string | Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return req.body;
    if (Buffer.isBuffer(req.body)) return req.body;
    return JSON.stringify(req.body);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export default async function handler(req: VercelRequest, res: ServerResponse): Promise<void> {
  try {
    const app = await getApp();
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(key, value);
      else if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    }
    // The body may be re-serialized; stale framing headers would corrupt it.
    headers.delete('content-length');
    headers.delete('transfer-encoding');
    const url = `https://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
    const request = new Request(url, {
      method: req.method ?? 'GET',
      headers,
      body: await readBody(req),
    });
    const response = await app.fetch(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'server request failed', detail: String(err) }));
  }
}
