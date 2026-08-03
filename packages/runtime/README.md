# @fluxus/runtime

The **Runtime app** — the runtime-plane app end users sign into (`src/main.tsx`): sign in, land on the operation's menu, open **published pages**. Nothing else. Chrome is the identity line (org · solution … operation · user) over a collapsible menu nav. See [docs/VISION.md](../../docs/VISION.md) and [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) at the repo root.

It renders whatever solution the caller's operation runs; end users see the solution's branding, not the platform's. `?operation=<id>` in the URL selects the operation — how the Console's Operations list launches it, and a plain bookmarkable address.

**Renamed from `@fluxus/sdm` (2026-08-01).** The old name said "shared data model", but the model lives in `@fluxus/engine` and `@fluxus/server` — this package is an app. It has **no library face**: the `<Workbench>` it used to export is now [`@fluxus/workbench`](../workbench/), and apps never import apps.

**Status:** M15 shape — published pages only. Pages render via [`@fluxus/page-runtime`](../page-runtime/). FluxScript hooks live: before-hook gates and transactional after-hook effects (DSL Phase 2 — see [ROADMAP](../../docs/ROADMAP.md)). Raw record access, running any activity, CSV import and the Schema Navigator are implementer work and live in the workbench, mounted by the **Console**.

The package still carries the sample asset-maintenance model ("Aber") in [config/](config/) — shared pools (`attributes.json`, `functions.json`) plus one file per entity (record type + workflow) under `config/entities/`, merged into one `ConfigRaw` by [src/config.ts](src/config.ts). It is the **seed script's input** (`@fluxus/server` reads it), not what the running app loads: the app fetches config from the server. The model is config; the runtime is generic. (File layout is POC-era convenience — the endgame is the SDM in a database, edited through UI.)

## Run

```bash
npm run dev          # from repo root: server + Runtime app + Console together
# or individually: npm run dev:server (required) + npm run dev:runtime
# → http://localhost:5173 (server at :8787; seed the demo SDM once with npm run seed:server)
```

Since backend stage 2 (2026-07-12) records live in `@fluxus/server` (Postgres): the app boots by fetching the scope's stored config + partition via `@fluxus/client` and runs every activity server-side — there is no localStorage fallback, so if the server is down, boot fails loudly. Config changes under [config/](config/) reach the server via `npm run seed:server` (config.put upserts; seed records load only for empty types).

## Docs

- [docs/SPEC.md](docs/SPEC.md) — living spec: current design truth
- [docs/SDM_Schema_Reference.md](docs/SDM_Schema_Reference.md) — the canonical SDM schema (wins on any conflict)
- [docs/phases/](docs/phases/) — point-in-time build summaries (append-only history, including the pre-rename workbench phases)
