# Fluxus — Roadmap

Cross-package phases and their interlocks only. Per-package detail lives in each package's `docs/phases/`.

## Where things stand (July 2026)

| Package | Status |
|---|---|
| `@fluxus/sdm` | POC1·a complete + DSL Phases 1–2 wired: `show_condition` / `List` datasources live (city → suburb acceptance), and hooks fire for real — before-hook gates, transactional after-hook effects, named functions (Complete Work Order acceptance); config incl. hooks/functions validated at startup. |
| `@fluxus/page-builder` | Shell + layout editor + ComponentContainer architecture done. Wiring is structural (context keys / mock procedures), callbacks UI-only. |
| `@fluxus/dsl` | **Phase 2 complete** (187 tests incl. sdm wiring): scripts tier — statements, `fail`/`warn`, staged mutations with atomic commit, `queue` outbox, named functions — on top of Phase 1. The page-builder `run activity` callback moved to the Extraction milestone. Next: Phase 3 (services registry). |

## Phase interlocks

```
DSL Phase 1 (expressions + queries + validator)
  ├─► sdm: show_condition + List attribute datasources (incl. attrs.-dependent)
  └─► page-builder: dynamic props become DSL expressions

DSL Phase 2 (scripts: hooks, mutations, fail/queue)                  ✅ done
  └─► sdm: before/after hooks fire for real (status finally moves)

DSL Phase 3 (services registry)
  └─► both hosts: notify / geocode / published functions

Extraction (shared activity engine)
  └─► page-builder: hosts the SDM store; `run activity` callback action
      (payload as `event` root) — moved here from Phase 2: it is blocked
      on this integration, not on language work

DSL Phase 4 (headless invocation)
  └─► backend: activities as the API surface (tRPC + Lambda + Neon per ARCHITECTURE.md)
```

## Sequence

1. **DSL Phase 1** — grammar, interpreter, schema-aware validator. Proven inside the sdm workbench: `show_condition` and `List` attributes with expression datasources (city → suburb dependency as the acceptance test).
2. **DSL Phase 2** ✅ — statements, `fail()`/`warn()`, `records` mutations, transactional after hooks with `queue`, named functions. Fills the sdm hook slots (plus, same cut: warn soft-stop confirmation, waivers/`can_waive`).
3. **DSL Phase 3** — `services` registry with one or two real modules.
4. **Extraction** — activity engine pulled out of the sdm package into a shared core once both hosts drive it (the seam already exists: `runActivity` + `Store` interface). Brings the page-builder `run activity` callback action (payload as `event` root) and manifest item-shape contracts.
5. **DSL Phase 4 + backend** — headless activity invocation over the agreed stack; `Store` swaps from localStorage to the real adapter.

Parked (deliberately, with invariants locked now): org → operation → project hierarchy; SDM import/replication between projects; one-way workflow visualisation; named-function governance constraints.
