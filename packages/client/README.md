# @fluxus/client

The browser hosts' door to `@fluxus/server` (backend stage 2). `connect()`
fetches a scope's stored SDM config and full record partition into the
engine's `MemoryAdapter`; hosts keep evaluating everything synchronously
against that snapshot, and every mutation is an `activities.run` round trip
followed by a partition re-fetch through the same adapter.

**Status:** built with backend stage 2 (July 2026). Used by the sdm workbench
and the page builder; a future host (CLI, mobile) starts here.

- Depends on `@fluxus/engine` (the adapter + types) and `@trpc/client`.
  `@fluxus/server` is a type-only dev dependency (the `AppRouter` type) —
  no server code reaches a browser bundle.
- No UI, no React, no fallback storage: if the server is unreachable the
  host's boot fails loudly (hard-cutover ruling).

Run checks: `npm run build` (typecheck).

Docs: [docs/SPEC.md](docs/SPEC.md) — the living design truth.
