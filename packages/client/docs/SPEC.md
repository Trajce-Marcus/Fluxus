# @fluxus/client — SPEC

Current design truth for the browser-host client layer. Built at backend
stage 2 (July 2026); see `@fluxus/server` docs/phases for the milestone
record.

## Role

One class, `FluxusClient`, owning the movements every remote host makes:

1. **`connect({url, operationId, records?})`** — resolve the operation to its
   solution (`operations.get`), then fetch `config.getForOperation` +
   `pages.list` and (unless `records: 'none'`) `records.partition` in parallel
   and build a
   `MemoryAdapter` snapshot plus the `pages` map (path → def) and the
   **effective menu** (§5 amended M10): `operation.config.menu ??
   config.default_menu ?? []` — the operation's whole-menu override when set,
   else the solution's default, resolved here because the engine is menu-blind.
   The host creates its engine over that adapter and wires UI subscriptions to
   it once. Exposes `operationId` + `solutionId`, and the Runtime header's
   three display names — `solutionName` + `operationName` (M10), `orgName`
   (M13) — all resolved from the one `operations.get` call. `connectSolution`
   passes `''` for `orgName`: display names are Runtime chrome, and Console has
   its own solution banner.
   Since 2026-08-09 the model arrives **trimmed to the caller's roles**
   (`config.getForOperation`, CLIENT_TRUST_BOUNDARY §2): no hooks, no access
   rules, no record type they cannot read. Hence the door is keyed on the
   operation, not the solution — the trim is decided by roles *in that
   operation*. The data was always filtered this way; now the model is too.
1a. **`connectSolution({url, solutionId, operationId?})`** (CONSOLE_RUNTIME_SPEC
   §3, design plane) — bind to a solution to author its model + draft pages:
   fetch `config.get` (the whole model, hooks included — authoring them is the
   job; **sol-admin gated** since 2026-08-09, and a refusal is surfaced rather
   than opened as a blank editor) + draft `pages.list` by `solutionId`, plus **that
   operation's records** (M9, ruled 2026-07-26 — the model is solution-scoped,
   the data you build against is one operation's). No menu/roles (`enforced`
   false: Console is the design plane). With an operation bound,
   `refresh`/`runActivity` work exactly as in the Runtime host — running an
   activity is how a solution builder tests a workflow. Omitting `operationId`
   yields an empty record set: legal for a solution with no operations yet,
   but the exception, not the design. Model writes are **per entity** (2026-08-08):
   `putAttribute`/`deleteAttribute`, `putRecordType`/`deleteRecordType`,
   `putWorkflow`/`deleteWorkflow`, `putFunction`/`deleteFunction`,
   `putRole`/`deleteRole` and `putDefaultMenu` each round-trip the matching
   `config.*` mutation, which validates the whole graph under a per-solution
   lock — so two people editing two different entities no longer overwrite each
   other. `saveConfig` still round-trips `config.put`, but as the **import**
   path (installing or rolling back a whole config), not the editing path.
   `publishConfig`/`configVersions`/`rollbackConfig` are the model's version
   history (the surface pages have had since M3). `operationsForSolution`
   (static) lists a solution's operations for the Console data picker.
1b. **`records: 'partition' | 'none'`** (2026-08-16) — how much data the
   client holds. `partition` (the default, and what every host did before the
   option existed) is every readable record in the operation *with its full
   activity history*, in one round trip at sign-in. `none` is nothing: the host
   fills the snapshot as it goes and asks the model for the rest through GET
   activities. The Runtime app passes `none` — it renders pages, and a page
   runs on what it asks for plus the one record it is about. The Console keeps
   the partition, because the workbench evaluates the model locally against it
   (DATA_THROUGH_ACTIVITIES step 5; the workbench's own on-demand loading is
   the step after).
1c. **`fetchRecord(recordId)` / `fetchRecords(typeId)`** (2026-08-16) — one
   record, or one type, **merged** into the snapshot through the new
   `MemoryAdapter.mergeRecords` rather than replacing it. `records.get` and
   `records.list` already existed server-side and are RBAC-filtered, so a
   record the caller may not read comes back as not-found — the fetch is the
   authorisation check as well as the load. These are what a host with no
   partition reaches for: a page's anchor record, the record a component's
   callback named, and (later) the type a grid is showing.
2. **`refresh()`** — with the partition, re-fetch the lot into the *same*
   adapter via `MemoryAdapter.replaceRecords` (identity stable, subscribers
   notified). With `records: 'none'` there is no partition to re-fetch, so it
   re-reads exactly the records already in hand — typically the one the page is
   about — and drops any that no longer read back (deleted, or no longer
   readable).
3. **`runActivity(input)`** — the only record mutation path: `activities.run`
   on the server (availability gate, hooks, persistence, reporting projection
   all server-side), then `refresh()`. Refresh runs even when the call throws,
   because a failing after hook persists the entry by doctrine.
4. **`query(input)`** — the read counterpart (DSL_SPEC §5a): name a GET
   activity, hand it its parameters, get `{ data, warnings }` back. The app
   carries the activity id, never the query. Its caller since 2026-08-10 is the
   page runtime, which binds it as the `invoke` a dynamic prop reaches the model
   through (DATA_THROUGH_ACTIVITIES step 2), and since step 3 it passes
   `recordId` — the page's own record, the anchor the server logs the read
   against, not the subject of the query. Still no `refresh()` afterwards: no
   record data changed, and the light entry the read produces is of no interest
   to the browser that caused it, so refreshing would double the round trips of
   every page that reads.
5. **`savePage(path, def)` / `deletePage(path)`** (backend stage 3) — mutate
   the local `pages` map first, then round-trip `pages.put`/`pages.delete`, so
   host reads of the page set stay synchronous. Defs are opaque `unknown`
   here: `PageDef` and its validation belong to the page builder.
6. **`uploads`** (ATTRIBUTE_TYPES_FILES_SCALARS §10) — the upload surface
   capture widgets inject: `upload(attributeKey, file, onProgress?)` and
   `resolveUrl(storageKey)`. The solution is bound here so widgets stay blind
   to it.

## Upload core (`src/upload.ts`)

Plain browser logic, no React — the reusable half of file/photo capture, kept
here (the door both hosts stand on) so a host's widgets are pure controlled
components that only call the injected `UploadService`. `runUpload` orchestrates
one file: read bytes → **SHA-256** (Web Crypto) → for images, **EXIF**
(`lat`/`lng`/`taken_at`, a focused hand-rolled JPEG APP1 reader — no dep, `{}`
on anything unexpected) + a **canvas thumbnail** (~320 px long edge, JPEG) →
`files.presignUpload` → **direct PUT to R2** (XMLHttpRequest, upload progress;
fetch can't report it) → the thumbnail PUT for photos → return the descriptor
(`FileDescriptor` / `PhotoDescriptor`, §4). Bytes never transit our server. The
descriptor types are exported here and reused by the widgets. The `presign`
step is injected into `runUpload`, so the core is transport-agnostic;
`FluxusClient` binds it to its tRPC client + solution.

## ConsoleClient (Console plane, CONSOLE_RUNTIME_SPEC §8)

A second, lighter class beside `FluxusClient`: the **cross-operation** admin
surface the page builder drives, distinct from `FluxusClient`'s single-operation
data snapshot. `ConsoleClient.create({ url, getToken })` (shares the bearer
transport) exposes plain typed calls: `listSolutions` / `createSolution` /
`updateSolution` (name only — the id is permanent) / `deleteSolution` (the
server side is a TODO: it answers `NOT_IMPLEMENTED` and destroys nothing),
`listOperations` /
`getOperation` / `createOperation` / `putOperationConfig`, and the publish set (`publishPage`,
`listPageVersions`, `getPageVersion`, `rollbackPage`). No snapshot, no engine —
just the tRPC door for admin screens.

**Users, admins and roles** (rewritten 2026-08-04, see root
[USERS.md](../../../docs/USERS.md)) are one method group per list, because each
list answers one question and is governed by one tier: the pool (`listUsers`,
`inviteUser`, `setUserStatus`, `removeUser`), org admins (`listOrgAdmins`,
`orgOwner`, `appointOrgAdmin`, `removeOrgAdmin` — the owner's alone), sol admins
(`listSolAdmins`, `listSolAdminsByOrg`, `appointSolAdmin`, `removeSolAdmin`), op
admins (`listOpAdmins`, `listOpAdminsBySolution`, `appointOpAdmin`,
`removeOpAdmin`), op users (`listOpUsers`, `addOpUser`, `removeOpUser`) and roles
(`operationRoles`, `listUserRoles`, `putUserRoles`).

`inviteUser` grants nothing anywhere — appointment is always a second call. The
`User` type carries no level; `Grant` is `{ email }`, because the row *is* the
appointment. `me()` answers `{ orgOwner, orgAdmin, opAdmin, console }` for
deciding what to **render**; every call is re-checked server-side.

`connect`'s `pages` option (`'draft'` default | `'published'`) picks which page
set the snapshot holds: the Runtime host passes `'published'` (latest version
per path); the Console passes `'draft'` (its editable preview). Connect also
fetches `me` → the caller's `userRoles` + `enforced` flag, and the effective
`menu`. `visibleMenu()` filters the menu for display (deny-default per §5;
unfiltered when not `enforced`, §7) — cosmetic, the server page filter is the
real gate. `ConsoleClient.listPublishedPaths` feeds the menu editors, and
`ConsoleClient.getOrg` / `putOrgProfile` (M14) drive Console's Organisation
settings surface — profile reads and edits over the `orgs` row (`OrgProfile`).
No create and no plan/status writes; the server owns both rules.
`ConsoleClient.getSolutionConfig` (M10) lets the Console's operation view show
the `default_menu` an operation inherits — sol-admin gated since the client trim,
so an op admin who does not build the solution sees an empty inherited menu.

## Contracts and postures

- **Two grades of model** (CLIENT_TRUST_BOUNDARY §2, 2026-08-09):
  `FluxusClient<C extends ClientSolutionConfig>` is generic in the grade it
  holds. `connect` yields the narrow one (hooks, access rules and the storage
  gate never left the server); `connectSolution` yields the full
  `SolutionConfig`, because the design plane authors hooks. **Hosts that only
  render and run take `FluxusClient` unparameterised** and get the narrow
  grade — which is what makes a stray `before_hook` read a compile error there
  rather than a runtime `undefined`. Console types its design singleton
  `FluxusClient<SolutionConfig>`.
- **Snapshot model** (stage 2 ruling): bootstrap fetch + refetch-after-run.
  The Store contract stays synchronous; the browser mirrors the server's own
  per-request partition-snapshot model. No per-read laziness until partition
  size demands it.
- **Hard cutover** (stage 2 ruling): no localStorage fallback. Connect
  failures propagate to the host's boot error surface.
- **Attributes are arbitrary JSON** — scalars are strings as the capture form
  submits; file/photo attributes carry descriptor objects and multi values
  arrays. The server types them authoritatively (`validateSubmission`).
- **`@fluxus/server` is type-only** (`import type { AppRouter }`): erased at
  compile time, so no server code (pg, PGlite, Hono) enters a browser bundle.
  It lives in devDependencies to say so.
- Defaults: url `http://localhost:8787/trpc`, operationId `demo/sdm` (matching
  the server's `DEFAULT_OPERATION`; the demo bundle's single id is both its
  operation and its solution).

## Auth (RBAC phase 1, 2026-07-19)

- **Bearer token on every call**: `ConnectOptions.getToken` (typically
  `HostAuth.getToken`) is resolved per request by the tRPC link and attached
  as `Authorization: Bearer` — per request because Neon Auth session JWTs
  live ~15 minutes. No supplier / null token ⇒ no header (the unconfigured
  server is open; the configured one rejects).
- **`src/auth.ts` — the hosts' Neon Auth seam** (`createHostAuth(url)` →
  `HostAuth`): sign-in/sign-up/sign-out/session plus `getToken` with
  near-expiry caching (30 s slack on the JWT `exp`). The young
  `@neondatabase/neon-js` SDK (Managed Better Auth client) is used **only in
  this module** (prefer-established-deps: young dep behind a seam, shallow
  usage). No auth URL ⇒ `configured: false` and hosts skip their sign-in gate
  — the same env-driven posture as the server.

## Not here (deliberately)

- Engine construction — hosts differ in service modules (workbench wires
  `notify` to its notification centre), so `createEngine` stays host-side.
- Optimistic updates, offline queueing, sync — parked with the offline
  question (root tt_todo); the seam is `refresh()`.
- Sign-in UI — the minimal email+password form is per host (RBAC_DESIGN §0);
  this package supplies only the seam it drives.

## `runScript` — ad-hoc FluxScript (2026-09-21)

`runScript({ source, recordId? })` → `ScriptQueryResult`, calling the server's
`scripts.query`. Read-only FluxScript over the connected operation's records,
for the Console's DSL Editor (`packages/console/docs/DSL_EDITOR_SPEC.md`).

Two things about its posture:

- **A failed script is a result, not a throw.** The result carries
  `error: { kind, message, line?, col? }`, because the editor shows the message
  against the source and a thrown `TRPCClientError` would lose the position and
  read as a transport failure. Gate and transport failures still throw.
- **No snapshot refresh.** Nothing mutates, so there is nothing to re-fetch.

`ScriptQueryResult` is re-exported from `@fluxus/server`, where the procedure
defines it.

## Browser performance logging (BUILT 2026-09-25, [docs/PERFORMANCE_LOGGING.md](../../../docs/PERFORMANCE_LOGGING.md))

`src/perf.ts`. One `BrowserPerf` per tRPC client (kept in a `WeakMap` beside it,
so the client's inferred type stays the plain one). **Inert until told**:
`FluxusClient.connect` / `connectSolution` call `perf.settings` in the same HTTP
batch as the rest of connect and `configure(operationId, enabled && browser)`; a
failure or an older server leaves it off. `ConsoleClient` and `PlatformClient`
never enable it — they name no operation.

- **`perfLink`** — a tRPC link ahead of `httpBatchLink` that times every call as
  the browser saw it, network included, as a `call` span named
  `procedure` or `procedure · activityId`. It stamps `op.context.fluxusTrace`
  (`traceId:spanId`), which the transport's `headers` function turns into the
  `x-fluxus-trace` header — taken from the **first** call in the batch that has
  one, so a batch's server spans hang under that call. `perf.*` is never timed.
  `refused` (FORBIDDEN, BAD_REQUEST, …) is told from `error`.
- **`pageOpen(path)`** on `FluxusClient` → a `PageOpenHandle` (`end({components})`,
  `fail(message)`, `cancel()`), or null when logging is off. While a page is
  opening every call carries the page's trace and is a child of its span; `calls`
  is counted. A page superseded before it is ready is never recorded. A call
  outside a page open is its own trace.
- **Sending** — batched every 10 s and when the tab is hidden; at most 500 buffered
  (oldest dropped); a failed send drops the batch. Nothing here may break the app.
- **`PlatformClient`** gains `listOperations`, `perfSwitches`, `setPerfSwitches`,
  `perfReport(range)` and `perfTrace(traceId)` for the dashboard, with the
  `PerfReport` / `PerfSpan` / `PerfSwitches` types. `@trpc/server` is now a declared
  dependency (the link's `observable`); `@trpc/client` already required it.

Tests: `test/perf.test.ts` (16) against a fake `next()`.
