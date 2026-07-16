# Fluxus — Roadmap

Cross-package phases and their interlocks only. Per-package detail lives in each package's `docs/phases/`.

## Where things stand (July 2026)

| Package | Status |
|---|---|
| `@fluxus/sdm` | POC1·a complete + DSL Phases 1–3 wired: `show_condition` / `List` datasources live (city → suburb acceptance), hooks fire for real (Complete Work Order acceptance), activity-level availability gate, and the services registry — `notify` (notification centre) + `geo` (service-backed suburb datasource); config incl. hooks/functions/services validated at startup. Since Extraction stage 1: hosts `@fluxus/engine` rather than owning the pipeline. |
| `@fluxus/engine` | **Extraction complete (July 2026):** the shared activity engine — `runActivity` pipeline (`createEngine`), `Store` contract, `MemoryAdapter` (THE Store; `LocalStorageAdapter` deleted at backend stage 3 — no host after the hard cutover), DSL bridge, config validation, core SDM types. Stage 2 added app-triggered runs: `callbackData` root, hook-written attributes, `services.logger` → `system_log` on the entry. Three live hosts. |
| `@fluxus/page-builder` | Shell + layout editor + ComponentContainer architecture done. **Second engine host (Extraction stage 2)**, and since 2026-07-12 **FluxScript everywhere** (page wiring redesign): dynamic props are DSL expressions with datasource posture, callbacks are scripts (`callbackData` root) with UI effects on the host-injected `services.page` module (`setContext` / `hideComponent`) and activity runs on the host-neutral `services.activities.run`, page context IS the ctx root, save-time `validatePage`, Monaco expression dialog (`fluxscript`). Mock procedure registry and overlay stub removed. |
| `@fluxus/dsl` | **Phase 3 complete** (207 tests incl. sdm wiring): services registry — module manifests, read/effect purity, registry-strict validation, async-shaped API (sync evaluator; async deferred to backend) — on top of Phases 1–2. **Phase 4 (headless) shipped 2026-07-12 with zero language change** — the backend's partition-snapshot model keeps the evaluator sync (see `@fluxus/server`); the async-shaped seam remains. |
| `@fluxus/server` | **Backend stage 1 (2026-07-12):** the third engine host — activities as the API surface (tRPC on Hono; Lambda entry unexercised), Postgres via Drizzle (PGlite in dev, Neon by `DATABASE_URL` — account pending), per-request partition snapshot → sync engine → transactional write-back + synchronous normalized reporting projection (`rpt_activities`/`rpt_attributes`), config as a stored validated artifact (`config.put`), engine-side `validateSubmission` (trio + datasource membership + reference existence). 13 acceptance tests incl. headless Complete Work Order. **Stage 2 done (2026-07-12):** browser hosts repointed — `records.partition` added; hooks + persistence are server-side only. |
| `@fluxus/client` | **Built at backend stage 2 (2026-07-12):** the browser hosts' door to the server — `connect()` fetches a scope's stored config + record partition (+ page set since stage 3) into the engine's `MemoryAdapter` (UI reads and FluxScript evaluation stay local + synchronous), `runActivity` round-trips `activities.run` then re-fetches the partition; `savePage`/`deletePage` write through the page snapshot. `@fluxus/server` is a type-only dependency; hard cutover — no localStorage fallback. |

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

DSL Phase 4 (headless invocation)                                ✅ done
  ├─ stage 1: backend — activities as the API surface            (2026-07-12)
  │  (tRPC + Hono/Lambda + Postgres per ARCHITECTURE.md)
  ├─ stage 2: browser hosts repoint from localStorage to the     ✅ done
  │  backend via @fluxus/client (Store swap made literal:        (2026-07-12)
  │  partition snapshot in, activities.run out, shared scope)
  └─ stage 3: page definitions repoint too — `pages` table on    ✅ done
     the config pipeline, repo page files as the deploy input    (2026-07-16)
     (deploying pages = deploying files); LocalStorageAdapter
     deleted — no localStorage left outside per-device UI prefs
```

## Sequence

1. **DSL Phase 1** — grammar, interpreter, schema-aware validator. Proven inside the sdm workbench: `show_condition` and `List` attributes with expression datasources (city → suburb dependency as the acceptance test).
2. **DSL Phase 2** ✅ — statements, `fail()`/`warn()`, `records` mutations, transactional after hooks with `queue`, named functions. Fills the sdm hook slots (plus, same cut: warn soft-stop confirmation, waivers/`can_waive`).
3. **DSL Phase 3** ✅ — `services` registry: module manifests with read/effect purity, registry-strict validation, `queue` dispatch incl. async posture; live modules `notify` + `geo` in the sdm workbench (plus, same cut: activity-level `show_condition` availability gate and the cancellation-as-compensation doctrine).
4. **Extraction** ✅ (July 2026) — activity engine pulled out of the sdm package into a shared core so both hosts drive it. **Stage 1:** `@fluxus/engine` extracted along the existing seam (`runActivity` + `Store`), sdm repointed, behaviour unchanged; the engine derives a CREATE activity's target type from config and returns `recordId` so hosts own their reactions. **Stage 2:** page builder hosts a Store (platform singleton, own storage key, reachable only through the declarative wiring layer) and gains the `run-activity` callback action — named callback → activity, contract (record, one data object), `callbackData` root in hooks, hook-written entry attributes, `services.logger`. The `event`-root payload-mapping sketch and manifest item-shape contracts were **superseded/deferred by ruling**: attributes come from the standard capture form (UI activities) or hook logic (non-UI), not from wiring expressions. Full design record: `packages/engine/docs/phases/EXTRACTION_Build_Summary.md`.
5. **Page wiring redesign + page validation** ✅ (2026-07-12) — pages speak FluxScript everywhere (design record: `packages/page-builder/docs/PAGE_WIRING_DESIGN.md`): dynamic props are single expressions with datasource posture, callbacks are scripts receiving `callbackData`, UI effects live on the host-injected `services.page` module and activity runs on the host-neutral `services.activities.run` (same manifest in every host — activity-running scripts stay portable to the Phase 4 headless host), page context IS the ctx root (permissive `context.page.*` by ruling). The DSL gained a `callback` validate mode (effects allowed, mutations rejected); the engine bridge gained `contextExtras` / `readonlyRecords` / `functionSignatures`. Save-time `validatePage` ships with it — component names against the registry, bindings against component schemas, expressions/scripts against the SDM schema + declared roots, literal `services.activities.run` ids against real activities — the guardrail for AI-built pages, same posture as `validateConfig` for AI-authored SDM config. Follow-ups left open by the design doc: expression↔function traversal + promote-to-function affordances, callback error contract shape, route params → ctx.
6. **DSL Phase 4 + backend — stage 1** ✅ (2026-07-12) — headless activity invocation over the agreed stack, in `@fluxus/server` (build record: `packages/server/docs/phases/PHASE4_BACKEND_Build_Summary.md`). Rulings made at kickoff: the Store contract **stays synchronous** — the server loads the scope's partition into the engine's new `MemoryAdapter` per request and writes the diff back in one transaction (no async evaluator rewrite; the Phase 3 async-shaped seam remains); PGlite (in-process Postgres) is the dev/test driver behind the same Drizzle schema Neon uses; the scope key is an opaque path string (`demo/sdm`). Shipped with it: engine `validateSubmission` (the headless parameter contract), config as a stored validated artifact, the normalized reporting projection written synchronously in-transaction, `geo` moved into the engine as the shared Store-backed module. Deliberately not in stage 1: GET activities (blocked on the unified-log design), auth (demo author stub), notifications storage (sink is pluggable, pending the same design), Lambda/Neon exercised for real.
7. **Backend stage 2 — hosts repoint** ✅ (2026-07-12) — the workbench and page builder swapped localStorage for the backend (build record: `packages/server/docs/phases/PHASE4_STAGE2_Build_Summary.md`). New `@fluxus/client` package (bootstrap snapshot: `config.get` + new `records.partition` into the engine's `MemoryAdapter`; re-fetch after every run; `@fluxus/server` type-only); both hosts share one scope (`demo/sdm`) and one stored config — "one model, many apps" literal. Rulings: bootstrap-snapshot + refetch (no async Store), server config with one shared scope, shared client package, hard cutover (no localStorage fallback; page builder's pages/templates stay local — they're not SDM records). The page-builder host sample's dispatch/reschedule activities merged into the sdm demo SDM (dispatch gains a `callbackData.crew is null` before-hook guard so a direct workbench run fails cleanly). Known consequence: the workbench notification bell is dormant — hooks (and their `notify`) run server-side; returns with the unified-log design. Still open: Neon account + first Lambda deploy, drizzle-kit migrations, GET activities, auth.

8. **Backend stage 3 — pages repoint** ✅ (2026-07-16) — page definitions move from browser localStorage to the server on the config pipeline: new `pages` table (`(scope, path)` PK, opaque jsonb def — `PageDef`/`validatePage` stay in the page builder, no server-side validation by construction), `pages.list/put/delete` tRPC procedures, `@fluxus/client` snapshots the page set at connect and writes through (`savePage`/`deletePage`), the page builder's `persistence.ts` keeps its synchronous API over that snapshot. Deploy story ruled with it: repo files under `page-builder/pages/` are the deploy input — the seed script upserts every `*.json` (file path = page path), so **deploying pages = deploying files** and deploys overwrite live edits; the demo page became the first such file. `LocalStorageAdapter` deleted from the engine (no host after the hard cutover; git history keeps it) — localStorage now holds only per-device UI preferences (UAT labels, notification last-seen) by ruling. PGlite stays as the dev/test driver by ruling (prod ignores it; the offline-question building block).

Parked (deliberately, with invariants locked now): org → operation → project hierarchy; SDM import/replication between projects; one-way workflow visualisation; named-function governance constraints.
