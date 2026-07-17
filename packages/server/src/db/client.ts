// Driver selection: DATABASE_URL set → real Postgres over TCP (Neon, RDS,
// local — node-postgres speaks to all of them); unset → PGlite, Postgres
// compiled to WASM running in-process (dev/tests on machines with no Postgres
// installed). Same Drizzle schema and SQL both ways — switching to Neon is a
// connection string, not a code change.
//
// Schema is applied by drizzle-kit migrations (packages/server/migrations,
// generated from schema.ts). migrate() is idempotent — it records applied
// migrations in __drizzle_migrations and only runs the outstanding ones, so
// booting an already-migrated database is a cheap check, not repeated DDL.

import { fileURLToPath } from 'node:url';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

// Both drivers expose the same query-builder surface over this schema; the
// PGlite type is the nominal one and the node-postgres instance is cast to it
// (their difference is the raw-result HKT, unused by our queries).
export type Db = PgliteDatabase<typeof schema>;

export interface CreateDbOptions {
  /** Postgres connection string; falls back to process.env.DATABASE_URL. */
  databaseUrl?: string;
  /** PGlite data directory (e.g. '.data/fluxus'); omit for in-memory (tests). */
  dataDir?: string;
  /** Set false to skip applying migrations at connect — the Vercel entry does
   *  (bundled code has no migrations/ on disk; deploys run `npm run db:migrate`
   *  from a dev machine instead). */
  applyMigrations?: boolean;
}

export async function createDb(options: CreateDbOptions = {}): Promise<Db> {
  const applyMigrations = options.applyMigrations ?? true;
  const migrationsFolder = fileURLToPath(new URL('../../migrations', import.meta.url));
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: databaseUrl });
    // Neon closes idle connections server-side; the dropped socket surfaces as
    // an 'error' on the idle client, which without a listener crashes the
    // process. Handling it lets pg-pool discard the dead client and open a
    // fresh one on next query.
    pool.on('error', (err) => {
      console.warn(`[db] idle client error (connection will be replaced): ${err.message}`);
    });
    const db = drizzlePg(pool, { schema });
    if (applyMigrations) {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      await migrate(db, { migrationsFolder });
    }
    return db as unknown as Db;
  }
  const { PGlite } = await import('@electric-sql/pglite');
  if (options.dataDir) {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(options.dataDir, { recursive: true }); // PGlite won't create parents
  }
  const db = drizzlePglite(new PGlite(options.dataDir), { schema });
  if (applyMigrations) {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(db, { migrationsFolder });
  }
  return db;
}

/**
 * Close the underlying connection (PGlite instance or node-postgres pool).
 * Scripts call this before exiting so shutdown is orderly on both drivers.
 */
export async function closeDb(db: Db): Promise<void> {
  const client = (db as unknown as { $client: { close?: () => Promise<void>; end?: () => Promise<void> } }).$client;
  if (client.close) await client.close();
  else if (client.end) await client.end();
}
