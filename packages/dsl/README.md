# @fluxus/dsl

The Fluxus scripting language (working name **FluxScript**): one DSL for attribute show conditions and datasources, before/after hooks, page-builder bindings, and headless workflows. A JS/SQL blend designed to be as learnable as SQL — no lambdas, no visible async, null-safe, case-insensitive, statically validated against the SDM at config-save time.

**Status: Phase 1 complete** (118 tests here + 7 wiring tests in `@fluxus/sdm`). Grammar signed off (GRAMMAR.md D1–D14; D11 provisional); lexer, parser, evaluator (four roots via `EvalHost`, null-safety, case-insensitive comparison, FK auto-deref, reverse-FK navigation, chains, builtins, quotas, snapshot copies) and schema-aware validator all built and tested; wired into the sdm workbench (`show_condition` + `List` datasources, city → suburb acceptance case live). See [docs/phases/PHASE1_Build_Summary.md](docs/phases/PHASE1_Build_Summary.md). Next: Phase 2 — scripts tier (hooks, mutations, `fail`/`queue`).

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
- **Four roots:** `ctx`, `attrs`, `records`, `services` — the entire injectable environment; every script is a function.
- **Gate/effects hooks:** before hook validates only (`fail`), after hook acts — transactionally, with `queue` for fire-and-forget service dispatch on commit.
- **Own grammar + TS tree-walking interpreter**, identical in browser and server.
