# The activity pool and apps — spec

**Status:** **Part 1 (the activity pool) BUILT 2026-10-10.** Its run check
(§1.5) was deferred then, and is now step 1 of Part 2 (ruled 2026-10-15).
**Part 2 (apps) re-specified 2026-10-15**, not built; it is built in four
steps, each checked before the next (§2.9). **Cold-reviewed 2026-10-16: step 1
can be built; steps 2–4 are not ready.** Start from § Cold review 2026-10-16 —
seven decisions await the user, then the spec is revised. Built from the exploration in
[ideas/apps-and-instances.md](ideas/apps-and-instances.md) and the user's
rulings of 2026-10-04 and 2026-10-15 (below).

**The word "instance" is retired (2026-10-15).** What it named — a page set up
in one operation — is now called the **app**. The file keeps its name so
existing links work. Text written before 2026-10-15 (the ideas note, the
2026-10-04 rulings below) uses the old words: there, "app" means the page and
"instance" means the app.

## In short

Activities live in one list per solution, the **activity pool**, and a
workflow lists the pool activities it uses, in order (Part 1, built). A
**page** is a definition the author builds and publishes. An **app** is a page
set up in one operation — what end users open, for example a water scheduler
and a sewer scheduler built from one page. Each app is a record of the
platform's own record type `rt_sys_apps`, holding its page, label, menu
placement, roles and settings; the operation's apps that have a label are its
menu. A page registers the record types it works with and may have a workflow
of its own. The app offers each registered type's workflow, plus the page's own
workflow for runs with no record, which run on the app. The page may add a
condition to any of those activities, and it must pass along with the
activity's own. Every run carries its app, and the server checks all of it.

## Rulings

### 2026-10-15 (this revision)

Who decided is marked: **the user's** ruling, or **Claude's** suggestion that
the user agreed to.

- **A page is the definition; an app is a page set up in an operation** —
  what users use, for example a water scheduler and a sewer scheduler built
  from one page. The user's. "Instance" is retired as ambiguous (the user's);
  a run carries `appId` and the URL `app=` (names the user proposed).
- **A page registers the record types it works with.** The app's activities
  are those types' workflows plus the page's own workflow. Registering record
  types rather than workflows was Claude's suggestion, agreed in the playback:
  a run names a record, whose type the server knows, and the type brings its
  current workflow.
- **Conditions instead of a remove list.** Which activities are available
  changes with state, so the page adds a condition per activity rather than
  listing activities to remove (the user's). The page's condition is added to
  the activity's own and both must pass; with none, the activity's own decides
  (the user's). It is one more expression per activity, beside the existing
  one — not a shared list of named conditions ticked against activities (the
  user's choice, for now; each condition converts later to one named row with
  one tick).
- So **an activity added later to a registered type's workflow appears on every
  app that registers the type**, unless a condition hides it (Claude raised it;
  the user agreed).
- **The page's own activities run only on the app, for now** (the user's). An
  action only one page offers on another type's records — a manager-only
  reopen of a shift report — goes in that type's workflow, with a condition.
- **An activity runs only on records of a type whose workflow includes it** —
  "no question, must not pass" (the user's). Built as step 1, and it applies
  in the Console's DSL Editor too (Claude's suggestion, agreed).
- **A run with no app is refused, except from the Console** (Claude's
  suggestion, agreed). This settles a disagreement: BLUEPRINT said such runs
  are refused, while this spec had allowed them for the workbench and outside
  callers.
- **Every page an operation uses is an app**, including pages reached only from
  other pages (the user's; Claude had suggested that such pages run under the
  app that opened them). The operation decides which pages it uses; if it sets
  up a page that opens another, it sets up that one too.
- **The menu is fields on the app** (label, group, order). An app with no label
  is not on the menu but keeps its settings (Claude's suggestion, agreed).
- **Opening a page that has several apps** picks the first, by group and order,
  that the caller may use (Claude's suggestion in the earlier draft, agreed).
- **The app's roles and the page's roles must both pass** (Claude's suggestion
  in the earlier draft, agreed).
- **No removing an app in Part 2** (the user's).
- **Apps are not created, changed or deleted by activities.** The page's own
  workflow has no CREATE, UPDATE or DELETE, unlike a record type's; an app is
  added in the Console (the user's, raised after the first draft of this
  revision).
- **Four build steps**, each working on its own (Claude's suggestion, agreed):
  §2.9.

### 2026-10-04

*Written before the renaming: here "app" means the page and "instance" means
the app. Where a later ruling changed one, it says so.*

- **A workflow is a named, ordered list of pool activities.** A record type
  points to one workflow, as today. An app points to one workflow of its own.
  (An earlier suggestion in the same discussion — an app gets an "activity
  list", not a workflow — was dropped: the list was a workflow by another name.)
- **An activity runs only through a workflow**, a record type's or an app's. A
  pool activity no workflow includes cannot run, GETs included.
- **An app may change which activities it has, but only narrow how each is
  used.** It adds through its own workflow and removes from either workflow. An
  activity's own rules (availability condition, hooks) apply wherever it runs;
  an app may tighten them, never loosen them. *Changed 2026-10-15: nothing is
  removed; the page narrows with conditions.*
- **A shared activity must fit every record type that uses it**, and that is
  the author's responsibility. Save checks it against each type and reports
  what does not fit; the author makes separate activities where it cannot.
  This includes CREATE: a CREATE reached through two record types is an error.
- **Record types keep their workflow.** Marking each activity with its record
  type instead (a model the user has used before) was considered and not taken.
- **Page settings stay on the page; the instance overlays them.** Roles stay on
  the page. Publishing a page updates every instance of it. *Changed
  2026-10-15: the app has roles too, and both must pass.*
- **Instances are set up where the menu is set up.** The instance records *are*
  the menu: no separate menu structure is stored for an operation.
- **A run always carries an instance; the record may be missing.**
- **`rt_sys_apps` is the platform's, not a solution's.** It is defined in
  platform code, like a system table, and no solution carries or changes it. Its
  rows live in `records`, so app use leaves history exactly as on any record.
  The name stays `rt_sys_apps`.
- **The Console writes instances directly.** Changing records only through
  activities is a rule for operational data; instance setup is not.
- **Settings are one plain string field** holding JSON. No new field type. How
  pages and hooks read the settings is deferred until there is a real need.
- **The solution's default menu stays at solution level** as the starting
  instances, copied into an operation when it is created.
- **A page added to a solution later reaching existing operations is parked.**
- **Change control (review before publish) for the model and instances is
  wanted later.** Nothing here may close it off.

---

## Part 1 — the activity pool

### 1.1 What it is

Today each activity is stored inside its workflow (`sdm_workflows.def.activities`).
After Part 1, activities are stored once per solution, and a workflow holds an
ordered list of references to them — the way an activity already holds an
ordered list of references to pool attributes.

Nothing changes for a person using a page or the workbench. Every existing
activity keeps its id, so history entries, page scripts and `invoke(...)` calls
that name activity ids keep working.

### 1.2 Storage

- New table **`sdm_activities`** — same shape as the other `sdm_*` entity
  tables: `solution_id`, `id`, `def` (the activity verbatim, including its id),
  `created_at/by`, `updated_at/by`; primary key `(solution_id, id)`.
- `sdm_workflows.def.activities` becomes an ordered list of references:
  `[{ "activity_ref": "act_submit_shift_reports" }, …]`. An object rather than a
  bare id, so per-workflow settings can be added later without a reshape (as
  attribute usages carry theirs).
- **Order is the list's order.** `sort_order` is removed from the activity: a
  shared activity has no single position. Callers that sort by it stop sorting
  and take the list as given.
- **Migration** (hand-written, auto-applies on connect, as all migrations here):
  for each workflow, sort its nested activities by `sort_order` then array
  position, insert each into `sdm_activities` without `sort_order`, replace the
  nested list with references in that order. Measured on the dev database
  2026-10-04: 111 activities across two solutions, ids already unique per
  solution, no workflow shared by two record types.
- **The migration fails loudly on a conflict.** If a database holds the same
  activity id in two workflows with different definitions (compared ignoring
  `sort_order`), the migration raises an error naming the id rather than keeping
  one. Only the dev database was measured; prod and local databases were not.
  It also needs its entry in `migrations/meta/_journal.json`.
- **Code and migration ship together.** Old code cannot read the new shape and
  new code cannot read the old, so a host running either against the other
  fails. Locally migrations apply on connect; the Vercel entry skips them and a
  deploy runs `db:migrate` by hand (`db/client.ts`).
- **Published versions** (`sdm_config_versions`) are immutable and keep the old
  shape. One TypeScript conversion function turns the old shape into the new,
  applying the migration's rules (order by `sort_order` then position; identical
  duplicates become one activity, compared ignoring `sort_order`). Every path
  that accepts a whole model runs it: rollback (`rollbackConfig` → `putConfig`)
  and import (`putConfig`). History is never rewritten.
- **Rollback stores the converted model as the new version**, not the old
  snapshot, so the newest version always matches the live tables.
  `sdm_config_versions.config` is typed as either shape on read.
- **An old snapshot may hold the same activity id in two workflows with
  different definitions.** The rollback is refused, naming the id.
- The migration's SQL and the TypeScript converter state the same rules twice;
  one test fixture runs through both.
- **One-off scripts** in `packages/server/scripts/` (11 of them write the model
  through `putConfigEntity`) assume nested activities. They have already run
  against the dev data and are not maintained; they are left as they are.
- **Record the reversal.** The 2026-08-08 ruling "activities stay inside their
  workflow" (server SPEC "Model storage", `schema.ts` comment on
  `sdm_workflows`) is marked reversed, with the reason: activities are now
  shared between workflows. Its "a migration with no API change" did not hold:
  `putActivity` / `deleteActivity` are new.

### 1.3 Config shape

- `SolutionConfig` gains `activities: ActivityRawDef[]` (the pool);
  `ClientSolutionConfig` gains the client grade of the same.
- `WorkflowRawDef.activities` becomes `ActivityUsage[]` — `{ activity_ref }`.
- The **resolved** shape does not change apart from `sort_order`:
  `WorkflowDef.activities` is still `ActivityDef[]`, filled from the pool in the
  workflow's order. `ActivityDef.sort_order` is removed with the raw one. Code that reads
  a record type's workflow through the store is untouched.
- **Client trim** (`projectConfig`): the pool is trimmed the same way the nested
  activities are today — the browser gets only activities in workflows it is
  sent, and the attributes and functions they reach. An activity in two shipped
  workflows is sent once. An activity no shipped workflow uses is not sent.

### 1.4 Rules (enforced by `validateConfig`)

- Activity ids are unique in the pool.
- Every `activity_ref` resolves; no workflow references the same activity twice.
- **A CREATE belongs to exactly one record type.** Today the engine works out
  which type a CREATE makes from the workflow that holds it. A CREATE reached
  through the workflows of two record types — by a shared activity, or by two
  types sharing one workflow — is an error, because the engine could not say
  which type to create.
- A pool activity that no workflow references is allowed, and cannot run —
  GETs included (§1.5).
- **Scripts are checked per record type.** An activity's scripts
  (`show_condition`, attribute rules, hooks, `returns`) are checked with
  `context.record` typed as each record type whose workflow includes it — once
  per type, a problem reported against the type it fails on. An activity no
  record type reaches is checked untyped, so field typos surface once a
  workflow includes it. The DSL validator's typing of `context.record` already
  takes the type as an input (`anchorType`); the change is calling it per type,
  entirely inside `validateConfig`. Problems that do not depend on the type
  (syntax, an unknown function, a bad `invoke` id) are reported once, not once
  per type; the rest name the type they fail on.
- **`invoke` of an activity no workflow includes is an error at save**, since it
  cannot run (§1.5). `validateConfig`'s `invoke` id map holds only activities
  some workflow includes, matching `validatePage` and the engine.

### 1.5 Behaviour

- **Field filling on a shared activity:** unchanged, and per record type. An
  UPDATE fills the fields of the record it runs on by exact key; an attribute
  naming its field in full (`rt_x.field`) fills that field on `rt_x` and falls
  back to exact key on any other type. Only CREATE and UPDATE fill fields; GET,
  DELETE and log-only activities do not.
- **Finding an activity by id** (`findActivity` in engine, server and page
  runtime) finds only activities some workflow includes; an activity in the pool
  alone is "not found", as today.
- **New check — only an activity that belongs to the record may run on it**
  (approved by the user 2026-10-06). **Deferred by the user 2026-10-10 — not
  built with Part 1.** **Now step 1 of Part 2 (ruled 2026-10-15), DSL Editor
  included (§2.9).** It is one check in `activities.run` and nothing else in
  Part 1 depends on it; until it is built, runs behave as they did before the
  pool. Part 2 needs it (§2.6). Today the server runs any UPDATE, DELETE
  or log-only activity against any readable record, whether or not that
  record's type lists it (`activities.run` checks the anchor is readable, never
  that its workflow holds the activity). The server now rejects a run whose
  activity is not in the anchor's record type's workflow. Part 2 widens this to
  include the page's own workflow, for runs on an app (§2.6). CREATE (no anchor) and GET (a
  question, not an act on its anchor) are not checked here. Before building,
  measure whether any existing page runs an activity on a record whose type's
  workflow lacks it.
- **Model querying (`model.*`):** `model.activities` lists every activity in
  the pool, one row each, used or not; it loses `workflow_ref`,
  `record_type_ref` and `sort_order` (an activity now has many of each). A new
  collection **`model.workflow_activities`** has one row per workflow's use of
  an activity: `workflow_ref`, `activity_ref`, `position`. A workflow's
  activities are its rows there.

### 1.6 Console

Approved by the user 2026-10-04.

- **A new Activities panel** in the model builder, beside Attributes: the
  solution's pool. Activities are created, edited and deleted here, with the
  editing the Workflows editor has today (name, description, record map,
  availability condition, attributes, hooks, `returns`). Each activity shows
  which workflows use it, so the author knows an edit changes all of them.
- **The Workflows editor** picks and orders: add an existing pool activity,
  remove one from the workflow (it stays in the pool), reorder. A shortcut "New
  activity" creates one in the pool and adds it to the workflow in one step.
- **Deleting a pool activity** is refused while any workflow references it; the
  message names them.
- Writes go per entity, like the others: `putActivity` / `deleteActivity` on the
  server; `putWorkflow` stores references only.
- **Save order.** Each per-entity write validates the whole model, so the
  Console saves in an order that never passes through an invalid state: new or
  changed pool activities before the workflows that add them; workflows that
  drop an activity before that activity's deletion; when a CREATE moves between
  workflows, the workflow losing it before the one gaining it.

### 1.7 Where the build has to look

Code that reads activities through the store's resolved `WorkflowDef` keeps
working. These read the stored shape, assume one owning record type, or are new:

- **Engine:** `createTypeByActivity` and `findActivity` (engine.ts);
  `validateConfig.ts` (the `invoke` id map, §1.4; the per-workflow script
  checks that become per-type); `modelProjection.ts` (`activityRows`, and
  `resolvedCaptureLists`, which must cover unused activities); the memory
  adapter's workflow resolution; the store interface (`store.ts` `ModelStore`)
  gains a way to list the resolved pool, delegated in the server's
  `databaseStore.ts`; `types.ts` (`sort_order` goes).
- **DSL:** no change; `anchorType` is already an option.
- **Server:** `findActivity` (host.ts); the new check in `activities.run`
  (router.ts); `projectConfig` (projection.ts: workflow walk, `sort_order`);
  host.ts `getSolutionConfig`, `putConfig`, `putConfigEntity`,
  `configCollections` (an `activities` entry), `COLLECTIONS_IN_FK_ORDER`,
  `rollbackConfig` (stores the converted model), `publishConfig`'s empty-model
  check; the new `putActivity` / `deleteActivity` routes; `sdm_config_versions`
  typing.
- **Client:** `putActivity` / `deleteActivity` beside `putWorkflow`.
- **Page runtime:** its own `findActivity` (runtime.ts) returns the *first*
  record type whose workflow holds the activity. For a shared activity the type
  must come from the record the run is on, since the capture form resolves
  attributes against it — and `ComponentContainer.tsx` opens the form before
  the anchor is fetched, so the form waits for the anchor or is set again once
  it arrives. `validatePage`'s host walks the same way.
  `availableActivities.ts` stops sorting by `sort_order`.
- **Workbench:** `AvailableActivities.tsx` stops sorting by `sort_order`.
- **Console:** `WorkflowsEditor.tsx` (pick and order, no `sort_order`); the new
  Activities panel, wired into `SdmView.tsx` and the sdm-builder `index.ts`;
  `useSolutionConfig.ts` (`saveActivities`, and the save order in §1.6);
  `AttributesEditor.tsx` (its "used by" walk); the DSL Editor's activity runs
  (§ Decision before building).
- **Test model and tests:** the JSON model in `packages/runtime/config/entities/`
  (used by `runtime/src/config.ts` and the server's `headless.test.ts`) and
  about 24 test files build nested activities with `sort_order`. Engine tests
  that call `createEngine` directly never pass through the converter, so their
  fixtures are rewritten.

### Decision before building

*Settled 2026-10-15: the check applies in the DSL Editor too, and that use
goes (Claude's suggestion, agreed).*

- **The DSL Editor and the new check.** The Console's DSL Editor runs any
  activity against any anchor, including a record of another type — documented
  as allowed ("said, not enforced", DSL_EDITOR_SPEC). The new check refuses
  those runs. Either the check applies there too and that use goes, or the
  Editor is exempt.

### 1.8 Not in Part 1

- Renaming activity ids (`act_<verb>_<plural>` does not fit a shared activity).
  A tidy-up, deferred.
- Settings per workflow reference (an override of `show_condition`, say). The
  reference is an object so this can be added later.
- Anything about apps or pages.

### 1.9 Done when

- Migration applied to the dev database; every solution loads and validates.
- Every existing page and the workbench behave exactly as before (the
  `projects` solution's pages are the real check).
- One activity added to the workflows of two record types runs from the
  workbench on a record of each, and fills each type's fields by exact key.
- The same shared activity, run from a page on a record of the second type,
  opens its form against that type.
- A CREATE added to a second record type's workflow is refused at save.
- A shared activity whose script uses a field one of its types lacks is refused
  at save, naming that type.
- An activity in the pool but in no workflow is "not found" when run or
  `invoke`d.
- *(Deferred with the check, §1.5; now Part 2 step 1.)* The server refuses an UPDATE, DELETE or log-only run on a record whose type's
  workflow does not include the activity.
- Rolling back to a version published before the migration works.
- Workbench and page activity buttons keep their order.
- Engine, server, console and page-runtime SPECs updated; GLOSSARY gains
  *activity pool*. Docs that state the old design are corrected: GLOSSARY
  "Model storage" ("Activities are not a table"), CLIENT_TRUST_BOUNDARY
  (`sort_order` in the client grade), QUERYING_THE_MODEL (`workflow_ref` /
  `record_type_ref` "derived from nesting"), CONSOLE_RUNTIME_SPEC, server SPEC
  "Ordering", DSL_EDITOR_SPEC §8, runtime `SDM_Schema_Reference.md`.

---

## Part 2 — apps

Built in four steps (§2.9), each checked before the next.

### 2.1 Page and app

- A **page** is authored and published in the solution, as today (`pages`,
  `page_versions`). Publishing a page updates every app built from it.
- An **app** is a page set up in one operation: a record of `rt_sys_apps`
  (§2.3). An app *is* that record; a run with no other record runs on the app,
  and leaves its history there. One operation may have several apps from one
  page (a water scheduler and a sewer scheduler), each with its own label,
  roles, settings and history.
- An operation has an app for every page it uses, whether or not that page is
  on its menu. A page with no app in an operation cannot be opened there, and
  nothing on it can run.

### 2.2 What an app offers

- **`PageDef.recordTypes`** — the record types the page works with. The page's
  own record type (`PageDef.record.type`) counts as registered whether or not
  it is listed.
- **`PageDef.workflow`** — optional: a workflow of the page's own, an ordinary
  workflow authored in the Workflows editor that no record type points to.
- **What the app offers:**
  - on a record of a registered type: that type's workflow;
  - with no record: each registered type's CREATEs and GETs, and the page's
    own workflow, which runs on the app.

  Nothing else. On a record of a type the page does not register, the app
  offers nothing.
- **The page's own workflow holds only log-only activities and GETs.** It runs
  on the app, which it must not change: a CREATE would have no record type to
  create, an UPDATE would fill the app's own fields (label, roles), and a DELETE
  would remove the app. Its hooks make the real changes, on other records — a
  bulk update of jobs, say. A workflow a record type points to cannot also be a
  page's own.
- **`PageDef.conditions`** — optional, activity id → expression: the page's
  condition for that activity. Same language and roots as an activity's own
  availability condition; `context.record` is the record the run is on (the
  app, for the page's own activities). An activity is offered only when its own
  condition and the page's both pass; with no page condition, its own decides.
  The server evaluates both; the browser never does.
- **Checked when the page is saved (`validatePage`):** each registered type
  exists; the page's own workflow exists, no record type points to it, and it
  holds only log-only activities and GETs; its activities' scripts are typed
  against `rt_sys_apps`; each page condition names an activity the app offers,
  and is typed against each record type that activity runs on in this app. The
  model does not know which pages name a workflow, so `validateConfig` keeps
  checking an activity only a page's workflow includes untyped (§1.4).
- **`PageRecordDef.instances` is removed.** Its `'one'` (find or create the
  page's record when it opens) is replaced by the app itself, and with
  `'many'` the only value left the field means nothing: a page record always
  comes from the URL (`?record=`). Measured 2026-10-15: no page on the dev
  database uses `'one'`.

### 2.3 `rt_sys_apps`

- Defined in platform code and added to every solution's model when it is
  loaded. It is never stored in `sdm_record_types`, never shown in the model
  builder, and an author cannot change it.
- **Fields:** `page` (page path), `label` (blank: not on the menu), `group`
  (text; apps with the same group show together), `order` (number; order
  within the group, and of groups by their first app), `roles` (role ids),
  `config` (a plain string holding JSON — the app's settings; how pages and
  hooks read it is deferred).
- **Workflow:** an empty one, defined with the type. What runs on an app comes
  from its page's own workflow (§2.2), never from the type.
- **Rows live in `records`**, per operation, like any record: an id, the fields
  above, and the history the app's runs leave.
- **Reads:** apps are not returned by general record reads (the Runtime's
  records, `records.*` in scripts, `RecordList`). The Runtime receives the
  caller's apps through the menu (§2.5); the Console reads them all.
- **Writes:** the Console writes apps directly (§2.4), not through activities —
  setting up an app is not operational data. Scripts cannot write apps, since
  they cannot read them.
- **The Console workbench** lists `rt_sys_apps` like any type, read only, so an
  app's history can be seen. It offers no activities (the type's workflow is
  empty). *A workbench change: approving this spec approves it.*

### 2.4 Console

- **Setting up apps.** The operation's menu editor (`admin/MenuItemsEditor`)
  becomes where its apps are set up: add an app (pick a published page), set
  its label, group, order, roles and config (a plain text box). Direct writes.
  No removing in Part 2; blanking the label takes an app off the menu.
- **The solution's default menu** (`sdm_menus`, edited in the model builder's
  Menu editor) becomes the solution's starting apps: a flat list of
  `{ page, label, group, order, roles, config }`, with a blank label for pages
  not on the menu. Today's one level of nested groups becomes the `group` text.
- **Creating an operation** copies the starting apps into app records for it.
  After that the operation owns them; nothing is inherited at runtime.
- **`operations.config.menu` is removed.**
- **The page editor's settings column** (beside *Page record* and *Page
  access*) gains:
  - the registered record types (ticks);
  - the page's own workflow (a pick list of workflows no record type points
    to);
  - **the activities list:** one row per activity the app offers, grouped by
    record type, then the page's own; columns: the activity, its own condition
    (read only), and the page's condition (editable, in the editor's existing
    expression dialog).

  *Page record* loses its one/many choice.

### 2.5 Runtime

- **The menu** is the operation's apps that have a label and that the caller
  may use (§2.6, check 2), grouped by `group` and sorted by `order`. The server
  filters, not the browser.
- **The URL** is `?operation=&app=&record=`. The app names the page; `page=` is
  dropped. An old link carrying `page=` opens that page's first app the caller
  may use (the rule below), so bookmarks keep working.
- **Opening another page** (`services.page.open`, or a component's link to a
  page) opens that page's first app in the operation, by group then order, that
  the caller may use. If there is none, the page says it is not set up for this
  operation.
- The page header's title is the app's label; an app with no label shows what
  the header shows today.

### 2.6 What a run carries, and what the server checks

- Runs (`activities.run`), GETs (`activities.query`) and the question of which
  actions a record offers (`page.activities`) carry **`appId`**, and a
  `recordId` when there is a record.
- **With an app**, the server:
  1. loads the app from the run's operation, and its page's published
     definition; either missing → not found;
  2. checks that the caller holds one of the app's roles **and** one of the
     page's roles (`access.open`); otherwise refused;
  3. finds what the run is on: the named record (read access applies, as
     today); the app itself when a non-CREATE run names no record; nothing for
     a CREATE;
  4. checks that the app offers the activity there (§2.2) — the record's type
     comes from the server's stored copy, never from the caller;
  5. evaluates the activity's own condition and the page's condition for it,
     with the real user;
  6. runs it under Part 1's rules.

  `page.activities` applies checks 1–5 and answers with what passes.
- **With no app**, the run is refused unless the caller has Console access to
  the operation's solution (org owner, org admin, or an admin of that
  solution). Those runs — the workbench, the DSL Editor, the page editor's
  preview — follow the record type's workflow and the activity's own condition
  only.
- **For every run, with an app or without:** an UPDATE, DELETE or log-only
  activity runs only on a record whose type's workflow includes it — for an
  app, its page's own workflow. A CREATE has no record, and a GET is a
  question rather than an act on its record, so neither is checked here
  (§1.5). From step 1 the DSL Editor's runs on records of other types are
  refused.
- **A GET with no record** is logged on the app. `context.record` is the app
  only for the page's own activities; a GET from a record type's workflow keeps
  an empty `context.record`, as today, because its scripts are typed against
  that record type. This finishes DATA_THROUGH_ACTIVITIES step 3 for pages with
  no record.

### 2.7 Migration

Measured on the dev database 2026-10-15: three solutions have pages —
`demo/sdm` (2 pages, both on its default menu, 2 operations), `projects` (8
pages, 1 on its default menu, 1 operation) and `inspections` (12 pages, 8 on
its default menu, 1 operation). `next-solution` and `primary-school-victoria`
have no pages and no default menu (3 operations), and get nothing. No operation
has a menu of its own. No page uses `'one'`.

- **Each default menu is reshaped:** nested groups become `group` text and
  `order` comes from position. Group-level roles are dropped (on dev, only
  `demo/sdm`'s group has any — the stray `role_`, which its items also carry);
  an empty group disappears (`inspections`' Admin). An item with no roles takes
  its page's roles (`access.open`), so what each person sees does not change
  (on dev, six of `inspections`' items have none).
- **A starting app with no label is added for every published page not already
  on the default menu**, with its page's roles, so every link between pages
  keeps working (on dev: 7 in `projects`, 4 in `inspections`).
- **Every operation of those solutions gets its solution's starting apps** as
  app records.
- **Each existing page registers** its own record type and every record type
  its components list, show or act on, found by walking the page (record
  lists, record views, action buttons, `invoke` ids). The build lists what it
  found per page for the user to check before the migration runs. Published
  versions are immutable, so the migration publishes a new version of each
  page carrying its registrations. Rolling a page back to a version from before
  the migration registers only its own record type; the author adds the rest.
- **`instances` is dropped** from page records.

### 2.8 Not in Part 2

- How pages and hooks read an app's `config`, and what `context.app` holds for
  an app (today a fixed `{ name: 'Fluxus' }` in the page runtime).
- The page's own activities running on records of registered types (an action
  only one page offers on another type's records).
- A shared list of named conditions ticked against activities.
- Removing an app.
- A page added to a solution later reaching existing operations by itself.
- The page editor's preview applying the page's registrations and conditions:
  it runs without an app, as a Console caller.
- Automations (the app with no UI).
- Search and pinning as ways to find apps.
- Review before publish for apps.

### 2.9 Build steps

1. **The record-type check.** One check in `activities.run`: an UPDATE, DELETE
   or log-only run on a record whose type's workflow lacks the activity is
   refused, in the DSL Editor too. Before building, measure whether any
   existing page runs an activity on a record of another type.
2. **Apps replace menu items.** `rt_sys_apps`; setting up apps in the Console,
   and the starting apps; the menu and operation migration (§2.7, first three
   points); the menu built from apps on the server; the URL `app=`; opening a
   page by its app; `appId` on runs, GETs and `page.activities`; checks 1–2 of
   §2.6; runs with no app refused except from the Console.
3. **Registered record types and the page's conditions.** `PageDef.recordTypes`
   and `PageDef.conditions`; checks 4–5 of §2.6; the page editor's record
   types and activities list; registering existing pages' types (§2.7);
   `instances` removed.
4. **The page's own workflow.** `PageDef.workflow`; runs on the app (check 3);
   GETs with no record logged on the app; the record-type check extended to
   apps.

### 2.10 Where the build has to look

- **Server:** `router.ts` (`activities.run`, `activities.query`, the offered
  actions `activities`, and the menu); creating an operation (copy the
  starting apps); `gates.ts` (Console access to one solution — today's
  `hasConsoleAccess` accepts an admin of *any* solution); model load in
  `host.ts` (add `rt_sys_apps`); `projection.ts` (leave apps out of general
  reads; send the browser the page's own workflows of pages the caller may
  open); migrations.
- **Engine:** the availability check gains the page's condition;
  `rt_sys_apps` as a platform type.
- **Page runtime:** `pageDef.ts`; `validatePage`; `runtime.ts` and
  `ComponentContainer.tsx` (`appId` on every call; opening a page by its app);
  `findActivity` for the page's own workflow.
- **Client:** `appId` on run, query and offered actions; the menu's shape
  (`MenuItem`).
- **Runtime app:** the URL, the menu, old `page=` links.
- **Console:** `admin/MenuItemsEditor.tsx` (setting up apps); the model
  builder's Menu editor (starting apps); `page-builder/PageEditor.tsx` (the
  settings column); the workbench (lists `rt_sys_apps`); the DSL Editor (runs
  on other types refused).
- **Docs:** each touched package's SPEC; DSL_EDITOR_SPEC; CONSOLE_RUNTIME_SPEC
  (menu, URL); GLOSSARY; ARCHITECTURE; BLUEPRINT.

### 2.11 Done when

- **Step 1:** an UPDATE run on a record of another type is refused — from a
  page, from a direct call, and from the DSL Editor.
- **Step 2:** an operation's menu comes from its apps, filtered by role on the
  server. Two apps of one page in one operation show as two menu items with
  separate histories. A new operation gets the starting apps. A run with no app
  is refused for a caller without Console access and allowed for one with it.
  A run naming an app the caller holds no role on is refused. Every existing
  page works as before, including links between pages.
- **Step 3:** a page that registers jobs and shift reports offers both types'
  activities; on a record of an unregistered type it offers nothing. A page
  condition hides an activity until it passes, and the server refuses the run
  while it fails. The page editor lists the app's activities with both
  conditions.
- **Step 4:** a page with no record runs a log-only activity from its own
  workflow; the entry lands on its app, and its hook changes other records. A
  GET from a page with no record is logged on the app. The page's own
  activities are refused on any other record, and without the app.
- SPECs, GLOSSARY, ARCHITECTURE and BLUEPRINT updated as each step lands.

---

## Cold review 2026-10-16 — open

A cold review of Part 2 against the code. Verdict: **step 1 can be built now**
(add what happens if its measurement finds a page that would break); **steps
2–4 are not ready.** Claude checked two findings itself and both hold (1 and 2c
below). Nothing here is ruled yet.

### Decisions for the user (Claude's recommendation in each)

1. **GETs and registered types.** As written, check 4 (§2.6) refuses most GETs
   pages make today: a page anchors every GET on its own record
   (`page-runtime/src/pageHost.ts:256`), and a form anchors its dropdowns' GETs
   on the record being acted on (`capture/AttributesForm.tsx:742,863`). The
   inspections job page lists area inspections and findings through GETs from
   other workflows; dropdowns call GETs from types no page registers
   (inspectors, defects). *Recommendation:* GETs don't need registration — they
   are questions, as the record-type check already treats them; read access
   still applies. Page conditions then cover acts only.
2. **Migrated menu roles.** Today a menu item's roles decide only what is
   listed and the page's roles decide entry (CONSOLE_RUNTIME_SPEC §5 "Two
   layers"); an item with no roles is hidden from everyone
   (`client/src/index.ts:861-871`). So §2.7's "an item with no roles takes its
   page's roles, so what each person sees does not change" is **wrong**: six
   `inspections` items (all admin pages) would become visible to admins.
   *Recommendation:* migrated apps take their page's roles (on dev, every item
   that has roles already matches its page), accepting that those six appear —
   probably an oversight in the inspections build. Needs the user's yes.
3. **Apps with no label must reach the Runtime.** §2.3 sends apps "through the
   menu" and §2.5 makes the menu labelled apps only, so links into the 11
   unlabelled pages on dev break at step 2. *Recommendation:* send the Runtime
   every app the caller may use; the menu shows the labelled ones.
4. **Who may run without an app.** §2.6 says org owner, org admin, or an admin
   of the solution; but the workbench, DSL Editor and preview are open only to
   solution admins (`config.get` → `requireSolAdmin`, `server/src/router.ts:495`).
   Also `scripts.query` runs GETs through `invoke` with no app, gated only by
   `requireOpUser` (`router.ts:1131-1157`). *Recommendation:* admins of that
   solution only; `scripts.query` follows the same rule.
5. **Does a Console change to an app leave a history entry?** BLUEPRINT rule 1
   (`BLUEPRINT.md:62-67`) says every change lands in history; app roles now
   control access. *Recommendation:* yes — the write stays direct but appends a
   history entry. Record the direct-write exception to rule 1 in BLUEPRINT,
   which today exists only in this spec.
6. **Logging GETs on the app.** Every GET from every user of a page with no
   record, re-run after each run, would rewrite one ever-growing jsonb array
   (`server/src/databaseStore.ts:450-456`); the engine also uses one record as
   both `context.record` and the log target (`engine/src/engine.ts:383-414`).
   *Recommendation:* drop it from Part 2; GETs on pages with no record stay
   unlogged, as today.
7. **Who sets up apps.** *Recommendation:* operation admins, as for today's menu
   override (`router.ts:463`).

### Fixes needing no decision (make them when revising)

- **Apps are never changed by runs.** `validatePage` cannot enforce §2.2's
  "log-only and GETs only": its findings never block a save
  (`console/.../page-builder/persistence.ts:36-46`), the server stores pages
  unvalidated (`host.ts:195-210`), it sees only the client grade of the model
  (no hooks or conditions), and later model edits never re-check pages. Add: the
  server refuses any CREATE, UPDATE or DELETE run on an app, and a hook may not
  update or delete `context.record` when it is an app (today it can:
  `dsl/src/validator.ts:762-765`, `evaluator.ts:1064`). The typing of page-own
  activities and page conditions moves to the server.
- **Where `rt_sys_apps` lives.** Every candidate place breaks something: left
  out of the validated model, the orphan check refuses model saves
  (`host.ts:651-662`); left in `getSolutionConfig`, publish snapshots it,
  rollback/import writes it into `sdm_record_types`, the model builder shows it,
  and `records.sys_apps` reaches every hook and GET (`engine/src/bridge.ts:135-170`).
  The DSL needs it in its schema to type against it. Read access cuts both
  ways (`computeReadable`, `projection.ts:42-58`): with auth on nobody reads
  it (workbench can't list it; a run on it answers "Record access denied" at
  `router.ts:980`); with auth off `records.*` and `projectConfig` hand it out.
  The spec must name the one place it is added (the run-time model only), how
  the DSL types against it without `records.*` seeing it, how read access
  treats it, and reserve the ids `rt_sys_apps` / `wf_sys_apps` so no solution
  can define them. §2.3's list of read paths also misses
  `records.partition/list/get`, `scripts.query`, `model.*`, `config.get`,
  `projectConfig`, publish and rollback.
- **Migration (§2.7).**
  - The page walk needs the DSL (types behind `context.record.quote`, a GET's
    `returns`), so it is a one-off script the user checks and runs, not an
    auto-applying SQL migration. With decision 1, it registers only the types
    whose acts a page runs.
  - Update the `pages` draft as well as publishing, or the author's next
    publish drops the registrations (`publishPage` snapshots the draft,
    `host.ts:237-241`); give values for `page_versions.readme` and
    `published_by` (NOT NULL, `schema.ts:457-467`).
  - Old published models hold the nested menu, and rollback writes it verbatim
    into `sdm_menus` (`host.ts:702-710`): add a converter, as Part 1 did for
    activities, and reshape `menuItemSchema` / `validateOperationMenu`
    (`host.ts:524-582`).
  - State the created apps' ids (UUIDv7, also on PGlite) and their first
    history entry.
- **Record the menu-override reversal.** Copying starting apps at operation
  creation and removing `operations.config.menu` reverses BLUEPRINT "The
  operating model" (`BLUEPRINT.md:45-49`, `:88`), CONSOLE_RUNTIME_SPEC §5
  (inherit/override) and §5a, and GLOSSARY *Solution*. Mark each reversed.
- **Page conditions see what the activity's own condition sees** — for a
  CREATE offered on a record and run without one (ACTIONS_OFFERED_BY_SERVER
  §2.1), and for a GET with no record. Say so.
- **`page.activities`.** Specify the item for the app's own workflow (today
  items are `{recordId} | {typeId}`, `router.ts:638-672`, and
  `ComponentContainer.listActivities` returns `[]` with no record,
  `ComponentContainer.tsx:209-215`); GETs are not offered
  (`offeredActivities`, `engine.ts:241`); failing checks 1–2 answers empty.
- **§2.8** gains the parked condition on opening a page (RECORD_READ_CONDITIONS
  `:22-24`, BLUEPRINT `:159-162`).
- **Drop §2.5's page-header bullet** — the title is the author's static config
  (`PageHeader.tsx:19-20`) and `context.app` is deferred.
- **Field types (§2.3):** `roles` stored as text holding a list, like `config`;
  `order` a number.
- **Name** the server's menu read and the Console's app writes (the user's OK
  needed); stop `projectConfig` sending `default_menu` to Runtime users
  (`projection.ts:295,304`).
- **Step 1:** if the measurement finds a page that would break (likely source:
  `ComponentContainer.tsx:144` anchors no-record runs on the page's record),
  stop and report to the user rather than build.
- **§2.10 additions.** Engine: `engine.ts` (`executeQuery`), `bridge.ts`,
  `validateConfig.ts` (reserved ids), `modelProjection.ts`. Server: `host.ts`
  (`validateConfigGraph`, `putConfig`, `publishConfig`, `rollbackConfig`, menu
  schema and validation, `createOperation`), `records.*` routes,
  `scripts.query`, `schema.ts` (`MenuItem`, `OperationConfig`). Client:
  `index.ts:842-871` (`visibleMenu`, `RunInput` / `QueryInput`). Runtime:
  `context/RuntimeContext.tsx`, `components/MenuNav.tsx`,
  `components/PagesList.tsx` and its no-menu fallback (`App.tsx:60-65`). Page
  runtime: `pageAnchor.ts`, `PageRenderer.tsx`, `capture/AttributesForm.tsx`,
  `RecordActivities`, `PageHeader`. Console: `admin/OperationMenuSection.tsx`,
  the DSL Editor's picker. The workbench package and its SPEC. Docs:
  CLIENT_TRUST_BOUNDARY (§1, §7), ACTIONS_OFFERED_BY_SERVER,
  RECORD_READ_CONDITIONS, DATA_THROUGH_ACTIVITIES, RBAC_COMPACT.

---

## Names needing the user's OK

Approved: `sdm_activities` · `activity_ref` · `model.workflow_activities`
(2026-10-06) · `rt_sys_apps` (2026-10-04) · `appId` on runs and `app` in the
URL (the user's, 2026-10-15) · `PageDef.recordTypes`, `PageDef.workflow`,
`PageDef.conditions`, the `rt_sys_apps` field keys `page`, `label`, `group`,
`order`, `roles`, `config`, and `wf_sys_apps` for its empty workflow
(2026-10-15).

None open.
