# @fluxus/dsl

The Fluxus scripting language (working name **FluxScript**): one DSL for attribute show conditions and datasources, before/after hooks, page-builder bindings, and headless workflows. A JS/SQL blend designed to be as learnable as SQL — no lambdas, no visible async, null-safe, case-insensitive, statically validated against the SDM at config-save time.

**Status:** Phase 1 in progress. Grammar signed off (GRAMMAR.md D1–D14; D11 provisional). Lexer and expression/query parser implemented and tested (`npm test`). Next: evaluator with the four injected roots, then the schema-aware validator, then wiring into the sdm workbench.

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
