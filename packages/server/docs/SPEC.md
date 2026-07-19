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

1. resolves the operation to its solution, loads that solution's SDM config
   and the operation's full record partition from Postgres into
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
src/db/schema.ts       — Drizzle schema: solutions + operations (the tier,
                         CONSOLE_RUNTIME_SPEC §2), role_assignments +
                         implementer_levels (governance store, §2a),
                         sdm_configs + pages (solution-keyed design artifacts),
                         page_versions (append-only published snapshots, §3),
                         records (transactional, operation-keyed),
                         rpt_activities + rpt_attributes (reporting,
                         operation-keyed), attachments (blob ledger)
src/db/client.ts       — driver selection (DATABASE_URL → node-postgres/Neon;
                         else PGlite) + boot-time idempotent DDL
src/auth.ts            — bearer-JWT verification against Neon Auth's JWKS
                         (jose), env-driven posture, the two-lookup
                         roles-resolver seam (stubbed)
src/host.ts            — loadOperationHost (resolve operation → solution, then
                         load) / writeBack (diff + projection) / putConfig;
                         solutions + operations helpers (ensure/list/create/
                         getOperation/putOperationConfig/seedOperationRecords)
src/router.ts          — the tRPC router: solutions.list, operations.list/get/
                         create/putConfig, config.get/put, pages.*, records.*,
                         activities.run, files.*; DEFAULT_SOLUTION/DEFAULT_OPERATION
src/services/blob.ts   — the blob-store seam (R2): the ONLY module touching the
                         S3 client; presign helpers, key generation, cost
                         constants. Unconfigured when FLUXUS_R2_* is unset
src/app.ts             — Hono app; tRPC mounted via the fetch adapter
src/index.ts           — local entry (Node, @hono/node-server, PGlite at .data/)
src/lambda.ts          — raw-AWS entry (hono/aws-lambda) — the kept-warm exit
                         path per docs/DEPLOYMENT.md, not the deploy target
src/vercel.ts          — prod entry (hono/vercel; requires DATABASE_URL);
                         `npm run build:vercel` bundles it (esbuild, one ESM
                         file) to api/index.mjs (generated, gitignored) —
                         with vercel.json the only Vercel-specifics by ruling
src/services/notify.ts — server notify module (manifest identical to the
                         workbench's; pluggable NotifySink, console default)
scripts/seed.ts        — dev tooling: demo SDM → putConfig (see below)
```

## The API surface

tRPC procedures — functions by name, no GET/POST design (agreed stack,
ARCHITECTURE.md "Hosting options"). Two partition keys after the operations
tier (CONSOLE_RUNTIME_SPEC §1–2): design artifacts take `solutionId?`, data
takes `operationId?` (both default `demo/sdm`):

- **`solutions.list`** → `{ id, name }[]` and **`operations.list`** →
  `OperationRow[]` / **`operations.get`** `{ operationId? }` →
  `{ id, orgId, solutionId, name, config }` / **`operations.create`**
  `{ id, solutionId, name }` (implementer `admin`) / **`operations.putConfig`**
  `{ operationId?, config }` (implementer `write`; the runtime menu, §5 —
  **validated at save**: every leaf `page` resolves to a published page of the
  linked solution, every role id is declared, one nesting level max).
  Plain auth-tier CRUD — no SDM, no activities. `operations.get` is the
  Runtime's resolution door: `@fluxus/client.connect(operationId)` calls it
  first, then loads config + pages by the returned `solutionId`.
- **`me`** `{ operationId? }` → `{ id, name, email, roles, authConfigured }` —
  the caller's identity + roles resolved for the operation. The Runtime host
  uses it for **cosmetic** menu filtering; the server filters are the real gate.
- **Governance (RBAC stage 1)** — over the `role_assignments` /
  `implementer_levels` store, all implementer-`admin`-gated: **`assignments.roles`**
  `{ operationId? }` → the linked solution's declared role defs (the picker);
  **`assignments.list`** `{ operationId? }` / **`assignments.put`**
  `{ operationId?, userId, roleIds }` (empty roleIds clears the row);
  **`implementers.list`** `{ solutionId? }` / **`implementers.put`**
  `{ solutionId?, userId, level }`.
- **`activities.run`** `{ operationId?, activityId, recordId?, attributes, waived?,
  acknowledgedWarnings?, callbackData? }` → `RunActivityResult`. The headless
  contract (DSL_SPEC §5): the activity's attribute list is its parameter
  signature; `validateSubmission` (engine) enforces the trio — show
  conditions (hidden ⇒ exempt from required, but supplying a hidden value is
  an error), required, validation rules — plus datasource membership and
  reference existence, which the form guarantees by construction. Attribute
  values transit as arbitrary JSON — scalars are strings as the form submits,
  file/photo descriptors are objects, multi values are arrays;
  `validateSubmission` does the authoritative per-type shape check. `recordId`
  anchors non-CREATE activities and is rejected on CREATE. Warn soft-stop
  returns `needs-confirmation` with nothing persisted; re-run with
  `acknowledgedWarnings`.
- **`files.presignUpload`** `{ solutionId?, attributeKey, name, mime, size, hash?,
  photo metadata? }` → `{ storageKey, uploadUrl, thumbKey?, thumbUploadUrl? }`
  / **`files.presignGet`** `{ solutionId?, key }` → `{ url }` — the blob upload/read
  door (ATTRIBUTE_TYPES_FILES_SCALARS §6). Bytes never transit the server: the
  browser PUTs straight to R2 with the returned URL. `presignUpload` is the
  cost chokepoint (§7), enforced BEFORE any bytes move: the platform per-file
  ceiling (20 MB), the attribute's `max_size_mb`, the `file` `accept` filter
  (photos are images), and the environment storage fuse (ledger SUM(size) vs
  8 GB). It inserts the `pending` ledger row and, for photos, a second
  presigned PUT for the thumbnail. `max_count` is enforced at submit
  (`validateSubmission`). Both procedures answer a clean error when
  FLUXUS_R2_* is unset.
- **`records.partition`** `{ operationId? }` / **`records.list`** `{ operationId?,
  typeId }` / **`records.get`** `{ operationId?, recordId }` — the platform data
  channel (RecordInstance shape, history embedded). `partition` returns the
  whole operation partition in one round trip — what `@fluxus/client` loads into the
  browser hosts' `MemoryAdapter` snapshot at bootstrap and re-fetches after
  every run (backend stage 2; client-side expression evaluation stays local,
  scripts and persistence are server-side). App-level reads become GET
  activities when §5a lands — records.* is infrastructure, not the app API.
  **RBAC stage 1**: all three apply the record-type read filter (below) — a
  deny reads as not-found on `get`, and unreadable types drop out of
  `partition`/`list`.
- **`config.get` / `config.put`** `{ solutionId?, config }` — the Phase 4 shift:
  the SDM config is a stored artifact and "config-save-time validation" is
  literal. `put` rejects on structural danglers (MemoryAdapter resolution) or
  any error-severity `validateConfig` finding. Config is solution-plane and
  owns no records; demo-record seeding moved to `seedOperationRecords` (called
  against an operation by the seed script), not `config.put`.
- **`pages.list` / `pages.put` / `pages.delete`** `{ solutionId?, path, def }`
  (backend stage 3, 2026-07-16) — page definitions on the config pipeline.
  Defs are **opaque jsonb**: `PageDef` and `validatePage` live in the page
  builder, and the server never depends on a peer host, so unlike `config.put`
  there is no save-time validation here. `put` is an unconditional upsert —
  the seed script pushes every `*.json` under `page-builder/pages/`, so
  deploying pages = deploying files and files win over live edits; unlike
  record seeds, pages are never user data. `list` `{ solutionId?, published? }`
  has **two modes** (M3): draft (Console — the `pages` rows) vs published
  (Runtime — latest `page_versions` per path). `@fluxus/client` snapshots one
  set at connect per its `pages` mode.
- **`pages.publish`** `{ solutionId?, path, readme }` → `{ version }` /
  **`pages.versions`** `{ solutionId?, path }` / **`pages.getVersion`**
  `{ solutionId?, path, version }` → `{ def }` / **`pages.rollback`**
  `{ solutionId?, path, version }` → `{ version }` (M3, implementer `write`).
  Publish snapshots the current draft at `max(version)+1` with required
  release notes; `page_versions` is **append-only, immutable** — rollback
  republishes an older version's def as a new version (draft untouched),
  never a delete/edit. Diffing is a non-goal. **`pages.publishedPaths`**
  `{ solutionId? }` (implementer `read`) lists every published path unfiltered —
  the authoring plane (menu editor); Console preview is access-exempt (§6).
  **Page access (M4)**: published `pages.list` filters to versions the caller
  can open — `def.access.open` must list a held role (default deny when auth
  configured + solution declares roles; a shallow read of the opaque def, no
  PageDef dep). This upgrades RBAC_COMPACT's "client interim" for pages.

**Partition keys** (CONSOLE_RUNTIME_SPEC §1–2): the opaque `scope` split into
a **solution** (design artifact: SDM config + pages + role defs) and an
**operation** (runtime unit: record partition + users + runtime config, linked
to exactly one solution via `solution_id NOT NULL`). Config/pages key on
`solution_id`; records/`rpt_*` key on `operation_id`. A runtime call resolves
operation → solution to read the config while its data stays operation-
partitioned. The demo bundle keeps one id (`demo/sdm`) as **both** its solution
and its operation, so the rekey (migration `0003_operations_tier`) is a
data-preserving column rename plus a backfill of the single implicit
solution/operation. Single implicit org for MVP (column present, no org UI).

## Auth (RBAC phase 1, built 2026-07-19 — roles stubbed)

Design authority: root docs/RBAC_COMPACT.md (compressed from RBAC_DESIGN.md
rev 6 §0). What the server implements:

- **Transport**: `Authorization: Bearer <JWT>` on every tRPC call — never
  cookies; headless callers identical. Tokens are Neon Auth (Managed Better
  Auth) session JWTs: EdDSA, ~15-min expiry, verified against the cached JWKS
  at `${NEON_AUTH_URL}/.well-known/jwks.json` with issuer = the URL's origin
  (`jose` `createRemoteJWKSet` owns caching/rotation).
- **Placement**: per-request in `createApp`'s tRPC `createContext`
  (`src/app.ts`): parse header → verify → `context.user`
  `{ id, name, email, roles }`. One code path under Node/Lambda/Vercel (all
  pass headers through untouched). `/health` stays open.
- **Env-driven posture**: `NEON_AUTH_URL` (or `NEON_AUTH_BASE_URL`) unset ⇒
  `context.user` is the engine's demo stub and everything is open — dev/tests
  unchanged. Set ⇒ a valid session is **required**: missing/invalid token is
  UNAUTHORIZED for the whole call; no anonymous mode.
- **Roles-resolver seam** (`RolesResolver`, two lookups, both **live**):
  `runtimeRoles(user, operation) → roleIds` (`createDbRolesResolver` reads
  `role_assignments`) → `context.user.roles`, resolved per call before the
  engine exists (gates read it). `implementerLevel(user, solution)` (M5) reads
  `implementer_levels`, **dormant until declared** — no rows ⇒ `admin` for all
  (adoption); once any row exists an unlisted user is `none` (denied). Checked
  by `config.put`/`pages.*`/`publish`/`operations.*`/governance via
  `requireImplementer` (keyed on the solution; `write` for edits, `admin` for
  people/operations). `requireImplementer` is a **no-op when auth is
  unconfigured** (env stub open, §7).
- **Record-type read enforcement** (RBAC stage 1, RBAC_COMPACT): active only
  when auth is **configured** (`ctx.authConfigured`) AND the solution declares
  `access.roles`; otherwise everything reads open (env stub / adoption
  posture). When active it is **default deny** — a type is readable only if its
  `access.read` lists a role the caller holds. Applied by `records.*` and by
  the `activities.run` anchor check (unreadable anchor ⇒ not-found, *before*
  the run gate). Activity `run` itself is the engine's existing availability
  gate reading `context.user.roles`.
- **Author**: `runActivity` stamps the verified user id on each new history
  entry (`entry.author`, engine-side); the projection copies it to
  `rpt_activities.author` (`'demo'` for pre-auth entries and the stub).

## Data layers (v1: one Postgres, both hats)

- `solutions` — `(id)` PK: the design artifact (name only for MVP). `operations`
  — `(id)` PK, `solution_id` FK NOT NULL, `org_id` (default `default`), `config`
  jsonb (the runtime menu, §5). The tier the rest key off (CONSOLE_RUNTIME_SPEC §2).
- `role_assignments` — `(org_id, operation_id, user_id)` PK, `role_ids` jsonb:
  the runtime-plane governance store (§2a). `implementer_levels` —
  `(user_id, solution_id)` PK, `level`: the design-plane store (consumed at M5).
- `records` — `(operation_id, id)` PK, `custom_fields` + `activity_history` JSONB:
  the RecordInstance shape verbatim. SDM edits never touch physical schema.
- `pages` — `(solution_id, path)` PK, opaque `def` JSONB (backend stage 3): page
  definitions on the config pipeline, one row per page so the page builder
  saves a single page without touching the SDM config blob (the draft).
- `page_versions` — `(solution_id, path, version)` PK, `def` + `readme` +
  `published_by`/`published_at`: append-only published snapshots (M3). Runtime
  renders the latest per path; never edited or deleted.
- `rpt_activities` / `rpt_attributes` — the normalized projection (agreed
  2026-07-12): one activities row per run (author = the entry's user id;
  `demo` for pre-auth entries and the unconfigured stub); one attributes row
  per attribute, single text `value`; a waived
  attribute is the same row with `value` null + `waive_desc`; acknowledged
  gate warnings project as a `system_warnings` row; `system_log` arrives as
  an ordinary captured attribute. Plain-object entry values (composite
  attributes, nested attr → item → column) flatten to one row per leaf cell
  keyed by the dotted path (`prelim_activities.access_permission.ok`) — `'.'`
  is reserved in keys for this, so cell queries stay uniform on the single
  text `value` column (waived cells are dotted-key waive rows like any
  other). File/photo **descriptors** flatten the same way (one row per leaf:
  `before_photo.hash`); **multi** values (arrays) flatten with positional
  segments (`site_photos.0.hash`, `tags.0`) — the one projection extension in
  this build (ATTRIBUTE_TYPES_FILES_SCALARS §9), which also closed the same
  latent gap for multi-select lists. Rejected gates and un-acknowledged
  soft-stops leave no rows (no entry committed). Projection is synchronous
  in-transaction; the outbox/async upgrade replaces `writeBack`'s body, not
  its callers. Rebuild-by-re-projection is possible by construction (the
  entries live on the records) but no rebuild tool exists yet.
- `attachments` — the blob ledger (ATTRIBUTE_TYPES_FILES_SCALARS §8): one row
  per uploaded object (`storage_key`, `size`, `mime`, `hash`, photo metadata,
  `status: pending → committed`, `created_at`). Inserted `pending` at presign;
  `writeBack` flips every `storage_key` a new entry references to `committed`
  in the same transaction. It is **not the source of truth and nothing
  references its rows** — pipeline values stay by-value, so a GC bug can never
  corrupt history. It exists for the bucket-side questions the pipeline is bad
  at: the quota fuse (`SUM(size)`, no Cloudflare usage API), duplicate/
  integrity queries (same `hash`, EXIF geo/time off), and trivial deferred GC
  (stale `pending` rows). Rebuildable from a bucket listing + history.

DDL is drizzle-kit migrations (`migrations/`, generated from `schema.ts` via
`npm run db:generate`): `createDb()` applies outstanding migrations
idempotently at connect on both drivers (unless `applyMigrations: false` —
the Vercel entry, where the bundle ships without migrations/ on disk), and
`npm run db:migrate` runs the same step explicitly against `DATABASE_URL` —
the required pre-deploy step for schema changes. Driver selection
is the connection string: `DATABASE_URL` set → node-postgres (Neon/RDS/local),
unset → PGlite (dev/tests, no Postgres install needed); `packages/server/.env`
supplies it for local dev (loaded by the dev server and scripts, never by the
deployed entries — `api/index.ts` and `lambda.ts` read the real environment).
The node-postgres pool handles idle-client `'error'` events (logged, client
discarded and replaced on next query) — Neon reaps idle connections
server-side, and an unhandled error event would crash the process.

## Services

The server registers `notify` (manifest identical to the workbench's — script
portability across hosts is the Phase 3 doctrine) and the engine's shared
`geo`. The notify sink is pluggable (`NotifySink`) and defaults to the
process log: real delivery/storage is deliberately deferred to the open
unified-log/notification design — no notifications table was added (One
Pipeline Invariant).

## Blob storage (R2)

`src/services/blob.ts` is the only module that touches the S3 client — the
provider never leaks past it. One **private** bucket per environment (mirrors
the Neon dev/prod split); all access is short-TTL presigned URLs, no public
URLs. Keys are `<yyyy>/<mm>/<uuid>/<sanitised-name>`, thumbnails
`…/<uuid>/thumb.jpg`. Env vars: `FLUXUS_R2_ACCOUNT_ID`,
`FLUXUS_R2_ACCESS_KEY_ID`, `FLUXUS_R2_SECRET_ACCESS_KEY`, `FLUXUS_R2_BUCKET`
(per environment; see docs/DEPLOYMENT.md). Missing any of them → the store is
`configured: false` and `files.*` answer a clean error, so the platform builds
and runs against the seam before R2 is provisioned. The client (`@aws-sdk/*`)
speaks the genuine S3 API, so the code is byte-portable to AWS S3 / Backblaze
B2. Cost enforcement is ours (R2 has no hard spend cap): the per-file platform
ceiling and per-attribute `max_size_mb`/`accept` at presign, the environment
fuse (ledger `SUM(size)`), and a Cloudflare billing notification as backstop.
Read ops (thumb fetches) are unreachable at POC scale against the free tier.

## Config distribution (interim)

`scripts/seed.ts` imports the sdm workbench's demo config and stores it via
`putConfig`. That cross-package import is dev tooling only — the server
runtime never depends on a peer host. Config distribution proper (authoring
against a running server) stays an open thread on the root ROADMAP.

## Known gaps (deliberate)

- Auth built (2026-07-19) but roles stubbed: `context.user.roles` is `[]` and
  the implementer plane is open until RBAC stages 1–2 fill the resolver seam;
  record-type read filtering and page `open` checks are not yet enforced.
- GET activities (DSL_SPEC §5a) not implemented — blocked on the unified-log
  design for their logging posture; `records.*` covers data needs meanwhile.
- Lambda entry unexercised by design — it is the raw-AWS exit path, kept
  compiling; the deploy target is Vercel (`api/index.ts`, docs/DEPLOYMENT.md).
- Multi-value (`selection: multi`) datasource membership validates array
  values element-wise but the capture form doesn't produce them yet.
