# @fluxus/client — SPEC

Current design truth for the browser-host client layer. Built at backend
stage 2 (July 2026); see `@fluxus/server` docs/phases for the milestone
record.

## Role

One class, `FluxusClient`, owning the movements every remote host makes:

1. **`connect({url, operationId})`** — resolve the operation to its solution
   (`operations.get`), then fetch `config.get` + `pages.list` (by `solutionId`)
   and `records.partition` (by `operationId`) in parallel and build a
   `MemoryAdapter` snapshot plus the `pages` map (path → def) and the
   operation's `menu` (spec §5). The host creates its engine over that adapter
   and wires UI subscriptions to it once. Exposes `operationId` + `solutionId`.
1a. **`connectSolution({url, solutionId})`** (CONSOLE_RUNTIME_SPEC §3, design
   plane) — bind to a solution directly, no operation: fetch `config.get` +
   draft `pages.list` by `solutionId`, empty record partition, no menu/roles.
   The Console uses this to author a solution's model + pages; `saveConfig`
   round-trips `config.put`. `refresh`/`runActivity` are not meaningful here.
2. **`refresh()`** — re-fetch the partition into the *same* adapter via
   `MemoryAdapter.replaceRecords` (identity stable, subscribers notified).
3. **`runActivity(input)`** — the only record mutation path: `activities.run`
   on the server (availability gate, hooks, persistence, reporting projection
   all server-side), then `refresh()`. Refresh runs even when the call throws,
   because a failing after hook persists the entry by doctrine.
4. **`savePage(path, def)` / `deletePage(path)`** (backend stage 3) — mutate
   the local `pages` map first, then round-trip `pages.put`/`pages.delete`, so
   host reads of the page set stay synchronous. Defs are opaque `unknown`
   here: `PageDef` and its validation belong to the page builder.
5. **`uploads`** (ATTRIBUTE_TYPES_FILES_SCALARS §10) — the upload surface
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
transport) exposes plain typed calls: `listSolutions`, `listOperations` /
`getOperation` / `createOperation` / `putOperationConfig`, and the governance
set (`operationRoles`, `listAssignments`/`putAssignment`,
`listImplementers`/`putImplementer`), and the publish set (`publishPage`,
`listPageVersions`, `getPageVersion`, `rollbackPage`). No snapshot, no engine —
just the tRPC door for admin screens.

`connect`'s `pages` option (`'draft'` default | `'published'`) picks which page
set the snapshot holds: the Runtime host passes `'published'` (latest version
per path); the Console passes `'draft'` (its editable preview). Connect also
fetches `me` → the caller's `userRoles` + `enforced` flag, and the operation's
`menu`. `visibleMenu()` filters the menu for display (deny-default per §5;
unfiltered when not `enforced`, §7) — cosmetic, the server page filter is the
real gate. `ConsoleClient.listPublishedPaths` feeds the menu editor.

## Contracts and postures

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
