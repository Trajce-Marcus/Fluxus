# @fluxus/runtime — Living Spec

Current design truth for the **Runtime app** — the runtime-plane app end users sign into: sign in, land on the operation's menu, open published pages. Updated in the same commit as any behaviour/design change (see root CLAUDE.md). Point-in-time build history lives in [phases/](phases/). The canonical schema is [SDM_Schema_Reference.md](SDM_Schema_Reference.md) — it wins on any conflict.

The package was `@fluxus/sdm` until the 2026-08-01 restructure. Two things left it and one thing stayed:

- **Gone to [`@fluxus/workbench`](../../workbench/docs/SPEC.md)** — the `<Workbench>` component and everything record-shaped: the UI tree, the attribute capture forms and widgets, the FluxScript form wiring (show conditions, required, validation, waivers, list datasources), the operation picker, the Schema Navigator, and the workbench's service composition. This package no longer exports a library face at all: **apps never import apps.**
- **Stayed here** — the Runtime app itself, plus the demo asset-maintenance config in [config/](../config/) (test fixture and reference only — nothing installs it) and the SDM/pipeline doctrine below, which is model-level truth rather than app behaviour.

## Model

Everything is driven by one logical config, stored split for hand-editing in `packages/runtime/config/` — `attributes.json` and `functions.json` (shared pools) plus `entities/<name>.json` (record type + its workflow, always a pair) — and merged into one `SolutionConfig` by `src/config.ts` (typed by `@fluxus/engine`). The split is POC-era convenience; the endgame is the SDM in a database edited through UI. Collections:

- **`attributes`** — standalone, reusable capturable inputs; activities reference them by `attribute_ref`.
- **`recordTypes`** — collections (`rt_<plural>`): custom fields (incl. `fk_ref` with `fk_record_type` / `fk_display_field`), optional constraints (`required`, `unique`, `immutable`, `indexed`), a `workflow_ref`.
- **`workflows`** — one per record type (`wf_<plural>`): ordered activities. One `record_map: CREATE` activity per workflow is the expected pattern; capture activities (no `record_map` — log-only unless hooks act) appear in the record-level activity strip. `record_map: "GET"` (query activities: attributes = parameters, `returns` expression = response, never mutates) is specified in DSL_SPEC §5a and **built 2026-08-09** — `act_get_work_orders` is the demo case. Logging a GET is still to come. A GET is not offered in the record-level activity strip: it answers an app, it is not a button on a record.

Records are never edited directly. All mutation flows through activities; each run appends an `ActivityHistoryEntry` (exactly what the user entered). Attribute → custom field mapping is exact-key only; unmatched attributes are intentionally dropped (SDM §1.9.3 rule 2 — not a bug). Custom fields without a matching captured attribute seed from `default`.

Hooks (`before_hook` / `after_hook`) are FluxScript scripts (DSL Phase 2; string or array-of-lines in the JSON, joined on load). Fields like `status` change **only** via hooks — do not add a direct write path (SDM §7a); `act_complete_work_orders` is the pattern: no `record_map`, the after hook moves the status.

## Workbench surfaces (moved 2026-08-01)

The attribute-capture form wiring (`show_condition`, `required`, `validation`, `can_waive`, list datasources, composites), the file/photo/scalar widgets, and the workbench's service composition are UI and now live with their code: see [`@fluxus/workbench` docs/SPEC.md](../../workbench/docs/SPEC.md). The doctrine those surfaces implement stays below.

## Hooks (DSL Phase 2)

`runActivity` is the write pipeline: **availability gate → before hook → record_map mapping → activity history append → after hook**. `runQuery` is its read counterpart for GET activities: the same gate and the same before hook, then the `returns` expression, and nothing persists. Since the Extraction milestone it lives in `@fluxus/engine` (`createEngine({ store, config, services })`); hosts build an engine over a client and wrap `runActivity` with their own UI reactions (the workbench's are in [its SPEC](../../workbench/docs/SPEC.md)). The behavioural doctrine below is model-level truth, unchanged by either move.

- **Availability gate** — activity-level `show_condition` (on the activity def, e.g. `"context.record.status <> 'Completed'"` on `act_update_work_orders` / `act_complete_work_orders`): whether the activity is offered and invocable at all. Strict boolean — only `true` makes it available. Evaluated before capture, so `attributes` is banned (the validator rejects it at config load); `context.record` is the anchor, null for CREATE. The UI hides unavailable activities (record activity strip; the grid's New button and with it CSV import), but the check inside `runActivity` is the enforcement point — headless callers skip the UI. **Evaluation errors fail closed** (deliberately opposite to the attribute-level `show_condition` rule, which leaves the attribute visible — workbench SPEC): this is an access rule, and a broken gate must not wave the activity through. Availability ("does this activity apply to this record right now") is this gate's job; validating the captured payload is the before hook's. Role-style conditions on `context.user` work through the same mechanism, but a real permission model is a platform-tier concern — this complements it, it doesn't replace it. Server-authoritative re-check when the backend lands, same doctrine as the rest of the contract.
- **Before hook** — the gate. Runs with the captured attributes (type-coerced) before anything persists, in read-only mode: mutations and `queue` are rejected statically and at run time. `fail('msg')` rejects the submission with that message in the form; a runtime error in the hook also blocks (a broken gate must not wave submissions through). `warn('msg')` is a **soft stop**: `runActivity` returns `needs-confirmation` with the messages and persists nothing; the form locks its fields, shows the warnings with **Continue anyway / Cancel**, and Continue re-submits the *frozen snapshot* that was validated (edited values can never ride through on an acknowledged submit). CSV bulk import acknowledges warnings up front; `fail` still rejects rows. **Acknowledged gate warnings are recorded on the activity history entry** (`warnings` field — "warned X, continued anyway" is audit), kept separate from `capturedAttributes`. Entry attributes carry what the user entered plus anything hook logic wrote (Extraction stage 2 ruling: immutable means users never edit them; hooks legitimately write them — see engine SPEC). When the backend lands, the same gate re-runs server-side authoritatively with the same protocol.
- **After hook** — the effects. Runs after the record mutation persists, with `context.record` refreshed to the target record (the created record for CREATE); since Extraction stage 2 the history entry is appended *after* the hook (one write carrying user input, hook-written attributes, and the `system_log`), but a failing after hook still gets the entry appended — the activity is recorded, no changes were applied. Mutations stage during the run and commit atomically via the adapter; `queue`d service calls dispatch only after the commit. After-hook `warn`ings are informational (the commit already happened): console only, until the workbench grows a toast slot. DELETE activities run only the before hook.
- **Staging seam** — the adapter splits its writes for the transaction: `buildRecord`/`insertRecord` (createRecord ≡ both) and `validateUpdate`/`updateRecord`, so hooks validate constraints at staging time and persist on commit. Script `Date` values serialize to `YYYY-MM-DD` (local midnight) or full ISO strings.
- **Named functions** — `config/functions.json`, bodies as array-of-lines (joined on load); callable from every scripted surface. Config validation enforces the governance floor: mandatory description, flat namespace, declared name matches the entry.

Acceptance (in `test/dsl-wiring.test.ts`): `act_complete_work_orders` — the availability condition hides/blocks it once Completed, the before hook warns when never started, the after hook sets `status`/`completed_date` via the staged commit. ("Already completed" moved from a before-hook `fail` to the show_condition when the availability gate landed — it is applicability, not payload validation.)

Plumbing: the DSL bridge (`buildDslSchema` / `buildRecordsHost` / `buildEvalHost` / `coerceCaptured` / `joinScript`) and `validateConfig` moved to `@fluxus/engine` at Extraction — see the engine SPEC. Each host triggers the config-save-time check via `engine.reportConfigFindings()` at boot ("save time" while the SDM is file-edited); diagnostics go to the console. Covered by `test/dsl-wiring.test.ts`.

**Services in the demo config (DSL Phase 3).** Two modules back the shipped scripts — `notify` (effect: `user`, `email`) and `geo` (read: `suburbsOf`, implemented in `@fluxus/engine`; it backs the suburb `List` datasource, so the city → suburb dependent picker exercises a service call end to end). `validateConfig` passes the registry, so the config is checked strictly: unknown service modules/functions, wrong arity, and effect calls outside after hooks are startup errors. Sample wiring: `act_complete_work_orders`' after hook ends with `queue services.notify.user('Work order ' + context.record.id + ' was completed')` — visible proof of the outbox: the notification dispatches only when the hook commits; a `fail`/soft-stop-Cancel dispatches nothing. Since backend stage 2 that hook runs **server-side**, so the dispatch lands on the server's notify sink (process console), not this app's bell — see the dormant-bell note under Architecture. Acceptance in `test/dsl-wiring.test.ts` ("DSL Phase 3 — services through the SDM wiring"). Where each host composes its own sink: this app's is `src/services/notify.ts` → `src/store/NotificationLog.ts`; the workbench keeps a separate dormant copy ([workbench SPEC](../../workbench/docs/SPEC.md)).

**No seeds (2026-08-05).** Entity files used to carry a `seeds` block — sample records loaded into any store that had none of that type, cities/suburbs among them so the location picker worked out of the box. It is gone: config, `SolutionConfig.seeds`, the `MemoryAdapter` loader, and the server's `seedOperationRecords`. It was a second write path into records, straight past activities, for demo convenience only — the one thing the invariant below forbids. An operation now starts empty and every record in it arrives through an activity; a store built from config alone holds nothing. Tests that need data build it themselves (`test/dsl-wiring.test.ts` pins a location fixture; the server's headless test raises its anchors through their own activities).

**And nothing else is prepopulated either.** The same day, the removal went the rest of the way: the seed script is deleted (with `npm run seed` / `npm run seed:server`), so nothing pushes this package's config or any page into a database, and no migration installs a demo org. [config/](../config/) is **test fixture and reference material** — the source of truth for a solution is the database, authored through the Console. Full account in the [server SPEC](../../server/docs/SPEC.md) under "Nothing is prepopulated".

Reference data (cities, suburbs, checklists) therefore has to be entered like anything else. If loading it in bulk is worth solving, it gets built deliberately as an import that runs activities — not by reviving a bypass. A "create a sample solution" action may be built later; the rule is that it runs when asked for by name, never on its own.

## The pipeline is the log (design direction, agreed July 2026 — not yet built)

There is no logging subsystem and there will not be one. Warnings, notifications, service dispatches, and observability are all **ordinary history data in the one pipeline**. Agreed in discussion 2026-07-10; lands physically with the backend (Postgres history table); nothing here is implemented in the workbench yet.

**The invariant.** All data operations happen via activities within workflows, and every workflow anchors to a record — no exceptions without prior discussion. The platform in one sentence: records have workflows; workflows have activities; activities are the only way anything happens; some record types are the system's own.

**Class: `direct` vs `system`.** Record types are classed — *direct* (business truth: work orders) or *indirect/system* (apps, no-UI workflow anchors, notifications). History entries inherit class by a rule nobody applies per-entry:
user-authored submissions on direct types = `direct`; engine-authored entries = `system`; everything on indirect types = `system`. Retention promise, precisely: **no entry of either class is ever edited; direct history is never trimmed; system history is retention-managed** by a visible governed policy (management tooling later — not MVP).

**Recording what a run did.** A run that executes an after hook appends up to two entries to the record's history:

1. *Submission entry* (`direct`, user-authored — exists today): `capturedAttributes` = exactly what the user entered; acknowledged gate warnings ride on it.
2. *Execution entry* (`system`, engine-authored — the after-hook run recorded like a human's run): its attributes state plainly what the machinery did — "record XYZ created", "email sent", after-hook warnings. **Appended only when there is something to say.** This replaces both the "activity log stream" and the "outbox table" ideas — deleted from the vocabulary.

No linking key between the two: every activity runs against a record, so both entries already sit on the same record's history. If real usage ever shows a tracing gap, a link can be added then — not before.

**Entry shape rulings (2026-07-12, land with the backend; the browser POC keeps its current fields until then):**
- *An entry is its attributes.* System-produced values use reserved attribute keys rather than special fields: `system_log` (hook log lines — implemented in the engine already) and `system_warnings` (acknowledged gate warnings — replaces the entry's separate `warnings` field).
- *Waivers:* one attribute, one row/entry — never a separate line. The waived attribute's value stays `null` (typed consumers see exactly "missing") and the mandatory reason is recorded **alongside the attribute** as `waive_desc`; its presence is the flag. Replaces the separate `waived` map.
- *Class is never stored per entry:* declared on the record type; an entry's class is derived from (type class, author). Entries store the author.

**Notifications — OPEN, deliberately deferred (July 2026).** The candidate shape is "notifications are records on an indirect record type" (created through the pipeline; delivery outcomes appended as activities), but this is *not agreed*: what notifications the platform actually needs is unknown yet, and designing their storage before knowing their use is premature. What IS agreed: no bespoke store survives long-term — the workbench's current `NotificationLog` + bell is a disposable stand-in either way. Added 2026-07-12: the notification centre conflates two roles, and only one is its own. The *audit* role (a record of what hooks sent) belongs to the pipeline — every `notify.*` call originates inside an activity run, so the fact of sending rides the history entry as attributes, same as `system_log`. The *delivery* role is the survivor: a notification is addressed to a **user**, not a record, and an inbox needs per-user addressing and read/unseen state — user state the pipeline shouldn't hold. Endgame: pipeline holds the truth of sending; the notification centre is a thin delivery view/inbox stub whose own storage is ephemeral UI state, never a second source of truth. Related deferred question, same discussion: history entries that need to **move/re-anchor from one record to another** (e.g. a notification arising on one record but belonging to another) — to be worked through against the never-edited promise (the archiving move-never-edit precedent is the likely key).

**GET requests are logged light**, as system-class entries: params, caller, outcome, duration — **never the returned data**. (This deliberately supersedes the earlier "GET writes nothing": system-class + governed retention resolves the objection that killed logging then.)

**Read service calls are not logged individually** (datasource-evaluation volume); they're subsumed by the activity/GET that triggered them. Effect dispatches are always recorded (execution entry + notification-style records).

**`watch` is the single escalation valve** — a per-activity dial that captures more when needed: validation failures, individual read calls, payloads. One mechanism; no ad-hoc logging switches.

**Not logged / parked (decisions, not accidents):** UI errors — not logged, accepted. Rejected submissions (gate `fail`) leave no trace — watchable when needed. SDM config edits live outside the pipeline — the platform-to-build-the-platform spiral is deliberately not entered.

**Sequencing:** MVP-first — ride the pipeline, take the free wins (uniform audit, AI-legible stream, zero logging concepts for solution builders), build retention tooling when real usage provides metrics.

## Cancelling a mistaken activity (doctrine, decided July 2026)

Activity history is append-only and never edited, so **cancel can never mean delete — it means compensate**: post a new activity that reverses the effects and references the mistake, the way accounting posts a reversal instead of erasing a journal entry.

- **No generic platform "undo".** Auto-inverting `record_map` effects is unsound: after hooks and `queue`d service calls are not invertible (a sent notification stays sent), and later activities may have overwritten the same fields — an automatic revert restores neither correctness nor truth.
- **Cancellation is modeled, not built in.** Where a workflow needs it, the SDM author defines a compensating activity (`act_cancel_...`, `act_correct_...`) whose hooks implement what "undo" means in that domain; its own availability `show_condition` governs when cancelling is allowed. The Phase 2 DSL is already sufficient.
- **Future nicety (not built):** a `cancels`/`corrects` reference on `ActivityHistoryEntry` linking the compensating entry to its target, so the UI can badge cancelled entries and audits can trace the pair.
- **Ruled out permanently:** any admin surface that edits or removes history entries — it would break the never-edited promise the spine is built on. (Pre-commit, the before-hook `warn` soft stop already catches the "obvious mistake"; compensation is the post-commit answer.)

## Architecture

```
config/{attributes,functions}.json + config/entities/*.json
  └── config.ts (merges to one typed SolutionConfig — test fixture only, installed
        nowhere; the running app reads config from the server)

src/host.ts (backend stage 2): FluxusClient.connect() → scope config +
        partition snapshot in the engine's MemoryAdapter;
        createPageRuntime({client}) — the @fluxus/page-runtime handle; one
        throwaway engine for reportConfigFindings() at boot (since M15 the app
        renders pages only, so nothing else here needs one); main.tsx awaits
        initHost() before rendering (server unreachable → boot error screen,
        no fallback)
        └── context/RuntimeContext (shell state: session/auth, the identity
              line's three names, published page paths, the open page)
              └── components/ (MenuNav, PagesList, PageView, NotificationCentre)
                    read via useRuntime()
```

The package has **no library face** since the 2026-08-01 restructure: `src/index.ts` and `"main"` are gone with the workbench, and no package imports this one. Apps never import apps.

- The Store-contract seam paid off at backend stage 2 (2026-07-12): hosts swapped `LocalStorageAdapter` for a fetched `MemoryAdapter` snapshot (`@fluxus/client`) with the UI untouched — reads and FluxScript evaluation stay local and synchronous; every mutation is a server-side `activities.run` (hooks + persistence live there only) followed by a partition re-fetch. This package keeps the demo config (as test fixture), the Runtime shell, and its own `NotificationLog` + notify sink (`src/services/notify.ts`; geo moved to the engine at DSL Phase 4).
- **Notification bell is dormant since stage 2**: hooks (and their `queue services.notify.*`) execute server-side, where the sink is the process console. The bell + `NotificationLog` stay wired (manifest still validates) and come back to life with the unified-log design.

## UI

The app is `main.tsx` → `App.tsx`: published pages and nothing else. The record
surface is [`@fluxus/workbench`](../../workbench/docs/SPEC.md), mounted by the
Console — not by this app (M15).

```
Runtime app — src/App.tsx
Header (identity line, notification bell, user menu)
├── Side panel — MenuNav; PagesList only as the no-menu fallback
└── Content — PageView for the open page, else the empty state
      ("Nothing published yet" / "Nothing open")
```

**Which operation it runs (2026-07-26):** `?operation=<id>` in the URL selects it (`initHost` reads the query string and passes `operationId` to `FluxusClient.connect`); absent ⇒ the client's default operation, so existing links keep working. This is how the Console's Operations list launches the app — Console's **Open** on an operation opens `${VITE_FLUXUS_RUNTIME_URL}/?operation=<id>` in a new tab — and it makes an operation a plain bookmarkable address.

**Pages (2026-07-19, extended M15):** pages render via `@fluxus/page-runtime` (`PageView` — plain `<style>` tag for the renderer css, no shadow DOM). The "Pages" listing that introduced them is now the **no-menu fallback only**; with a menu effective, `MenuNav` addresses pages. The open page lives in `RuntimeContext` — since M15 there is no record selection beside it to return to.

**Runtime shell (M10, 2026-07-26 — CONSOLE_RUNTIME_SPEC §4):** the app is chrome around the effective menu. Top bar: a ☰ toggle (nav collapse, persisted at `fluxus:sdm:nav-open`), the identity line (below), then the notification bell, and (auth configured) a user menu — signed-in name + Sign out (`hostAuth.signOut()` then reload, so boot re-runs the sign-in gate; `host.ts` exports `currentSession`/`hostAuth` for it). Nav: `MenuNav` (the role-filtered effective menu, `client.visibleMenu()`) is primary; without a menu (demo/adoption posture) the pages listing is the fallback. *Amended M15:* the record-type list is gone from this nav entirely — it belongs to `<Workbench>` now — and so is the "Workbench" menu item.

**Identity line (M13, 2026-07-27):** the header answers who you work for, which app you are in, whose data it runs on, who you are, and whose platform this is. Left: **org name** `·` **solution name** (`.app-org` / `.app-header-sep` / `.app-title`). Right, before the toggles: the **operation name** as a context chip (`.op-chip`) — display-only, since switching operations in-session needs a memberships list that does not exist. All three come off `FluxusClient` (`orgName` / `solutionName` / `operationName`, resolved at connect from `operations.get`). Platform attribution is one **"Powered by Fluxus"** line pinned to the foot of the nav (`.powered-by`; `.side-panel` is now a column with a scrolling `.side-panel-nav`) — at the edge, never competing with the tenant's branding in the bar. Names come from the tenancy's own rows — nothing installs a demo org, solution or operation any more (2026-08-05), so each is whatever its admin named it, falling back to the id when a row is missing.

**Workbench out of the Runtime app (M15, 2026-07-27 — BUILT; CONSOLE_RUNTIME_SPEC §4):** the Runtime app renders published pages only. Raw record access, running any activity, CSV import and the schema navigator are design-plane work, so the whole cluster collapsed into `<Workbench client user? />` and moved to the Console, where it mounts as a solution-level tab against the M9 data operation. What changed here:

- **`AppContext` is gone**, split in two. `context/RuntimeContext` holds this app's shell state (session/auth, the identity line's three names, published page paths, the open page); the workbench's own context holds everything record-shaped. Nothing above `<Workbench>` knows the record state exists — that mixing *was* the coupling.
- **Consequences, by design**: no "Workbench" menu item, no record-type list in the Runtime nav, and an operation whose solution has no published pages shows an empty app. The escape hatch is gone deliberately.
- **Package shape, since 2026-08-01**: the cluster is its own package, [`@fluxus/workbench`](../../workbench/docs/SPEC.md) — which owns its component contract, its css-as-a-string rule, the operation picker, the Schema Navigator and its panel layout. M15's interim shape (`src/index.ts` + `"main"` exporting `<Workbench>` from this package) is gone: apps never import apps.

**UAT component labels: removed 2026-08-01.** The header "Labels" toggle and `context/UatLabels.tsx` overlaid each region with its component name for UAT feedback. Deleted along with every `ComponentLabel` usage and the `fluxus:sdm:uat-labels` key.

## Naming conventions

Collections are plural: `rt_<plural>` / `wf_<plural>` / plural display names. Activity IDs `act_<verb>_<plural>`; activity display names singular (they act on one record). Rationale: types and workflows name collections; an activity acts on an instance.

## Adding a record type

Add a workflow (with one CREATE activity) and a record type (`workflow_ref` pointing at it) to the config. Rules: attribute keys matching custom field keys are written on create; unmatched dropped; unmatched fields seed from `default`; constraints enforced by the adapter.
