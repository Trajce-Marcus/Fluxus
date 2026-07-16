import { defineConfig } from 'drizzle-kit';

// Generates/apply migrations for the platform's physical tables (src/db/schema.ts).
// DATABASE_URL comes from the gitignored .env (Node --env-file at run time).
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
