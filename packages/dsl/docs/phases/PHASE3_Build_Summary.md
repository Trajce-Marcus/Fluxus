# DSL Phase 3 — Build Summary (July 2026)

> Point-in-time record; never edited after the phase closes. Living truth is [../DSL_SPEC.md](../DSL_SPEC.md) (§7a) and the sdm SPEC ("Services").

## Scope delivered

The `services` root became a **registry of manifest-carrying modules**, with purity enforcement, registry-strict validation, and two live modules in the sdm workbench. 186 tests in `@fluxus/dsl` (up from 173), 21 wiring/acceptance tests in `@fluxus/sdm` (up from 16).

**Async fork (Claude recommended deferral; user approved):** the evaluator stays synchronous; the async internal-await refactor is deferred to the backend phase. The registry API is async-shaped now (functions may return Promises) so nothing renames later — only evaluator internals change.

## What was built

1. **Registry types** (`host.ts`) — `ServiceModuleDef` / `ServiceFunctionDef`: name, mandatory description, `params`, `kind: 'read' | 'effect'`, `fn`. `EvalHost.services` migrated from an untyped bag to `ServiceModuleDef[]`; new `EvalHost.onQueuedFailure` hook for async dispatch failures.
2. **Evaluator** — `services` resolves through `ServicesRoot`/`ServiceModuleValue` wrappers: unknown module/function are runtime errors; case-insensitive like the language; bare member access on a module errors ("service functions are called, not read"). **Purity at run time:** `effect` calls outside `mode: 'mutate'` are errors. **Async posture:** a waiting call returning a Promise errors (pointing at `queue`); `queue` dispatch accepts Promises fire-and-forget, rejections land on `onQueuedFailure` (the script has already returned — they can't become warnings; sync dispatch failures still do).
3. **Validator** — `DslSchema.services` (+ `servicesSchema(modules)` helper): unknown module, unknown function, and arity are config-save-time errors; effect calls are errors in expressions and before hooks and a **warning** (non-transactional, prefer `queue`) as waiting calls in after hooks; `queue` statements resolve module/function/arity through the same path. Without `schema.services` the old untyped pass-through holds (hosts without a registry).
4. **sdm `notify` module** (effect) — `user(message)`, `email(to, subject, body)`; lands in the new `NotificationLog` (localStorage, capped, subscribe pattern) rendered as the header **notification centre** (bell + unseen badge + newest-first panel + clear).
5. **sdm `geo` module** (read) — `suburbsOf(city)` over the seeded reference data; the suburb `List` datasource switched from the inline query chain to `services.geo.suburbsOf(attributes.city)` — the spec's own example, live.
6. **Sample wiring** — `act_complete_work_orders` after hook ends with `queue services.notify.user('Work order ' + context.record.id + ' was completed')`; `validateConfig`/`reportConfigFindings`/`buildDslSchema`/`buildEvalHost` all take the registry, so the shipped config is checked strictly at startup.

## Also in this cut (pre-phase, user's tt_todo "important" items)

- **Activity-level `show_condition`** — the availability gate: first step of the `runActivity` pipeline, fails closed, `attributes` root banned (new validator `bannedRoots` mechanism — embedding points can withhold a standard root). UI hides unavailable activities; work-order activities gated on `status <> 'Completed'`.
- **Cancellation doctrine** — cancel = modeled compensating activity, never history edits; recorded in the sdm SPEC + GLOSSARY, no machinery needed.

## Acceptance cases

- **Read path:** the city → suburb dependent picker (Phase 1's acceptance) now runs through a service call end to end.
- **Effect path:** completing a work order posts exactly one notification, only on commit — a `fail`ing hook or a soft-stop Cancel dispatches nothing (outbox proven through the UI and headlessly in `packages/sdm/test/dsl-wiring.test.ts`).

## Deliberate simplifications (not bugs)

- Sync evaluator; waiting async calls error until the backend-phase async refactor (deferral recommended by Claude, approved by the user).
- `queue`ing a `read` function is allowed silently (pointless but harmless).
- POC `notify` "sends" to the in-app notification centre only; `email` records, never delivers. A real gateway slots behind the same manifests.
- Async `queue` dispatch failures go to the console via the bridge; a toast/banner slot may take over later.
- Published functions on the `services` root (the read-surface idea superseded by GET activities) remain out of scope.
