# DSL Phase 1 — Build Summary (July 2026)

> Point-in-time record; never edited after the phase closes. Living truth is [../DSL_SPEC.md](../DSL_SPEC.md) and [../GRAMMAR.md](../GRAMMAR.md).

## Scope delivered

Expressions + queries tier of FluxScript, end to end: grammar → lexer → parser → evaluator → schema-aware validator → wired into the sdm workbench. 118 tests in `@fluxus/dsl`, 7 wiring/acceptance tests in `@fluxus/sdm`.

## What was built

1. **Grammar** (`GRAMMAR.md`) — EBNF, precedence, lexical rules. All decisions D1–D14 signed off with the user (D11 snapshot variables provisional, building per recommendation). Notable calls: SQL-style `=` comparison, single-quoted strings with `''` escaping, `//` comments only, no semicolons, JS-way null semantics (D5), no lambdas (bare-field scope in `where`), no JOIN (navigations: FK auto-deref, reverse-FK properties, subquery membership), `r.update({...})` mutation shape with mandatory-`where` bulk updates (Phase 2).
2. **Lexer** (`src/lexer.ts`) — case-insensitive, newline statement termination with continuation rules, teaching errors for `"` and `;`.
3. **Parser** (`src/parser.ts`) — recursive descent, one function per grammar rule; AST carries positions.
4. **Evaluator** (`src/evaluator.ts`, `src/host.ts`) — four roots injected via `EvalHost`/`RecordsHost`; null-safe navigation; case-insensitive compare/sort/`like`; FK auto-deref via `FkPointer`; reverse-FK navigation; chains `where/orderBy/select/values/top/first/count`; builtins + date methods; snapshot copies; step/row/time quotas; strict booleans in conditions; division-by-zero errors.
5. **Validator** (`src/validator.ts`) — shape-tracking static check: unknown types/fields, FK paths, reverse nav, rows-by-column, arity, select aliases, property/method confusion; `ctx`/`attrs`/`services` pass untyped (no false positives), `anchorType` types `ctx.record`; `lintSchema` for root shadowing.
6. **Workbench wiring** (`packages/sdm/src/dsl/`) — `bridge.ts` (config → `DslSchema`, Store → `RecordsHost`, `buildEvalHost`), `validateConfig.ts` (all config expressions validated at app start), `show_condition` + `List` attributes in AttributesForm with dependent re-evaluation and stale-selection clearing; entity seeds (cities/suburbs) so the picker works out of the box.

## Acceptance case

`records.suburbs.where(city_id = attrs.city).orderBy(name).top(50)` as the suburb picker's datasource, with `show_condition: "attrs.city is not null"` — the city → suburb dependent attribute, proven headlessly in `packages/sdm/test/dsl-wiring.test.ts` and live in the workbench via Work Orders → Set Location.

## Deliberate simplifications (not bugs)

- Evaluator materializes eagerly (fetch-all-then-filter); quotas are the fuse. The designed fix is query-plan pushdown behind `RecordsHost` (spec §9 scale strategy) — no language change.
- `ctx.user` is a demo stub until auth exists.
- `List` renders as a single/plain select; grid picker with `columns`, and multi-select, come with later UI work.
- Statements tier (`let`, `if`, `for each`, `fail`, `queue`, mutations) is specified and grammar'd but not implemented — that is Phase 2.
