# Extraction — Build Summary

Point-in-time snapshot at milestone close (2026-07-12). Append-only; the
living truth is `docs/SPEC.md`.

## What the milestone was

Pull the activity engine out of `@fluxus/sdm` into a shared core and make the
page builder its second host. Design forks were presented for the user's
ruling before each build stage (their working mode).

## Design record

- **Fork 1 — where the engine lives** (2026-07-11): separate package
  `@fluxus/engine`. User's stated preference; independently supported by the
  technical analysis (dependency direction `dsl` ← `engine` ← hosts; peer
  hosts must not depend on each other; the Store seam was already pure).
- **Fork 2 — how the page builder hosts the Store** (2026-07-11, Claude
  recommended / user approved): platform singleton at bootstrap, never in
  React state; components reach the SDM only through the declarative wiring
  layer; the engine's `LocalStorageAdapter` parameterised by host-named
  storage key (`fluxus:page-builder:records`); no cross-host data sharing
  until the backend — no sync mechanism (One Pipeline Invariant).
- **Forks 3/4 — app-triggered activities** (respecified by the user,
  2026-07-11/12, superseding the old "payload as `event` root" sketch in the
  ROADMAP/page-builder SPEC):
  - The implementer owns the container wiring; a component's **named
    callback** is associated there with an activity id.
  - Callback contract: **(record, one data object)**.
  - UI activity → the standard capture form opens, run proceeds normally.
    Non-UI activity (no attributes) → nothing to fill in; straight to hooks.
  - The data object reaches hooks as the **`callbackData` root** (an
    embedding-point extra root, like `value`; named by the user).
  - **Hooks may write attributes onto the entry** (`attributes.crew = …`) —
    immutable means users never edit history; hook logic legitimately writes
    it. The prior "capturedAttributes = exactly what the user entered, never
    touched by scripts" doctrine was revised by this ruling.
  - **`services.logger`** (user's naming) — hook-callable anywhere; lines
    land on the entry as the reserved `system_log` attribute. The pipeline is
    the log.
  - **Manifest item-shape contracts deferred**: with attributes coming from
    the standard form or hook logic, wiring-expression payload mapping (the
    contracts' main consumer) was dropped; revisit only if silent payload
    mapping becomes needed.
  - User's observation, recorded: an activity is a function with an optional
    UI plus a before hook — independently re-derives the Phase 4 headless
    thesis.

## Stage 1 (commit 0725c59)

`@fluxus/engine` created: `createEngine` (runActivity pipeline, availability
gate, evaluate, config validation), `Store` contract, `LocalStorageAdapter`,
DSL bridge, core types — moved from sdm along the existing seam; sdm
repointed, behaviour unchanged. Host-leak fixes: CREATE target type derived
from config (was the workbench's UI selection ref); `RunActivityResult.recordId`
added so hosts own their reactions (deselect on delete); after-hook warnings
returned, not printed. Verified: engine+sdm tsc, 21 sdm + 186 dsl tests,
workbench Playwright smoke (Create Work Order end-to-end, after hook set
status).

## Stage 2

Engine: `RunActivityOptions.callbackData` → `callbackData` extra root in both
hooks (validator accepts it in any hook); live attribute bag
(`ScriptContext.liveAttributes`) so hook member-assignments are diffed onto
the entry (zero DSL changes — plain-object member assign already existed);
entry appended after the after hook in one write (still appended when the
hook fails); gate warnings ride the entry, after-hook warnings only the
result; engine-owned `services.logger` (name reserved) buffering per run into
the `system_log` entry attribute.

Page builder: `src/sdm-runtime/` (engine singletons + own sample SDM config +
minimal capture form + seeded demo page `pages/work-orders-demo`);
`run-activity` callback action in `SlotConfig`; container launches the form
or runs directly, `window.confirm` for warn soft stops, errors to the page
error surface, dynamic props re-fetch after a run; store-backed procedure
`sdm.listWorkOrders`.

Verified by Playwright smoke: config validates clean at boot; dispatch
(non-UI) updated the record via `context.record.update`, wrote `wo`/`crew`
attributes and the `system_log` line onto the entry, UI refreshed; second
dispatch blocked by the availability gate with the error surfaced; reschedule
opened the capture form and persisted the UPDATE with its entry.

## Open threads at close

- Config distribution: each host ships its own sample config; canonical
  config home undecided (ties to tt_todo "update config via tool").
- Shared capture form: page builder's is a deliberate text/date+required
  subset of the workbench form; where a full shared form lives (peer hosts
  can't import each other) is undiscussed.
- `record` as a top-level DSL root (user floated; anchor stays at
  `context.record` for now) — language-wide change, needs its own discussion.
- Warn soft-stop dialog on pages is `window.confirm` — a styled platform
  dialog can replace it without design change.
