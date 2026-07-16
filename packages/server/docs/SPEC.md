# @fluxus/server — Living Spec

The backend host (DSL Phase 4, built 2026-07-12): the third front door on
the one activity pipeline — and since backend stage 2 (same day) the *only*
door to persistence: the workbench and the page builder run their reads off
a fetched partition snapshot (`@fluxus/client`) and their mutations through
`activities.run`. Headless invocation over HTTP, records in Postgres, the
reporting projection. Root ARCHITECTURE.md owns the cross-package data
architecture; this SPEC covers what the server package owns.

## The request model: partition snapshot, not async rewrite

The engine's `Store` contract and the DSL evaluator are synchronous — and
stay so (ruled at Phase 4 kickoff). Per request the server:

1. loads the scope's SDM config and full record partition from Postgres into
   an engine `MemoryAdapter` (the transactional layer is lean by doctrine —
   ARCHITECTURE.md "partition-fetch + filter" made literal),
2. runs the same sync pipeline every browser host runs
   (`validateSubmission` → `runActivity`: availability gate → before hook →
   record_map → history append → after hook),
3. diffs the adapter against its load-time baseline and writes everything
   back in **one transaction**: record upserts/deletes plus the reporting
   projection of each new history entry.

The DSL's async-shaped API (Phase 3) remains the seam for a future truly
async evaluator; nothing here forecloses it. Concurrency is last-write-wins
per record for now; optimistic versioning slots into `writeBack` when
multi-writer deployments exist.

A failing after hook persists by doctrine ("recorded, but no changes
applied"): the router writes the diff back even when `runActivity` throws,
because the entry append and record_map change preceded the hook.

## What the package owns

```
src/db/schema.ts       — Drizzle schema: sdm_configs, records (transactional),
                         rpt_activities + rpt_attributes (reporting)
src/db/client.ts       — driver selection (DATABASE_URL → node-postgres/Neon;
                         else PGlite) + boot-time idempotent DDL
src/host.ts            — loadScopeHost / writeBack (diff + projection) / putConfig
src/router.ts          — the tRPC router: config.get/put, records.list/get,
                         activities.run; DEFAULT_SCOPE
src/app.ts             — Hono app; tRPC mounted via the fetch adapter
src/index.ts           — local entry (Node, @hono/node-server, PGlite at .data/)
src/lambda.ts          — prod entry (hono/aws-lambda; requires DATABASE_URL)
src/services/notify.ts — server notify module (manifest identical to the
                         workbench's; pluggable NotifySink, console default)
scripts/seed.ts        — dev tooling: demo SDM → putConfig (see below)
```

## The API surface

tRPC procedures — functions by name, no GET/POST design (agreed stack,
ARCHITECTURE.md "Hosting options"):

- **`activities.run`** `{ scope?, activityId, recordId?, attributes, waived?,
  acknowledgedWarnings?, callbackData? }` → `RunActivityResult`. The headless
  contract (DSL_SPEC §5): the activity's attribute list is its parameter
  signature; `validateSubmission` (engine) enforces the trio — show
  conditions (hidden ⇒ exempt from required, but supplying a hidden value is
  an error), required, validation rules — plus datasource membership and
  reference existence, which the form guarantees by construction. Attribute
  values are strings, exactly as the capture form submits. `recordId` anchors
  non-CREATE activities and is rejected on CREATE. Warn soft-stop returns
  `needs-confirmation` with nothing persisted; re-run with
  `acknowledgedWarnings`.
- **`records.partition`** `{ scope? }` / **`records.list`** `{ scope?,
  typeId }` / **`records.get`** `{ scope?, recordId }` — the platform data
  channel (RecordInstance shape, history embedded). `partition` returns the
  whole scope in one round trip — what `@fluxus/client` loads into the
  browser hosts' `MemoryAdapter` snapshot at bootstrap and re-fetches after
  every run (backend stage 2; client-side expression evaluation stays local,
  scripts and persistence are server-side). App-level reads become GET
  activities when §5a lands — records.* is infrastructure, not the app API.
- **`config.get` / `config.put`** `{ scope?, config }` — the Phase 4 shift:
  the SDM config is a stored artifact and "config-save-time validation" is
  literal. `put` rejects on structural danglers (MemoryAdapter resolution) or
  any error-severity `validateConfig` finding, then loads seed records for
  types with none (LocalStorageAdapter semantics: user data never touched).

`scope` is an opaque path string, default `demo/sdm` — the partition key of
the transactional layer. Org-defined repo/folder levels arrive later as data
in the path, not as schema (locked hierarchy ruling: org + SDM,
GitHub-style).

## Data layers (v1: one Postgres, both hats)

- `records` — `(scope, id)` PK, `custom_fields` + `activity_history` JSONB:
  the RecordInstance shape verbatim. SDM edits never touch physical schema.
- `rpt_activities` / `rpt_attributes` — the normalized projection (agreed
  2026-07-12): one activities row per run (author is the `demo` stub until
  auth); one attributes row per attribute, single text `value`; a waived
  attribute is the same row with `value` null + `waive_desc`; acknowledged
  gate warnings project as a `system_warnings` row; `system_log` arrives as
  an ordinary captured attribute. Rejected gates and un-acknowledged
  soft-stops leave no rows (no entry committed). Projection is synchronous
  in-transaction; the outbox/async upgrade replaces `writeBack`'s body, not
  its callers. Rebuild-by-re-projection is possible by construction (the
  entries live on the records) but no rebuild tool exists yet.

DDL is drizzle-kit migrations (`migrations/`, generated from `schema.ts` via
`npm run db:generate`): `createDb()` applies outstanding migrations
idempotently at connect on both drivers, and `npm run db:migrate` runs the
same step explicitly against `DATABASE_URL` at deploy time. Driver selection
is the connection string: `DATABASE_URL` set → node-postgres (Neon/RDS/local),
unset → PGlite (dev/tests, no Postgres install needed); `packages/server/.env`
supplies it for local dev (loaded by the dev server and scripts, never by
`lambda.ts`).

## Services

The server registers `notify` (manifest identical to the workbench's — script
portability across hosts is the Phase 3 doctrine) and the engine's shared
`geo`. The notify sink is pluggable (`NotifySink`) and defaults to the
process log: real delivery/storage is deliberately deferred to the open
unified-log/notification design — no notifications table was added (One
Pipeline Invariant).

## Config distribution (interim)

`scripts/seed.ts` imports the sdm workbench's demo config and stores it via
`putConfig`. That cross-package import is dev tooling only — the server
runtime never depends on a peer host. Config distribution proper (authoring
against a running server) stays an open thread on the root ROADMAP.

## Known gaps (deliberate)

- No auth: `context.user` is the demo stub; `author` in reporting likewise.
- GET activities (DSL_SPEC §5a) not implemented — blocked on the unified-log
  design for their logging posture; `records.*` covers data needs meanwhile.
- Lambda entry unexercised; Neon untested until an account exists (driver is
  standard node-postgres, so risk is config, not code).
- Multi-value (`selection: multi`) datasource membership validates array
  values element-wise but the capture form doesn't produce them yet.
