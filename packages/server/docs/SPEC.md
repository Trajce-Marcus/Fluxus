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
                         sol_admins (governance store, §2a),
                         sdm_attributes/_workflows/_record_types/_functions/
                         _roles/_menus (the model, one table per collection —
                         the ONLY copy since 0020 dropped the derived
                         sdm_configs snapshot), pages (solution-keyed),
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
                         load) / writeBack (diff + projection) / putConfig +
                         the per-entity model writes (configCollections,
                         putConfigEntity/deleteConfigEntity/putDefaultMenu);
                         orgs + solutions + operations helpers (ensure/list/
                         create/getOrg/putOrgProfile/getOperation/
                         putOperationConfig)
scripts/retire-id-field.ts
                       — one-off, 2026-09-18: drops `id_field` from every stored
                         record type (every record now gets an issued UUIDv7).
                         Idempotent, `--dry`. Ran against `projects` (3 types)
                         on 2026-09-18 and `demo/sdm` (10) on 2026-09-21; every
                         stored solution is now off natural keys. The delay was
                         instructive: a config write validates the WHOLE graph,
                         so two dead items in `demo/sdm`'s default menu — labels
                         with no page and no children, unrelated to identity —
                         refused every write to that solution until they were
                         removed in the Console
src/projection.ts      — the client projection: computeReadable (the record-type
                         read filter, shared by the data and model cuts) and
                         projectConfig (the stored model → the browser's copy).
                         The ONE place that decides what leaves the server.
                         Its per-field whitelists are locked to the model types
                         by three tests (2026-09-18) — a field added to a usage
                         wrapper, a type config or a pool attribute and not
                         named here fails the build rather than going missing in
                         the browser, which is how `source` and `field` were
                         both lost for three days
src/router.ts          — the tRPC router: orgs.get/putProfile,
                         solutions.list/create/update/delete,
                         operations.list/get/create/putConfig,
                         config.get/getForOperation/put
                         + the per-entity model writes (putAttribute…
                         putDefaultMenu), pages.*, records.*, activities.run,
                         files.*;
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
scripts/bootstrap.ts   — the only script that writes: promotes the first org
                         admin into an existing org (lockout recovery)
scripts/migrate.ts     — applies drizzle-kit migrations against DATABASE_URL
```

## The API surface

tRPC procedures — functions by name, no GET/POST design (agreed stack,
ARCHITECTURE.md "Hosting options"). Two partition keys after the operations
tier (CONSOLE_RUNTIME_SPEC §1–2): design artifacts take `solutionId?`, data
takes `operationId?` (both default `demo/sdm`):

- **`orgs.get`** `{ orgId? }` → the org profile (unknown id ⇒ a synthetic row,
  so an un-onboarded workspace renders rather than errors) / **`orgs.putProfile`**
  `{ orgId?, name }` — **the name only**. `owner_email` is deliberately not
  writable here: changing it is ownership transfer, and this is org-admin work,
  so an org admin who could write it would promote themselves to the root that
  appoints org admins. There is
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
- **Governance (RBAC stage 1)** — over the `user_roles` / `sol_admins` store.
  **`userRoles.roles`** `{ operationId? }` → the linked solution's declared role
  defs (the picker; open, exposes no user data); **`userRoles.list`**
  `{ operationId? }` / **`userRoles.put`** `{ operationId?, email, roleIds }`
  (empty roleIds clears the row) — both **op-admin** gated, and an org admin is
  refused deliberately.
- **Users, admins and roles (rewritten 2026-08-04)** — one router per list, each
  governed by one tier. The whole surface is `src/routers/users.ts`; the store is
  `src/users/`; the checks are `src/gates.ts`.

  | Router | Procedures | Tier |
  |---|---|---|
  | `users` | `list` `{orgId?}`, `invite` `{email,name?,operationId?,orgId?}`, `setStatus` `{email,status,orgId?}`, `expire` `{email,orgId?}`, `unexpire` | org admin; `invite` also owner or op admin of the named operation |
  | `orgAdmins` | `list`, `owner`, `appoint` `{email}`, `remove` `{email}` | list = org admin **or owner**; **appoint/remove = owner only** |
  | `solAdmins` | `list` `{solutionId}`, `listByOrg` `{orgId?}`, `appoint` `{solutionId,email}`, `remove` | org admin, including the read |
  | `opAdmins` | `list` `{operationId}`, `listBySolution` `{solutionId}`, `appoint`, `remove` | appoint/remove = org admin; `list` = op **or** org admin |
  | `opUsers` | `list` `{operationId}`, `add` `{operationId,email}`, `remove` | `list`/`add` = op **or** org admin; `remove` = op admin |

  **Invite grants nothing anywhere** — it adds a row to `users` and stops. Every
  appointment is a separate call on the list it belongs to. Appointment refuses
  an email that is not in the pool: invite, then appoint, enforced in the store
  rather than assumed by the UI.

  `opUsers.remove` clears that person's roles in the operation; `users.expire`
  drops every grant at every tier, so nothing outlives the relationship that
  justified it — but **keeps the person row**, always (see *Lifecycle* below).
- **The tiers (rewritten 2026-08-04)** — five checks in `src/gates.ts`, one per
  tier, deliberately **not nested**: `requireOrgOwner` (`orgs.owner_email`),
  `requireOrgAdmin` (`org_admins`), `requireOpAdmin` (`op_admins`, per
  operation), `requireSolAdmin` (`sol_admins`, per solution) and `requireOpUser`
  (entry — `op_users` OR `op_admins`, since an admin row implies entry).
  Authority has one root — the **owner** — and flows **downward only**; no tier
  appoints its own tier. The governing split is **identity vs authorization**:

  | Procedure | Tier |
  |---|---|
  | `users.*` (lifecycle), `solutions.create`, `operations.create` | org admin |
  | `orgAdmins.appoint` / `remove` | **owner only** |
  | `solAdmins.*`, `opAdmins.appoint` / `remove` | org admin |
  | `opUsers.add` | op admin **or** org admin |
  | `opUsers.remove`, `userRoles.*`, `operations.putConfig` | op admin |
  | `config.put`, the per-entity model writes, `pages.*`, `publish` | sol admin |

  **Sol admins have no user-facing grant at all** — including `solAdmins.list`,
  which carries real emails. A person building the model has no business over
  real identities.

  An **org admin is not implicitly an op admin**: they may not manage roles or
  the menu override until they appoint themselves one. A speed bump, not a wall
  — the point is that the grant becomes explicit and auditable rather than
  ambient. **The owner is not implicitly an org admin** for the same reason.

  The one read that crosses (2026-08-09): **`orgAdmins.list` answers the owner as
  well as an org admin**. The owner is that list's sole editor and deliberately
  not an admin, so gating the read on `org_admins` alone locked them out of the
  only list they govern — and a list a caller may not read renders as an empty
  one, which is a lie about who administers the organisation. It stays a read:
  `users.list` and the rest of the org tier remain the admin's. Same shape as
  `opAdmins.list`/`opUsers.list` answering either tier, and like those it is a
  local helper in the router, not a sixth gate.

  **Suspension bites every tier**: each `is*Admin` re-reads the pool row, so a
  suspended person is no admin anywhere while their grants survive intact for
  reinstatement.

  **Lifecycle, and why there is no delete** (migration 0017) — `suspended` is a
  reversible pause that keeps every grant; **`expired`** is terminal and drops
  them all, stamping `expired_at`. Neither deletes the row, and nothing else
  does either. Deleting a person deleted nothing they had *done* — record
  history, `rpt_activities` and the publish trails are append-only and carry no
  foreign keys — but it deleted the only row that could say who they *were*:
  `author` is an auth id, and `users.auth_user_id` is the only bridge from that
  id to a name. Expiry **replaced** removal rather than joining it. `bindAuthUser`
  will not resurrect an expired row, and `setUserStatus` refuses `expired` —
  dropping grants is not something a status write may do silently.

  `hasConsoleAccess` derives "may open the Console" — owner, org admin, or sol
  admin of anything. Never a stored flag. The owner's derivation is what makes
  the first appointment reachable on a fresh org, where nobody holds a grant.
- **Bootstrap** — `bootstrapOrgAdmin(db, { email })`, exposed as
  `npm run bootstrap`. No signup plus a strict entry gate means the
  chain cannot start itself: after migration 0010, an operation admits nobody,
  including the Console, which reaches an operation through the same gate as the
  Runtime — so nobody can open the screen that would invite the first person.
  Something outside the request path has to write the first row. **Deliberately
  a script and not a migration**: it needs an env var (plain SQL cannot read
  one), and it must be **re-runnable**, because it is also the lockout recovery
  tool and a lockout you can only fix by writing another migration is not a fix.
  Three rules make re-runs safe — the pool row and the `org_admins` appointment
  are upserted (promotion is the point); ownership is claimed **only** if the org
  has none (transfer is a deliberate act, never a side effect); and `op_admins` /
  `sol_admins` rows are written **only** where nobody administers that operation
  or solution yet. It is safe against production because that is all it writes:
  since 2026-08-05 it is the **only** script that writes anything, and it
  installs no content. It also **requires the org to exist** — recovery promotes
  someone inside a tenancy, it never invents one, so on an empty database
  `platform.registerOrg` comes first.

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

  `registerOrg` writes three things **in one act**: the `orgs` row, its
  `owner_email` (the root of authority), and the owner's `users` row — the
  organisation's **first user**. Nobody invites the owner, because there is
  nobody there to do it, so the act that creates the org creates the person
  (2026-08-04). They are deliberately **not** appointed an org admin: they
  appoint org admins, and appoint themselves one if they mean to do ordinary
  org-admin work. Console access is derived from ownership, which is what makes
  that first appointment reachable.
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
  acknowledgedWarnings? }` → `RunActivityResult`. There is no free-form side
  channel: the `callbackData: z.unknown()` input was **removed 2026-08-09**
  (DATA_THROUGH_ACTIVITIES §4) — every value a run carries arrives as a
  declared attribute and goes through `validateSubmission`. The headless
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
  `acknowledgedWarnings`. A GET is refused here — it has its own door.
- **`activities.query`** `{ operationId?, activityId, recordId?, attributes }`
  → `QueryActivityResult` — the read path (DSL_SPEC §5a, built 2026-08-09). A
  tRPC **query, not a mutation**: no record data changes and there is no
  confirmation round-trip. It does write one thing — the light entry the engine
  records on the anchor (step 3, 2026-08-11) — so it write-backs like a run
  does, including on the way out of a failure, because the read happened either
  way. The app names a GET activity
  and the model answers; the query itself never reaches the browser (`returns`
  lives on the server grade of the model and `projectConfig` cannot copy it).
  The parameters are the activity's attributes and go through the same
  `validateSubmission`. `recordId` is optional and, when given, is read-gated
  like any anchor (unreadable ⇒ not-found). Authorisation is the activity's own
  `show_condition`, with no second filter over the answer — see the engine SPEC
  for why. **Logged light** on the anchor when one is given: parameters,
  caller, outcome, duration, never the answer; anchorless reads leave no trace.
- **`files.presignUpload`** `{ solutionId?, attributeKey, name, mime, size, hash?,
  photo metadata? }` → `{ storageKey, uploadUrl, thumbKey?, thumbUploadUrl? }`
  / **`files.presignGet`** `{ solutionId?, key }` → `{ url }` — the blob upload/read
  door (ATTRIBUTE_TYPES_FILES_SCALARS §6). Bytes never transit the server: the
  browser PUTs straight to R2 with the returned URL. `presignUpload` is the
  cost chokepoint (§7), enforced BEFORE any bytes move: the attribute must be
  an **upload** type (`isUploadType` — photo/file; it was "has a descriptor"
  until `geopoint` became a descriptor bag that is not a file, 2026-09-22), the
  platform per-file
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
- **`config.get` / `config.put`** `{ solutionId?, config }` — the **design
  plane's** door: the whole model, hooks and access rules included, because
  authoring them is the job. Since 2026-08-09 `get` requires **sol admin** like
  `put` — reading a model and writing it are the same privilege in a one-grade
  world (see "What the client is given" below). The Phase 4 shift:
  the SDM config is a stored artifact and "config-save-time validation" is
  literal. `put` rejects on structural danglers (MemoryAdapter resolution),
  any error-severity `validateConfig` finding, or (2026-07-26) a record-type
  id that stored records still reference — the config must survive the data it
  already governs: mutation is activity-only, so orphaned `typeRef`s would be
  unreachable forever. Config is solution-plane and owns no records, and since
  2026-08-05 nothing else puts records in an operation either (see "Nothing is
  prepopulated" below). Since M10 the artifact may
  carry a top-level **`default_menu`** (§5 amended — the solution's default
  runtime navigation, inherited by operations unless overridden): the engine
  stays menu-blind, so `put` validates it here — §5 shape, published-page +
  declared-role references (roles read from the **incoming** config via
  `validateOperationMenu`'s `rolesFrom` param), one nesting level — and, since
  2026-08-20, **every item must open a page or be a group**. A label with
  neither is a dead entry: it renders, clicking it does nothing, and its mere
  presence hides the Pages list the Runtime app falls back to when an operation
  has no menu — which is how three such items in the demo operation made its
  published pages unreachable. A group is any item carrying an `items` key,
  **empty included**: the Console makes a group first and fills it by dragging
  items in, and an empty one never renders (`visibleMenu` drops a group with no
  visible child). The Console's two save paths used to prune empty `items[]`
  into a bare label, which this rule then refused — they stopped.
  Since 2026-08-08 `put` is the **import** path, not the editing path: the
  Console saves one entity at a time through the eleven per-entity mutations
  (`config.putAttribute` … `config.putDefaultMenu`), which run this same
  validation under a per-solution lock. See "Model storage: the SDM config as
  tables".
- **`config.getForOperation`** `{ operationId? }` → `ClientSolutionConfig` — the
  **runtime plane's** door (BUILT 2026-08-09): the model trimmed to what this
  caller may see. Keyed on the operation, not the solution, because what
  survives is decided by the caller's roles *in that operation*; entry
  (`requireOpUser`) is checked before anything is trimmed.
  `FluxusClient.connect` uses this; `connectSolution` (Console) uses
  `config.get`. See "What the client is given" below.
- **`pages.list` / `pages.put` / `pages.delete`** `{ solutionId?, path, def }`
  (backend stage 3, 2026-07-16) — page definitions on the config pipeline.
  Defs are **opaque jsonb**: `PageDef` and `validatePage` live in the page
  builder, and the server never depends on a peer host, so unlike `config.put`
  there is no save-time validation here. `put` is an unconditional upsert, and
  the only caller is the Console: pages are authored artifacts, and no repo file
  installs one (the "deploying pages = deploying files" posture and the demo
  page file both went on 2026-08-05). `list` `{ solutionId?, published? }`
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
  engine exists (gates read it). `isSolAdmin(email, solution)` (M5) reads
  `sol_admins` — **strict**: you build a solution only if you are appointed to
  it. One grade, so one boolean (2026-08-04); the `read`/`write` split bought
  nothing once appointment moved onto the admin tiers. Keyed on **email**, so a
  caller with no email can never match. Checked by
  `config.put`, the per-entity model writes, `pages.*` and `publish` via `requireSolAdmin`;
  `solutions.update|delete`, operations, users and roles left this check when the
  admin tiers landed. `requireSolAdmin` is a **no-op when auth is unconfigured**
  (env stub open, §7).
- **Record-type read enforcement** (RBAC stage 1, RBAC_COMPACT): active only
  when auth is **configured** (`ctx.authConfigured`) AND the solution declares
  `access.roles`; otherwise everything reads open (env stub / adoption
  posture). When active it is **default deny** — a type is readable only if its
  `access.read` lists a role the caller holds. Applied by `records.*`, by
  the `activities.run` anchor check (unreadable anchor ⇒ not-found, *before*
  the run gate), and since 2026-08-09 by `projectConfig` — one answer
  (`computeReadable`, `src/projection.ts`) governing both halves of a snapshot,
  the data and the model. Activity `run` itself is the engine's existing
  availability gate reading `context.user.roles`.
- **Author**: `runActivity` stamps the verified user id on each new history
  entry (`entry.author`, engine-side); the projection copies it to
  `rpt_activities.author` (`'demo'` for pre-auth entries and the stub).

## Data layers (v1: one Postgres, both hats)

- `orgs` — `(id)` PK: the tenant (M13 `name`, M14 profile). `operations.org_id`
  / `user_roles.org_id` have carried an org key since M1 with nowhere to
  read a row from; this is that row. `owner_email` (the root of authority, and the org's contact address — a
  separate `contact_email` was dropped by migration 0018, having been born
  identical to it and read by nothing), `plan` (subscribed tier, default
  `'free'`), `status` (default `'active'`), `created_at` = the registration
  date. Migrations `0008_orgs` / `0009_org_profile` / `0018_org_owner_email`; one implicit
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
  sign-in, and `removeOpUser` (which clears by email) was clearing nothing.
- **The user tables (rewritten 2026-08-04, migration 0016)** — one population,
  then grants, with **no `level` column anywhere**. Every grant table is keyed
  `(target, person)`: the row *is* the appointment.

  | Table | PK | Question |
  |---|---|---|
  | `users` | `(org_id, email)` | Who is this person? Plus `name`, `auth_user_id`, `status` (`invited`/`active`/`suspended`/`expired`), `invited_at`, `expired_at`. |
  | `org_admins` | `(org_id, email)` | Who administers the organisation? |
  | `sol_admins` | `(email, solution_id)` | Who builds this solution? One grade. |
  | `op_users` | `(org_id, operation_id, email)` | Who may enter this operation? |
  | `op_admins` | `(org_id, operation_id, email)` | Who administers it? |

  `orgs.owner_email` holds the root of authority. `sol_admins` carries no
  `org_id`, unlike its siblings: solution ids are globally unique, so the org is
  derivable through `solutions`.

  Migration 0016 preserved data by **promotion**: `org_users.level='admin'` →
  an `org_admins` row, `op_users.level='admin'` → an `op_admins` row (the
  `op_users` row dropped, since an admin row implies entry), `sol_users`
  `write` → `sol_admins`, `read` **dropped**. Orphan grants — rows naming
  somebody not in the pool — are deleted, so the invite-then-appoint order is
  enforced rather than assumed.

  Lifecycle lives on the `users` row alone, so suspension bites every tier at
  once rather than being re-implemented in each.

  **Email is the key, not the auth id** — an**Email is the key, not the auth id** — an
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
draft is the builder's working copy. Nothing installs a config or a page: a
migrated database is empty and stays empty until someone authors into it.

DDL is drizzle-kit migrations (`migrations/`). `npm run db:generate` can write
one from `schema.ts`, but in practice every migration since 0006 is
**hand-written** — the prose header explaining why a change is being made is
worth more than the generator's output, and the snapshots under `migrations/meta`
(which only the generator reads) stopped at 0005 accordingly. A hand-written
migration needs its `.sql` file and an entry in `meta/_journal.json`; the
runtime migrator reads only those two. `createDb()` applies outstanding migrations
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

## What the client is given (**BUILT 2026-08-09**)

Design authority: root [docs/CLIENT_TRUST_BOUNDARY.md](../../../docs/CLIENT_TRUST_BOUNDARY.md) §2,
step 1 of its sequencing. The finding it closes: **the data was filtered, the
model was not.** `config.get` returned the entire `SolutionConfig` to anyone —
so a runtime user who could read one record type still received every other
type's definition, every activity, **every hook body**, and the `access.read`
rules that excluded them.

The fix is not one endpoint filtering harder — a sol admin authoring in the
Console genuinely needs the whole model — it is **two separate procedures for
two audiences**:

| | Audience | Gate | Returns |
|---|---|---|---|
| `config.get` `{ solutionId }` | design plane (Console) | **sol admin** | `SolutionConfig`, whole |
| `config.getForOperation` `{ operationId }` | runtime plane | op user, then the role trim | `ClientSolutionConfig` |

**One pure function.** `projectConfig(config, { roles, enforced })` in
`src/projection.ts` is the only thing that turns one into the other — one place
to audit, one place to test (`test/projection.test.ts`).

It trims **in memory**, over the model `getSolutionConfig` already assembled,
rather than pushing the cuts down as `WHERE` clauses. That is a deliberate first
cut: assembly is one round trip either way, and a pure function is testable
without a database. Pushing the row cuts into SQL is a later optimisation, not a
redesign.

**It builds its output by naming each field that goes in.** Removing fields
instead (`delete config.hooks`) leaks every field added to the model later,
until somebody remembers; naming what goes in makes new fields invisible until
somebody deliberately exposes them. This is the rule the whole module rests on.

| | Ships | Stripped |
|---|---|---|
| attributes | `key`, `label`, `description`, `type`, display config, `max_count`, `validation` + `validation_message`, `show_condition`, `required`, `can_waive` | the presign gate (`max_size_mb`); attributes no surviving form reaches, and pool orphans |
| record types | `id`, `name`, `description`, `workflow_ref`, custom field key + label + type + FK wiring | `access.read`; storage constraints (`required`/`unique`/`immutable`/`indexed`/`default`); **unreadable types entirely** |
| activities | `id`, `name`, `description`, `sort_order`, `record_map`, form definition, `show_condition` | **`before_hook` and `after_hook` entirely** |
| workflows | `id`, `name`, `description`, and the activities that survive | workflows serving no surviving record type |
| functions | those reachable from a shipped expression, transitively | the rest — including every hook-only helper |
| roles | — | **the whole `access` block**; the client gets its own roles from `me` |
| `default_menu` | rides through untouched | — |

**Hooks are the prize**: business logic and every effect never leave the server.
**Validation expressions are deliberately kept** — the client needs them for
inline validation, they are not secret (the user discovers the rule by hitting
it anyway), and the server revalidates regardless.

`default_menu` ships because the runtime cannot render its navigation without
it, and the operation's own override — which usually wins — arrives untrimmed
from `operations.get` anyway.

**The type system enforces it.** `ClientSolutionConfig` is declared first in
`@fluxus/engine` and `SolutionConfig` **extends** it, so client-side code typed
against the narrow grade cannot compile a reference to `before_hook`: the trim
is structurally unreachable, not merely filtered at runtime. `FluxusClient` is
generic in its grade — see the client SPEC.

**Consequences to know about**, both from the `config.get` tightening:

- An org admin who is not a sol admin of a solution can no longer open its model
  in the Console. `connectSolution` surfaces the refusal rather than opening a
  blank editor.
- The operation-menu screen's "inherited default" read (`getSolutionConfig`)
  goes through `config.get`, so an op admin who does not build the solution sees
  an empty inherited menu. Its call already catches and degrades.

**Still to come** (§2, blocked on §7): the second cut, **by page** — the larger
payload win — lands as another option on this same function.

## Model storage: the SDM config as tables (**BUILT 2026-08-08**, steps 1–2; the derived snapshot dropped 2026-08-09)

Until 2026-08-08 one jsonb blob per solution (`sdm_configs.config`) held
attributes, record types, workflows, functions and `access.roles`. The mismatch
that forced the change: the **consistency unit is the whole graph** (a workflow
references attributes, so validation is always global) while the **change unit
is one entity** (an author edits one attribute) — and a blob makes the *write*
unit the whole graph too. `config.put` is therefore last-write-wins across the
entire model: two sol admins editing two different record types have no logical
conflict, yet one silently loses their work. There is also no per-entity
authorship and no "what uses attribute X", the prerequisite for any safe
rename or delete.

**The rule that governs the change**: the one-pipeline invariant governs
*solutions* — records, activities, hooks, history — not the Console. The
Console is a conceded custom app that already owns tables (`users`,
`*_admins`, `pages`, …), so design-plane authoring storage is not a second
pipeline and the invariant does not block this.

**Direction: the tables are truth; the assembled config is derived.**
Considered and rejected: keeping the blob and adding an etag/version to
`config.put`. That protects against loss but still forces every author to
serialise on the whole model.

### The six tables

One per collection, `sdm_` prefixed like the two model tables that already
exist. Every row is keyed by solution and carries the entity exactly as the
config spells it.

| Table | PK | Holds |
|---|---|---|
| `sdm_attributes` | `(solution_id, key)` | the attribute pool |
| `sdm_record_types` | `(solution_id, id)` | `recordTypes[]` |
| `sdm_workflows` | `(solution_id, id)` | `workflows[]`, **activities included** |
| `sdm_functions` | `(solution_id, id)` | `functions[]` |
| `sdm_roles` | `(solution_id, id)` | `access.roles[]` |
| `sdm_menus` | `(solution_id)` | `default_menu` — one row, not a collection |

**`sdm_menus` is the odd one** — keyed by solution alone, because the
solution's default runtime menu (§5, M10) is the config's only non-collection
field. It is a table rather than a column on `sdm_configs` so that **nothing in
`sdm_configs` is truth**: the snapshot row stays purely derived, and therefore
droppable and rebuildable at any time. Its `def` holds the menu array whole —
menu items are not independently authored entities, and one person edits a menu
at a time (the same reasoning that keeps activities inside their workflow).

Common columns: `solution_id` text NOT NULL (FK → `solutions.id`), the PK's
second column where there is one (`key` for attributes — the config's own
spelling for that entity's identity — `id` for record types, workflows,
functions and roles; `sdm_menus` has none), `def` jsonb NOT NULL, and
`created_at`/`created_by`, `updated_at`/`updated_by`. The `*_by` columns hold
**email**, the users-model key, and are **nullable**: null means the row
predates per-entity authorship (the backfill), never a fake author.

`def` is the entity verbatim, *including* its own key/id — assembly is then
`rows.map(r => r.def)` with no reconstruction step, and the duplicated
identifier is the price of an assembler that cannot be wrong. `def` is the
established name for exactly this (`pages.def`, `page_versions.def`).

One promoted column: **`sdm_record_types.workflow_ref`** text NOT NULL, FK
`(solution_id, workflow_ref)` → `sdm_workflows(solution_id, id)`. It is the
one reference the split can hand to Postgres. Named `workflow_ref` to match
the config field, not `workflow_id`, because it *is* that field lifted out.

**Activities stay inside their workflow** (ruled 2026-08-08). They were the
obvious sixth table — an activity is the largest object in the model and
plausibly the edit unit — but the change unit is really the workflow: one
person owns one workflow at a time, and reviewing a workflow change wants the
whole thing in one view. Keeping them nested also preserves their authored
order for free. If a workflow ever grows too contended or too long to review,
splitting activities out later is a migration with no API change — assembly is
per-collection either way.

### What does not change

- **`sdm_config_versions`** — untouched. Publish still assembles the graph into
  one immutable jsonb snapshot; that is already the right artifact for
  install / share / version.
- ~~**`sdm_configs`**~~ — **DROPPED 2026-08-09, migration 0020.** It survived
  the split for one day as a derived snapshot, on the premise that assembling
  the model cost six round trips and `config.get` should stay one. It costs
  **one**: `jsonb_agg` subqueries in a single SELECT, which `getSolutionConfig`
  now issues `FROM solutions` so the same statement also answers "does this
  solution exist". With the premise gone the snapshot was a second copy of the
  truth buying nothing — and the copy every host actually read, so any drift
  would have run hosts on a model the tables disagreed with, invisibly. The
  lock moved to the `solutions` row (below). Reversibility was never at stake:
  a derived table is rebuildable by definition.
- **`config.get`** — unchanged by the split (it assembles the tables). Since
  2026-08-09 it is sol-admin gated and no longer the runtime plane's door — see
  "What the client is given" above.
- **`config.put`** (whole config) — kept, as the **import** path: it explodes an
  incoming config into rows, replacing all five collections and the menu (rows
  absent from the incoming config are deleted). `rollbackConfig` depends on it,
  and installing a solution package will too.

### Ordering

Rows carry no authored array order, so assembly is deterministic by key:
attributes by `key`, the other four by `id`. Activities keep their existing
`sort_order` inside the workflow def. Authored array order in today's blobs is
**lost at migration** — accepted; nothing reads it.

### The write path (BUILT 2026-08-08)

Eleven per-entity mutations sit beside `config.put`: `config.putAttribute` /
`deleteAttribute`, `config.putRecordType` / `deleteRecordType`,
`config.putWorkflow` / `deleteWorkflow`, `config.putFunction` /
`deleteFunction`, `config.putRole` / `deleteRole`, and
`config.putDefaultMenu` (no delete — an empty array is the empty menu) — sol
admin, like `config.put`. Each runs one transaction:

1. `SELECT … FROM solutions WHERE id = $1 FOR UPDATE` — this **serialises
   validation per solution** while leaving writes per entity. Two admins editing
   different record types both keep their work; they queue for the length of one
   validation, they do not overwrite. A lock needs one row both writers reach
   for, not a row of its own: this was the `sdm_configs` row until 2026-08-09,
   and locking the solution to change its model says what was always meant.
   Writers of *different* solutions take different rows and never wait. It
   settles existence in the same statement, too — every entity row is FK'd to
   `solutions`, so a model without its solution is an orphan either way.
2. write the entity row (`created_by` on insert, `updated_by` on update).
3. re-read the graph (`getSolutionConfig`, one round trip).
4. run the **existing** validation unchanged — MemoryAdapter resolution,
   error-severity `validateConfig` findings, the stored-`typeRef` orphan check,
   and `default_menu` shape/reference validation. Global validation is not
   relaxed by the split; only the storage shape moves.
5. any error → rollback, so the entity write disappears with it.
6. success → commit. There is no snapshot to refresh.

A delete that would dangle (an attribute an activity still uses, a workflow a
record type still points at) fails at step 4 like any other invalid graph — the
FK catches the record-type case earlier and more cheaply.

Details settled in the build:

- **A put addresses the entity by the identity its own `def` carries** — the
  wire input is `{ solutionId, def }`, and `def` is opaque exactly as
  `config.put`'s whole config is. A def with no `key`/`id` is rejected before
  anything is locked: assembly never reconstructs an identity, so a def without
  one has nowhere to live. A delete names it explicitly, in the collection's own
  spelling: `deleteAttribute({ key })`, the other four `({ id })`.
- **A put replaces or appends**; a **delete is idempotent** — an id already gone
  is a delete that already happened, matching `deletePage`.
- **Authoring into a solution with no model works from the first entity**, with
  no whole-config save first: there is no row to create, and an unwritten model
  simply assembles to the empty one.
- **`default_menu` validation moved into the host** (`validateDefaultMenu`) so
  both doors run one implementation, and it runs on **every** entity write, not
  just menu writes — that is what makes deleting a role a menu item still names
  fail. `config.put`'s own behaviour and error text are unchanged.
- A **rename is not one call**: it is `put` of the new identity plus `delete` of
  the old, and the delete fails while anything still references the old one.
  That is the same answer the whole-config door gave (a renamed attribute its
  activities still name is a dangling ref either way), arrived at one step
  earlier.

### Migration (BUILT: `0019_model_entity_tables`)

One migration creates the six tables and backfills by exploding each existing
`sdm_configs.config` with `jsonb_array_elements`, leaving `config` in place as
the snapshot (dropped a day later by 0020). `*_by` columns land null for backfilled rows — null means the row
predates per-entity authorship, never a fake author. Like the backfills in 0003
and 0016 it only SELECTs from rows that already exist, so on a fresh database it
inserts nothing.

Two things the backfill settles by doing: **authored array order is lost**
(accepted above — nothing reads it), and **workflows are inserted before record
types**, because `workflow_ref` is a real FK. Verified against a database
migrated to 0018 and seeded with a blob config; the suite itself cannot cover it,
since a test database is migrated from empty and has nothing to backfill.

One behaviour the FKs add beyond the storage move: **a model cannot exist
without its solution.** Every entity row references `solutions.id`, so
`config.put` (and every per-entity write) on an unknown solution is refused —
asked explicitly up front, so it reads as "no such solution" rather than as a
constraint violation. Two older tests stored configs for solutions they never
created and were fixed to create them.

### Build order (ruled 2026-08-08): the API moves before the storage

**Step 1 — the per-entity procedures, over today's blob. BUILT 2026-08-08.**
The concurrency fix does not need the tables. Each procedure runs the
transaction described above with one substitution at steps 2–3: instead of
writing a row and assembling, it splices the single entity into the parsed
`sdm_configs.config` under the same `FOR UPDATE` lock. Validation, the lock, the
signatures and the Console's call sites are all final. Two admins editing
different record types both keep their work from this step onwards — which is
the point of the whole exercise.

What landed, and where the seam is: `configCollections` in `src/host.ts` names
the five collections, each with the identity field its entities carry and a
`read`/`write` pair over a config. `putConfigEntity` / `deleteConfigEntity` /
`putDefaultMenu` share one `editConfig` transaction (lock → splice → validate →
write back); the procedures are thin gate-plus-call. **The `write` half of each
collection and the splice inside `editConfig` are the only throwaway parts** —
step 2 replaces them with a table write plus assembly, and touches nothing else.
Step 1 keeps authored array order (a put replaces in place); step 2 drops it, as
*Ordering* above says.

**Step 3 — drop the snapshot. BUILT 2026-08-09** (migration
`0020_drop_sdm_configs`). Prompted by the user asking why a second copy of the
model was being kept at all. It was: the read-cost premise behind it was wrong,
assembly is one round trip. `getSolutionConfig` became a single `jsonb_agg`
SELECT, the write lock moved to the `solutions` row, `publishConfig` snapshots
the assembled model, and `ConfigCollection.write` died with the JS assembler
that used it. "Nothing to publish" now means an **empty model** rather than a
missing row — the same condition stated against the truth. A solution with
nothing authored yet reads as the empty model instead of throwing, which removed
a special case the client had been carrying.

**Step 2 — the tables underneath. BUILT 2026-08-08** (migration
`0019_model_entity_tables`). Each procedure's body swapped blob-splicing for
row-write-plus-assemble. No API change, no app change — the Console was not
touched, which is the whole return on doing the API first. What the swap
actually moved: each collection gained `list`/`put`/`remove`/`removeExcept` over
its table, `editConfig` became lock → write rows → `assembleConfig` → validate →
refresh snapshot, and `putConfig` became the exploder described above.

Rejected: storage first, under an unchanged Console. It delivers nothing until
step 2, and it leaves the editor to change its storage *and* its API in one
later step. This order touches the Console once, early, and pays out
immediately.

**Per-entity authorship** arrived with the tables, as planned: `created_by` on
insert, `updated_by` on update, both the caller's email, both null for backfilled
rows. Covered by `test/configentities.test.ts`, whose first case is the lost
update itself — two writers, two different entities, both saved.

### Deliberately deferred

- **Per-entity history** ("who changed this attribute in March") — the split
  gives last-writer columns only; real history needs a second append-only
  table. Not built: it has never existed, and `sdm_config_versions` still
  records every publish.
- **A usage edge table** — activity → attribute edges live inside `def`, so
  "what uses attribute X" is a jsonb containment query, not a join, and
  Postgres cannot enforce those refs. Accepted; a derived `sdm_attribute_usages`
  table can be added later as pure derivation.

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

## Nothing is prepopulated (ruled 2026-08-05)

**A migrated database is empty.** No orgs, no solutions, no operations, no
pages, no records. There is no seed script, no bootstrap fixture, and no
migration that installs content. Everything arrives the way a real tenant's
would: an org through `platform.registerOrg`, a solution through
`solutions.create`, a page through the Console, a record through an activity.

What was removed, and why each had to go:

| Removed | What it did | Why |
|---|---|---|
| `scripts/seed.ts` (+ `npm run seed`, `npm run seed:server`) | Installed a demo org/solution/operation, the repo's SDM config, the demo page, and demo records | A database that fills itself is a database whose contents nobody chose |
| `seedOperationRecords` + `SolutionConfig.seeds` | Inserted demo records into an operation's partition | A second write path into records, straight past activities — the pipeline invariant allows none |
| `INSERT` in migration `0008_orgs` | Invented `('default', 'Northwind Utilities')` | A migration's job is schema; inventing a tenant row is seeding |
| `packages/console/pages/work-orders-demo.json` | The demo page the seed pushed | Pages are authored, not shipped |

Two things deliberately stayed, because neither installs content:

- **`scripts/bootstrap.ts`** — promotes the first org admin into an org that
  already exists (and now refuses one that doesn't). It is the answer to a
  strict entry gate, not a content installer, and it remains the lockout
  recovery tool.
- **Backfill `INSERT`s in migrations `0003` and `0016`** — they `SELECT` from
  rows that already exist and rewrite them into new tables. On a fresh database
  they insert nothing.

**Sample content later is an explicit action.** A "create a sample solution"
function may well be built. The rule is that it runs because someone asked for
it, once, by name; it never installs itself, and if it creates records it does
so by running activities. It has no material waiting for it: the model under
`packages/runtime/config/` was cut down on 2026-08-11 to what the tests reach,
precisely so that nothing in the repo doubles as a solution — a sample would be
authored, not lifted from there.

### Config distribution (interim)

The cross-package import of the demo config now exists only in
`test/headless.test.ts` — dev tooling, never the server runtime, which depends
on no peer host. Config distribution proper (authoring against a running
server) is the Console, and remains an open thread on the root ROADMAP.

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

## `scripts.query` — ad-hoc FluxScript, read-only (BUILT 2026-09-21)

Runs arbitrary FluxScript against one operation's records and returns the value.
The Console's DSL Editor is its only caller
(`packages/console/docs/DSL_EDITOR_SPEC.md`).

**Why this is not a hole in the read rule.**
`docs/DATA_THROUGH_ACTIVITIES.md` governs the *application* read path, where a
query belongs in the model as a GET so it can be authorised and logged. This is
workbench-class admin inspection, and the workbench is already outside that —
the Console takes the whole operation partition at connect to evaluate locally
against it. Running the query on the server is **narrower**: the browser gets
the filtered subset instead of every record.

**It is not logged.** A history entry lives on a record and an ad-hoc query has
no anchor. Accepted, and recorded as debt against the unified-log design.

**Read-only is structural, not a validation pass.** `readonlyRecords: true`
removes `records.mutate` from the eval host, so the capability is not on the
object; `engine.evaluate` additionally runs in expression posture. Static
checking would not have done: a model function's body is validated separately,
so a mutating function passes at its call site.

**`engine.evaluate`, not `executeScript`.** `executeScript` returns the value of
a top-level `return` and null otherwise, so a bare expression or query would
answer null.

**Access: `requireOpUser` — entry gate only.** The same gate the workbench's
data door uses; the Console is reachable only by solution designers, so no admin
tier on top. Deliberate departure from `records.partition`, which also filters
rows by role-readable types: a script here reads **every** type in the
operation. As with every gate but platform-admin, `requireOpUser` returns early
when auth is unconfigured, so on such a deployment this endpoint is open.

**Quotas** are raised per call (`maxRows: 100_000`, `maxSteps: 2_000_000`,
`timeoutMs: 15_000`) — the partition is already in memory by then. Hooks keep
`DEFAULT_QUOTAS`.

A failed script returns a result carrying `error`, not a TRPCError; the editor
needs the position. A bad anchor record id answers the same way, for the same
reason — it is the caller's typo, not a transport failure.

**Two error kinds, classified server-side.** `engine.evaluate` parses as well as
evaluates, so `FluxSyntaxError` lands in the same catch as `FluxRuntimeError`;
`compile` is the former, `runtime` everything else. Neither DSL error class has
a `position` object — both carry `line`/`col` as own fields. Messages cross with
their `(line n, col n)` suffix stripped, and **an error that is neither DSL
class is internal: its text is not forwarded**, only that the script failed.

**`invoke` is supplied** from `host.engine.invoke` with the anchor, so the
built-in reaches GET activities as it does everywhere else — it is read-only by
construction. A GET records a light history entry, so the run writes back even
though the script cannot mutate.

**The result is walked before it is sent** (`forWire`): `Date` values go back as
wall-clock text and `FkPointer` as its id. A Date would otherwise serialise as a
UTC instant, and since `date('2026-07-01')` parses at *local* midnight while the
record persists the raw wall-clock string, a server ahead of UTC would report
the previous day. A tRPC transformer does not fix this — it preserves the Date
and the browser renders it in the browser's zone instead.

**Scripts are capped at 4,000 characters** — a tRPC query's input travels in the
URL and Node's default 16KB header limit counts the request line, so a longer
script died as an opaque transport failure. Raising it means POSTing every
query in the app.

### `scripts.query` supplies the model (2026-09-22)

The call passes `modelTypes: true`, so `model.*` answers from the operation's
solution config alongside `records.*` (`docs/QUERYING_THE_MODEL.md`). Nothing
else passes it — no hook, page binding, datasource or GET — so a model query
outside the editor fails as an unknown collection rather than quietly working.

Hook and `returns` source text is included in the projection. The Console is the
gate (the user's ruling, 2026-09-22, the same one that set this endpoint's
access): operation users have no Console access. The wider-door caveat already
recorded for this endpoint applies to model content too.
