# @fluxus/engine — Living Spec

The shared activity engine: the host-agnostic SDM core extracted from
`@fluxus/sdm` (now `@fluxus/runtime`) at the Extraction milestone (July 2026). Everything here used to
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
src/types.ts       — SDM config + runtime types (SolutionConfig, RecordTypeDef,
                     ActivityDef, RecordInstance, ActivityHistoryEntry, …)
                     `SolutionConfig` was `ConfigRaw` until 2026-08-07: one of
                     these IS one solution's model (`sdm_configs.config`, keyed
                     by solution id), and the `Raw` suffix paired with nothing
                     — there is no cooked top-level config. The inner
                     `WorkflowRawDef`/`ActivityRawDef` keep theirs, because
                     those do pair with resolved forms. Type-only rename: no
                     stored jsonb changed. Since 2026-08-09 every config type
                     comes in two grades — see "Two grades of model" below.
src/store.ts       — the Store contract (the persistence seam)
src/memoryAdapter.ts — the in-memory Store: all reference behaviour, no storage
                     (extracted from LocalStorageAdapter at DSL Phase 4;
                     LocalStorageAdapter itself was deleted at backend
                     stage 3 — no live host after the hard cutover).
                     replaceRecords() swaps the whole snapshot in place
                     (identity stable, subscribers notified) — how client
                     hosts refresh after a server-side run (backend stage 2);
                     mergeRecords() adds or replaces some without touching the
                     rest (2026-08-16) — how a host that was never handed the
                     partition fills its snapshot as it goes
src/attributeTypes.ts — the attribute type registry (files, photos, scalars,
                     geopoint): per-type descriptor field schemas + accepted
                     type_config keys, read by the client uploader,
                     validateSubmission, and validateConfig
src/bridge.ts      — SDM ↔ DSL translation (schema, hosts, coercion, four roots)
src/validateConfig.ts — config-save-time validation of every FluxScript script
src/evaluateWithGets.ts — the waiting loop for a host whose GET answers are a
                     round trip away: evaluate, fetch what the round asked for,
                     evaluate again. Written in the page host, moved here
                     2026-08-16 when form dropdowns needed the same thing.
src/validateSubmission.ts — headless payload validation (DSL Phase 4): the
                     attribute trio + datasource membership as one check
src/services/geo.ts — shared geo module (Store-backed, host-agnostic)
src/services/logger.ts — the engine-owned logger manifest (one builder:
                     createEngine binds the live sink; validateConfig
                     registers it with a no-op so configs using
                     services.logger validate identically everywhere)
src/engine.ts      — createEngine: the runActivity (write) and runQuery (read)
                     pipelines, `invoke`, and the evaluation entry
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
  write pipeline: availability gate → before hook (read-only gate; warn = soft
  stop returning `needs-confirmation`) → record_map mapping (CREATE/UPDATE/
  DELETE/append) → history append → after hook (staged, atomic commit).
  `options`: `acknowledgedWarnings`, `waived`. Refuses a GET.
- `engine.runQuery(activity, captured, anchorRecord)` — the read pipeline; see
  "GET activities" below. Refuses anything that is not a GET. Records the run
  on the anchor, logged light.
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

`{ status: 'done' | 'needs-confirmation', warnings, recordId?, deleted? }`.
`recordId` (added at extraction) is the record acted on — created, updated,
appended to, or deleted; absent when nothing persisted, which now means only a
run awaiting confirmation. Hosts use it to react (the workbench deselects a
deleted record). **`deleted`** (2026-09-21) says the record named is gone: a
caller cannot infer that from the id, since every other outcome leaves the
record there, and it is what lets a host say "deleted" rather than "saved" and
leave a page about a record that no longer exists.

### The DELETE record map (reworked 2026-09-21)

Four steps, the user's sequence: **initiate, confirm, the record and its
history go, the caller is told what happened.**

*Confirm* is the platform's existing soft-stop. A DELETE always returns
`needs-confirmation` first, carrying a line saying the history goes with the
record and cannot be recovered; the caller re-runs with `acknowledgedWarnings`
to proceed, and dropping it cancels for free since nothing was touched. An
author who wants their own wording adds `warn()` in the before hook and it is
shown alongside.

What this replaced: the engine looked for a captured attribute **literally
named `confirm`** holding the string `'DELETE'` — a contract stated nowhere in
the model, so an author who named it anything else got a run that returned
`done` having deleted nothing. Confirmation is now guaranteed by the engine
rather than left to whether an author remembered to ask for it, and a run that
is not confirmed reads as cancelled rather than as success.

*The referential check* is the same one a hook's `delete()` obeys —
`blockingReferences`, shared by both paths, so one act has one rule. A record
others point at is refused and the message names them.

No trace survives, by design: deleting is for a record that should never have
existed, and a removal that needs a trace is modelled as a marked field
instead.

## GET activities — the read path (built 2026-08-09)

`record_map: "GET"` (DSL_SPEC §5a, DATA_THROUGH_ACTIVITIES step 1). A GET
answers a question instead of changing something: its **attributes are its
parameters** and its **`returns` expression is the answer**. An app names the
activity; the model holds the query.

`runQuery` shares the front of the pipeline with `runActivity` — the same
availability gate, then the same before hook as a gate — and then diverges:

- **No record data changes**, so there is no `record_map` mapping and nothing
  to write back but the entry below. Gate warnings come back **with the
  answer** rather than as a soft stop, because "confirm and re-run" is
  meaningless for a call that changed nothing. `fail()` in the gate still
  blocks — and a rejected read leaves no trace, exactly as a rejected
  submission does.
- **`QueryActivityResult`** is `{ data, warnings }` — no `status`. `data` is
  plain JSON-safe data: records flatten to `{ id, ...fields }` and FK pointers
  to their ids (`toComponentValue`, moved to the bridge so the server and the
  page host shape results identically), because every caller is SDM-blind.
- **The anchor is where the entry lands**, not what the query is about
  (DATA_THROUGH_ACTIVITIES §1). A page passes its own record; a caller with
  none passes null and the read goes untraced, which is the honest state for a
  read nothing owns.

### Logged light (step 3, built 2026-08-11)

A GET is an activity, so its run is recorded like every other: **one entry on
the anchor record**, carrying the parameters (which are its attributes, so they
land exactly as a write's captured values do), the caller, and two reserved
keys of its own — `system_outcome` (`ok` / `error`) and `system_duration_ms` —
beside the existing `system_log` and the gate warnings. **Never the returned
data** (runtime SPEC, "the pipeline is the log"): the answer is not stored
anywhere, and `watch` is the escalation valve for the day someone needs to see
what a person actually saw.

The entry is written whichever way the answer goes: a `returns` that throws
records the attempt with `system_outcome: 'error'` and the message on the
system log, then rethrows — the same posture as a failing after hook, which is
recorded even though nothing was applied.

**A GET reached through `invoke` from a hook is not logged separately.** It is
part of the run that asked, so its logger lines join that run's system log and
no second entry appears — the rule the runtime SPEC already states for read
service calls, applied to the read that is an activity. It also keeps a read
from persisting inside a write whose gate went on to reject it.

**Purity is the validator's job, twice over.** `returns` is checked as an
*expression*, and expression mode already rejects `create()`/`update()` and
unqueued service effects — so a read cannot write, and no new rule was needed
to say so. At runtime the eval host is built with `readonlyRecords`, so
anything that slipped past config-save throws rather than writing.

`validateConfig` also enforces the shape: a GET **needs** a `returns`, may
**not** have an after hook (nothing persisted, so there is nothing to react
to), and `returns` on a non-GET is rejected.

**"Needs a `returns`" is a server-grade rule** (fixed 2026-09-12). `returns` is
deliberately absent from the client's copy of the config — the query never
reaches the browser — so demanding it of a trimmed config reported every GET in
the model as an error at boot, in a console the author is meant to trust.
`validateConfig` runs on either grade, and any rule about something the trim
*removes* has to know which one it is looking at. The grade is legible without
a new parameter: the trim **omits** the server-only keys rather than nulling
them, so a `before_hook` that is explicitly `null` still says "this is the full
model, and there is no hook". Every other rule here is safe as written, because
it checks what a value *says* rather than that it is there at all.

### `invoke(activityId, params?)`

The hook-facing read door: run a GET and take its answer. Read-only by
construction — it can only reach a GET — so it carries none of the cascade
risk that keeps hooks from starting other workflows, and it is legal in before
hooks, which is what makes it usable as a guard (DATA_THROUGH_ACTIVITIES §3
tier 2). The DSL declares the built-in and stays scope-blind; the engine
supplies the implementation through `ScriptContext.invoke`, resolves the id,
refuses a non-GET, and blocks re-entry so a GET whose gate invokes itself
fails instead of hanging. `validateConfig` resolves **literal** ids at
config-save time (unknown id, or not a GET, is a finding); a computed id is
left to runtime.

**Who may run a GET is the activity's own gate**, exactly as for a write:
`show_condition` and roles decide, and there is deliberately no second read
filter over the answer — a GET returns what its author declared it to return.
That is the same posture as an UPDATE that writes a record type the caller
cannot read: the activity is the unit of access.

## App-triggered runs (Extraction stage 2, ruled 2026-07-11)

An app triggers an activity through a host's named-callback wiring; the
callback contract is **the record alone** — the host resolves it to the anchor.
An app-triggered run and a workbench run are then the same run.

- **No side channel** (changed 2026-08-09, DATA_THROUGH_ACTIVITIES §4). The
  `callbackData` root in hooks, `RunActivityOptions.callbackData` and the
  server's `z.unknown()` pass-through are **removed**. Values reach an activity
  as **declared attributes**, and get types, `required`, `validation`,
  `show_condition`, storage and logging with them; an undeclared object off the
  wire got none of those, and the hook author had to hand-check what the
  pipeline checks for free everywhere else. `callbackData` survives only in
  page callback scripts, as `{ value }` — the anchor, authorised on every run.
- **UI vs non-UI activity** — with attributes, the host opens the standard
  capture form and the run proceeds normally; with no attributes there is
  nothing to fill in and the run passes straight to the hooks.
- **Hook-written attributes** — hooks may assign onto the `attributes` root
  (`attributes.wo = context.record.id`); new or changed keys land on the
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

- `context.user` is host-supplied since auth (RBAC phase 1, 2026-07-19):
  `EngineOptions.user` (`ContextUser` `{ id, name, email?, roles? }`) is
  injected into every evaluation the engine makes and stamped as `author` on
  each committed history entry; `ScriptContext.user` carries it through
  `buildEvalHost`. Absent (tests, hosts that only evaluate) → the exported
  `DEMO_USER` stub (`{ id: 'demo', name: 'Demo User', email: null, roles: [] }`),
  and entries carry no `author`. The server passes its per-request verified
  user; `roles` are resolved outside the engine (the server's roles-resolver
  seam) — scripts stay scope-blind.
- Async `queue` dispatch failures land on `console.warn` via the bridge's
  `onQueuedFailure`; becomes host-supplied when a second host needs it to
  differ.

### Two grades of model (BUILT 2026-08-09)

Design authority: root [docs/CLIENT_TRUST_BOUNDARY.md](../../../docs/CLIENT_TRUST_BOUNDARY.md) §2.
Every config type has a `Client*` grade — what a browser on the **runtime**
plane is given — and a full grade that **extends** it:

```
ClientSolutionConfig      ← SolutionConfig      (adds access.roles)
ClientRecordTypeDef       ← RecordTypeDef       (adds access.read + storage constraints)
ClientActivityRawDef      ← ActivityRawDef      (adds before_hook / after_hook)
ClientAttributeTypeConfig ← AttributeTypeConfig (adds max_count / max_size_mb)
ClientCustomFieldDef · ClientAttributeDef · ClientWorkflowRawDef
```

**The narrow one is declared first, deliberately.** Code typed against it
cannot compile a reference to `before_hook` — the trim is structurally
unreachable rather than merely filtered at runtime. The engine defines the
shapes; `projectConfig` (server) is the only thing that performs the trim.

Everything here that takes a config takes the **narrow** grade —
`MemoryAdapter`, `EngineOptions.config`, the bridge, `validateConfig` — because
the full grade is assignable to it and nothing in the engine needs a stripped
field. Two places do read hooks off a raw config (`MemoryAdapter`'s workflow
resolution, `validateConfig`'s hook pass) and both go through
**`activityHooks(activity)`** (`src/bridge.ts`): the one place that widens back
to the full def, so "hooks may simply not be here" is stated once. On a client
config they resolve to `null`, which is already a legal state.

**The client never executes a hook** regardless: scripts and persistence are
server-side by ruling, and a browser evaluates expressions only
(`show_condition`, `validation`, datasources).

### RBAC config surface (RBAC_COMPACT; enforced outside the engine)

`SolutionConfig.access.roles` (`RoleDef[]`, solution-scoped role definitions) and
`RecordTypeDef.access.read` (role ids that may read a type) are carried on the
config for the **server** to enforce (record-type read filter, RBAC stage 1) —
the engine defines the shape but does not gate reads on it. Activity gating
stays the existing `show_condition`/availability check, which already reads
`context.user.roles`. Absent `access.roles` ⇒ RBAC dormant (adoption posture).

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

`MemoryAdapter` (extracted at DSL Phase 4) is THE Store: workflow/attribute
resolution, constraint checks, staged mutation halves, **record identity** —
with a protected `persist()` no-op hook (for storage-backed subclasses, none
currently live) and `allRecords()` for diffing hosts. Every host runs one:
browser hosts fill it from `@fluxus/client`'s snapshot; the server host loads
a scope's partition per request. `LocalStorageAdapter` (the
localStorage-persisting subclass both browser hosts ran before backend stage 2)
was deleted at backend stage 3 — the hard cutover left it without a host.

**No config seeding (2026-08-05).** `SolutionConfig.seeds`, the `SeedGroup` type and
the adapter's `{ seed: true }` option are gone. Config carried sample records
that loaded into any store holding none of that type — a write path into
records that went around activities, which the pipeline invariant forbids. A
store built from a config alone is empty; callers that need records create
them.

### validateSubmission (DSL Phase 4)

`validateSubmission(engine, activity, captured, anchorRecord, waived)` — the
attribute trio applied as one payload check for callers with no capture form,
per DSL_SPEC §5 ("in headless mode the datasource doubles as validation").
Semantics mirror the standard capture form (`@fluxus/page-runtime`, the workbench's until 2026-08-16): attribute show_conditions
fail OPEN (the activity-level gate inside runActivity is the fail-closed
one); hidden attributes are exempt from `required`; waivers need can_waive +
a reason; validation rules run on non-empty values with typed `value`
injected. Headless-strict additions the form guarantees by construction:
unknown keys, values supplied for hidden attributes, list values outside
their datasource (fail closed on datasource errors), and dangling references
are all rejected. The workbench form keeps its interactive per-field checks;
folding it onto this function is an open cleanup.

**A datasource may name a GET (DATA_THROUGH_ACTIVITIES step 4, 2026-08-16).**
`invoke` is supplied in the script context here, so a producer written as
`invoke('act_get_crews', { region: attributes.region })` resolves during the
membership check — the same one declaration that filled the input decides what
the input may hold, with the GET's own gate deciding what this caller is
offered. Nothing about the check is new: the datasource was always re-run
server-side and always failed closed, so a GET that rejects, errors, or does
not exist rejects the submission rather than waving it through.

`Engine.invoke(activityId, params, anchorRecord)` exists for this — the read
door hooks already get injected, exposed so a caller can put it in a script
context. It evaluates **in that engine, against that store**, so a host that
must not answer reads locally must not hand it to an expression. Only the
server does today; the browser reaches a GET through the client, over the
wire.

### Composite attributes and section markers

`type: "composite"` packs one question's row of sub-fields — a paper form's
Item + OK/Reference/Comments answer slots — into a single attribute.
`type_config.attributes` is a list of **usage wrappers pointing at real pool
attributes** (the same `attribute_ref` + overrides shape an activity's list
uses — reuse over inline definitions, redesign ruled 2026-07-18 after the
first grid-level cut lost item show_conditions). Sub-attributes may be any
type except `composite` (no nesting) and `reference` (parked until cell
pickers exist); usage-level `required` / `can_waive` / `validation` /
`show_condition` apply per cell. The adapter resolves sub-usages into
`AttributeDef.sub_attributes` at load, exactly like activity usages.

Grouping is a separate, presentation-only construct: a **section marker**
(`{ "section": "…", "description": "…" }`) in an activity's attribute list,
resolved to a pseudo-AttributeDef of `type: 'section'` (key `_section_<n>`).
It renders as a heading, captures nothing, and headless callers ignore it —
supplying a value for one is rejected.

One value per cell, addressed by the dotted path `attr.sub` — `'.'` is
reserved in every key namespace for this (enforced by validateConfig). The
translation contract (owned by `bridge.ts`):

- **Payloads** carry cells flat under dotted keys or nested (attr → sub);
  `flattenCaptured` normalises to flat.
- **Scripts** always see the composite NESTED under the attribute key, every
  declared cell present (empty → null), so
  `attributes.access_permission.ok` is total.
- **History entries** store the nested raw-string form with only non-empty,
  non-waived cells (`nestComposite`); hook writes into cells are detected by
  JSON snapshot (object identity can't see them).
- **Waivers** are per cell: the entry's `waived` map keys are dotted paths.
- **Custom-field mapping**: a composite key matches no custom field and is
  intentionally dropped — rows live in history, not on the record.

`validateSubmission` applies the same per-cell semantics headless (required,
waive rules, validation with typed cell `value`, list sub-attribute datasource
membership, sub show_conditions fail-open). Reporting hosts flatten the nested
entry value back to one row per cell under the dotted key (see server SPEC).

## Attribute types: files, photos & scalars

The type registry (`attributeTypes.ts`, ATTRIBUTE_TYPES_FILES_SCALARS §5) is
one entry per attribute type declared in engine code — the companion the SDM
baseline asked for once `type_config` shapes stopped self-documenting as table
columns. Each entry declares its **descriptor** sub-fields (photo/file only),
the **type_config keys** it accepts, and whether **multi** is legal. Three
consumers read it: the client upload core (what descriptor fields to write),
`validateSubmission` (server-authoritative descriptor shape check), and
`validateConfig` (config-key / multi rules). It is *not* wired into the DSL
validator — descriptor dot-access (`attrs.before_photo.taken_at`,
`value.size`) stays permissive/untyped, as all attribute-value access already
is; typed dot-paths in hooks/validations are a later, additive step.

- **Types this build**: `photo`, `file`, `datetime`, `time`, `int`, `decimal`;
  `text` gains `multiline`.
- **`geopoint`** (2026-09-22): one point on the earth — `{ lat, lng }` in
  degrees, WGS 84 — captured by the person filling the form. It is a descriptor
  bag like a photo, so it gets the shape check and the by-value threading for
  free, but it is the first bag that is **not** a file: the presign gate now
  asks `isUploadType` (the registry's `upload` flag, photo/file) instead of
  "has a descriptor", or a geopoint attribute would have been an upload target.
  No `multi` — one point until the map component takes a list — and no
  `type_config` keys. `geoPoint(value)` reads the degrees back and
  `geoPointText(value)` writes them for a person (`-37.9003, 144.6614`); both
  are what the UI draws with, since `String()` on a bag says `[object Object]`.
  A fuller `geo` type carrying lines and polygons may replace it later; the
  rest of GIS stays direction-only.
- **Descriptor value** (`photo`/`file`, §4): a by-value bag
  (`storage_key`/`name`/`mime`/`size`/`hash`; photo adds
  `width`/`height`/`thumb_key` and optional EXIF `lat`/`lng`/`taken_at`).
  Stored by-value in the pipeline exactly like a composite — history entries
  stay self-contained; bytes never enter the pipeline. `isDescriptorType` /
  `descriptorFields` / `descriptorShapeIssues` expose the schema and the shape
  check; `isUploadType` says which of them are files.
- **Cardinality** is one flag, `type_config.multi: true` (§2): the value is
  then always an array and `required` means ≥ 1 item. Legal on every type
  except `composite` (repeating composites deferred). Replaces the former
  `list`-only `selection` key — deleted, one spelling of cardinality
  platform-wide.
- **Config vs validation** (§3): `type_config` holds only capture-shaping keys
  that must act before a value exists (`accept`, `max_size_mb`, `max_count`,
  `multi`, `multiline`, `decimal_places`) — a closed set per type, no format
  mini-language. Every judgement about a value stays in FluxScript
  `validation` with descriptor dot-access (`value.size <= 20000000`).
- **Coercion** (`coerceValue`): `datetime` parses to a `Date` (the raw
  offset-bearing ISO string is what persists, so the entry keeps the
  wall-clock the user saw); `decimal`/`int` to numbers; `time` stays a string
  (`HH:MM`, zone-less, lexical comparison). `coerceCapturedValue` maps multi
  arrays element-wise and passes descriptor bags through by-value.
- **Structured threading**: `flattenCaptured` / `nestComposite` /
  `coerceCaptured` keep descriptor objects and multi arrays by-value instead of
  stringifying them; `isBlank` is the shared emptiness test (empty string /
  empty array blank; a descriptor bag present).
- **validateConfig** rejects `multi` on `composite` and any `type_config` key
  not in a type's registry entry. Types absent from the registry
  (custom/experimental) are left unchecked.
- **validateSubmission** re-checks, server-authoritatively: descriptor shape
  (missing required field, wrong scalar kind, non-object), single-vs-array
  cardinality, `max_count`, and per-file `max_size_mb` (the presign gate is the
  first check; this is the re-check at submit).

## Numbers are stored as numbers (2026-09-22)

A `decimal` or `int` field holds a **number** in the record, coerced at the one
door every write goes through — `MemoryAdapter.buildRecord` and `updateRecord`,
so an activity write and a hook write are treated alike
(`coerceFieldValues`, `test/numericStorage.test.ts`).

It corrects a defect, not a design. `runActivity` wrote the **raw captured
bag** into the record fields and coerced a *separate* copy for the hooks, so
the coercion existed, ran on every run, and never reached storage: CBS budgets
read `"2400000"`. What it cost sat two packages away and looked like a language
problem — `+` concatenated instead of adding, so the projects solution's total
GETs returned `024000001260000018000004500000…` and were written up as an
arithmetic gap in the DSL. There was no gap. With the write fixed and the 18
stored values converted (`packages/server/scripts/numeric-fields-to-numbers.ts`),
those totals return real figures with no script changed.

Two values are deliberately left alone, and both keep an existing meaning
rather than introducing one: a blank stays `''`, because blank already means
blank everywhere; and a string that is not a number — `"2,400,000"`, a typo —
stays as typed, so a bad value stays visible instead of silently becoming null.
History entries are untouched: `capturedAttributes` is what a person submitted,
append-only, and a record of a submission rather than a value anything computes
with.

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

## A hook may delete (2026-09-21)

`RecordsMutationHost` gains `prepareDelete(type, id)` and `MutationOp` gains
`{ op: 'delete' }`, so the DSL's `delete()` reaches the store the way create and
update do: validated while the script runs, staged, applied atomically on
commit. `prepareDelete` reads the record — proving it exists — and refuses it if
its type is not the one the script named, since a script deleting a record of
the wrong type would be silently destructive. `apply` calls
`Store.deleteRecord`, which takes the row and the history embedded in it.

On the server this needs nothing new: `writeBack` diffs the partition by
absence, so a record a hook removed in memory becomes a real row delete
(`test/hookDelete.test.ts` in @fluxus/server proves it at the database).

What the platform is saying by having this verb destroy history: a delete is for
a record that should never have existed. The keep-it case is a field the author
marks and filters on — the projects solution's `expired` — and that stays the
author's to design rather than the platform's to impose (the user's ruling; the
reasoning and the rejected alternatives are in the DSL GRAMMAR, D15).

**Referential integrity is checked across the whole staged set**, at the start
of `apply`, before a single op lands. A delete is refused while another record
still points at it, and the error names the holders so the author can work
bottom-up. The check is not in `prepareDelete` for a specific reason: a script
deleting a subtree stages the parent and its children together, and a
per-record check against the store would see the children still present and
refuse the parent — the script blocking itself. A reference only counts if the
record holding it is not itself on the way out, which is knowable only once the
set is complete. Nothing is written before the check, so a refusal leaves the
store untouched.

**One gap, deliberate.** Reporting rows projected from a deleted record's
history are not purged with it — deferred, and pinned by a test so the day it
changes, something says so.

There is deliberately **no environment gate**. A "no deletes in production"
rule, gated by an operation lifecycle state, was ruled and then reversed the
same day (2026-09-21): publishing governs the SDM and pages, while data needs no
dev/prod split, and a solution is expected to ship the tools to manage its own
data. Delete is guarded like any other change — it runs inside an activity, so
availability, roles and hooks apply, plus the referential check above.

## Every record gets its own id (2026-09-18)

A record's id is **issued by the engine, never declared by the model**:
`MemoryAdapter.buildRecord` generates a **UUIDv7** (the `uuid` package, the
engine's only runtime dependency besides `@fluxus/dsl`). The id is the storage
key `(scope, id)`, and the cross-type clash guard stays as a guard — one map
lookup that fails loudly rather than silently overwriting a record of another
type.

`RecordTypeDef.id_field` is **gone**. It let a record type key on one of its own
custom fields, and the projects solution keyed the WBS and the CBS on their
codes — which made a business value load-bearing three ways: a deleted node
reserved its code against the reporting rows that outlive the record, a rename
left the id saying the old code while the field said the new one, and two record
types numbering a node `1.0` collided outright. A code is a value; identity is
the platform's to issue. Version 7 rather than 4 because it leads with a
timestamp, so ids sort by creation and inserts land at the end of the index.

Consequences worth knowing:

- **Uniqueness must now be stated.** A natural key was unique because it *was*
  the id. A type that needs a value unique declares `unique: true` on the field,
  which `buildRecord`/`validateUpdate` already enforce per type.
- **Uniqueness within a parent has no expression** — a WBS code unique inside
  its project rather than across the operation. Global uniqueness was an
  accident of the old scheme (it would have refused the second project a node
  coded `1.0`); the scoped rule is an open gap, not something invented here.
- **Existing records keep the ids they have.** Nothing parses an id, so a store
  holding both old value-shaped ids and new UUIDs is consistent. The adapter's
  `migrateNaturalIds` — a re-keying routine nothing ever called — went with the
  feature.
- **Anything that named a record by its code must read back what a create
  returned.** That is what changed across the test fixtures at this date.

`test/recordIdentity.test.ts` holds the rule: issued not taken, unique, sorted,
two types free to share a code, rename-safe, and no id ever reused after a
delete.

## An attribute names the field it fills (2026-09-15)

**The attribute key is an identity for a captured value, not a pointer to a field** (the user's ruling). A `reference` attribute may say which field it lands in, fully qualified — `type_config.field: 'rt_wbs_nodes.parent_id'` — and the **target type is then read off that field**, never repeated, so the two cannot disagree. `attributeFieldRef` parses it; `Store.resolveAttributeTarget(typeId, fieldKey)` is the lookup; `validateConfig` refuses a field that does not exist or is not a reference; the write path maps the captured key to the declared field (`landingFields` in engine.ts). An attribute naming no field keeps the old rule exactly — key is the field key, target from its own `fk_record_type` — so nothing written before this changed.

Why: attributes are a shared pool, so with the key doing both jobs one `parent_id` had to serve every record type that has a parent and could name only one target between them. Adding a child to a WBS node was refused with *"Parent: no cbs_nodes record 'WBS 1'"*, because the attribute had been created for the CBS. A second attribute was no escape either — an unmatched key is dropped by design, so `wbs_parent_id` would simply not have been written. Tests: `test/referenceTarget.test.ts`.

**A first cut that was rejected:** making the acting record type's field silently win over the pooled target. It fixed the symptom and left two sources for one fact with an unwritten precedence rule; the user's call was that the model should *say* it.

**A `reference` may also name where its candidates come from** (2026-09-23). `datasource`, `display_field` and `columns` join its `configKeys` — **the same three settings a `list` already spells**, read by a second kind of attribute rather than spelled a second way. They name the GET that supplies candidates to the record picker; the *target* is still the declared field's, unchanged. An attribute declaring none keeps today's behaviour exactly. Validation only ever widens here, and the place that checks a datasource does so without caring which attribute type it came from — so this was free. The one change it did need: `validateConfig` passes **`term`** as an extra root wherever a datasource is checked, because the picker's search box reaches the expression that way (it must not ride in the form's values, which are unknown-shaped and would read as blank at runtime). Harmless on a `list`, which simply never names it. The picker itself is specified in [page-runtime's SPEC](../../page-runtime/docs/SPEC.md).

**And a reference field must declare what to show** (2026-09-23). `fk_display_field` has been documented as required on an `fk_ref` since the field type was written and was enforced nowhere; `validateConfig` now refuses a reference field that declares none. It was harmless while a reference was drawn as its raw id — the record picker is what made it matter, because with no display field there is nothing readable to put in the list. **The alternative was a silent fallback** — guessing `name`, the way a `list` attribute must because it has no field declaration to consult, or drawing blanks — and either hides a modelling gap from the one person who can fix it (the user's call, 2026-09-23). Measured before adding, across every solution in the database: 20 reference fields, all 20 already declaring one, so nothing existing fails. `fk_record_type` is still checked only on the attribute path, not blanket — left alone as a separate question.

## An attribute may be sourced rather than asked for (2026-09-15)

`AttributeUsageDef.source` — a FluxScript expression evaluated when the capture form opens, filling the value instead of putting a question to someone. The case it exists for: a CREATE has no anchor, so `context.record` is null and the record a new one is created **under** could not reach it. `act_create_wbs_nodes` sources the project with `context.page.record.id` — see the page-runtime SPEC for that root, and for the rule that an attribute arriving filled (sourced or seeded) is not shown.

## Per-call quotas (2026-09-21)

`ScriptContext.quotas` (`Partial<Quotas>`) is passed through `buildEvalHost`
onto the eval host, where the evaluator merges it over `DEFAULT_QUOTAS`. Absent
— which is every hook, every page evaluation, every existing caller — means the
defaults, unchanged.

The DSL Editor's endpoint raises them. Its reasoning: `loadOperationHost` has
already loaded the operation's whole record set into memory before the script
runs, so `maxRows` is not protecting server memory at that point, and
`timeoutMs: 1_000` is too short for an interactive tool. Hooks keep the
conservative defaults because their failure mode is different — a runaway hook
blocks a user's submission.

Note what the row quota does: it **throws**, and it throws in `readAll`, before
`where` runs. A record type larger than `maxRows` cannot be queried at all, not
even by id. The real fix is query pushdown (DSL_SPEC §9); raising the cap is the
interim.

## Defect: `resolveUsage` drops the pool's `required` (found 2026-09-22, not fixed)

An attribute is declared once in the solution's pool and then *used* by
activities, which may override some of its settings. `resolveUsage`
(`memoryAdapter.ts`) merges the two.

It falls back to the pool definition for `source`, `show_condition`,
`validation`, `validation_message` and `can_waive` — but **not for `required`**:

```ts
required: usage.required,        // no `?? def.required`
```

So an activity whose usage sets *any* override — a `show_condition`, say — and
does not restate `required` silently loses the pool's required flag, and the
attribute becomes optional on that activity. A usage that overrides nothing
takes the pool definition whole and is unaffected, which is why this has not
been noticed.

Two readings, and the fix depends on which is intended:

- **Pool `required` is a default.** Then the merge is wrong and needs
  `?? def.required` like its four neighbours.
- **`required` belongs to the usage alone.** Then the merge is right, the pool
  should not carry `required` at all, and `AttributeDef.required`'s own comment
  ("carried over from the usage wrapper") is the intended story.

**Not fixed deliberately.** Either change alters how existing solutions
validate submissions — the first could start rejecting captures that pass
today. It needs the user's ruling and a look at live configs first.

Found while specifying `docs/QUERYING_THE_MODEL.md`, which wanted to project
pool-level defaults and could not describe them truthfully.

## The model projected as record types (BUILT 2026-09-22)

`modelProjection.ts` turns a `SolutionConfig` into the `sdm_*` collections
behind the DSL's `model` root — see `docs/QUERYING_THE_MODEL.md` for the design
and `modelProjection.test.ts` for what is pinned.

- `modelSchemaTypes()` — the collections as `DslSchema.types` entries, for a
  host that validates (the Console's editor).
- `withModelTypes(base, config, opts)` — wraps a records host so those types
  answer from the config while everything else falls through to the store.
- `ScriptContext.modelTypes` turns it on. Absent everywhere but the editor's
  endpoint, which is how exposure stays opt-in rather than opt-out.

Three things the projection has to do, each of which broke a draft:

- **Materialize every column, absent ones as explicit null.** Bare-field scope
  tests `name in obj`, so a merely-missing key falls through to the outer scope
  and raises "Unknown name" inside `where`/`select`. Config objects come from
  JSON, where optionals are simply absent.
- **Answer the name a script can use.** `query_name` is the stored id minus
  `rt_`; a projection answering `rt_projects` hands back something that cannot
  be pasted after `records.`.
- **Project the resolved capture list, not the raw one.** An activity's stored
  attribute list is heterogeneous — usages and section markers, the latter with
  no attribute reference at all — so `resolvedCaptureLists` reads the adapter's
  resolution and a heading becomes a row with `kind: 'section'`.

Two links are derived rather than stored: an activity's `workflow_ref` (from
nesting) and its `record_type_ref` (reverse lookup through the workflow). 
**Nothing enforces one record type per workflow**, so that answers null when
none points at the workflow and the first by config order when several do.
