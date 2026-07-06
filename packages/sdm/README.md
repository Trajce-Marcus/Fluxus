# @fluxus/sdm

The SDM (Shared Data Model) runtime: record types, workflows, activities, activity history, and the record workbench UI. This is the centre of the platform — see [docs/VISION.md](../../docs/VISION.md) and [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) at the repo root.

**Status:** POC1·a complete. List record types → create via CREATE activity → run capture activities → view history; FK refs with related records, Schema Navigator, CSV import/export. Hooks are no-op slots awaiting DSL Phase 2 (see [ROADMAP](../../docs/ROADMAP.md)).

The package currently carries a sample asset-maintenance model ("Aber") in [docs/poc_SDM.json](docs/poc_SDM.json) — the model is config; the runtime is generic.

## Run

```bash
npm run dev:sdm      # from repo root, or `npm run dev` in this package
# → http://localhost:5173
```

Browser-only; records persist in localStorage (`fluxus:sdm:records`). After changing record type IDs in the config, clear once: `localStorage.removeItem('fluxus:sdm:records')`.

## Docs

- [docs/SPEC.md](docs/SPEC.md) — living spec: current design truth
- [docs/SDM_Schema_Reference.md](docs/SDM_Schema_Reference.md) — the canonical SDM schema (wins on any conflict)
- [docs/phases/](docs/phases/) — point-in-time build summaries (append-only history)
