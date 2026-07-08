# @fluxus/dsl

The Fluxus scripting language (working name **FluxScript**): one DSL for attribute show conditions and datasources, before/after hooks, page-builder bindings, and headless workflows. A JS/SQL blend designed to be as learnable as SQL — no lambdas, no visible async, null-safe, case-insensitive, statically validated against the SDM at config-save time.

**Status: Phase 2 complete** (173 tests here + 14 wiring tests in `@fluxus/sdm`). Phase 1 (grammar D1–D14 signed off; lexer, parser, evaluator, schema-aware validator; `show_condition` + `List` datasources live in the workbench) plus the Phase 2 scripts tier: statements (`let`, `if/else`, `for each`, assignment), `fail`/`warn`, staged record mutations with atomic commit (`update`/`create`/bulk-with-`where`), `queue` outbox, named functions — all wired into the sdm hook slots (Complete Work Order is the acceptance case). The page-builder `run activity` callback moved to the Extraction milestone (root ROADMAP). See [docs/phases/](docs/phases/). Next: Phase 3 — services registry.

```
records.resources
  .where(rest_type = 'Labour' and status = 'Active')
  .orderBy(name)
  .select(id, name, rate)
```

## Docs

- [docs/DSL_SPEC.md](docs/DSL_SPEC.md) — the language specification (founding doc, living truth)

## Design pillars

- **Three tiers, one grammar:** expressions → queries → scripts; each embedding point admits a tier.
- **Four roots:** `context`, `attributes`, `records`, `services` — the entire injectable environment; every script is a function.
- **Gate/effects hooks:** before hook validates only (`fail`), after hook acts — transactionally, with `queue` for fire-and-forget service dispatch on commit.
- **Own grammar + TS tree-walking interpreter**, identical in browser and server.
