// Deploy-time migration step: apply outstanding drizzle-kit migrations to the
// database named by DATABASE_URL (run once per environment, e.g. against Neon
// before releasing). createDb() runs migrate() as part of connecting, so this
// simply connects and exits.
//
//   node --env-file=.env --import tsx scripts/migrate.ts
//   (or: npm run db:migrate  — with DATABASE_URL in the environment)

import { createDb } from '../src/db/client';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('db:migrate requires DATABASE_URL (the target Postgres/Neon)');
  }
  await createDb();
  console.log('Migrations applied to', process.env.DATABASE_URL.replace(/:[^:@/]+@/, ':****@'));
  process.exit(0);
}

main().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
