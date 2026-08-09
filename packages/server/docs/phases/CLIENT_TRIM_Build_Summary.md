# Trim the model by role — build summary (2026-08-09)

Point-in-time snapshot. Append-only; not edited after the phase closed.

Step 1 of the sequencing in root
[CLIENT_TRUST_BOUNDARY.md](../../../../docs/CLIENT_TRUST_BOUNDARY.md) §2.
Living truth: this package's SPEC ("What the client is given"), the engine SPEC
("Two grades of model"), the client SPEC.

## What shipped

The finding, in one line: **the data was filtered, the model was not.**
`config.get` returned the entire `SolutionConfig` to any caller, so a runtime
user who could read one record type still received every other type's
definition, every activity, **every hook body**, and the `access.read` rules
that excluded them.

Closed with **two separate procedures rather than one that filters harder** — a sol admin authoring in the Console
genuinely needs the whole model:

| | Audience | Gate | Returns |
|---|---|---|---|
| `config.get` | design plane | **sol admin** (was: open) | `SolutionConfig`, whole |
| `config.getForOperation` | runtime plane | op user, then the role trim | `ClientSolutionConfig` |

## Code shape

- **`packages/engine/src/types.ts`** — every config type now has a `Client*`
  grade, declared **first**, which the full grade extends. Code typed against
  the narrow one cannot compile a reference to `before_hook`: the trim is
  structurally unreachable, not merely filtered at runtime.
- **`packages/engine/src/bridge.ts`** — `activityHooks(activity)`, the one place
  that widens a client activity back to the full def. The two hook-reading sites
  (`MemoryAdapter`'s workflow resolution, `validateConfig`'s hook pass) go
  through it, so "hooks may simply not be here" is stated once. Everything in
  the engine that takes a config now takes the **narrow** grade.
- **`packages/server/src/projection.ts`** (new) — `projectConfig`, pure, and
  `computeReadable` moved here from the router: one answer now governs both
  halves of a snapshot, the data and the model.
- **`packages/client/src/index.ts`** — `FluxusClient<C extends
  ClientSolutionConfig>`. `connect` yields the narrow grade, `connectSolution`
  the full one; hosts that only render and run take `FluxusClient`
  unparameterised and get the narrow one.
- **`packages/page-runtime`** — `PageRuntime.config` and the page host narrow to
  `ClientSolutionConfig`; pages run on both planes, so the narrower grade is
  what they may rely on.

## The rule the projection rests on

**It builds its output by naming each field that goes in.** Removing fields
instead (`delete config.hooks`) leaks every field added to the model later,
until somebody remembers. Naming what goes in makes new fields invisible until
somebody deliberately exposes them — the field table is in the SPEC.

Decisions taken during the build, beyond the design's table:

- Record-type fields ship as key + **label** + type + FK wiring; storage
  constraints (`required`/`unique`/`immutable`/`indexed`/`default`) do not —
  nothing client-side builds a record. The design asked for labels and the model
  had none, so `CustomFieldDef.label` was **added** (optional, key as the
  fallback via `fieldLabel`, a Label column in the Console's record-type editor,
  used by the workbench grid, record view, related records and schema
  navigator).
- The attribute pool ships **by reference**, transitively through composite
  sub-usages, rather than wholesale.
- Function reachability is transitive through bodies, detected by an
  over-inclusive bare-name call scan: shipping an uncalled function is harmless,
  missing one breaks an expression.
- `default_menu` rides through untouched — the runtime cannot render navigation
  without it, and the operation's override arrives untrimmed from
  `operations.get` anyway.
- The trim runs **in memory** over the assembled model rather than as `WHERE`
  clauses: one round trip either way, and a pure function is testable without a
  database.

## Tests

`test/projection.test.ts` (14, no database — the function is pure), including
the growth-proof one the design asked for: **no hook key appears anywhere in the
output**, under every grade of access. `test/rbac.test.ts` gained the wiring
cases (trimmed per role, entry checked first, env stub open);
`test/soladmins.test.ts` now asserts the `config.get` refusal, not just the
grant.

## Consequences to know about

Both from tightening `config.get`:

- An org admin who is not a sol admin of a solution can no longer open its model
  in the Console. `connectSolution` surfaces the refusal instead of opening a
  blank editor.
- The operation-menu screen reads the inherited `default_menu` through
  `config.get`, so an op admin who does not build the solution now sees it as
  empty. The call already caught and degraded.

`max_count` **still ships** (corrected the same day): only `max_size_mb` is
stripped, because it gates the presign before bytes move. The capture widget
keeps stopping the user at the add tile — client-side validation, never
enforcement, exactly like validation expressions.

## Not in this phase

The second cut in §2 — **trimming by page**, the larger payload win — waits on
the page declaration (§7). It lands as another option on `projectConfig`, not a
second function.
