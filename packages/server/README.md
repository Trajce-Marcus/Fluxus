# @fluxus/server

The backend host of the shared activity engine (DSL Phase 4): activities as
the API surface over tRPC + Hono, records in Postgres (Neon in prod; PGlite —
Postgres-in-process — for dev/tests, selected by `DATABASE_URL`), with the
two-layer data architecture from root [ARCHITECTURE.md](../../docs/ARCHITECTURE.md):
transactional JSONB partitions plus the normalized reporting projection,
written synchronously in-transaction.

**Status:** backend stage 3 — headless invocation live with tests, both
browser hosts repointed here via `@fluxus/client` (partition snapshot in,
`activities.run` out; hooks + persistence server-side only), and page
definitions stored here too (`pages` table on the config pipeline; authored in
the Console — nothing installs pages). Neon is live
(schema via drizzle-kit migrations; local dev reads `.env` for
`DATABASE_URL`). Deploy target is **Vercel** (`src/vercel.ts` bundled by
`npm run build:vercel` + `vercel.json`; decision + seam rules in root
`docs/DEPLOYMENT.md`); `src/lambda.ts` is the kept-warm raw-AWS exit path.

## Run

```bash
npm run bootstrap -- you@example.com "Your Name"   # first org admin (root or this package; idempotent, safe on prod)
npm run dev  --workspace=@fluxus/server   # http://localhost:8787, tRPC at /trpc
npm test     --workspace=@fluxus/server   # acceptance tests on in-memory PGlite
```

A migrated database is **empty** — no orgs, solutions, pages or records, by
ruling (2026-08-05). There is no seed script: register an org through
`platform.registerOrg`, then `npm run bootstrap` promotes the first admin into
it (it refuses an org that does not exist rather than inventing one).

No `DATABASE_URL` → PGlite persisted to `.data/`. Set `DATABASE_URL` to any
Postgres (Neon) to use it instead — same schema, same queries.

See [docs/SPEC.md](docs/SPEC.md) for the design.
