# DSL Phase 2 — Build Summary (July 2026)

> Point-in-time record; never edited after the phase closes. Living truth is [../DSL_SPEC.md](../DSL_SPEC.md) and [../GRAMMAR.md](../GRAMMAR.md).

## Scope delivered

Scripts tier of FluxScript, end to end: statements → staged mutations with atomic commit → `queue` outbox → named functions → wired into the sdm hook slots, with the workbench UX to match (warn soft-stop, waivers). 173 tests in `@fluxus/dsl` (up from 118), 14 wiring/acceptance tests in `@fluxus/sdm` (up from 7).

The page-builder `run activity` callback, originally listed in this phase, was **re-scoped to the Extraction milestone** (root ROADMAP): it is blocked on the page builder hosting the SDM store, not on language work. Phase 2 closed without it.

## What was built

1. **Statements** (GRAMMAR §5, no longer provisional) — `let` (block-scoped), assignment (`x = …` / member writes on plain objects; records reject them pointing to `.update`), `if / else if / else`, `for each` (null-safe), `return`, newline termination, mandatory braces. New parser entry points `parseScript` / `parseFunction`; lexer change: braces no longer suppress newlines (object literals get parser-level newline tolerance instead).
2. **`fail` / `warn`** — `fail('msg')` throws `FluxFailError` (user-facing verbatim); `warn('msg')` accumulates into `ScriptResult.warnings`.
3. **Transactional mutations** (D13/D14 confirmed, D11 resolved) — `r.update({…})`, `records.<type>.create({…})`, bulk `.where(…).update({…})` (evaluates to affected count). Staged during the run; committed atomically by `executeScript` only on success. Constraint checks (`required`/`unique`/`immutable`) run at staging time via the host's `prepareCreate`/`prepareUpdate`. Read-your-writes: new reads (queries, FK derefs, `context.record`) see staged state; earlier snapshots stay put; created records carry final ids immediately. Records handed out by plain-object roots are snapshotted — scripts never alias live store objects.
4. **`queue` outbox** — arguments evaluate at the statement; dispatch only after commit; a failed dispatch becomes a warning (commit already happened). Rejected statically and at run time outside after hooks.
5. **Named functions** (§8) — parsed lazily from `EvalHost.functions`, explicit params + implicit roots, lexically isolated (no caller variables), callable from every tier, call-depth guard. Governance floor at config validation: mandatory description, flat namespace, declared name must match the collection entry.
6. **Validator, scripts tier** — `validateScript` (mode `before`/`after`) / `validateFunction`: scope tracking (use-before-declare, redeclare, root/builtin shadowing), variable shape flow, before-hooks-validate-only, bulk-update-needs-`where`, projections-not-updatable, mutation field keys checked against the schema, queue-must-target-services, named-function arity. Expression tier rejects mutations and `fail`/`warn`.
7. **SDM hook pipeline** — `runActivity`: before hook (gate, read-only) → record_map mapping → history append → after hook (effects, mode `mutate`). `fail`/runtime error in the gate blocks; a failing after hook applies nothing but the activity stays recorded. Adapter grew the staging seam (`buildRecord`/`insertRecord`/`validateUpdate`); bridge exposes `mutate`, named functions, `joinScript` (array-of-lines hook/function bodies); startup validation covers hooks and functions. Hooks receive type-coerced attribute values; script `Date`s serialize to date-only strings at local midnight.
8. **Warn soft-stop + audit** (same cut, user-driven) — gate warnings return `needs-confirmation` (nothing persists); the form locks its fields and offers Continue anyway / Cancel; Continue submits the frozen validated snapshot. Acknowledged warnings are recorded on the history entry (`warnings` field, separate from `capturedAttributes`).
9. **Waivers** (same cut, user-driven) — `can_waive` on an attribute usage: a required value may be declared unavailable via a "Can't provide" toggle with a mandatory reason; stored as `waived: { key: reason }` on the history entry; the record field is never written (CREATE seeds default, UPDATE untouched); scripts see null. Sample: `serial_no` on `act_create_assets`.

## Acceptance case

`act_complete_work_orders` (no `record_map` — the domain rule "status changes only via hooks" working for the first time): before hook `fail`s when already Completed and `warn`s when never started; after hook moves `status`/`completed_date` via the staged commit. Proven headlessly in `packages/sdm/test/dsl-wiring.test.ts` and live in the workbench.

## Deliberate simplifications (not bugs)

- Evaluator stays synchronous; the async-under-the-hood interpreter arrives when a host actually needs it (services/backend).
- `apply` failures mid-commit are not rolled back store-side (script-level atomicity is complete; store-level is the backend's transaction when it lands).
- Function bodies validate in 'after' (permissive) mode; the calling surface's rules are enforced at run time.
- After-hook warnings surface on the console only (toast slot pending); the activity log stream (analysis-grade warnings, outcomes) belongs to Phase 4.
- `context.user` remains a demo stub until auth exists.
