# @fluxus/sdm

The SDM (Shared Data Model) runtime: record types, workflows, activities, activity history, and the record workbench UI. This is the centre of the platform — see [docs/VISION.md](../../docs/VISION.md) and [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) at the repo root.

**Status:** POC1·a complete. List record types → create via CREATE activity → run capture activities → view history; FK refs with related records, Schema Navigator, CSV import/export. FluxScript hooks live: before-hook gates and transactional after-hook effects (DSL Phase 2 — see [ROADMAP](../../docs/ROADMAP.md)).

**Next (workbench):**
1. Activity run/test console — a UI to invoke *any* activity type headlessly (pick activity → enter parameters → see gate/warnings/result/history), independent of the record view; becomes the natural home for GET activities when they land.
2. Toast/banner slot for after-hook `warn()`s (currently console-only; before-hook warnings already prompt Continue/Cancel).
3. Data-gaps worklist — records with waived (`can_waive`) attributes and their reasons, so known-missing values get chased.
4. Put `openWorkOrders` (functions.json) to real use — e.g. as a workgroup picker datasource — once a surface needs it.

The package currently carries a sample asset-maintenance model ("Aber") in [config/](config/) — shared pools (`attributes.json`, `functions.json`) plus one file per entity (record type + workflow) under `config/entities/`, merged into one `ConfigRaw` by [src/config.ts](src/config.ts). The model is config; the runtime is generic. (File layout is POC-era convenience — the endgame is the SDM in a database, edited through UI.)

## Run

```bash
npm run dev          # from repo root: server + workbench + page builder together
# or individually: npm run dev:server (required) + npm run dev:sdm
# → http://localhost:5173 (server at :8787; seed the demo SDM once with npm run seed:server)
```

Since backend stage 2 (2026-07-12) records live in `@fluxus/server` (Postgres): the workbench boots by fetching the scope's stored config + partition via `@fluxus/client` and runs every activity server-side — there is no localStorage fallback. Config changes under [config/](config/) reach the server via `npm run seed:server` (config.put upserts; seed records load only for empty types).

## Docs

- [docs/SPEC.md](docs/SPEC.md) — living spec: current design truth
- [docs/SDM_Schema_Reference.md](docs/SDM_Schema_Reference.md) — the canonical SDM schema (wins on any conflict)
- [docs/phases/](docs/phases/) — point-in-time build summaries (append-only history)
