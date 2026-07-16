# @fluxus/client — SPEC

Current design truth for the browser-host client layer. Built at backend
stage 2 (July 2026); see `@fluxus/server` docs/phases for the milestone
record.

## Role

One class, `FluxusClient`, owning the movements every remote host makes:

1. **`connect({url, scope})`** — fetch `config.get` + `records.partition` +
   `pages.list` for the scope (in parallel) and build a `MemoryAdapter`
   snapshot plus the `pages` map (path → def). The host creates its engine
   over that adapter and wires UI subscriptions to it once.
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

## Contracts and postures

- **Snapshot model** (stage 2 ruling): bootstrap fetch + refetch-after-run.
  The Store contract stays synchronous; the browser mirrors the server's own
  per-request partition-snapshot model. No per-read laziness until partition
  size demands it.
- **Hard cutover** (stage 2 ruling): no localStorage fallback. Connect
  failures propagate to the host's boot error surface.
- **Attributes are strings** — exactly what the capture form submits; the
  server's zod input enforces it.
- **`@fluxus/server` is type-only** (`import type { AppRouter }`): erased at
  compile time, so no server code (pg, PGlite, Hono) enters a browser bundle.
  It lives in devDependencies to say so.
- Defaults: url `http://localhost:8787/trpc`, scope `demo/sdm` (matching the
  server's `DEFAULT_SCOPE`).

## Not here (deliberately)

- Engine construction — hosts differ in service modules (workbench wires
  `notify` to its notification centre), so `createEngine` stays host-side.
- Optimistic updates, offline queueing, sync — parked with the offline
  question (root tt_todo); the seam is `refresh()`.
- Auth headers — arrive with auth itself.
