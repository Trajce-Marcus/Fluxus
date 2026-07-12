// Driver selection: DATABASE_URL set → real Postgres over TCP (Neon, RDS,
// local — node-postgres speaks to all of them); unset → PGlite, Postgres
// compiled to WASM running in-process (dev/tests on machines with no Postgres
// installed). Same Drizzle schema and SQL both ways — switching to Neon is a
// connection string, not a code change.

import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
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
}

export async function createDb(options: CreateDbOptions = {}): Promise<Db> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  let db: Db;
  if (databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: databaseUrl });
    db = drizzlePg(pool, { schema }) as unknown as Db;
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    if (options.dataDir) {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(options.dataDir, { recursive: true }); // PGlite won't create parents
    }
    db = drizzlePglite(new PGlite(options.dataDir), { schema });
  }
  await ensureSchema(db);
  return db;
}

// Boot-time idempotent DDL, kept in step with schema.ts by hand while the
// platform is young — drizzle-kit migrations take over when Neon deployments
// begin (generated files, applied per environment).
async function ensureSchema(db: Db): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sdm_configs (
      scope text PRIMARY KEY,
      config jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS records (
      scope text NOT NULL,
      id text NOT NULL,
      type_ref text NOT NULL,
      custom_fields jsonb NOT NULL,
      activity_history jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (scope, id)
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS records_scope_type ON records (scope, type_ref)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rpt_activities (
      id bigserial PRIMARY KEY,
      scope text NOT NULL,
      record_id text NOT NULL,
      record_type text NOT NULL,
      activity_id text NOT NULL,
      activity_name text NOT NULL,
      author text NOT NULL,
      ts timestamptz NOT NULL
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS rpt_activities_scope_record ON rpt_activities (scope, record_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS rpt_activities_scope_activity ON rpt_activities (scope, activity_id)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS rpt_attributes (
      id bigserial PRIMARY KEY,
      activity_row_id bigint NOT NULL REFERENCES rpt_activities(id),
      key text NOT NULL,
      value text,
      waive_desc text
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS rpt_attributes_activity ON rpt_attributes (activity_row_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS rpt_attributes_key_value ON rpt_attributes (key, value)`);
}
