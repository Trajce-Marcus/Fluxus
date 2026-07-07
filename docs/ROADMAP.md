# Fluxus — Roadmap

Cross-package phases and their interlocks only. Per-package detail lives in each package's `docs/phases/`.

## Where things stand (July 2026)

| Package | Status |
|---|---|
| `@fluxus/sdm` | POC1·a complete + DSL Phase 1 wired: `show_condition` and `List` attributes run FluxScript live (city → suburb acceptance case in Work Orders → Set Location); config validated at startup; entity seeds. Hooks remain no-op slots (DSL Phase 2). |
| `@fluxus/page-builder` | Shell + layout editor + ComponentContainer architecture done. Wiring is structural (context keys / mock procedures), callbacks UI-only. |
| `@fluxus/dsl` | **Phase 1 complete** (125 tests incl. sdm wiring): grammar signed off (D1–D14), lexer + parser + evaluator + schema-aware validator, wired into the sdm workbench. Next: Phase 2 (scripts tier — hooks, mutations, fail/queue). |

## Phase interlocks

```
DSL Phase 1 (expressions + queries + validator)
  ├─► sdm: show_condition + List attribute datasources (incl. attrs.-dependent)
  └─► page-builder: dynamic props become DSL expressions

DSL Phase 2 (scripts: hooks, mutations, fail/queue)
  ├─► sdm: before/after hooks fire for real (status finally moves)
  └─► page-builder: `run activity` callback action

DSL Phase 3 (services registry)
  └─► both hosts: notify / geocode / published functions

DSL Phase 4 (headless invocation)
  └─► backend: activities as the API surface (tRPC + Lambda + Neon per ARCHITECTURE.md)
```

## Sequence

1. **DSL Phase 1** — grammar, interpreter, schema-aware validator. Proven inside the sdm workbench: `show_condition` and `List` attributes with expression datasources (city → suburb dependency as the acceptance test).
2. **DSL Phase 2** — statements, `fail()`, `records` mutations, transactional after hooks with `queue`. Fills the sdm hook slots; adds `run activity` to page-builder callback actions (with payload as `event` root) and manifest item-shape contracts.
3. **DSL Phase 3** — `services` registry with one or two real modules.
4. **Extraction** — activity engine pulled out of the sdm package into a shared core once both hosts drive it (the seam already exists: `runActivity` + `Store` interface).
5. **DSL Phase 4 + backend** — headless activity invocation over the agreed stack; `Store` swaps from localStorage to the real adapter.

Parked (deliberately, with invariants locked now): org → operation → project hierarchy; SDM import/replication between projects; one-way workflow visualisation; named-function governance constraints.
