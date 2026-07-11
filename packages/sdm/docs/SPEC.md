# @fluxus/sdm — Living Spec

Current design truth for the SDM runtime. Updated in the same commit as any behaviour/design change (see root CLAUDE.md). Point-in-time build history lives in [phases/](phases/). The canonical schema is [SDM_Schema_Reference.md](SDM_Schema_Reference.md) — it wins on any conflict.

## Model

Everything is driven by one logical config (typed by `src/types.ts`), stored split for hand-editing in `packages/sdm/config/` — `attributes.json` and `functions.json` (shared pools) plus `entities/<name>.json` (record type + its workflow, always a pair) — and merged into one `ConfigRaw` by `src/config.ts`. The split is POC-era convenience; the endgame is the SDM in a database edited through UI. Collections:

- **`attributes`** — standalone, reusable capturable inputs; activities reference them by `attribute_ref`.
- **`recordTypes`** — collections (`rt_<plural>`): custom fields (incl. `fk_ref` with `fk_record_type` / `fk_display_field`), optional constraints (`required`, `unique`, `immutable`, `indexed`), a `workflow_ref`.
- **`workflows`** — one per record type (`wf_<plural>`): ordered activities. One `record_map: CREATE` activity per workflow is the expected pattern; capture activities (no `record_map` — log-only unless hooks act) appear in the record-level activity strip. `record_map: "GET"` (query activities: attributes = parameters, `returns` expression = response, never mutates, logged with duration/outcome) is specified in the DSL spec §5a and lands with Phase 2+.

Records are never edited directly. All mutation flows through activities; each run appends an `ActivityHistoryEntry` (exactly what the user entered). Attribute → custom field mapping is exact-key only; unmatched attributes are intentionally dropped (SDM §1.9.3 rule 2 — not a bug). Custom fields without a matching captured attribute seed from `default`.

Hooks (`before_hook` / `after_hook`) are FluxScript scripts (DSL Phase 2; string or array-of-lines in the JSON, joined on load). Fields like `status` change **only** via hooks — do not add a direct write path (SDM §7a); `act_complete_work_orders` is the pattern: no `record_map`, the after hook moves the status.

## FluxScript wiring (DSL Phase 1)

The workbench executes FluxScript (see `packages/dsl`) for two attribute features:

- **`show_condition`** on an activity's attribute usage (e.g. `"attributes.city is not null"`): evaluated live in AttributesForm; hidden attributes are excluded from submission. Evaluation errors leave the attribute visible (a broken condition must never make an input unreachable — the activity-level rule under "Hooks" deliberately does the opposite).
- **`required`** on an activity's attribute usage: blocks submission until captured (inline banner + `*` on the label). Per-usage, not per-attribute — a shared attribute can be optional in one activity and mandatory in another. Hidden attributes are exempt by construction.
- **`validation`** (+ optional `validation_message`) on a usage or attribute def (usage wins): a FluxScript rule that must evaluate `true` for the captured value, with the value injected as the extra root `value` — e.g. `"value <= now()"` on completed_date. Runs on submit for visible, non-empty attributes (empties are `required`'s job). Captured strings are **type-coerced** first (`date`/`int`/`bool` per the attribute's type; `coerceCaptured` in bridge.ts), which also types `attributes.*` in show conditions and datasources. Date attributes render as native date inputs.
- **`can_waive`** on an activity's attribute usage: the user may declare the value unavailable — a **"Can't provide"** toggle replaces the input with a mandatory reason box. No fake data is entered to satisfy `required`. The waiver is stored on the history entry as `waived: { <key>: <reason> }` (presence of the key is the flag; only waived attributes appear), kept out of `capturedAttributes`. Waived attributes never write to record fields: on CREATE the field seeds from its default, on UPDATE the existing value is untouched ("can't provide it now" must never blank last month's value). Scripts see the attribute as null. Show conditions and hooks handle *predictable* branching; waivers absorb the unpredictable physical realities of data entry — and being recorded data (not silence or garbage), they can later power a data-gaps worklist. Sample: `serial_no` on `act_create_assets`.
- **`List` attributes** (`type: "list"`): `type_config.datasource` is a FluxScript expression yielding a list; `key_field`/`display_field` map items to options. Current form values are injected as `attributes` (empty strings read as null), so dependent pickers (city → suburb) re-evaluate as values change; stale selections self-clear.

## Hooks (DSL Phase 2)

`runActivity` is the pipeline: **availability gate → before hook → record_map mapping → activity history append → after hook**. Since the Extraction milestone it lives in `@fluxus/engine` (`createEngine({ store, config, services })`); AppContext hosts the engine and wraps `runActivity` with the workbench's UI reactions (deselect a deleted record via the result's `recordId`, console the returned after-hook warnings). The behavioural doctrine below is unchanged by the move.

- **Availability gate** — activity-level `show_condition` (on the activity def, e.g. `"context.record.status <> 'Completed'"` on `act_update_work_orders` / `act_complete_work_orders`): whether the activity is offered and invocable at all. Strict boolean — only `true` makes it available. Evaluated before capture, so `attributes` is banned (the validator rejects it at config load); `context.record` is the anchor, null for CREATE. The UI hides unavailable activities (record activity strip; the grid's New button and with it CSV import), but the check inside `runActivity` is the enforcement point — headless callers skip the UI. **Evaluation errors fail closed** (deliberately opposite to the attribute-level rule above): this is an access rule, and a broken gate must not wave the activity through. Availability ("does this activity apply to this record right now") is this gate's job; validating the captured payload is the before hook's. Role-style conditions on `context.user` work through the same mechanism, but a real permission model is a platform-tier concern — this complements it, it doesn't replace it. Server-authoritative re-check when the backend lands, same doctrine as the rest of the contract.
- **Before hook** — the gate. Runs with the captured attributes (type-coerced) before anything persists, in read-only mode: mutations and `queue` are rejected statically and at run time. `fail('msg')` rejects the submission with that message in the form; a runtime error in the hook also blocks (a broken gate must not wave submissions through). `warn('msg')` is a **soft stop**: `runActivity` returns `needs-confirmation` with the messages and persists nothing; the form locks its fields, shows the warnings with **Continue anyway / Cancel**, and Continue re-submits the *frozen snapshot* that was validated (edited values can never ride through on an acknowledged submit). CSV bulk import acknowledges warnings up front; `fail` still rejects rows. **Acknowledged gate warnings are recorded on the activity history entry** (`warnings` field — "warned X, continued anyway" is audit), kept separate from `capturedAttributes`, which stays exactly what the user entered. When the backend lands, the same gate re-runs server-side authoritatively with the same protocol.
- **After hook** — the effects. Runs after the activity persists, with `context.record` refreshed to the target record (the created record for CREATE). Mutations stage during the run and commit atomically via the adapter; `queue`d service calls dispatch only after the commit (services registry itself is Phase 3). A failing after hook applies no changes; the thrown message says the activity was recorded but nothing applied. After-hook `warn`ings are informational (the commit already happened): console only, until the workbench grows a toast slot. DELETE activities run only the before hook.
- **Staging seam** — the adapter splits its writes for the transaction: `buildRecord`/`insertRecord` (createRecord ≡ both) and `validateUpdate`/`updateRecord`, so hooks validate constraints at staging time and persist on commit. Script `Date` values serialize to `YYYY-MM-DD` (local midnight) or full ISO strings.
- **Named functions** — `config/functions.json`, bodies as array-of-lines (joined on load); callable from every scripted surface. Config validation enforces the governance floor: mandatory description, flat namespace, declared name matches the entry.

Acceptance (in `test/dsl-wiring.test.ts`): `act_complete_work_orders` — the availability condition hides/blocks it once Completed, the before hook warns when never started, the after hook sets `status`/`completed_date` via the staged commit. ("Already completed" moved from a before-hook `fail` to the show_condition when the availability gate landed — it is applicability, not payload validation.)

Plumbing: the DSL bridge (`buildDslSchema` / `buildRecordsHost` / `buildEvalHost` / `coerceCaptured` / `joinScript`) and `validateConfig` moved to `@fluxus/engine` at Extraction — see the engine SPEC. The workbench triggers the config-save-time check via `engine.reportConfigFindings()` at app start ("save time" while the SDM is file-edited); diagnostics go to the console. Covered by `test/dsl-wiring.test.ts`.

**Seeds:** an entity file may carry `seeds` (sample records); the adapter loads them only when the store has no records of that type. Cities/suburbs ship seeded so the location picker works out of the box.

## Services (DSL Phase 3)

The workbench registers two service modules (DSL_SPEC §7a) with the evaluator and validator — `src/services/`, composed in AppContext alongside the adapter:

- **`notify`** (effect) — `user(message)` and `email(to, subject, body)`. In the POC "sending" means appending to the **notification centre**: `NotificationLog` (localStorage `fluxus:sdm:notifications`, capped at 200, subscribe pattern) rendered as the header bell with an unseen count and a newest-first panel. When a real gateway exists it slots behind the same manifest; scripts don't change.
- **`geo`** (read) — `suburbsOf(city)`: suburb records for a city id, ordered by name, over the seeded reference data. Backs the suburb `List` datasource (`services.geo.suburbsOf(attributes.city)` — the query-chain version it replaced is noted in the attribute's description), so the city → suburb dependent picker now exercises a service call end to end.

Sample wiring: `act_complete_work_orders`' after hook ends with `queue services.notify.user('Work order ' + context.record.id + ' was completed')` — visible proof of the outbox: the notification appears only when the hook commits; a `fail`/soft-stop-Cancel dispatches nothing. Async dispatch failures land on the console via the bridge's `onQueuedFailure` (the after-hook-warn toast slot may take this over later).

`validateConfig` passes the registry, so the shipped config is checked strictly: unknown service modules/functions, wrong arity, and effect calls outside after hooks are startup errors. Acceptance in `test/dsl-wiring.test.ts` ("DSL Phase 3 — services through the SDM wiring").

## The pipeline is the log (design direction, agreed July 2026 — not yet built)

There is no logging subsystem and there will not be one. Warnings, notifications, service dispatches, and observability are all **ordinary history data in the one pipeline**. Agreed in discussion 2026-07-10; lands physically with the backend (Postgres history table); nothing here is implemented in the workbench yet.

**The invariant.** All data operations happen via activities within workflows, and every workflow anchors to a record — no exceptions without prior discussion. The platform in one sentence: records have workflows; workflows have activities; activities are the only way anything happens; some record types are the system's own.

**Class: `direct` vs `system`.** Record types are classed — *direct* (business truth: work orders) or *indirect/system* (apps, no-UI workflow anchors, notifications). History entries inherit class by a rule nobody applies per-entry:
user-authored submissions on direct types = `direct`; engine-authored entries = `system`; everything on indirect types = `system`. Retention promise, precisely: **no entry of either class is ever edited; direct history is never trimmed; system history is retention-managed** by a visible governed policy (management tooling later — not MVP).

**Recording what a run did.** A run that executes an after hook appends up to two entries to the record's history:

1. *Submission entry* (`direct`, user-authored — exists today): `capturedAttributes` = exactly what the user entered; acknowledged gate warnings ride on it.
2. *Execution entry* (`system`, engine-authored — the after-hook run recorded like a human's run): its attributes state plainly what the machinery did — "record XYZ created", "email sent", after-hook warnings. **Appended only when there is something to say.** This replaces both the "activity log stream" and the "outbox table" ideas — deleted from the vocabulary.

No linking key between the two: every activity runs against a record, so both entries already sit on the same record's history. If real usage ever shows a tracing gap, a link can be added then — not before.

**Notifications — OPEN, deliberately deferred (July 2026).** The candidate shape is "notifications are records on an indirect record type" (created through the pipeline; delivery outcomes appended as activities), but this is *not agreed*: what notifications the platform actually needs is unknown yet, and designing their storage before knowing their use is premature. What IS agreed: no bespoke store survives long-term — the workbench's current `NotificationLog` + bell is a disposable stand-in either way. Related deferred question, same discussion: history entries that need to **move/re-anchor from one record to another** (e.g. a notification arising on one record but belonging to another) — to be worked through against the never-edited promise (the archiving move-never-edit precedent is the likely key).

**GET requests are logged light**, as system-class entries: params, caller, outcome, duration — **never the returned data**. (This deliberately supersedes the earlier "GET writes nothing": system-class + governed retention resolves the objection that killed logging then.)

**Read service calls are not logged individually** (datasource-evaluation volume); they're subsumed by the activity/GET that triggered them. Effect dispatches are always recorded (execution entry + notification-style records).

**`watch` is the single escalation valve** — a per-activity dial that captures more when needed: validation failures, individual read calls, payloads. One mechanism; no ad-hoc logging switches.

**Not logged / parked (decisions, not accidents):** UI errors — not logged, accepted. Rejected submissions (gate `fail`) leave no trace — watchable when needed. SDM config edits live outside the pipeline — the platform-to-build-the-platform spiral is deliberately not entered.

**Sequencing:** MVP-first — ride the pipeline, take the free wins (uniform audit, AI-legible stream, zero logging concepts for implementers), build retention tooling when real usage provides metrics.

## Cancelling a mistaken activity (doctrine, decided July 2026)

Activity history is append-only and never edited, so **cancel can never mean delete — it means compensate**: post a new activity that reverses the effects and references the mistake, the way accounting posts a reversal instead of erasing a journal entry.

- **No generic platform "undo".** Auto-inverting `record_map` effects is unsound: after hooks and `queue`d service calls are not invertible (a sent notification stays sent), and later activities may have overwritten the same fields — an automatic revert restores neither correctness nor truth.
- **Cancellation is modeled, not built in.** Where a workflow needs it, the SDM author defines a compensating activity (`act_cancel_...`, `act_correct_...`) whose hooks implement what "undo" means in that domain; its own availability `show_condition` governs when cancelling is allowed. The Phase 2 DSL is already sufficient.
- **Future nicety (not built):** a `cancels`/`corrects` reference on `ActivityHistoryEntry` linking the compensating entry to its target, so the UI can badge cancelled entries and audits can trace the pair.
- **Ruled out permanently:** any admin surface that edits or removes history entries — it would break the never-edited promise the spine is built on. (Pre-commit, the before-hook `warn` soft stop already catches the "obvious mistake"; compensation is the post-commit answer.)

## Architecture

```
config/{attributes,functions}.json + config/entities/*.json
  └── config.ts (merges to one typed ConfigRaw)
        └── @fluxus/engine LocalStorageAdapter (seeds defs; loads/persists records;
              pub/sub; enforces field constraints on CREATE/UPDATE;
              host-named key 'fluxus:sdm:records', legacy 'aber-poc-v1-records')
              └── @fluxus/engine createEngine (runActivity pipeline, evaluate,
                    config validation — see engine SPEC)
                    └── context/AppContext (hosts the engine singletons; subscribe →
                          tick → re-render; selection state; UI reactions around
                          runActivity)
                          └── components read via useAppContext()
```

- The engine's `Store` contract is the seam: swapping localStorage for the real backend (tRPC + Neon per root ARCHITECTURE.md) is a one-adapter change. Since Extraction the interface, the `LocalStorageAdapter`, the DSL bridge, `validateConfig`, and the core types all live in `@fluxus/engine`; the sdm package keeps what is workbench-specific — config, UI, `NotificationLog`, and the two service module implementations (`src/services/`).
- Two separate gets on type selection, kept separate for the future CQRS split: `getRecordTypeDef(typeId)` (def + workflow → grid columns, CREATE discovery, activity strip) and `getRecordTypeData(typeId)` (instances → grid rows).
- Extraction stage 1 (engine package, sdm repointed) is done; stage 2 (the page builder hosting a Store and the `run activity` callback action) is next — see root ROADMAP.

## UI

```
Header ("Fluxus SDM / Aber sample")
├── Side panel — RecordTypeList
└── Content
    ├── RecordsGrid — sort, search, count, CSV import/export, FK links, CREATE launch
    └── RecordView — owns back/forward nav state (viewedTypeId derived from record.typeRef)
        ├── AvailableActivities (record-level; CREATE excluded — it has no anchor record)
        ├── RecordDetails (read-only custom fields; FKs via FkDisplay asLink)
        ├── RelatedRecords (reverse-FK index)
        └── ActivityHistoryList
```

Schema Navigator: org-chart-style record-type relationship viewer — focal type centred, FK targets one side, reverse FKs the other, click to recentre; launched from the RecordView header.

## Naming conventions

Collections are plural: `rt_<plural>` / `wf_<plural>` / plural display names. Activity IDs `act_<verb>_<plural>`; activity display names singular (they act on one record). Rationale: types and workflows name collections; an activity acts on an instance.

## Adding a record type

Add a workflow (with one CREATE activity) and a record type (`workflow_ref` pointing at it) to the config. Rules: attribute keys matching custom field keys are written on create; unmatched dropped; unmatched fields seed from `default`; constraints enforced by the adapter.
