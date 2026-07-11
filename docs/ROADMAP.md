# Fluxus — Roadmap

Cross-package phases and their interlocks only. Per-package detail lives in each package's `docs/phases/`.

## Where things stand (July 2026)

| Package | Status |
|---|---|
| `@fluxus/sdm` | POC1·a complete + DSL Phases 1–3 wired: `show_condition` / `List` datasources live (city → suburb acceptance), hooks fire for real (Complete Work Order acceptance), activity-level availability gate, and the services registry — `notify` (notification centre) + `geo` (service-backed suburb datasource); config incl. hooks/functions/services validated at startup. Since Extraction stage 1: hosts `@fluxus/engine` rather than owning the pipeline. |
| `@fluxus/engine` | **New at Extraction stage 1 (July 2026):** the shared activity engine — `runActivity` pipeline (`createEngine`), `Store` contract, `LocalStorageAdapter` (host-named storage keys), DSL bridge, config validation, core SDM types — extracted from sdm with behaviour unchanged (sdm tests + workbench smoke green). |
| `@fluxus/page-builder` | Shell + layout editor + ComponentContainer architecture done. Wiring is structural (context keys / mock procedures), callbacks UI-only. Becomes the engine's second host at Extraction stage 2. |
| `@fluxus/dsl` | **Phase 3 complete** (207 tests incl. sdm wiring): services registry — module manifests, read/effect purity, registry-strict validation, async-shaped API (sync evaluator; async deferred to backend) — on top of Phases 1–2. Next: Phase 4 (headless) after Extraction completes. |

## Phase interlocks

```
DSL Phase 1 (expressions + queries + validator)
  ├─► sdm: show_condition + List attribute datasources (incl. attrs.-dependent)
  └─► page-builder: dynamic props become DSL expressions

DSL Phase 2 (scripts: hooks, mutations, fail/queue)                  ✅ done
  └─► sdm: before/after hooks fire for real (status finally moves)

DSL Phase 3 (services registry)                                      ✅ done
  └─► sdm: notify (notification centre) + geo (service-backed datasource);
      page-builder picks the registry up at Extraction

Extraction (shared activity engine)
  ├─ stage 1: @fluxus/engine package; sdm repointed              ✅ done
  └─► stage 2: page-builder hosts the SDM store; `run activity` callback
      action (payload as `event` root) — moved here from Phase 2: it is
      blocked on this integration, not on language work. Open design forks:
      the callback's config/`event` shape, manifest item-shape contracts.

DSL Phase 4 (headless invocation)
  └─► backend: activities as the API surface (tRPC + Lambda + Neon per ARCHITECTURE.md)
```

## Sequence

1. **DSL Phase 1** — grammar, interpreter, schema-aware validator. Proven inside the sdm workbench: `show_condition` and `List` attributes with expression datasources (city → suburb dependency as the acceptance test).
2. **DSL Phase 2** ✅ — statements, `fail()`/`warn()`, `records` mutations, transactional after hooks with `queue`, named functions. Fills the sdm hook slots (plus, same cut: warn soft-stop confirmation, waivers/`can_waive`).
3. **DSL Phase 3** ✅ — `services` registry: module manifests with read/effect purity, registry-strict validation, `queue` dispatch incl. async posture; live modules `notify` + `geo` in the sdm workbench (plus, same cut: activity-level `show_condition` availability gate and the cancellation-as-compensation doctrine).
4. **Extraction** — activity engine pulled out of the sdm package into a shared core so both hosts drive it. **Stage 1 done (July 2026):** `@fluxus/engine` extracted along the existing seam (`runActivity` + `Store`), sdm repointed, behaviour unchanged; the engine derives a CREATE activity's target type from config (no UI-selection input) and returns `recordId` so hosts own their reactions. **Stage 2 next:** page builder hosts a Store (platform singleton, own storage key, reachable only through the declarative wiring layer) and gains the `run activity` callback action (payload as `event` root) with manifest item-shape contracts — design forks to settle before building.
5. **DSL Phase 4 + backend** — headless activity invocation over the agreed stack; `Store` swaps from localStorage to the real adapter.

Parked (deliberately, with invariants locked now): org → operation → project hierarchy; SDM import/replication between projects; one-way workflow visualisation; named-function governance constraints.
