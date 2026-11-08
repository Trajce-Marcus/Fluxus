# @fluxus/client — SPEC

Current design truth for the browser-host client layer. Built at backend
stage 2 (July 2026); see `@fluxus/server` docs/phases for the milestone
record.

## Role

One class, `FluxusClient`, owning the movements every remote host makes:

1. **`connect({url, operationId})`** — resolve the operation to its
   solution (`operations.get`), then fetch `model.getForOperation` +
   **`apps.user`** in parallel and build a
   `MemoryAdapter` snapshot, **empty of records** (§1b) plus the `pages` map (path → def) and the caller's
   **app menu** (APPS_AND_INSTANCES §2.5, §2.7, since 2026-10-18): `apps.user`
   answers the apps the caller may run (`apps`, each `{ id, label, pageId,
   definition }`), their published pages, the menu built from them on the
   server. (`appIdByPageId`, each page's only app for the old way of opening a
   page by its path, went in step 6, 2026-10-18.) No fallback: an empty menu means nothing is
   set up. *(Until then the menu was `operation.config.menu ??
   config.default_menu ?? []`, filtered in the browser by `visibleMenu`.)*
   Runs carry **`typeId`** (`RunInput.typeId`, since step 3): the record type
   the run is about — required by the server through an app.
   **`appId`** is the app the host has open: the Runtime sets it when it opens
   one, and every call that runs, reads or uploads through it carries it —
   `activities.run`, `activities.query`, `page.activities`, `records.get`,
   `files.*`. The Console never sets it. `findApp(appId)` answers an app the
   caller may run, or null.
   The host creates its engine over that adapter and wires UI subscriptions to
   it once. Exposes `operationId` + `solutionId`, and the Runtime header's
   three display names — `solutionName` + `operationName` (M10), `orgName`
   (M13) — all resolved from the one `operations.get` call. `connectSolution`
   passes `''` for `orgName`: display names are Runtime chrome, and Console has
   its own solution banner.
   Since 2026-08-09 the model arrives **trimmed to the caller's roles**
   (`model.getForOperation`, CLIENT_TRUST_BOUNDARY §2): no hooks, no access
   rules, no record type they cannot read. Hence the door is keyed on the
   operation, not the solution — the trim is decided by roles *in that
   operation*. The data was always filtered this way; now the model is too.
1a. **`connectSolution({url, solutionId, operationId?})`** (CONSOLE_RUNTIME_SPEC
   §3, design plane) — bind to a solution to author its model + draft pages:
   fetch `model.get` (the whole model, hooks included — authoring them is the
   job; **sol-admin gated** since 2026-08-09 — and since 2026-10-18 open to
   the admins of the solution's operations too — and a refusal is surfaced
   rather than opened as a blank editor) + draft `pages.list` by `solutionId`
   (sol admin only since 2026-10-18: a refusal connects with no pages and sets
   **`solutionAdmin`** false, which the Console reads to hide its design
   tools), bound to **one operation's records** (M9, ruled 2026-07-26 — the model is solution-scoped,
   the data you build against is one operation's), fetched as the workbench's
   screens show them (§1b), none at connect. No menu/roles (`enforced`
   false: Console is the design plane). With an operation bound,
   `refresh`/`runActivity` work exactly as in the Runtime host — running an
   activity is how a solution builder tests a workflow. Omitting `operationId`
   yields an empty record set: legal for a solution with no operations yet,
   but the exception, not the design. Model writes are **per entity** (2026-08-08):
   `putAttribute`/`deleteAttribute`, `putRecordType`/`deleteRecordType`,
   `putWorkflow`/`deleteWorkflow`, `putFunction`/`deleteFunction`,
   `putRole`/`deleteRole` each round-trip the matching
   `config.*` mutation, which validates the whole graph under a per-solution
   lock — so two people editing two different entities no longer overwrite each
   other. `saveModel` still round-trips `model.put`, but as the **import**
   path (installing or rolling back a whole config), not the editing path.
   `publishModel`/`modelVersions`/`rollbackModel` are the model's version
   history (the surface pages have had since M3). `operationsForSolution`
   (static) lists a solution's operations for the Console data picker.
1b. **No records at connect; what is fetched is held** (CONSOLE_RECORD_FETCHING,
   2026-11-09). Neither connect fetches a record — the Runtime has not since
   2026-08-16, and the Console's whole-operation fetch (`records.partition`,
   and the `records: 'partition' | 'none'` option with it) is gone. The client
   keeps what it fetched, entry by entry, each counting its holders: each
   record fetched by id with what came with it, each list with its rows and
   labels. The `MemoryAdapter` copy is **rebuilt from those entries**
   (`replaceRecords`) whenever one changes — a fetch, a release, a refresh —
   so a fetch landing while a refresh runs is never wiped by it. A read by id
   wins over a list row of the same record (it carries the history).
1c. **`fetchRecord(recordId)` / `releaseRecord(recordId)`** — one record by id
   (`records.get`), held until released. A record the caller may not read is
   refused ("Record access denied" since 2026-10-12, not-found before) — the
   fetch is the authorisation check as well as the load. What a page's anchor,
   a component's callback and the workbench's record view reach for. It brings
   the records it points at — `records.get`'s `references`, two levels,
   readable ones only (2026-10-12) — so a page's expressions and a form's
   reference labels can follow a reference; the references it may not read
   (`withheld`) make following one throw `RecordAccessDeniedError`. The
   Runtime never releases: its pages hold their records for the session.
   **`isRecordFetched(recordId)`** says whether a record is held by id, in
   full, as opposed to only as a list row or a reference — what the workbench
   waits on before it opens a form.
1d. **`fetchRecords(typeId, filter?)` / `releaseRecords(typeId, filter?)`** —
   one type's rows (`records.list`), held until released; **the Console's**:
   `records.list` serves operation admins with no app, so no Runtime user.
   `filter` (`{ fieldKey, value }`) narrows to the rows whose reference field
   holds a value — the related records panel. Rows come without history, with
   **labels** for their references (`{ id, typeRef, field, label }`), which
   the adapter keeps and `resolveDisplayLabel` answers from when the record
   itself is not held.
2. **`refresh()`** — after an activity run, fetch every held entry again, in
   parallel: one `records.get` per record held by id, one `records.list` per
   list, then rebuild the *same* adapter (identity stable, subscribers
   notified). A record the server answers is gone or not readable
   (NOT_FOUND, FORBIDDEN) leaves the copy but keeps its holders, so their
   releases still pair; any other failure (a lost connection) keeps the last
   copy, as a failed list keeps its last rows; a record still on its first
   fetch is left to it (cold test 2026-11-09). A release — including the one a
   failed fetch makes for itself — lets go of its own entry only, never one
   made in its place. The records
   that came along as references are not re-read on their own, so following
   references never grows what is held.
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
4a. **`pageActivities(items)`** (2026-10-11,
   [ACTIONS_OFFERED_BY_SERVER](../../../docs/ACTIONS_OFFERED_BY_SERVER.md)) —
   `page.activities` on the server: which actions each item offers the
   signed-in user, an item being `{ recordId }` (its actions), `{ typeId }`
   (its CREATEs, with no record — a create button) or an empty `{}` (the open
   app's own activities, APPS_AND_INSTANCES step 5). One `{ id, name }` list
   per item, in the order asked; an unreadable record answers an empty list,
   as a missing one does. The browser draws what comes back: the client's
   model no longer carries actions' availability conditions. Its callers are
   the page runtime's `listActivities` and the workbench.
5. **`savePage(path, def)` / `deletePage(path)`** (backend stage 3) — mutate
   the local `pages` map first, then round-trip `pages.put`/`pages.delete`, so
   host reads of the page set stay synchronous. Defs are opaque `unknown`
   here: `PageDef` and its validation belong to the page builder.
6. **`uploads`** (ATTRIBUTE_TYPES_FILES_SCALARS §10) — the upload surface
   capture widgets inject: `upload(attributeKey, file, onProgress?)` and
   `resolveUrl(storageKey)`. The solution and operation (and the open app,
   2026-10-18) are bound here so widgets stay blind to them.

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
`getOperation` / `createOperation` / `putOperationMenu`, and the publish set (`publishPage`,
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
fetches `me` → the caller's `userRoles` + `enforced` flag. (`visibleMenu()`
went 2026-10-18: the server builds each caller's menu.)
`ConsoleClient.listPublishedPaths` feeds the apps dialog, and
`pageAppDefaults(solutionId, path)` (2026-11-03, `pages.appDefaults`) gives
it a new app's starting values; and
`ConsoleClient.getOrg` / `putOrgProfile` (M14) drive Console's Organisation
settings surface — profile reads and edits over the `orgs` row (`OrgProfile`).
No create and no plan/status writes; the server owns both rules.
`ConsoleClient.getSolutionModel` (M10) reads the whole model (sol admins and,
since 2026-10-18, the admins of the solution's operations).

**An operation's apps list** (2026-10-18, APPS_AND_INSTANCES §2.6):
`listApps(operationId)` → `{ apps: App[], menu: MenuItem[] }` (the menu is
saved with `putOperationMenu`), `getApp(operationId, appId)` →
the app with its `activityHistory`, `putApp(operationId, AppInput)` → `{ id }`
(no `id` adds one), `expireApp(operationId, appId)` (2026-11-03, §3.2 —
final; nothing is deleted). `App` is `{ id, pageId, label, roleIds,
definition, status }`, `definition` being JSON as text and `status`
`'active' | 'expired'`. Op admin, server-side.

## Contracts and postures

- **Two grades of model** (CLIENT_TRUST_BOUNDARY §2, 2026-08-09):
  `FluxusClient<C extends ClientSolutionModel>` is generic in the grade it
  holds. `connect` yields the narrow one (hooks, access rules and the storage
  gate never left the server); `connectSolution` yields the full
  `SolutionModel`, because the design plane authors hooks. **Hosts that only
  render and run take `FluxusClient` unparameterised** and get the narrow
  grade — which is what makes a stray `before_hook` read a compile error there
  rather than a runtime `undefined`. Console types its design singleton
  `FluxusClient<SolutionModel>`.
- **Snapshot model** (stage 2 ruling): fetch + refetch-after-run. The Store
  contract stays synchronous. *Narrowed 2026-08-16 (Runtime) and 2026-11-09
  (Console):* the snapshot is only what the host's screens hold, never the
  whole operation.
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
