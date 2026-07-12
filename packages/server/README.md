# @fluxus/server

The backend host of the shared activity engine (DSL Phase 4): activities as
the API surface over tRPC + Hono, records in Postgres (Neon in prod; PGlite —
Postgres-in-process — for dev/tests, selected by `DATABASE_URL`), with the
two-layer data architecture from root [ARCHITECTURE.md](../../docs/ARCHITECTURE.md):
transactional JSONB partitions plus the normalized reporting projection,
written synchronously in-transaction.

**Status:** backend stage 1 — headless invocation live with tests; browser
hosts still run on localStorage (repoint is stage 2). Lambda entry exists but
has not been deployed; Neon path untested until an account exists.

## Run

```bash
npm run seed --workspace=@fluxus/server   # load the demo SDM (validated on save)
npm run dev  --workspace=@fluxus/server   # http://localhost:8787, tRPC at /trpc
npm test     --workspace=@fluxus/server   # acceptance tests on in-memory PGlite
```

No `DATABASE_URL` → PGlite persisted to `.data/`. Set `DATABASE_URL` to any
Postgres (Neon) to use it instead — same schema, same queries.

See [docs/SPEC.md](docs/SPEC.md) for the design.
