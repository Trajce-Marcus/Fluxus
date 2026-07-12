# @fluxus/engine — Living Spec

The shared activity engine: the host-agnostic SDM core extracted from
`@fluxus/sdm` at the Extraction milestone (July 2026). Everything here used to
live inside the workbench; the pipeline semantics did not change in the move —
per-step doctrine (gate fail-closed rules, warn soft stop, waivers,
exact-key mapping, staged after-hook commits) is specified in the sdm SPEC's
Hooks section and DSL_SPEC §5–§7, which remain the authority for behaviour.
This SPEC covers what the engine *owns* and the contracts hosts program
against.

## Why a separate package (fork 1, decided 2026-07-11)

- Dependency direction is `dsl` ← `engine` ← hosts (`sdm`, `page-builder`).
  The engine *uses* the language; the language stays ignorant of records,
  workflows, and history — that ignorance is load-bearing (scope-blindness).
- Peer hosts must not depend on each other; the shared pipeline is a literal
  artifact both import, not a pattern they imitate.
- One Pipeline Invariant made structural: there is exactly one `runActivity`.

## What the engine owns

```
src/types.ts       — SDM config + runtime types (ConfigRaw, RecordTypeDef,
                     ActivityDef, RecordInstance, ActivityHistoryEntry, …)
src/store.ts       — the Store contract (the persistence seam)
src/memoryAdapter.ts — the in-memory Store: all reference behaviour, no storage
                     (extracted from LocalStorageAdapter at DSL Phase 4)
src/localStorageAdapter.ts — MemoryAdapter + localStorage persistence (browser)
src/bridge.ts      — SDM ↔ DSL translation (schema, hosts, coercion, four roots)
src/validateConfig.ts — config-save-time validation of every FluxScript script
src/validateSubmission.ts — headless payload validation (DSL Phase 4): the
                     attribute trio + datasource membership as one check
src/services/geo.ts — shared geo module (Store-backed, host-agnostic)
src/engine.ts      — createEngine: the runActivity pipeline + evaluation entry
```

What it deliberately does **not** own: UI of any kind, React, selection state,
notification surfaces (`NotificationLog` stays in sdm), service module
*implementations* with host-owned sinks (hosts supply them; the engine only
carries them to the evaluator/validator — `notify` differs per host), and the
SDM config itself (config distribution is an open thread — see root ROADMAP).
Two service modules are engine-owned because their sink/source is engine
state: `logger` (sink = the history entry) and, since DSL Phase 4, `geo`
(source = Store reference data; moved from sdm so all three hosts share one
implementation).

## The Engine object

```ts
const engine = createEngine({ store, config, services? });
```

One engine per host per SDM — a platform singleton created at bootstrap
(fork 2), *not* inside any UI framework's state.

- `engine.runActivity(activity, captured, anchorRecord, options?)` — the
  pipeline: availability gate → before hook (read-only gate; warn = soft stop
  returning `needs-confirmation`) → record_map mapping (CREATE/UPDATE/DELETE/
  append) → history append → after hook (staged, atomic commit).
  `options`: `acknowledgedWarnings`, `waived`.
- `engine.activityAvailability(activity, anchorRecord)` /
  `isActivityAvailable(...)` — the activity-level `show_condition` gate,
  fail-closed. UIs use it to hide; `runActivity` re-checks it as the
  enforcement point (headless callers skip the UI).
- `engine.evaluate(source, scriptContext)` — expression evaluation (datasources,
  show conditions) against the live store with the four roots injected.
- `engine.validateConfig()` / `engine.reportConfigFindings()` — every
  FluxScript surface in the config checked against the schema + service
  registry; report goes to the console.
- `engine.store` — the Store the engine was built with (host convenience).

### RunActivityResult

`{ status: 'done' | 'needs-confirmation', warnings, recordId? }`.
`recordId` (added at extraction) is the record acted on — created, updated,
appended to, or deleted; absent when nothing persisted (needs-confirmation, or
a DELETE whose confirm text didn't match). Hosts use it to react (the
workbench deselects a deleted record).

## App-triggered runs (Extraction stage 2, ruled 2026-07-11)

An app triggers an activity through a host's named-callback wiring; the
callback contract is **(record, one data object)** — the host resolves the
record to the anchor and passes the object as `options.callbackData`.

- **`callbackData` root** — the data object, injected as an embedding-point
  extra root into both hooks (like `value` in validation rules); `null` on
  direct (workbench-form) runs. The validator accepts it in any hook — every
  activity may be app-triggered. Untyped (validated as UNKNOWN); its shape is
  the implementer's contract with their component.
- **UI vs non-UI activity** — with attributes, the host opens the standard
  capture form and the run proceeds normally; with no attributes there is
  nothing to fill in and the run passes straight to the hooks.
- **Hook-written attributes** — hooks may assign onto the `attributes` root
  (`attributes.crew = callbackData.crew`); new or changed keys land on the
  history entry alongside what the user typed. Enabled by the live-bag
  mechanism (`ScriptContext.liveAttributes`): the same object is shared with
  the evaluator un-copied, and the engine diffs it after the after hook. If
  the after hook fails, its attribute writes are discarded with the rest of
  its effects ("recorded, but no changes applied").
- **`services.logger`** — engine-owned module, name reserved: `note(message)`
  appends to the run's system log, which lands on the entry as the reserved
  `system_log` attribute. The pipeline is the log — there is no separate log
  store. `kind: 'read'` deliberately, so it is callable from any hook;
  lines are discarded when no entry commits (rejected gate, cancelled soft
  stop, DELETE).
- **Entry append order** — the entry is appended *after* the after hook runs
  (one write carrying user input + hook-written attributes + system log), but
  a failing after hook still appends the entry before the error propagates —
  the activity is recorded; no changes were applied. Gate warnings ride the
  entry; after-hook warnings only travel in the result (host's channel).

### Host-leak removals made during extraction

- **CREATE target type is derived, not supplied.** The workbench used to pass
  its UI selection ("currently selected record type"); the engine instead maps
  each CREATE activity to the record type whose workflow declares it, at
  `createEngine` time. Behaviour is identical for well-formed configs (an
  activity belongs to one workflow; a record type points at its workflow);
  configs where two record types share a workflow with a CREATE activity are
  currently ambiguous (last mapping wins) — revisit if that ever becomes
  legal.
- **DELETE deselection moved to the host**, driven by `recordId`.
- **After-hook warnings are returned, not printed.** Surfacing them is the
  host's job; the engine has no UI channel. (The workbench keeps its console
  channel; a toast slot may take over later.)

### Host channels that remain engine defaults (deliberate, for now)

- `context.user` is the demo stub (`{ id: 'demo', name: 'Demo User' }`) until
  auth exists — set in `buildEvalHost`.
- Async `queue` dispatch failures land on `console.warn` via the bridge's
  `onQueuedFailure`. Both become host-supplied when a second host needs them
  to differ.

## The Store contract

`src/store.ts` — unchanged from the sdm original: type/def/data reads, staged
mutation halves (`buildRecord`/`insertRecord`, `validateUpdate`/apply),
`appendActivity`, `subscribe`, FK display/reverse-ref resolution. It is the
persistence seam — and it is deliberately **synchronous**: the backend host
(@fluxus/server, DSL Phase 4) does not implement an async Store; it loads the
scope's partition into a `MemoryAdapter` per request, runs the sync engine,
and writes the diff back transactionally (root ARCHITECTURE.md
"partition-fetch + filter"). The DSL's async-shaped API remains the seam if a
truly async evaluator is ever needed.

`MemoryAdapter` (extracted at DSL Phase 4) is the reference implementation:
workflow/attribute resolution, constraint checks, staged mutation halves,
seeding, natural-id migration — with a protected `persist()` no-op hook and
`allRecords()` for diffing hosts. `LocalStorageAdapter` subclasses it, shared
by both browser hosts and parameterised by key (fork 2): each host names its
own `storageKey` (sdm: `fluxus:sdm:records`; page builder:
`fluxus:page-builder:records`) — separate data per host until the browser
hosts repoint at the backend, making "one model, many apps" literal.
`legacyStorageKey` supports one-time key renames (merge once, remove old
key).

### validateSubmission (DSL Phase 4)

`validateSubmission(engine, activity, captured, anchorRecord, waived)` — the
attribute trio applied as one payload check for callers with no capture form,
per DSL_SPEC §5 ("in headless mode the datasource doubles as validation").
Semantics mirror the workbench's AttributesForm: attribute show_conditions
fail OPEN (the activity-level gate inside runActivity is the fail-closed
one); hidden attributes are exempt from `required`; waivers need can_waive +
a reason; validation rules run on non-empty values with typed `value`
injected. Headless-strict additions the form guarantees by construction:
unknown keys, values supplied for hidden attributes, list values outside
their datasource (fail closed on datasource errors), and dangling references
are all rejected. The workbench form keeps its interactive per-field checks;
folding it onto this function is an open cleanup.

## Bridge and validation

`bridge.ts` translates between SDM shapes and the DSL's hosts: config →
`DslSchema` (short type names, `rt_` stripped; service manifests in),
Store → `RecordsHost` (queries, FK targets, reverse refs, the `mutate`
staging surface), captured strings → typed script values (`coerceCaptured`),
and `buildEvalHost` assembling the four roots + named functions.
`validateConfig.ts` is the config-save-time check (DSL_SPEC §9) over every
datasource, show condition, validation rule, hook, and named function.
Both moved verbatim from sdm.

Host knobs on `ScriptContext` (page wiring redesign, 2026-07-12):
`contextExtras` merges extra members into the `context` root itself — how the
page host injects `context.page` and `context.app` (page context IS the ctx
root, not a parallel construct); `readonlyRecords` omits the records mutation
surface, so record writes fail at runtime even in `mutate`-mode scripts — the
page-callback posture (service effects allowed, direct writes never).
`functionSignatures(config)` exposes the named-function signature map for
hosts running their own `validate*` calls (validatePage in the page builder).
