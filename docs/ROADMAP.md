# Fluxus — Roadmap

Cross-package phases and their interlocks only. Per-package detail lives in each package's `docs/phases/`.

## Where things stand (July 2026)

| Package | Status |
|---|---|
| `@fluxus/sdm` | POC1·a complete + DSL Phases 1–3 wired: `show_condition` / `List` datasources live (city → suburb acceptance), hooks fire for real (Complete Work Order acceptance), activity-level availability gate, and the services registry — `notify` (notification centre) + `geo` (service-backed suburb datasource); config incl. hooks/functions/services validated at startup. Since Extraction stage 1: hosts `@fluxus/engine` rather than owning the pipeline. |
| `@fluxus/engine` | **Extraction complete (July 2026):** the shared activity engine — `runActivity` pipeline (`createEngine`), `Store` contract, `LocalStorageAdapter` (host-named storage keys), DSL bridge, config validation, core SDM types. Stage 2 added app-triggered runs: `callbackData` root, hook-written attributes, `services.logger` → `system_log` on the entry. Two live hosts. |
| `@fluxus/page-builder` | Shell + layout editor + ComponentContainer architecture done. **Second engine host (Extraction stage 2)**, and since 2026-07-12 **FluxScript everywhere** (page wiring redesign): dynamic props are DSL expressions with datasource posture, callbacks are scripts (`callbackData` root) with UI effects on the host-injected `services.page` module (`setContext` / `hideComponent` / `runActivity`), page context IS the ctx root, save-time `validatePage`, Monaco expression dialog (`fluxscript`). Mock procedure registry and overlay stub removed. |
| `@fluxus/dsl` | **Phase 3 complete** (207 tests incl. sdm wiring): services registry — module manifests, read/effect purity, registry-strict validation, async-shaped API (sync evaluator; async deferred to backend) — on top of Phases 1–2. Next: Phase 4 (headless) after Extraction completes. |

## Phase interlocks

```
DSL Phase 1 (expressions + queries + validator)
  ├─► sdm: show_condition + List attribute datasources (incl. attrs.-dependent)
  └─► page-builder: dynamic props are DSL expressions — built 2026-07-12,
      extended to callbacks + services.page; see                     ✅ done
      packages/page-builder/docs/PAGE_WIRING_DESIGN.md

DSL Phase 2 (scripts: hooks, mutations, fail/queue)                  ✅ done
  └─► sdm: before/after hooks fire for real (status finally moves)

DSL Phase 3 (services registry)                                      ✅ done
  └─► sdm: notify (notification centre) + geo (service-backed datasource);
      page-builder picks the registry up at Extraction

Extraction (shared activity engine)                              ✅ done
  ├─ stage 1: @fluxus/engine package; sdm repointed              ✅ done
  └─ stage 2: page-builder hosts the SDM store; `run-activity`   ✅ done
     callback action — named callback → activity, contract
     (record, data object), `callbackData` root, hook-written
     attributes, services.logger. Manifest shape contracts
     deferred by ruling (standard form replaced payload mapping).

Page validation (save-time validatePage in the page builder)        ✅ done
  └─► AI-built pages: checked artifacts, same guardrail role as
      validateConfig for AI-authored SDM config

DSL Phase 4 (headless invocation)
  └─► backend: activities as the API surface (tRPC + Lambda + Neon per ARCHITECTURE.md)
```

## Sequence

1. **DSL Phase 1** — grammar, interpreter, schema-aware validator. Proven inside the sdm workbench: `show_condition` and `List` attributes with expression datasources (city → suburb dependency as the acceptance test).
2. **DSL Phase 2** ✅ — statements, `fail()`/`warn()`, `records` mutations, transactional after hooks with `queue`, named functions. Fills the sdm hook slots (plus, same cut: warn soft-stop confirmation, waivers/`can_waive`).
3. **DSL Phase 3** ✅ — `services` registry: module manifests with read/effect purity, registry-strict validation, `queue` dispatch incl. async posture; live modules `notify` + `geo` in the sdm workbench (plus, same cut: activity-level `show_condition` availability gate and the cancellation-as-compensation doctrine).
4. **Extraction** ✅ (July 2026) — activity engine pulled out of the sdm package into a shared core so both hosts drive it. **Stage 1:** `@fluxus/engine` extracted along the existing seam (`runActivity` + `Store`), sdm repointed, behaviour unchanged; the engine derives a CREATE activity's target type from config and returns `recordId` so hosts own their reactions. **Stage 2:** page builder hosts a Store (platform singleton, own storage key, reachable only through the declarative wiring layer) and gains the `run-activity` callback action — named callback → activity, contract (record, one data object), `callbackData` root in hooks, hook-written entry attributes, `services.logger`. The `event`-root payload-mapping sketch and manifest item-shape contracts were **superseded/deferred by ruling**: attributes come from the standard capture form (UI activities) or hook logic (non-UI), not from wiring expressions. Full design record: `packages/engine/docs/phases/EXTRACTION_Build_Summary.md`.
5. **Page wiring redesign + page validation** ✅ (2026-07-12) — pages speak FluxScript everywhere (design record: `packages/page-builder/docs/PAGE_WIRING_DESIGN.md`): dynamic props are single expressions with datasource posture, callbacks are scripts receiving `callbackData`, UI effects live on the host-injected `services.page` module, page context IS the ctx root (permissive `context.page.*` by ruling). The DSL gained a `callback` validate mode (effects allowed, mutations rejected); the engine bridge gained `contextExtras` / `readonlyRecords` / `functionSignatures`. Save-time `validatePage` ships with it — component names against the registry, bindings against component schemas, expressions/scripts against the SDM schema + declared roots, literal `runActivity` ids against real activities — the guardrail for AI-built pages, same posture as `validateConfig` for AI-authored SDM config. Follow-ups left open by the design doc: expression↔function traversal + promote-to-function affordances, callback error contract shape, route params → ctx.
6. **DSL Phase 4 + backend** — headless activity invocation over the agreed stack; `Store` swaps from localStorage to the real adapter.

Parked (deliberately, with invariants locked now): org → operation → project hierarchy; SDM import/replication between projects; one-way workflow visualisation; named-function governance constraints.
