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
src/db/schema.ts       — Drizzle schema: orgs + solutions + operations (the tier,
                         CONSOLE_RUNTIME_SPEC §2), user_roles +
                         sol_users (governance store, §2a),
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
                         orgs + solutions + operations helpers (ensure/list/
                         create/getOrg/putOrgProfile/getOperation/
                         putOperationConfig/seedOperationRecords)
src/router.ts          — the tRPC router: orgs.get/putProfile,
                         solutions.list/create/update/delete,
                         operations.list/get/create/putConfig, config.get/put,
                         pages.*, records.*, activities.run, files.*;
                         DEFAULT_ORG/DEFAULT_SOLUTION/DEFAULT_OPERATION
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

- **`orgs.get`** `{ orgId? }` → the org profile (unknown id ⇒ a synthetic row,
  so an un-onboarded workspace renders rather than errors) / **`orgs.putProfile`**
  `{ orgId?, name, contactEmail }` — name and contact email only. There is
  deliberately **no `orgs.create`** (signup needs user → org resolution) and
  `plan`/`status` are not writable: they are ours to set, not the org's.
- **`solutions.list`** → `{ id, name, origin }[]` / **`solutions.create`**
  `{ id, name }` (ungated — nothing exists to grant a level on yet) /
  **`solutions.update`** `{ solutionId, name }` (**org admin** since 2026-08-02) —
  **name only**: the id is permanent, since config, pages, versions, sol users
  and every operation are keyed on it. Called `update`, not `rename`,
  because the profile will grow. / **`solutions.delete`** `{ solutionId }`
  (**org admin** since 2026-08-02) — **wired but not implemented**: it validates the
  solution exists and then throws `NotImplementedError` → `NOT_IMPLEMENTED`,
  destroying nothing. The ruling it waits on is a **cascade** (2026-07-31:
  deleting a solution deletes the operations running it, records included), and
  `host.deleteSolution` carries the TODO listing every table that has to go and
  the two open questions (R2 blobs, whether a deletion is recorded).
- **`operations.list`** →
  `OperationRow[]` / **`operations.get`** `{ operationId? }` →
  `{ id, orgId, solutionId, name, config, solutionName, orgName }` (the display
  names ride along for the Runtime header's identity line — solution M10, org
  M13; both fall back to their id so a missing row can't break boot)
  / **`operations.create`**
  `{ id, solutionId, name }` (**org admin**) / **`operations.putConfig`**
  `{ operationId?, config }` (**op admin** since 2026-08-02; the runtime menu **override**,
  §5 amended M10 — `menu` absent ⇒ inherit the solution's `default_menu`, `[]` ⇒
  explicitly empty; **validated at save**: every leaf `page` resolves to a
  published page of the linked solution, every role id is declared, one nesting
  level max).
  Plain auth-tier CRUD — no SDM, no activities. `operations.get` is the
  Runtime's resolution door: `@fluxus/client.connect(operationId)` calls it
  first, then loads config + pages by the returned `solutionId`.
- **`me`** `{ operationId? }` → `{ id, name, email, roles, authConfigured }` —
  the caller's identity + roles resolved for the operation. The Runtime host
  uses it for **cosmetic** menu filtering; the server filters are the real gate.
- **Governance (RBAC stage 1)** — over the `user_roles` /
  `sol_users` store. Re-tiered 2026-08-02: `userRoles.*` are now
  **op-admin** gated and `solUsers.*` **org-admin** gated (see *The admin
  tiers* below); `userRoles.roles` stays open, exposing only role defs.
  **`userRoles.roles`**
  `{ operationId? }` → the linked solution's declared role defs (the picker);
  **`userRoles.list`** `{ operationId? }` / **`userRoles.put`**
  `{ operationId?, userId, roleIds }` (empty roleIds clears the row);
  **`solUsers.list`** `{ solutionId? }` / **`solUsers.put`**
  `{ solutionId?, email, level }` — **keyed on email since 2026-08-02**
  (migration 0012), and both **org-admin** gated. `level: 'admin'` here *is* the
  solution-admin tier; there is deliberately no separate solution-users table.
- **Users (2026-08-02)** — the org pool and each operation's user list:
  **`users.listOrg`** `{ orgId? }` / **`users.invite`**
  `{ email, name?, level?, orgId? }` / **`users.removeOrg`** `{ email, orgId? }`
  / **`users.setStatus`** `{ email, status, orgId? }` / **`users.setOrgLevel`**
  `{ email, level, orgId? }`; **`users.listOp`** `{ operationId? }` /
  **`users.addOp`** `{ operationId?, email, level? }` / **`users.removeOp`**
  `{ operationId?, email }`. `addOp` refuses an email that is not in the pool —
  the pool is the only way in, so `op_users` can never be the wider set.
  `removeOp` clears that user's role assignments in the operation; `removeOrg`
  removes them from every operation **and strips their sol users**, so
  no grant outlives the pool row that justified it (the second only became
  reachable with the email rekey).
- **The admin tiers (2026-08-02)** — three checks in `router.ts`, one per tier,
  deliberately **not nested**: `requireOrgAdmin` (`org_users.level`),
  `requireOpAdmin` (`op_users.level`, per operation) and `requireSolUser`
  (`sol_users`, per solution). Authority has one root and flows
  **downward only**; no tier appoints its own tier. The governing split is
  **identity vs authorization**:

  | Procedure | Tier | Was |
  |---|---|---|
  | `users.listOrg` / `invite` / `removeOrg` / `setStatus` / `setOrgLevel` | org admin | ungated |
  | `solutions.create`, `operations.create` | org admin | design plane `admin` |
  | `solUsers.list` / `solUsers.put` | org admin | design plane `admin` |
  | `users.addOp` (level `user`) | op admin **or** org admin | design plane `admin` |
  | `users.addOp` (level `admin`) | org admin only | — |
  | `users.removeOp` | op admin | design plane `admin` |
  | `userRoles.list` / `userRoles.put` | op admin | design plane `admin` |
  | `operations.putConfig` (menu override) | op admin | design plane `write` |
  | `config.put`, `pages.*`, `publish` | sol user | unchanged |

  **Solution admins lose every user-facing grant** — including
  `solUsers.list`, which since the rekey carries real emails. A person
  building the model has no business over real identities.

  An **org admin is not implicitly an op admin**: they may not manage roles or
  the menu override until they appoint themselves op admin. A speed bump, not a
  wall — the point is that the grant becomes explicit and auditable rather than
  ambient. Suspension bites both tiers: a suspended pool row is not an admin
  anywhere.

  **The escalation rule lives in exactly one place** — `users.addOp` branches on
  the `level` being written. Writing `user` needs op admin or org admin (entry
  is an identity question, so either tier may answer it); writing `admin` needs
  org admin. **An op admin can never mint an op admin.**
- **Bootstrap** — `bootstrapOrgAdmin(db, { email })`, exposed as
  `npm run bootstrap` and called by `npm run seed` when
  `FLUXUS_ORG_ADMIN_EMAIL` is set. No signup plus a strict entry gate means the
  chain cannot start itself: after migration 0010, an operation admits nobody,
  including the Console, which reaches an operation through the same gate as the
  Runtime — so nobody can open the screen that would invite the first person.
  Something outside the request path has to write the first row. **Deliberately
  a script and not a migration**: it needs an env var (plain SQL cannot read
  one), and it must be **re-runnable**, because it is also the lockout recovery
  tool and a lockout you can only fix by writing another migration is not a fix.
  Two rules make re-runs safe — the pool row is upserted to org admin
  (promotion is the point), but op-admin rows are written **only** into
  operations that currently have no users at all. It is safe against production
  precisely because it is separate from `seed`, which installs the demo bundle.

  **Superseded for every org but the first (2026-08-03)**: `platform.registerOrg`
  now writes an org and its owner in one act inside the request path, so the
  script's job shrinks to what it should always have been — lockout recovery,
  and the very first admin on a fresh deployment. See "The platform tier" below.
- **The platform tier** — above every org (ruled 2026-08-03), and the only
  caller that may read across orgs or create one. `requirePlatformAdmin` guards
  `platform.listOrgs` and `platform.registerOrg`; membership is
  `isPlatformAdmin(email)` in `auth.ts`, an **env allowlist**
  (`FLUXUS_PLATFORM_ADMINS`) rather than a table — a `platform_users` table
  recreates one tier up exactly the chicken-and-egg the bootstrap script exists
  to escape, and the env is already outside the request path, which is the only
  property the first row of any tier needs.

  **This gate alone does not fall open when auth is unconfigured.** Every other
  check here is open in demo posture, on the reasoning that with no identity
  there is nothing to gate on — but those guard one org's data from that org's
  own people. This one guards every org from everyone, and an unconfigured dev
  machine must not be one where anyone who can reach the port registers orgs.

  `registerOrg` writes the `orgs` row (with `contact_email` = the owner) and the
  owner's `org_users` admin row **in one act**, because after the first alone the
  org admits nobody — including whoever would perform the second. The owner is
  **not a new level**: they are the org's first org admin, and a distinct
  `owner` value would need transfer and demotion rules nothing needs yet.
  Duplicate id ⇒ `CONFLICT`; ids are `^[a-z0-9][a-z0-9-]*$` because the id **is**
  the URL (`/o/<orgId>/…`). Nothing is emailed — an invite is a database row
  until a mail sender exists.
- **`org_id` as a boundary** (2026-08-03) — registering a second org made the
  org key load-bearing and exposed two things that had been invisible while
  `'default'` was the only org. `createOperation` never set `org_id`, so every
  operation landed in `'default'` whatever its solution belonged to; an operation
  now **inherits its solution's org** (the link is binding and permanent, so a
  mismatch could never be corrected). And six `requireOrgAdmin(ctx)` call sites
  defaulted to `'default'`, so an admin of the default org could create, rename,
  delete and staff solutions in anyone's workspace while the real owner was
  refused; each now names the org being written to, resolved via
  `getSolutionOrg` where the input does not carry it.
- **The entry gate** — `resolveUser` is the one choke point every
  operation-scoped call passes through, so the op-user check lives there.
  **Strict, not dormant** (ruled 2026-08-02): an operation with no `op_users`
  admits nobody — `FORBIDDEN`. Deliberately unlike the record-type/page/
  sol-user surfaces, which are dormant-until-declared: those ask *what may
  you see*, where an unconfigured model staying visible is a reasonable adoption
  default; this asks *may you enter*, and an operation with no users listed has
  literally no users. An empty list is an answer, not an absence of one. The
  demo posture (auth unconfigured) is still open — with no identity to check
  there is nothing to gate on. Entry and roles stay independent — an op
  user with no roles enters and sees nothing (valid), and roles without an
  `op_users` row never grant entry. There is **no design-plane bypass**: the
  sol-user resolver is dormant-open today, so a bypass would make the gate a
  no-op — someone who builds the solution adds themselves like anyone else.
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
  literal. `put` rejects on structural danglers (MemoryAdapter resolution),
  any error-severity `validateConfig` finding, or (2026-07-26) a record-type
  id that stored records still reference — the config must survive the data it
  already governs: mutation is activity-only, so orphaned `typeRef`s would be
  unreachable forever. Config is solution-plane and owns no records;
  demo-record seeding moved to `seedOperationRecords` (called against an
  operation by the seed script), not `config.put`. Since M10 the artifact may
  carry a top-level **`default_menu`** (§5 amended — the solution's default
  runtime navigation, inherited by operations unless overridden): the engine
  stays menu-blind, so `put` validates it here — §5 shape, published-page +
  declared-role references (roles read from the **incoming** config via
  `validateOperationMenu`'s `rolesFrom` param), one nesting level.
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
  `{ solutionId?, path, version }` → `{ version }` (M3, sol-user `write`).
  Publish snapshots the current draft at `max(version)+1` with required
  release notes; `page_versions` is **append-only, immutable** — rollback
  republishes an older version's def as a new version (draft untouched),
  never a delete/edit. Diffing is a non-goal. **`pages.publishedPaths`**
  `{ solutionId? }` (sol-user `read`) lists every published path unfiltered —
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
  `user_roles`) → `context.user.roles`, resolved per call before the
  engine exists (gates read it). `solUserLevel(email, solution)` (M5) reads
  `sol_users`, **dormant until declared** — no rows ⇒ `admin` for all
  (adoption); once any row exists an unlisted user is `none` (denied). Keyed on
  **email** since 2026-08-02, so a caller with no email is `none` once levels
  exist. Checked by `config.put`/`pages.*`/`publish`/`solutions.update|delete`
  via `requireSolUser` (keyed on the solution; `write` for edits, `admin`
  for the solution profile). Operations, users and assignments left this check
  when the admin tiers landed. `requireSolUser` is a **no-op when auth is
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

- `orgs` — `(id)` PK: the tenant (M13 `name`, M14 profile). `operations.org_id`
  / `user_roles.org_id` have carried an org key since M1 with nowhere to
  read a row from; this is that row. `contact_email`, `plan` (subscribed tier,
  default `'free'`), `status` (default `'active'`), `created_at` = the
  registration date. Migrations `0008_orgs` / `0009_org_profile`; one implicit
  `'default'` row, and **no signup path** — creating an org needs the auth tier
  to resolve user → org, which it does not do.
- `solutions` — `(id)` PK: the design artifact — `name`, plus provenance (M12):
  `origin` (`'authored'` default | `'installed'`, the packaging seam) and
  `origin_ref` (opaque catalogue lineage, null for authored). `operations`
  — `(id)` PK, `solution_id` FK NOT NULL, `org_id` (default `default`), `config`
  jsonb (the runtime menu **override**, §5 amended M10). The tier the rest key
  off (CONSOLE_RUNTIME_SPEC §2).
- `solutions.org_id` (2026-08-02, migration 0014) — which org's workspace a
  solution lives in; the last table to carry the org key. **Scoping, not
  identity**: two orgs installing the same solution have different `org_id` and
  the same package. The PK stays `id` alone — solution ids are **globally
  unique**, which is the right posture for a distributable package and means no
  foreign or composite key had to change.
- `user_roles` — `(org_id, operation_id, email)` PK, `role_ids` jsonb:
  the runtime-plane governance store (§2a). Renamed from `role_assignments` and
  rekeyed `user_id` → `email` 2026-08-02 (migration 0015) — the last table on
  the auth provider's id. Not a membership layer: an attribute of being an op
  user. The rekey fixed two things: roles could not be granted before first
  sign-in, and `removeOpUser` (which clears by email) was clearing nothing. `sol_users` —
  `(email, solution_id)` PK, `level`: the design-plane layer of the three
  (org_users → sol_users → op_users), consumed at M5. Renamed from
  `implementer_levels` 2026-08-02 (migration 0013) so one word serves each
  layer; `level` collapsed to **read | write** in the same migration, because
  once the admin tiers took over, `admin` here guarded only
  `solutions.update`/`delete` — both org-admin work. No `org_id` column, unlike
  its two siblings: solution ids are globally unique, so the org is derivable
  through `solutions`. Rekeyed from `user_id` to `email` 2026-08-02 (0012) — a solution admin is appointed from
  the org pool, whose users typically have not signed in yet, so keying on the
  auth id made invite-first appointment impossible. The backfill joins through
  `org_users.auth_user_id` and drops rows that do not resolve; levels are
  dormant-until-declared, so an empty table was the expected prior state.
  Note `user_roles.user_id` was **not** rekeyed — see the open item below.
- `org_users` — `(org_id, email)` PK, `name`, `auth_user_id`, `status`
  (`invited`/`active`/`suspended`), `level` (`admin`/`user`): the organisation's
  user pool, and where the **org admin** tier is stored. `op_users` —
  `(org_id, operation_id, email)` PK, `level` (`admin`/`user`): who may enter an
  operation, and where the **op admin** tier is stored. Added 2026-08-02
  (RBAC_COMPACT "Users"); `level` columns in migration 0011. There is no
  solution-users table — a **solution admin** is `sol_users.level =
  'admin'`, which already existed. **Email is the key, not the auth id** — an
  invited user has no auth id until first sign-in, so both tables key on email
  and `createContext` binds `auth_user_id` (and flips `invited` → `active`) on
  the first authenticated request. The bind statement carries
  `auth_user_id IS NULL`, so it is self-disarming: an indexed no-op after the
  first request, and an email that was never invited matches nothing — showing
  up authenticated does not make you an org user. There is **no signup**; entry is
  invite-only, pending a company user-directory integration long term.
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

**Solution history** (M9, ruled 2026-07-26): the database is the source of
truth for a solution, so its change record lives beside it — `page_versions`
for pages (M3) and `sdm_config_versions` for the model. Both append-only with
required release notes; rollback republishes rather than deleting. One
difference: `rollbackConfig` also restores the older config **as the draft**,
because the config draft is what every host evaluates against, whereas a page
draft is the builder's working copy. The repo files the seed script reads are a
bootstrap fixture for an empty database, never authority — `npm run seed` is
skip-if-present (`--force` overwrites from the files on purpose).

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

- ~~`user_roles.user_id` is still keyed on the auth user id~~ — **closed by
  migration 0015** (2026-08-02), which renamed `role_assignments` → `user_roles`
  and rekeyed it to email. All four tables are email-keyed, roles can be granted
  to an invited user before first sign-in, and `removeOpUser` actually clears
  their grants. (This entry stayed stale for two days; noted 2026-08-04.)
- Auth built (2026-07-19) but roles stubbed: `context.user.roles` is `[]` and
  the design plane is open until RBAC stages 1–2 fill the resolver seam;
  record-type read filtering and page `open` checks are not yet enforced.
- GET activities (DSL_SPEC §5a) not implemented — blocked on the unified-log
  design for their logging posture; `records.*` covers data needs meanwhile.
- Lambda entry unexercised by design — it is the raw-AWS exit path, kept
  compiling; the deploy target is Vercel (`api/index.ts`, docs/DEPLOYMENT.md).
- Multi-value (`selection: multi`) datasource membership validates array
  values element-wise but the capture form doesn't produce them yet.
