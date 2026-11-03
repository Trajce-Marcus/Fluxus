# The activity pool and apps — spec

**Status:** **Part 1 (the activity pool) BUILT 2026-10-10.** Its run check
(§1.5) was deferred then, and is step 1 of Part 2. **Part 2 (apps)
re-specified 2026-10-17**, cold-reviewed and revised the same day (§ Cold
review 2026-10-17: nine decisions ruled, fixes applied), and built 2026-10-18. The user
revisited the architecture from scratch rather than answer the seven decisions
the 2026-10-16 cold review left. A second cold review the same day left five
decisions and 18 fixes; the decisions were settled with the user on 2026-10-18
and Part 2 revised with them and the fixes (§ Second cold review). Built in six
steps, each checked before the next (§2.10). **Step 1 BUILT 2026-10-18.**
Step 2's names settled with the user the same day (§ Names). **Step 2 BUILT
2026-10-18** (four commits), and its script run on the dev database the same
day at the user's go-ahead, after a dry run he reviewed: 24 apps in four
operations (inspections-dev 12, projects-dev 8, demo/sdm and
nicks-inspection-business 2 each), each with its `sys_migration` entry, and
their menus rebuilt; the three operations whose solutions have no pages were
skipped (§2.8). **Step 3 BUILT 2026-10-18** (four commits); its script ran on
the dev database first, at the user's go-ahead after a dry run: all 22
published pages got their lists, nothing unresolved. **Step 4 BUILT
2026-10-18** (two commits), after measuring the dev database read-only: no
computed id in any datasource or the named functions they reach, no GET of an
app's own on any list, and no item condition on a GET. **Step 5 BUILT
2026-10-18** (three commits), after measuring dev read-only: no list held an
app's own activity, and the 24 apps had only `sys_*` history entries. **Step 6
BUILT 2026-10-18** (three commits), after measuring dev read-only: its script
ran on the dev database between the second and third commits, at the user's
go-ahead after a dry run — 18 links in 11 pages rewritten, 11 apps'
definitions filled, nothing unresolved — and the old way of opening went.
**Part 2 is complete.** Built from
the exploration in [ideas/apps-and-instances.md](ideas/apps-and-instances.md)
and the user's rulings below.

**Words.** Since 2026-10-17 an **app** is the thing that is built (for now, a
page), and an operation's **apps list** holds the apps it uses, each with its
own id, name, roles and definition; two apps in one list may be made from one
page. The first 2026-10-17 draft called an app in the list a "config"; the user
ruled the word out the same day, and § Cold review 2026-10-17 keeps it where
quoted. Text from 2026-10-15 to 2026-10-16 used "app" for the page set up in an
operation; text before 2026-10-15 used "instance" for it, a word retired as
ambiguous. The file keeps its name so existing links work.

## In short

Activities live in one list per solution, the **activity pool**, and a
workflow lists the pool activities it uses, in order (Part 1, built). An
**app** is built in the solution; for now a UI app is a page, and automations
come later. Each app has **one list** — its page's own workflow — of the
activities and reads it uses, pulled from the pool; each item may carry a
condition. An operation admin picks apps into the operation's **apps list**,
giving each its name, who may run it, and its definition (what it needs set for
this operation). The same page can be picked twice (a water scheduler and a
sewer scheduler). Each app in the list is a record of the platform's
`rt_sys_apps`; activities that name no record run on it and leave their history
there. The **app menu** points at apps in the list and has no roles of its own.
Every app is opened the same way — by its id, with params — from a menu, a link
(`services.app.open`, the id read from the app's definition where it differs
per operation) or (later) a scheduled job. Every call from the Runtime names its app, and the
server checks every call: the caller may run the app, the activity is on its
list, it fits the record type and record named, and both the activity's own
condition and the app's pass. Only an operation admin works on records without an app, from the Console.

## Rulings

### 2026-10-17 (this revision)

Who decided is marked: **the user's** ruling, or **Claude's** suggestion that
the user agreed to.

- **An app is the thing that is built.** It does something; it may or may not
  touch record types; it may have a list of activities or none; it may have a
  UI or be an automation (the user's). For now a UI app is a page (Claude's
  reading, confirmed in the playback). *Reverses 2026-10-15, where "app" was
  the page set up in an operation.*
- **An operation's apps list.** To be used, an app is added to an operation's
  apps list with what it needs there: who may run it and its definition (the
  user's; the user first called this its "definition or config", and ruled
  "config" out as a name later the same day — an app in the list is simply an
  app, with an id). The same page may be added twice, each app separate
  (Claude's, agreed). The list is seen in the Console, never in the Runtime
  (the user's).
- **The app menu points at apps in the list and has no roles** — "no role
  there, just a pointer" (the user's). An item shows only to a user who may run
  the app it points at, and the name lives on the app, not the menu item
  (Claude's, agreed). An app the menu doesn't point at — one opened only from
  another app, later an automation — is still in the list (the user's).
- **The solution's list is simply its apps; the default menu goes.** An admin
  picks apps into each operation (the user's). The operation's menu editor is
  not suitable and is reworked (the user's).
- **One list per app.** The app's workflow lists the activities it uses; the
  author pulls them from the activity pool, some of which are also in record
  types' workflows (the user's). The app offers only what its list holds
  (Claude's reading of the user's design, agreed in the assessment). The app's
  workflow sets each activity's condition there (the user's).
- **Both sets of rules must pass** — the record type's and the app's (the
  user's, when Claude asked whether the app's conditions replace or add).
- **Every call is checked on the server; the browser is not trusted** — "we
  cannot" (the user's). Claude judged the overhead small; the user agreed.
- **A call names the activity, the record type and the record; the server
  refuses a mismatch** (the user's). **An activity called with no record type
  and no record runs on the app's record** (the user's); the app in the list
  *is* that record, so two apps made from one page keep separate histories
  (Claude's, agreed).
- **Two ways in.** Activities run for users through an app in the Runtime, or
  on records directly in the Console (the user's). An outside caller will come
  in through an automation, which is an app (Claude's, agreed).
- **Reads are linked to an app the same way as activities** (the user's). This
  reverses the 2026-10-16 cold review's recommendation 1, that GETs need no
  listing.
- **Record read rules still apply inside an app** — both checks are kept
  (the user's, on Claude's suggestion).
- **Who may run an app is set only on it in the apps list**; the page carries
  no roles — "generally true, for now anyway" (Claude's reading, the user's
  confirmation).
- **Anything the browser passes is checked like any other input** — a record
  id passed in gets the read check (Claude's, in the playback the user
  approved).
- **Automations will need names, possibly set up as users**; details later (the
  user's). Automations are not in Part 2 (Claude's, in the plan the user
  approved).
- **The cold review's nine decisions were ruled the same day** — reads checked
  against the list only, their record being where the history entry lands;
  form GETs counted from literal `invoke` ids; calls with no app for operation
  admins only, who read every record in their operation; history on every
  change to an operation's app; the app's own GETs unlogged; operation admins
  set up apps; one way to open any app, by its id; the names. Each is recorded, with
  who decided, in § Cold review 2026-10-17.

### 2026-10-15 — superseded 2026-10-17 where marked

**Reversed 2026-10-17:** "app" as the page set up in an operation (now "app"
is what is built, and an operation's apps list holds the apps it uses); the page registering record types and offering their whole workflows,
so that an activity added to a workflow later appeared on every page (now an
explicit list); page conditions kept on the page (now on the app's workflow
entries); menu fields (label, group, order) on the app (now a separate menu of
pointers, the name on the app in the list); the app's roles and the page's both
passing (now only the roles on the app in the list); the solution's default menu as starting apps copied
into each new operation (now an admin picks). **Still standing:** "instance"
retired; `appId` and `app=`; the record-type check as step 1, DSL Editor
included; runs with no app refused except from the Console; every page an
operation uses is set up there; no removing in Part 2; apps in the list not
created, changed or deleted by activities; the app's own activities run only on
the app.

*The 2026-10-15 rulings as written (section numbers refer to the 2026-10-15 Part 2):*

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
  included (§2.10). BUILT 2026-10-18.** It is one check in `activities.run` and nothing else in
  Part 1 depends on it; until it is built, runs behave as they did before the
  pool. Part 2 needs it (§2.3). Today the server runs any UPDATE, DELETE
  or log-only activity against any readable record, whether or not that
  record's type lists it (`activities.run` checks the anchor is readable, never
  that its workflow holds the activity). The server now rejects a run whose
  activity is not in the anchor's record type's workflow. Part 2 widens this to
  include an app's own activities, for runs on the operation's app (§2.3). CREATE (no anchor) and GET (a
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

Re-specified 2026-10-17; revised with the rulings of § Cold review 2026-10-17
the same day, and with those of § Second cold review on 2026-10-18. Built in
six steps (§2.10), each checked before the next — all six built 2026-10-18.

**Words used here.** An **app** is the thing built — for now, a page. An
operation uses apps through its **apps list**: each app there has its own id,
name, roles and definition, and is a record of `rt_sys_apps`. Two apps in one
list may be made from the same page (Water scheduler and Sewer scheduler, both
from the scheduler page). Where the two could be confused, this spec says **the
page** for what is built and **the operation's app** for an app in the list.
Users open an app by its id. An **item** is one activity in a workflow's list.
A **history entry** is one line in a record's history. (The first 2026-10-17
draft called an app in the list a "config"; the user ruled the word out.)

### 2.1 Apps, the apps list, the app menu

- An **app** is built in the solution. For now a UI app is a **page**
  (`pages`, `page_versions`), authored and published as today; publishing it
  updates every operation's app made from it. An automation is an app with no
  UI; automations are not in Part 2 (§2.9), and nothing here may close them off.
- **The solution's apps are its published pages.** Nothing else is stored to
  make an app available. The solution's default menu (`sdm_menus`,
  `default_menu`) is removed.
- **An operation's apps list** holds the apps an operation admin has picked
  from the solution, each with its own id, name, who may run it, and
  definition (what the app needs set for this operation, e.g. which network,
  or which app a link opens). One page may be picked more than once — a water
  scheduler and a sewer scheduler — each app with its own name, roles,
  definition and history. Each is a record of `rt_sys_apps` (§2.4). The list is
  seen in the Console only.
- **One way to open an app: by its id, with params.** A menu item, a link in a
  page and (later) a scheduled job all open an app the same way, and the server
  checks it the same way (§2.3). A page opens one with
  `services.app.open(appId, params)` (§2.7).
- **A page not in an operation's apps list cannot be opened there**, and
  nothing on it can run. An app opened only from another app is picked like any
  other; it simply isn't on the menu.
- **The app menu** (§2.5) is what Runtime users see: items pointing at apps in
  the list, in groups. It holds no roles.
- **Operation admins** set up the apps list and the menu, in the Console
  (§2.6).
- A new operation starts with an empty apps list and an empty menu.

### 2.2 The app's list

- **An app has one list: the activities and reads it uses.** It is the page's
  own workflow, `PageDef.workflowId` — an ordinary workflow, authored in the
  Workflows editor, that no record type points to. The author adds pool
  activities to it: activities that are also in record types' workflows (an
  inspection's Submit, a GET listing jobs), and activities of the app's own
  (a "cancel today's jobs" button).
- **An activity of the app's own** is one on the app's list that is in no
  record type's workflow.
- **An app offers only what its list holds.** An activity added to a record
  type's workflow later appears on no app until its author adds it there. A
  page with no list offers nothing and runs no GETs.
- **Reads stay GET activities.** A field's dropdown never holds a read of its
  own; it calls a GET with `invoke`.
- **A form's GETs count as listed.** A GET that a listed activity's form calls
  — the datasource of one of its attributes, composite cells included, or a
  named function such a datasource calls — counts as on the list without being
  added. The server works these out from the literal ids in `invoke('…')`. A
  computed id anywhere on that path is refused at save. Until step 4
  `checkInvokes` ran only over hooks and `returns`, never datasources, and
  skipped computed ids; step 4 checks every datasource's path (measured on dev
  first: nothing refused).
- **Each item may carry a condition**: `{ activity_ref, show_condition }` on
  the workflow's reference — the per-reference setting Part 1 left room for
  (§1.8). Same language and roots as an activity's own `show_condition`;
  `context.record` is the record the activity runs on. An activity is offered,
  and runs, only when its own condition and the item's both pass; with none on
  the item, its own decides. The server evaluates both; the browser never does
  (`projectConfig` sends references with `activity_ref` only,
  `projection.ts:257-264`). An item's condition sees what the activity's own
  condition sees — for a CREATE offered beside a record
  (ACTIONS_OFFERED_BY_SERVER §2.1), the record at offer time and none at run
  time.
- **Where an activity runs is fixed by the model, not by the caller:**
  - an UPDATE, DELETE or log-only activity in a record type's workflow runs on
    a record of that type; a CREATE runs on none and creates one of that type;
  - a GET runs on whatever record the call sends — the record its history
    entry lands on, not what it asks about (DATA_THROUGH_ACTIVITIES
    `:45-58`) — or on none;
  - an activity of the app's own runs on the operation's app's record (§2.4).
- **The app's own activities are log-only activities and GETs.** A CREATE
  would have no type to create, an UPDATE would change the operation's app, a
  DELETE would remove it. Their hooks make the real changes, on other records.
- **Checked at model save, for workflows a page names.** The server passes
  `validateConfig` the workflows pages name (their drafts and latest published
  versions — model save already queries the database, `host.ts:651-656`), and
  the app-list rules apply to those only, so ordinary Console editing of a
  record type's workflow is untouched (`RecordTypesEditor.tsx:53-62,165`). On a
  page's list: an activity in no record type's workflow must be log-only or a
  GET, and is typed against `rt_sys_apps`; an item's condition is typed against
  each record type its activity runs on (`rt_sys_apps` for the app's own). A
  condition on any other workflow is an error, and so is pointing a record type
  at a workflow a page names. `createTypeByActivity` and "a CREATE belongs to
  exactly one record type" already count only record types' workflows
  (`activityPool.ts:39-51`).
- **A page's list is protected.** Deleting a workflow some page names is
  refused, naming the page; so is a model rollback that would remove one
  (`host.ts:683-700`). Rolling a page back to a version with no `workflow`
  carries the current one forward into the new version.
- **Checked when a page is published:** its `workflow`, if set, exists and no
  record type points to it; otherwise the publish is refused. (`validatePage`'s
  findings do not block a draft save, `persistence.ts:34-46`.) At run time, a
  page whose `workflow` is missing, dangling, or pointed at by a record type
  offers nothing.
- **What a script knows about its app — `context.app`.** In a page and in
  every server-side script of a call through an app: `pageId`, `label` and
  `definition` (the whole definition, parsed from its JSON text, which reaches
  the browser). Not its roles.
  It replaces today's fixed `{ name: 'Fluxus' }` in the page runtime. An app's
  own activities see the same through `context.record`, typed with the record
  fields `page_id`, `label` and `definition` only. *A server-only part of the definition is not built now* (§2.9).
- **Removed from the page definition:** `PageDef.access` (who may open the page
  — now on the operation's app, §2.4) and `PageRecordDef.instances` (its
  `'one'` is replaced by the operation's app; measured 2026-10-15, no page on
  dev uses it). Both go in step 2. The page runtime reads `instances` today
  (`pageAnchor.ts:57-77`, `validatePage.ts:175-195`) and the page editor
  defaults to `'one'` (`PageEditor.tsx:370`); those go. Old page versions keep
  both fields; nothing reads them. `PageDef.recordTypes` and
  `PageDef.conditions`, approved 2026-10-15, are not built.

### 2.3 What a call carries, and what the server checks

- **From the Runtime, every call carries `appId`** — its app's id: runs
  (`activities.run`), GETs (`activities.query`), the question of which actions
  are offered (`page.activities`), fetching a record (`records.get`), and file
  uploads and downloads (`files.presignUpload`, `files.presignGet`, which gain
  `operationId` — today they take only `solutionId` and check only sign-in,
  `router.ts:770-858`, client `index.ts:893,897`).
- **A run names the record type and record it is about**: `typeId` for an
  activity in a record type's workflow, plus `recordId` unless it is a CREATE.
  An activity of the app's own names neither. **A GET names no type**; it
  sends a record or none, and the server works out the rest.
- **With an app, the server, on every call:**
  1. loads the app from the call's operation's apps list, and its page's
     published version; either missing → not found;
  2. checks the caller holds one of the app's roles; otherwise refused
     (with sign-in off, open, as `pageOpenable` is today, `host.ts:593`);
  3. checks the activity is on the app's list, or is a GET its listed
     activities' forms call (§2.2); otherwise refused;
  4. checks the call matches the model, refusing a mismatch:
     - an UPDATE, DELETE or log-only activity in a record type's workflow: the
       call names that type and a record whose **stored** type is that type —
       never the caller's word for it;
     - a CREATE: the call names its type and no record;
     - an activity of the app's own: no type and no record; it runs on the
       app's record;
     - a GET: any record it sends is only where its history entry lands;
  5. checks the caller may read every record the call sends — the record it is
     about, and the records a run's reference fields send back (today
     `validateSubmission` checks only that they exist and have the right type,
     `validateSubmission.ts:284-300`) — as today's read rules say (and read
     conditions once built). A GET's parameters are not checked: a GET decides
     what it returns. The GET that lists a dropdown's choices is untouched;
  6. evaluates the activity's own condition and the item's, with the real user;
  7. runs it under Part 1's rules.

  `page.activities` applies checks 1–6 and answers with what passes; failing 1
  or 2 answers empty. An empty `{}` in the request asks for the app's own
  activities. `records.get` applies checks 1–2 and 5. `files.*` apply checks
  1–2.
- **A call that sends an `rt_sys_apps` record id is always refused** — as the
  record of `records.get`, a run's `recordId`, or a reference field. (With
  sign-in off, check 5 alone would pass it: `computeReadable` returns null,
  `projection.ts:47`.) An app's own activity runs on its app's record because
  the server puts it there, never because the caller named it.
- **Anything else the browser passes is checked** by `validateSubmission`, as
  today: a GET's parameters and a run's attributes.
- **With no app, a call is refused unless the caller is an admin of that
  operation.** An operation admin reads every record in it, whatever their
  roles, and nothing in operations they are not admins of. The rule governs
  exactly these calls: `activities.run`, `activities.query`, `page.activities`,
  `records.get`, `records.list`, `records.partition`, `scripts.query` (today
  gated only by being in the operation, while reading every record type,
  `router.ts:1131-1146`), the published mode of `pages.list` (removed
  2026-11-01 — nothing called it), and `files.*`.
  They cover the Console's workbench, DSL Editor and page preview, and follow
  the record type's workflow and the activity's own condition only. A
  solution admin who wants to work on an operation's records must also be its
  admin.
- **Calls that stay open to the operation's users**, app or none: the
  connect-time calls `operations.get`, `config.getForOperation`, `me`,
  `apps.user` and `perf.*`. **`pages.list` in draft mode** is the design
  plane: called by `connectSolution` with no operation
  (`client/src/index.ts:692`) and ungated today (`router.ts:685`), it becomes
  solution admins only.
- **For every run, with an app or without**, Part 1's record-type check
  applies (step 1). A run on an operation's app's record is refused without
  that app's id.
- **Inside a run nothing is re-checked against the list.** A hook's writes and
  an `invoke` from a server-side script are the activity's business once it is
  admitted (the way in is always an activity).
- **`operations.get`** stops returning the operation's menu (today it returns
  `config.menu` unchecked, `router.ts:420-435`); the Runtime gets it from
  `apps.user`, the Console from `apps.list`.

### 2.4 `rt_sys_apps` — the operation's apps

- **Rows in `records`**, per operation, of type `rt_sys_apps`, with an id
  issued by the platform (UUIDv7). The ids `rt_sys_apps` and `wf_sys_apps` are
  reserved: no solution may define them.
- **Kept out of everything general, by type id:** the stray-record-type check
  that would otherwise refuse every model save once a row exists
  (`validateConfigGraph`, `host.ts:649-662`); `records.partition/list/get`;
  `records.*` in scripts (`bridge.ts:135-170`); `scripts.query`; `model.*`;
  `config.get` and `projectConfig`; publish and rollback. The operation's apps
  are read only through `apps.list` and `apps.user`.
- **Where the platform's definition of `rt_sys_apps` and `wf_sys_apps` lives**
  (step 5): one constant in `@fluxus/engine`, which the engine adds to the model
  it runs and `validateConfig` adds to the model it checks. It is never stored
  and never sent to the browser. Until step 5, rows exist only as data the
  server reads directly.
- **Fields** (record field keys, snake_case like every record field; calls
  spell them `pageId`, `roleIds`): `page_id` (the page — its path, which is its
  id), `label` (its name, e.g. "Water
  scheduler"; required), `role_ids` (role ids, stored as text holding a list),
  `definition` (what the app needs set for this operation: a plain string
  holding JSON, read as `context.app.definition`, §2.2).
- **Workflow:** an empty one, `wf_sys_apps`. What runs on an operation's app
  comes from its page's list (§2.2).
- **Never changed by runs.** The server refuses any CREATE, UPDATE or DELETE
  run on an operation's app, and a hook may not update or delete
  `context.record` when it is one (today it can: `dsl/src/validator.ts:762-765`,
  `evaluator.ts:1064`; the `sdm_` model-prefix guard there, `:1064-1075`, is
  the precedent).
- **The Console writes the operation's apps directly** (`apps.put`), not
  through activities — setting up an app is not working data — **and every
  change leaves a history entry** on the app's record. It is written through
  the same append that fills `rpt_activities` (`databaseStore.ts:443-468`),
  whose `activity_id` and `activity_name` are required (`schema.ts:481-489`):
  `sys_console_edit` / "Changed in the Console", with who, when, and the
  changed fields' new values in `capturedAttributes`. The migration's entry is
  `sys_migration` / "Created by the migration". Both ids are reserved.
  BLUEPRINT rule 1 records this as its one direct-write exception.
- **Checked at save:** `page_id` is a published page of the solution; every role
  exists in the solution; `label` is not blank; `definition` is JSON.
- **The app's own GETs leave no history entry** on its record; reads about a
  real record keep logging as today. Today `executeQuery` logs on whatever
  record it runs on (`engine.ts:401-407`), so the record a GET runs on and the
  record it logs on become separate (step 5).

### 2.5 The app menu

- Stored on the operation, `operations.config.menu`, reshaped. A **leaf** is
  `{ id, appId }`, `appId` being an app's id; a **group** is `{ id, label, items }`,
  one level deep as today. No roles and no page on either.
- **A leaf shows its app's name.** Group labels belong to the menu.
- **The server builds each caller's menu** (`apps.user`): leaves whose app
  the caller may run (check 2), groups that keep at least one leaf, in the
  stored order. The browser no longer filters (`visibleMenu`,
  `client/src/index.ts:861-871`, goes).
- **Checked at save:** every `appId` is an app of this operation; an app
  appears at most once.

### 2.6 Console

- **Operation admins use the Console for their operations.** Who sees what:
  - an operation admin sees the operation's admin (apps list, menu, users) and
    the workbench for that operation's records;
  - the design tools — the model builder and the page builder — show only to
    solution admins, who alone can save there;
  - someone who is both sees both.

  Today an operation admin already reaches the operation's admin and fails at
  `pages.publishedPaths` (`OperationMenuSection.tsx:30`); `me().console` has no
  consumer in `packages/console/src`. The real blockers: `config.get`
  (solution admins only, `router.ts:495`) serves operation admins of an
  operation of that solution, and so does `pages.publishedPaths`
  (`router.ts:727-735`).
- **Connecting.** `connectSolution` fetches `records.partition` together with
  `config.get` and `pages.list` (`client/src/index.ts:691-701`), so a refusal
  would fail the whole connect — and the remembered operation is forgotten only
  after a successful one (`console/src/sdm-runtime/engine.ts:106-117`). The
  Console connects with no records unless the caller administers that
  operation, and its operation picker lists only operations the caller
  administers. A solution admin who administers none designs with no records.
- **Apps list** — in the operation's admin, replacing the operation menu
  editor (`admin/MenuItemsEditor.tsx`, `admin/OperationMenuSection.tsx`, which
  read the menu through `operations.get`, `:26,46`; they read `apps.list`,
  which returns the apps, without their history, and the menu). It lists the
  operation's apps, in an **Apps** tab of the operation. **Add**
  opens a dialog: pick a published page, give it a name, roles and definition
  (a plain text box). The same dialog edits an app and shows its history,
  fetched for that one app when the dialog opens (`apps.get`). No
  removing in Part 2.
- **App menu** — beside the apps list: add a leaf by picking an app, add a
  group, reorder, move a leaf into or out of a group.
- **Model builder:** the Menu editor is removed. In the Workflows editor, a
  workflow a page names shows a condition column against each item, edited in
  the existing expression dialog.
- **Page editor's settings column:** gains the app's list (chosen from the
  workflows no record type points to, `PageDef.workflowId`). *Page access* is removed.
  *Page record* loses its one/many choice.

### 2.7 Runtime

- **What it receives** (`apps.user`): `apps`, those the caller may run, each
  with its `id`, `label`, `pageId` and `definition`; `pages`, their pages'
  published definitions (`pages.list` becomes a no-app call, §2.3 — its
  published mode removed 2026-11-01); `menu`,
  built from them (§2.5). Until step 6 it also answered `appIdByPageId` — for
  each page the operation had exactly one app made from, that app's id — for the
  old way of opening (below).
- **Opening an app.** A page opens one with **`services.app.open(appId,
  params)`**, params carrying things like the record, e.g.
  `services.app.open(context.app.definition.jobLinkId, { recordId: job.id })`.
  The author writes the link into the page; where the target differs per
  operation, the page reads its id from its app's definition, which the author
  also designs. Making links correct is the author's job; the platform opens
  the id it is given, after its checks. An id the caller may not run, or that
  is not an app of this operation, says the app is not set up for this
  operation.
- **A button opens an app the same way:** `OpenApp`, placed on a page or
  named by a RecordList action column, its `target` the key in the app's
  definition holding the id to open (§ Names, step 6).
- **The old way, removed in step 6 (2026-10-18):** until then
  `services.page.open(page, record)`, OpenPage targets and RecordList action
  columns named a page, and opened the operation's only app made from that
  page; with several, they said the app is not set up for this operation. The
  step 6 script rewrote every link (§2.8) and `services.page.open`, OpenPage,
  `appIdByPageId` and `page=` went.
- **The URL** is `?operation=&app=&record=`, `app` being an app's id; `page=`
  is dropped. Until step 6 an old link carrying `page=` followed the old way
  above; since then it opens nothing.
- **No menu, no fallback.** The list of every openable page shown when an
  operation has no menu (`PagesList`, `App.tsx:59-66`) goes; an empty menu says
  nothing is set up.
- **The page header** is unchanged: its title is the author's static setting
  (`PageHeader.tsx:19-20`).

### 2.8 Migration

Measured on the dev database 2026-10-15, **re-measured 2026-10-18 before
building step 2 — unchanged** (read-only; no `rt_sys_apps` rows, reserved ids
unused, no page using `instances: 'one'`; links between pages only in
`projects`: four OpenPage buttons and one `services.page.open`): three
solutions have pages — `demo/sdm` (2 pages, both on its default menu, 2
operations), `projects` (8 pages, 1 on its default menu, 1 operation) and
`inspections` (12 pages, 8 on its default menu, 1 operation).
`next-solution` and `primary-school-victoria` have no pages and no default
menu (3 operations), and get nothing. No operation has a menu of its own.

**Step 2 — a one-off TypeScript script**, `packages/server/scripts/apps-step2.ts`:
`npx tsx scripts/apps-step2.ts` prints what it would do and writes nothing;
`--apply` writes it, one transaction per operation; an operation that already
has apps is skipped, so a second run does nothing; migrations are not applied
(UUIDv7 ids exist only in
TypeScript, `memoryAdapter.ts:1,391`), run by the user **after** the step 2
deploy: old code would refuse every model save once `rt_sys_apps` rows exist
(`host.ts:651-662`), and the step 2 code excludes them. It prints what it will
create first.

- **Every operation gets an app for each published page of its solution.**
  Its name is the page's label on the operation's effective menu (its own, else
  the solution's default); for a page not on the menu, the page's path. Its
  roles are the page's `access.open`. Its definition is `{}`. Its first history
  entry is `sys_migration`. Every link between pages keeps working (§2.7, the
  old way).
- **Every operation's menu is rebuilt** from its effective menu: each leaf
  points at the app made for its page; group labels and order are kept; roles
  are dropped. A page on two menu items keeps the first, in menu order; the
  script prints the ones it drops. Six `inspections` admin pages whose menu
  items carried no roles (so were hidden) become visible to admins — the user
  ruled "no role there, just a pointer" after being told (2026-10-17).
- **The default menu goes in a later deploy.** The step 2 script reads
  `sdm_menus`, and migrations apply themselves on connect (`createDb`,
  `db/client.ts:42,59-63`), so the hand-written SQL dropping `sdm_menus` and
  `default_menu` ships with step 3, after the script has run. Old published
  models hold the menu, and rollback writes it back (`host.ts:702-710`):
  from step 3, rollback drops it, through a converter as Part 1 did for
  activities.

**Step 3 — a one-off script giving every page its list**, which the user
checks and runs **before** the step 3 deploy (it only adds workflows and page
versions; verify at build that today's code ignores both). It needs the DSL to
read pages, so it is not SQL. It walks each page and lists what the page uses
today: the whole workflow of each record type it shows or acts on (record
views, record lists and their action columns, action buttons, RunActivity
targets, and activities callbacks run through `services.activities.run` with a
literal id, `validatePage.ts:245-257`), and every GET it calls through `invoke`
— in dynamic props, `{{ }}` holes in static config (`inspections-pages.ts:123`)
and model functions reached from page expressions (callbacks cannot `invoke`,
`validatePage.ts:221-228`). A list or action row fed by a GET has no static
record type: the script takes it from the GET's `returns` where that names a
type, and otherwise lists the row as unresolved for the user. Form GETs need no
listing (§2.2). It creates one workflow per page, `wf_app_<page>`, and sets
`PageDef.workflowId` on both the draft and a new published version made from the
**latest published** definition — not the draft, which may hold unpublished
work (`page_versions.readme` and `published_by` need values). It prints what it
found per page for the user to check first. After the deploy, a page still
with no list offers nothing.

**Step 6 — a one-off script rewriting links.** Each literal
`services.page.open(page, …)`, OpenPage target and RecordList action column
becomes `services.app.open(context.app.definition.<key>, …)`, and the script
fills each operation's apps' definitions with the ids of the apps those links
open. It proposes one key per linked page and prints them, with every rewrite,
for the user to check first. Links whose page is computed are listed for the
author to rewrite. *Built as `packages/server/scripts/apps-step6.ts`, and run on
the dev database 2026-10-18 at the user's go-ahead after a dry run (§2.10).*

**Record the reversals** (with step 2): BLUEPRINT "The operating model" (the
menu override), § Access "Built" (page access lists, menu item roles), and the
core terms' *Solution* line (the default menu); CONSOLE_RUNTIME_SPEC §5
(inherit/override, the two layers of menu roles and page roles), §5a (menu
groups an operation switches on) and §6 (page access); GLOSSARY *Solution*;
USERS.md `:228-231` (how Console access is derived); CLIENT_TRUST_BOUNDARY
`:171-173` (`config.get` for solution admins only); DSL_EDITOR_SPEC `:405-411`
(`scripts.query` behind the entry gate only).

### 2.9 Not in Part 2

- Automations, their names or user identities, scheduled jobs, and outside
  callers coming in through them.
- **A server-only part of the definition.** The user considered `client` and
  `server` sections (`context.app.definition.client.jobLinkId`,
  `.server.network`, the same path everywhere, `server` never sent) and ruled
  not to split yet (2026-10-18); that is the shape when something genuinely
  secret turns up, and adding it changes nothing existing.
- Roles on the app itself ("for now"). *Taken up 2026-11-03 as a default only: the page's default roles, §3.3.*
- Removing an app from an apps list. *Taken up 2026-11-03: expiring an app, §3.2.*
- A shared list of named conditions ticked against activities.
- A condition on opening an app, for ad hoc rules (parked: RECORD_READ_CONDITIONS,
  BLUEPRINT § Access).
- Search and pinning as ways to find apps.
- Review before publish for apps and apps lists.
- The page editor's preview applying the app's list and conditions: it runs
  without an app, as an operation admin. In the preview `context.app` is
  `{ pageId: <the page>, label: <the page>, definition: {} }` and
  `services.app.open` says the preview cannot open apps. **Parked (the user,
  2026-10-18):** a definition for the preview — a dummy one, or one of the
  operation's apps — so a page that reads its definition can be developed.
  *Taken up 2026-11-03: the page's example definition, §3.1.*
- **Removing the Console's whole-operation fetch** (`records.partition`) — a
  deferred to-do for a later session (the user's; SERVER_DATA_LOADING §6).

### 2.10 Build steps (the backlog)

Each step works on its own and is cold-tested before the next.

1. **The record-type check — BUILT 2026-10-18.** Measured first on the dev
   database: no past run of an existing activity in `rpt_activities` would have
   been refused (the 12 that would were of three activities no longer in the
   model, which fail as "not found" anyway), and every page action without a
   record is a CREATE, while every row action belongs to its rows' type. One
   check in `activities.run`
   (`router.ts:957-982`): an UPDATE, DELETE or log-only run on a record whose
   type's workflow lacks the activity is refused — from pages, direct calls and
   the DSL Editor alike, since the Editor runs through `activities.run`
   (`DslEditorView.tsx:454`). Before building, measure whether any existing
   page runs an activity on a record of another type (likely source:
   `ComponentContainer.tsx:144` anchors no-record runs on the page's record);
   if one would break, stop and report to the user.
2. **The apps list and the app menu — BUILT 2026-10-18.** `rt_sys_apps` rows kept out of general
   reads, and calls sending their ids refused; `apps.list`, `apps.put`,
   `apps.user`; the Console's apps list and menu editor; operation admins in
   the Console (who sees what, `config.get`, `pages.publishedPaths`, connecting
   with no records); history entries on every change; the server-built menu;
   the Runtime receiving its apps; the URL `app=`, `services.app.open`, and
   `context.app`; `appId` on every Runtime call, and `operationId` on
   `files.*`; checks 1, 2 and 5 (reference fields included); the no-app rule on
   its closed list, and `pages.list` draft mode for solution admins;
   `operations.get` without the menu; the no-menu fallback, page access and
   `instances` removed; the step 2 script. Until step 3, a call that passes
   checks 1, 2 and 5 is offered and run as today: the record type's workflow
   and the activity's own condition.

   *As built* (choices made in the build that the spec left open, each a
   working default — mentioned to the user rather than raised): an app's
   history is fetched by `apps.get` when its dialog opens, not sent with the
   list (the user's question); a change to the menu leaves no history entry —
   the menu is the operation's, not an app's; `operations.list` leaves the menu
   out as `operations.get` does; the Console learns whether the caller may
   design from a refusal of the draft pages (`solutionAdmin`), and which
   operations they administer from `me` per operation — its Overview and
   Settings still count every operation; the model builder's Menu editor and
   `config.putDefaultMenu` went now, the stored default menu staying until
   step 3; in the Console's preview `context.app` is the page's own path and an
   empty definition, and `services.app.open` says it cannot open apps (a
   preview definition is parked, §2.9); FluxScript folds an object literal's
   keys, so `{ recordId }` is read without regard to case; the reference read
   check covers composite cells and references that name no target type;
   `files.*` also check that the operation runs the solution named. The step 2
   script is `packages/server/scripts/apps-step2.ts` (§2.8), tested against an
   in-memory database shaped like dev (`test/appsStep2.test.ts`).
3. **The app's list — acts — BUILT 2026-10-18.** `PageDef.workflowId` and items' conditions;
   `typeId` on runs; checks 3, 4 and 6 for runs and `page.activities`; the
   app-list rules at model save for workflows pages name; the page's list
   protected and checked at publish; the Workflows editor's condition column
   and choosing the list in the page editor; the step 3 script, run before the deploy;
   the SQL dropping the default menu, and rollback's converter.

   *As built* (working defaults, mentioned to the user): the step 3 script is
   `packages/server/scripts/apps-step3.ts` (dry run by default, `--apply`
   writes; a page that has a list is skipped), and a list id makes every
   character outside `[A-Za-z0-9_]` an underscore (`pages/new page 1` →
   `wf_app_pages_new_page_1`); an activity of the app's own on a list is
   checked untyped until step 5 defines `rt_sys_apps`, and cannot run until
   then; `typeId` is required through an app, and checked when given on a
   Console run; a save that removes a workflow a page names is refused only if
   the workflow existed before the save (a page naming a missing one does not
   block every model save); the page editor offers as lists the workflows no
   record type points to; migration 0023 drops `sdm_menus`, an imported or
   rolled-back model's `default_menu` is dropped, and the step 2 script's test
   went with the table (the script ran, and now skips every operation).
4. **The app's list — reads — BUILT 2026-10-18.** Checks 3 and 6 for GETs (`activities.query`);
   form GETs counted from literal `invoke` ids in datasources and the named
   functions they call; computed ids there refused at save.

   *As built* (working defaults, mentioned to the user): the save check covers
   **every** datasource, not only those of activities on a list today, since
   any activity can be put on one later; on that path a literal id must also
   name a runnable GET (reported on the full model only, since a browser's
   copy leaves out the workflows of types its user may not read), and a
   problem in a named function is reported once, naming the first datasource
   that reaches it; a computed id in a function no datasource reaches stays a
   run-time matter, as in hooks. Check 4 for a GET is that it is in some
   record type's workflow, so a GET shared by several types passes with no
   record; a GET of the app's own is refused until step 5, as runs are. An
   item's condition on a GET applies whenever the GET is on the list, even
   when a listed activity's form also calls it — the server cannot tell the
   two calls apart. Every activity on the list counts for form GETs, GETs
   included. The done-when was checked on dev read-only: through the
   inspections apps, `act_list_area_inspections` is on the Job and Area
   Inspection pages' lists, and the defect picker's `act_search_area_defects`
   is a form GET of the Finding and Area Inspection pages' listed activities.
5. **The app's own activities — BUILT 2026-10-18.** Log-only activities and GETs of the app's own
   run on the operation's app's record; the platform's `rt_sys_apps` and
   `wf_sys_apps` in `@fluxus/engine`, typed with `page_id`, `label` and
   `definition`; never changing an operation's app; their GETs unlogged (the
   engine change, §2.4); the browser able to find and open them (§2.11).

   *As built* (working defaults, mentioned to the user): **the browser gets an
   app's own activities with its model** — `config.getForOperation` sends the
   list of each app the caller may run, holding only its own activities (a list
   with none is not sent), so `findActivity` finds them there with no record
   type; **`context.app` reaches server-side scripts now** (§2.2 asked for it
   in every script of a call through an app; step 2 built it in pages only) —
   conditions, hooks and GETs of every call through an app, its definition
   parsed from JSON; **`validateConfig` adds `rt_sys_apps` to the schema it
   checks only**, so the engine's run-time model is unchanged: an app's own
   activity runs on its app's record without the type being in the records
   root, and `records.sys_apps` passes the save check but finds nothing at run
   time; **a script never changes an app**, refused at save (the DSL's
   `readOnly` schema type) and at run time (the engine's mutation hosts, which
   key on the record's id alone); an activity in no record type's workflow is
   refused with no app — the Console included — and with a record or a type
   through one; `page.activities`' `{}` with no app answers empty; in the
   browser an app's own form has no `context.record` (the app's record is not
   sent; the server's checks see it). The scripts' type omits `role_ids`
   (decision 3 of the second review), and the record a script holds is
   trimmed to `page_id`, `label` and `definition` — the step 5 cold test found
   a GET returning `context.record` whole sent the stored `role_ids` to the
   browser; fixed the same day.
6. **One way to open an app — BUILT 2026-10-18.** The step 6 script rewriting links;
   `services.page.open` and the old way of opening (§2.7) removed.

   *As built* (working defaults, mentioned to the user): dev measured read-only
   first — every link literal, drafts the same as what is published, no
   operation with several apps from one page, every app's definition `{}`;
   links in `projects` (9 action columns, 4 OpenPage buttons, one
   `services.page.open`) and in `inspections` (4 action columns, not counted by
   the earlier measurement).
   The button that opens an app is **`OpenApp`** (§ Names), its `target` a key
   in the app's definition, read without regard to case as FluxScript reads
   it; it came first, beside `OpenPage`, so pages the script rewrites work at
   once. The script is `packages/server/scripts/apps-step6.ts` (dry run by
   default, `--apply` writes), committed with its test before anything was
   removed; the user ran it on dev — 11 keys, 18 links in 11 pages, 11 apps'
   definitions filled, nothing unresolved (Claude's playback said 19; the count
   was wrong, the dry run's list was 18) — and a second dry run found nothing.
   Its definition changes leave `sys_migration` entries; a page got a new
   published version made from the latest published, and its draft rewritten.
   Then the old way went: `services.page.open`, `OpenPage`, `PageRuntime.openPage`,
   `appIdByPageId` in `apps.user` and the client, and `page=` handling in the
   Runtime — an old `page=` link now opens nothing, and a page still calling
   `services.page.open` fails validation. Rolling a page back to a version from
   before the script brings back an `OpenPage`, which then draws as an unknown
   component until its author makes it an `OpenApp`. The cold test (Sonnet 5,
   same day) found no divergence, and one loose end: pages' component lists
   (`componentDependencies`, the page editor's palette, read by nothing else)
   still named `OpenPage` in 18 drafts. At the user's go-ahead the script now
   swaps it for `OpenApp` there as well, in the draft alone when nothing else
   on the page changes (only the page editor reads the list, from the draft).

**Done when:**

- **Step 1:** an UPDATE run on a record of another type is refused — from a
  page, from a direct call, and from the DSL Editor.
- **Step 2:** an operation admin who is not a solution admin opens the
  Console, sees the operation's admin and workbench but not the design tools,
  adds two apps from one page (a water and a sewer scheduler), each with its
  own name and roles, and points the menu at both; each user sees only the
  leaves they may run; each app's history shows its own changes. A solution
  admin who administers no operation still opens the solution and designs. An
  app left off the menu opens from another app through
  `services.app.open(context.app.definition.…)`. A call naming an app the
  caller holds no role on is refused; a call with no app is refused for anyone
  but an operation admin, who reads every record whatever their roles.
  `scripts.query` is refused for a plain operation user. A run whose reference
  field names a record the caller may not read is refused. A new operation
  starts empty. Every existing page works as before after the migration, links
  between pages included.
- **Step 3:** an app offers only the activities on its list; an activity added
  to a record type's workflow afterwards does not appear on it. An item's
  condition hides an activity until it passes, and the server refuses the run
  while it fails. A run naming a record of a type other than the one it names,
  or an activity not on the list, is refused. Deleting a workflow a page names
  is refused. Re-pointing a record type in the Console works as before.
- **Step 4:** a GET not on the app's list, and not called by a listed
  activity's form, is refused; one on it answers. The inspections Job page's
  list of area inspections and the findings defect picker still work.
- **Step 5:** an app with no record runs a log-only activity of its own; the
  history entry lands on the operation's app and its hook changes other
  records, reading `context.app.definition`. An app's own GET leaves no history
  entry. An app's own activity is refused on any other record, and without its
  app. Two apps made from one page keep separate histories of these runs.
- **Step 6:** no page calls `services.page.open`; every existing link opens
  the app its definition names; `services.page.open` is gone.
- SPECs, GLOSSARY, ARCHITECTURE and BLUEPRINT updated as each step lands.

### 2.11 Where the build has to look

- **Server:** `router.ts` — `activities.run` (`:957-982`), `activities.query`,
  `page.activities` (`:638-672`), `records.partition/list/get`,
  `scripts.query`, `files.*` (`:770-858`), `pages.list` (`:681-696`),
  `pages.publishedPaths`, `operations.get` (`:420-435`), `operations.putConfig`
  (the menu), `config.get` (`:495`), `me`, the new `apps.*`; `gates.ts`
  (no-app calls by operation admins; Console access for them); `host.ts` —
  `validateConfigGraph` (`:649-662`), `editConfig` (the workflows pages name),
  `putConfig`, `publishConfig`, `rollbackConfig` (drop `default_menu`; refuse
  removing a page's list), `deleteWorkflow`, `menuItemSchema` /
  `validateOperationMenu` (`:524-582`), `putDefaultMenu`, `createOperation`,
  page publish and rollback (`:237-253`), `pageOpenable` (`:592-600`);
  `projection.ts` (the operation's apps out of general reads; `computeReadable`,
  `:42-58`; stop sending `default_menu`, `:295,304`); `databaseStore.ts`
  (history entries on changes to an operation's app); `schema.ts` (`MenuItem`,
  `OperationConfig`, `sdm_menus`); `db/client.ts` (migrations on connect);
  migrations.
- **Engine:** `engine.ts` (`executeQuery` running on one record and logging on
  another, `offeredActivities`, the availability check gaining the item's
  condition); `bridge.ts` (`records.*` must not reach the operation's apps,
  `:135-170`); `validateConfig.ts` (reserved ids; items' conditions;
  `checkInvokes` over datasources and the functions they call, `:273-274`,
  `:325,330`; the app-list rules for workflows pages name); `validateSubmission.ts`
  (reference fields read-checked, `:284-300`, through the server);
  `modelProjection.ts`; the platform's `rt_sys_apps` constant (step 5).
- **DSL:** a hook may not update or delete an operation's app
  (`validator.ts:762-765`, `evaluator.ts:1064-1075`).
- **Page runtime:** `pageDef.ts`; `validatePage` (`:175-195`, `:221-257`);
  `pageAnchor.ts` (`:57-77`); `pageHost.ts` (`services.app.open` beside
  `services.page.open`, `:144-166`; `context.app`; page GETs anchored on the
  page's record, `:256`); `runtime.ts` (`findActivity` searches record types'
  workflows only, `:113-120`) and `ComponentContainer.tsx` (`appId` and
  `typeId` on calls; opening an app by its id; `launchActivity`'s "Unknown
  activity", `:120-121`; the form's record type, `:156,175`, which for an app's
  own activity is `rt_sys_apps`; `listActivities` sending an empty `{}` with no
  record instead of returning `[]`, `:211`); `PageRenderer.tsx`;
  `capture/AttributesForm.tsx`; `RecordActivities` (shows the app's own
  activities with no record); `actionComponents.tsx` (OpenPage, `:84-90`).
- **Client:** `appId` and `typeId` on run, query, offered actions, record
  fetches and files; `apps.user`; `connectSolution` connecting with no records
  (`index.ts:691-701`); the menu's shape (`MenuItem`, `OperationConfig`);
  `visibleMenu` goes; the effective-menu fallback (`index.ts:840-846`).
- **Runtime app:** `context/RuntimeContext.tsx` (the URL), `components/MenuNav.tsx`,
  `components/PagesList.tsx` and the no-menu fallback (`App.tsx:59-66`), old
  `page=` links, `host.ts` (connect).
- **Console:** `sdm-runtime/engine.ts` (the operation picker; forgetting the
  remembered operation, `:106-117`); who sees what; the operation's admin
  (apps list with history, app menu); the model builder's Menu editor (removed)
  and Workflows editor (condition column); `RecordTypesEditor.tsx` (re-pointing
  unchanged, `:53-62,165`); `page-builder/PageEditor.tsx` (the settings column;
  the `'one'` default, `:370`); the DSL Editor (runs on other types refused).
- **Docs:** each touched package's SPEC; DSL_EDITOR_SPEC; CONSOLE_RUNTIME_SPEC
  (§5, §5a, §6, the URL); CLIENT_TRUST_BOUNDARY (§1, §7);
  ACTIONS_OFFERED_BY_SERVER; RECORD_READ_CONDITIONS; DATA_THROUGH_ACTIVITIES;
  SERVER_DATA_LOADING; RBAC_COMPACT; USERS.md; GLOSSARY; ARCHITECTURE;
  BLUEPRINT.

---

## Part 3 — follow-ups (2026-11-03)

Items §2.9 left for later that the user asked to do now, each specced here
before it is built. Cold-reviewed 2026-11-03; its findings are folded in
below, the four that needed a ruling settled on Claude's recommendation (the
user's OK).

### 3.1 The page's example definition

**Ruled 2026-11-03.** The user wanted the preview's definition saved with the
page, so another author finds it "prepackaged with an example" (the user's);
Claude proposed that one example do two jobs — the preview runs with it, and a
new app starts with a copy — and the user agreed.
**Built 2026-11-03**, with `pages.appDefaults` (both its halves — §3.3 adds
the field its roles come from).

- **`PageDef.exampleDefinition`** — optional JSON text, like an app's
  definition (§2.4). Absent or blank means none. It is an example: nothing
  outside the page editor's preview and the new-app dialog reads it, and no app
  ever reads it at run time.
- **Page editor.** A section in the configuration column, under the page's
  list: a text box for the example. It saves with the page's other settings,
  to the draft. Text that is not JSON shows an error under the box.
- **Publishing** refuses a page whose example is not JSON, as it refuses a
  page whose list is not a list (§2.2).
- **Preview.** The page runs with the example as `context.app.definition`;
  blank or not JSON gives `{}` (as today). `pageId` and `label` stay the
  page's path, and `services.app.open` is still refused in the preview. The
  parsed example is kept until the text changes, not parsed on every render.
  It reaches only what runs in the browser — the page's expressions; an
  activity the preview runs on the server sees no app, as today.
- **Rollback** (`pages.rollback`) does not carry the example forward: the
  version rolled back to comes back with its own example, or none.
- **New-app dialog** (Console, §2.6). When an app is being added, its
  definition box is filled with the chosen page's example, or `{}` when the
  page has none, and filled again whenever another page is chosen. Editing an
  existing app never changes its definition. The example comes from the page's
  **latest published version** — an operation admin cannot read drafts (§2.3),
  and an app is made from a published page.
- **The dialog reads it through `pages.appDefaults`** (§3.3), with the page's
  default roles.
- **Later, not now:** if hand-typed JSON causes mistakes, the example may grow
  into a list of the settings a page needs, each with a type (a setting holding
  an app's id offered as a dropdown of the operation's apps).

### 3.2 Expiring an app

**Ruled 2026-11-03.** "Let's not delete anything … we need a way to expire it
and for it to be unavailable"; an expired app "can still be seen as an app,
just expired. The data should be kept" (the user's). The word and its meaning
follow users' `expired` — the end of the relationship, the row kept (Claude's,
the user agreed); the field is `status` (the user's OK). **Built 2026-11-03.**

- **`status`** on the app's record — `active` or `expired`. An app with no
  `status` (every app before this) is `active`; nothing is migrated. Scripts
  do not see it: `rt_sys_apps` as scripts read it (§2.4) is unchanged. The
  server's `App` (`appFromRow`) and the client's `App` gain `status`.
- **Expiring is final.** Nothing un-expires an app (unlike users, who can be
  unexpired — corrected 2026-11-03 at the build: this said "as for users", and
  users are not final; final for apps is kept, the simpler thing, until a need
  to bring one back appears). Expiring an app already expired is refused,
  saying so.
- **Console** (§2.6): the apps list keeps showing an expired app, marked
  Expired. Its dialog still opens with its name, roles, definition and
  history, read-only. An active app's dialog has an **Expire** button, asking
  for confirmation first. Operation admins only, like the rest of the list.
- **`apps.expire`** `{ operationId, appId }` sets `status: expired` and writes
  the history entry every Console change writes (`sys_console_edit`, §2.4),
  with `status: expired` captured. `apps.put` refuses an expired app. Client:
  `expireApp(operationId, appId)`.
- **Runtime:** an expired app is not set up for the operation. `apps.user`
  leaves it out, so it drops off the menu, and the Runtime refuses opening it
  — from the menu, a link or the URL — as for any app not set up ("not set up
  for this operation"); it never asks the server. A call that does reach the
  server naming it — running or reading through it — is refused (check 1,
  §2.3), saying the app has expired; `page.activities` answers empty for it,
  as for any app check 1 refuses. `model.getForOperation` (today
  `config.getForOperation`) leaves its list out of the browser's model.
- **The menu** (§2.5): saving one that points at an expired app is refused,
  naming it. Items already pointing at one stop showing (above), and stay in
  the stored menu until an admin saves it without them. The Console's menu
  editor (`MenuItemsEditor`, `OperationMenuSection`) offers only active apps,
  and marks an item pointing at an expired one Expired so the admin can
  remove it.
- **The step 6 script** (`apps-step6`) skips expired apps, both as an app
  whose definition it fills and as a link's target.
- **Nothing is deleted:** the app's record and full history stay.

### 3.3 The page's default roles

**Ruled 2026-11-03:** roles on the built app are a **default**, not a limit
(the user's, on Claude's recommendation). A limit would bring back the two
layers that could disagree, dropped 2026-10-18 (BLUEPRINT § Access). Who may
run an app is still set only on it in the apps list; the page's roles never
decide who may run anything.

- **`PageDef.roleIds`** — optional list of the solution's role ids, the page's
  default roles (the name the user's, over Claude's `defaultRoleIds`).
- **Page editor.** A section in the configuration column, beside the example
  definition (§3.1): one checkbox per role the solution declares. Saving drops
  any id the solution no longer declares (it has no checkbox to untick).
- **New-app dialog.** Like the example definition: when an app is being added,
  its roles start as the chosen page's default roles (none when it has none),
  set again whenever another page is chosen; the admin changes them freely.
  Editing an existing app never changes its roles, and changing a page's
  default roles never touches existing apps. Read from the page's latest
  published version.
- **Publishing** refuses nothing over default roles.
- **One call for both starting values** — `pages.appDefaults`
  `{ solutionId, path }` → `{ definition, roleIds }` from the latest published
  version (`definition` the example, or `null`; `roleIds` the default roles
  the solution still declares, or `[]` — so a stale id never reaches
  `apps.put`, which refuses unknown roles), gated like `pages.publishedPaths`.
  A path never published is refused (not found). Client:
  `pageAppDefaults(solutionId, path)`.
- **Rollback** does not carry the default roles forward, as for the example.

### 3.1–3.3 together

- **Neither field reaches the Runtime.** `apps.user` sends whole published
  pages to every user's browser; it strips `exampleDefinition` and `roleIds`
  first. Only the page editor (drafts) and `pages.appDefaults` read them.
- **Docs, in the same commits:** server SPEC (`apps.*` calls, `pages.*` calls,
  check 1), page-runtime SPEC (`PageDef`, the preview's `context.app`),
  console SPEC (page editor sections, apps list, menu editor), client SPEC
  (`expireApp`, `pageAppDefaults`, `App.status`), and a BLUEPRINT note on
  expiry under § Access.

### 3.4 "config" becomes "model"

**Agreed 2026-10-18, the list approved 2026-11-03** (the user's OK on Claude's
list). "config" is the code's old name for a solution's model; the user ruled
it out for apps and asked for this tidy-up. A rename only — nothing behaves
differently — done in its own commits, after §3.1–§3.3.

- **Server calls:** `config.*` → `model.*`, the names after the dot unchanged
  (`get`, `getForOperation`, `put`, the `put…` and `delete…` per-entity calls,
  `publish`, `versions`, `rollback`). Two things are now called `model.*`:
  these server calls and the DSL's `model.*` root (querying the model in a
  script) — unrelated; docs say which they mean each time.
- **Table:** `sdm_config_versions` → `sdm_model_versions`, its `config` column
  → `model`, its primary key `sdm_config_versions_solution_id_version_pk` →
  `sdm_model_versions_solution_id_version_pk`; the Drizzle export
  `sdmConfigVersions` → `sdmModelVersions`.
- **Migration 0024**, hand-written, with its `_journal.json` entry (idx 24):
  the renames above; then `operations.menu` jsonb NOT NULL DEFAULT `'[]'`,
  filled from `COALESCE(config->'menu', '[]')`, then `operations.config`
  dropped.
- **Deploy order.** Migrations apply on connect, so the first new server to
  connect changes the database under any old one still running: migrate, then
  deploy the server, Console and Runtime together.
- **Types:** `SolutionConfig` → `SolutionModel`, `ClientSolutionConfig` →
  `ClientSolutionModel`, `ConfigCollection` → `ModelCollection`,
  `ConfigValidationError` → `ModelValidationError`, `ValidateConfigOptions` →
  `ValidateModelOptions`, `ConfigDraftNotFoundError` →
  `ModelDraftNotFoundError`, `StoredConfigBeforePool` →
  `StoredModelBeforePool`, `ConfigPublishControl` → `ModelPublishControl`.
- **Functions:** `Config` → `Model` in `validateConfig`, `validateConfigGraph`,
  `getSolutionConfig`, `putConfig`, `putConfigEntity`, `deleteConfigEntity`,
  `readConfig`, `saveConfig`, `projectConfig`, `useSolutionConfig`,
  `useLoadedConfig`, `publishConfig`, `rollbackConfig`, `editConfig`,
  `listConfigVersions`, `getConfigVersion`, `appendConfigVersion`,
  `reportConfigFindings`; `configCollections` → `modelCollections`,
  `configVersions` → `modelVersions`.
- **Variables and options:** `client.config` → `client.model`,
  `EngineOptions.config`, `PageRuntime.config`, `OperationHost.config` and the
  `MemoryAdapter`'s model argument → `model`, and every variable holding a
  model named `model`.
- **Files:** `validateConfig.ts`, `ConfigPublishControl.tsx`,
  `useSolutionConfig.ts`, runtime `src/config.ts` and `config/`,
  `configentities.test.ts`, `configGrade.test.ts` — `config` → `model` in the
  name.
- **Messages users see:** "SDM config" → "model" in host.ts's three errors
  (no model stored, model rejected, no model to publish) and the Console's
  solutions page ("Design artifacts — SDM config, pages and role defs").
- **The operation's menu:** `operations.config` holds only `{ menu }`, so it
  becomes an `operations.menu` column holding the menu itself (migration
  0024). `OperationConfig` and `operationConfigSchema` go;
  `operations.putConfig` → `operations.putMenu`, its input
  `{ operationId, menu }`; `putOperationConfig` → `putOperationMenu`, on the
  server and the client; `OperationRow.config` and the client's
  `Operation.config` → `menu`; `withoutMenu` goes with them.
- **Scripts:** the seven kept (`bootstrap`, `migrate`, the three `check-*`,
  `apps-step3`, `apps-step6`) are renamed with the rest. The 40 one-off data
  scripts were deleted first (0f118cb, the user's call), so nothing is left
  using the old names unchecked.
- **Unchanged — they mean something else:** `slotConfigs` / `SlotConfig` (a
  layout's slots), `staticConfig` (a component's set values), `type_config` /
  `AttributeTypeConfig` (an attribute type's settings), `authConfigured` /
  `configured` (sign-in set up), `ConfigColumn` (the page editor's settings
  column). Dropped tables (`sdm_configs`) keep their names in old migrations
  and history notes; phase summaries are never edited.
- **Docs:** every SPEC and root doc naming the old names, in the same commits.

**Names approved 2026-11-03** (the user's OK): `status` (`active` /
`expired`), `apps.expire`, `PageDef.roleIds`, `pages.appDefaults`;
`PageDef.exampleDefinition` was in the proposal the user agreed to, not
confirmed on its own.

---

## Cold review 2026-10-17 — decisions ruled, fixes applied

A cold review of the 2026-10-17 Part 2 against the code (dev database not
re-measured; lines quoted from `packages/server/scripts/inspections-*.ts` show
the model as those scripts built it). Verdict at the time: **step 1 can be
built now; steps 2–5 are not ready.** The first revision's six open decisions
(its §2.12) were folded in. All nine decisions were ruled with the user the same
day, and Part 2 was revised with them and with the fixes below (2026-10-17);
section numbers below refer to the first revision, and "config" (ruled out as a
name the same day) means an app in the operation's apps list.

### Decisions for the user (the reviewer's recommendation in each)

1. **Does check 4's "record of that type" apply to GETs?** **Ruled 2026-10-17:
   the recommendation, agreed by the user.** A GET's record is
   where its entry lands, not what it asks about (DATA_THROUGH_ACTIVITIES
   `:45-58`): pages send the page's record (`pageHost.ts:256`), forms the
   record being acted on (`AttributesForm.tsx:742,863`). The inspections Job
   page (about jobs) calls `act_list_area_inspections` from
   `wf_area_inspections`; the findings defect picker calls a GET from
   `wf_defects` on a finding. Check 4 refuses all of them, while §2.3 also says
   GETs keep today's record — a contradiction. The browser often cannot name a
   GET's `typeId` either (`invoke` names only the activity; the browser lacks
   unreadable types' workflows, `projection.ts:255-272`). *Recommendation:* for
   GETs, check 4 only confirms the GET is on the app's list (and in some record
   type's workflow); the record stays where the entry lands, with the read
   check; the server, not the browser, works out the type.
2. **Form GETs** (§2.12 #1). **Ruled 2026-10-17: the recommendation, agreed by
   the user, including refusing non-literal datasource invokes at save; reads
   stay GET activities, never written into a field** (the user asked; Claude
   recommended keeping them). Measure dev for non-literal datasource invokes
   before building. Datasources sit on pool attributes
   (`validateConfig.ts:310-312`), not activities, and `activities.query`
   carries only the GET's id. *Recommendation:* work out ahead of time, from
   literal `invoke` ids in the datasources of listed activities' attributes
   (composite cells included), which GETs count as listed; refuse non-literal
   datasource invokes at save. Must be ruled before step 3 (the script lists
   form GETs or not).
3. **Record fetches** (§2.12 #2). **Ruled 2026-10-17: the recommendation,
   agreed by the user.** The whole-operation fetch should never happen (the
   user's); removing it from the Console is a deferred to-do for a later session
   (SERVER_DATA_LOADING §6), and Part 2 only closes it to everyone without
   Console access. `records.list`'s only page caller is the
   removed `'one'` path (`pageAnchor.ts:64`); `records.partition` is Console-only
   in practice (Runtime connects with `records: 'none'`, `runtime/src/host.ts:118-124`)
   but open to any operation user. *Recommendation:* `records.get` carries
   `appId` and passes checks 1–2, in step 2; `records.list` and
   `records.partition` fall under the no-app rule.
4. **Who may call with no app** (§2.12 #3). **Ruled 2026-10-17, changed from
   the recommendation: admins of that operation** (the user's; Claude agreed —
   the operation is the data boundary, and a solution admin may be a designer
   who should not see an org's records). They read every record in it,
   whatever their roles (the user's), and nothing in operations they are not
   admins of. `scripts.query` and `records.partition` follow the same rule —
   closing today's hole where any operation user can run a script reading every
   record type (`router.ts:1131-1146`). So a solution admin who wants to work on
   an operation's records must also be its admin; the Console must open to
   operation admins (`gates.ts:145-152`, see decision 7), and the workbench's
   model read (`config.get`, solution-admin only, `router.ts:495`) must serve
   them. The reviewer's recommendation was: solution
   admins only, `scripts.query` and `records.partition` included.
5. **History on a Console change to a config** (§2.12 #4). **Ruled 2026-10-17:
   yes, keep history — the recommendation, agreed by the user.** Record the
   direct-write exception to rule 1 in BLUEPRINT. *Recommendation
   holds* (yes), but must be ruled before step 2: step 2's "separate
   histories" has nothing else to show until step 5. Written through the same
   append that fills `rpt_activities` (`databaseStore.ts:447-470`).
6. **Logging GETs on the config** (§2.12 #5). **Ruled 2026-10-17: an app's own
   GETs leave no entry — the recommendation, agreed by the user;** the engine
   change goes in step 5. Mis-framed in §2.12: an app's own GET
   runs on the config and `executeQuery` logs on whatever it runs on
   (`engine.ts:401-407`). *Recommendation:* unlogged, which needs an engine
   change (the record a GET runs on and the one it logs on become separate),
   named in step 5.
7. **Who sets up apps and the menu** (§2.12 #6). **Ruled 2026-10-17: operation
   admins, with a list of the solution's published apps they can read — the
   recommendation, agreed by the user;** the Console opens to them (decision
   4). Picking uses
   `pages.publishedPaths`, solution-admin only (`router.ts:727-735`), and the
   Console is closed to a plain operation admin (`gates.ts:145-152`).
   *Recommendation:* operation admins, with a list of published apps they can
   read; whether they can open the Console is separate.
8. **Opening a page that has several configs** (new). **Ruled 2026-10-17,
   replacing the recommendation: one mechanism opens any app — a menu, a link
   in a page, or a scheduled job** (the user's). It is "open app" with an id —
   the id of the app's entry in the operation's apps list, where its config
   lives — plus params, through the same gate; no ambiguity (the user's
   wording: "open the app", not "open the config"). A link's author can only
   name the app, so the operation turns it into an id: with one entry for that
   app, its id; with several, the operation admin picks which, on the entry the
   link comes from (Claude's, agreed: "exactly"). Original text: "First the caller may
   run, by name" (§2.7) is not a ruling; from the water scheduler, a link to its
   own page may land in the sewer one. *Recommendation:* keep the open config
   when the target is its own page; otherwise first by name.
9. **Names.** **Ruled 2026-10-17 — see § Names (the user's `definition` and
   `show_condition`; the rest Claude's, agreed).** The config's field `config` gives `config.config`, beside
   `SolutionConfig`, `config.*` calls and `operations.config`.
   *Recommendation:* `settings`. Also unendorsed: the new server calls
   (Runtime's read of configs and menu; Console's config list and write), the
   ids of the workflows the script creates, the `page.activities` item for an
   app's own activities.

### Fixes needing no decision (make them when revising)

- **Step 2:** settle where `rt_sys_apps` lives now, not at build — the first
  config row makes `validateConfigGraph` refuse every model save
  (`host.ts:649-662`); with sign-in off `records.partition` hands configs out
  (`router.ts:866-871`); the workbench reads only through `records.partition`
  and `config.get` (`client/src/index.ts:691-704`). Suggested: rows in
  `records`, excluded by type id from the stray-type check and every general
  read, with dedicated reads; adding it to the model waits for step 5. Say
  whether the migration is SQL or a script and how ids are issued (UUIDv7
  exists only in TypeScript, `memoryAdapter.ts:1,391`). Fix §2.3's
  contradiction on record fetches. Add to the call list and §2.11:
  `files.presignUpload/presignGet` (`router.ts:770-858`), `pages.list`
  (`router.ts:681-696`), `operations.get` (raw `config.menu`, unchecked,
  `router.ts:420-435`). State config save checks (published page, roles exist)
  and check 2 with sign-in off. Say whether the no-menu fallback
  (`App.tsx:59-66`) goes. Old page versions keep `access`; the server stops
  reading it. The reversal list adds BLUEPRINT § Access "Built" and the
  core-terms *Solution* line.
- **Step 3:** protect a page's list from `deleteWorkflow` and model rollback
  (`host.ts:683-700`), and say what page rollback to a pre-step-3 version
  does (`host.ts:249-253`). Deploy order: the script runs with the step 3
  deploy, or a missing `workflow` means unchecked until it has run. Define
  check 3 for a missing, dangling, or record-type workflow (pages are stored
  unvalidated, `host.ts:205-210`). The app's condition on a CREATE offered on
  a record sees the record at offer time and null at run time — say so. The
  script also walks dynamic props, `{{ }}` holes in static config
  (`inspections-pages.ts:123`), callback scripts, RecordList action columns,
  RunActivity and OpenPage targets, and model functions reached from page
  expressions. The missing-config warning covers OpenPage targets
  (`actionComponents.tsx:84-90`) and RecordList action columns too.
- **Step 4:** a GET shared by several types with no record — any type that
  lists it passes.
- **Step 5:** the browser cannot find or open an app's own activities —
  `projectConfig` sends only readable types' workflows (`projection.ts:255-272`),
  `runtime.findActivity` and `validatePage` search record types' workflows only
  (`runtime.ts:113-120`, `validatePage.ts:230,250`), the form needs a record
  type (`ComponentContainer.tsx:152,173`). Specify the `page.activities` item
  and which component asks (`listActivities` returns `[]` with no record,
  `ComponentContainer.tsx:211`). §2.3's last bullet allows runs on a config
  without an app; step 5's done-when refuses them — pick refusal.
- **Steps 3 and 5:** "the app's own" means "in a workflow no record type
  points to", not "in no record type's workflow" (which also covers pool
  activities in no workflow, §1.4). `validateConfig` cannot see pages, so it
  treats every such workflow as an app's list and refuses CREATE, UPDATE and
  DELETE there. Measure dev for such workflows holding UPDATEs or DELETEs.
- **Wording:** "entry" means both a workflow list item and a history entry;
  use different words.

### Checked and fine

`createTypeByActivity` and the one-type CREATE rule already count only record
types' workflows (`engine.ts:213-218`, `validateConfig.ts:241-248`); the
server's and engine's `findActivity` and `invoke` search every workflow
(`host.ts:148-154`, `engine.ts:271-278`); `projectConfig` sends references
with `activity_ref` only, so app conditions never reach the browser
(`projection.ts:257-264`); "where an activity runs is fixed by the model"
holds for UPDATE, DELETE, log-only and CREATE; every line §2.3–§2.12 cites
holds.

---

## Second cold review 2026-10-17 — decisions ruled 2026-10-18, fixes applied

A second cold review, of the revision above. Dev database not measured; whether
dev's solution admins are also operation admins (it decides how many people
fix 3 affects) is unverified. **Step 1 buildable now; step 3 needs fixes only;
step 4 ready once step 3 lands, after fix 14; steps 2 and 5 not ready.** Of the
first review: decisions 1, 2, 3, 6, 7, 9 landed (2 with wrong citations); 4, 5,
8 partly; the fixes landed except as listed below.

### Decisions for the user (the reviewer's recommendation in each)

1. **A link to a page with several apps when the open app's `links` has no
   pick for it.** **Ruled 2026-10-18, replacing the question: links open an app
   by its id, like a menu item** (the user's). The author writes the link into
   the page; where the target differs per operation, the page reads it from its
   app's definition, which the author also designs (e.g.
   `context.app.definition.jobLinkId`); making links correct is the author's
   job (the user's). One way to open an app: `services.app.open(appId, params)`
   (the user's; Claude placed it under `services`, the page scripts' root);
   `services.page.open` goes — kept working until a final step 6 rewrites
   existing links and removes it (Claude's, agreed); meanwhile a link to a page
   with several apps in the operation is refused, "not set up for this
   operation". The `links` field is dropped. Original question: — the second app added after the pick, or a path computed in
   a script (§2.6 finds only literal paths, OpenPage targets and action
   columns). *Recommendation:* refuse with "not set up for this operation", and
   the Console warns when an app is added from a page other apps link to.
2. **The activity id and name of a history entry from a Console change or the
   migration.** **Ruled 2026-10-18: the recommendation, agreed by the user** —
   `sys_console_edit` / "Changed in the Console" (who, when, the changed fields
   with their new values in `capturedAttributes`) and `sys_migration` /
   "Created by the migration". Reserved: no solution may use either id. `rpt_activities.activity_id` and `activity_name` are NOT NULL
   (`schema.ts:481-489`; the append writes both, `databaseStore.ts:443-468`);
   §2.4 says only "who, when, what changed". *Recommendation:* one reserved id
   for Console changes and one for the migration (names the user's); changed
   fields in `capturedAttributes` as their new values.
3. **Do scripts of an app's own activities see `definition` (and `roles`,
   `links`)?** **Ruled 2026-10-18, replacing the recommendation: one definition,
   sent to the browser, read as `context.app.definition.…` everywhere** — pages
   and server-side scripts alike (the user's, on Claude's recommendation not to
   split yet). The user first preferred the definition on the server only, then
   a definition with `client` and `server` sections
   (`context.app.definition.client.jobLinkId` / `.server.network`, same path
   everywhere); not built now — that is the shape if something genuinely secret
   turns up, and adding it later changes nothing existing. Scripts read the
   app's `page`, `label` and `definition`, not its `roles` (Claude's, flagged to
   the user). Typing `context.record` as `rt_sys_apps` (step 5) would expose
   them, while §2.9 defers how an app reads its definition. *Recommendation:*
   only `page` and `label` until that is taken up.
4. **Does "a record id passed in gets the read check" cover reference
   attributes on a run and record ids in a GET's parameters?** **Ruled 2026-10-18: the
   recommendation, agreed by the user** — the record ids a run's reference
   fields send back are read-checked on the server; the GET that lists the
   choices is untouched, and GET parameters are not checked (the user's
   distinction: the list is just a GET, the id returned is what gets checked). §2.3 checks only
   the record the call sends; `validateSubmission` checks a reference exists and
   has the right type (`validateSubmission.ts:284-300`). *Recommendation:*
   read-check reference attributes on runs; leave GET parameters, since GETs
   filter for themselves (BLUEPRINT § Access).
5. **What an operation admin who is not a solution admin sees in the Console.** **Settled 2026-10-18 without a ruling** — the user: the Console is an
   operations tool, operation admins administer operations and use it. So they
   use the Console for their operations; the design tools (model and page
   builders) show only to those who can save there, solution admins (Claude's,
   as the plain consequence).
   Once `config.get` serves them they can open the design scope, where every
   save fails. *Recommendation:* the operation's admin and the workbench; the
   model and page builders hidden.

### Fixes needing no decision

1. `files.presignUpload/presignGet` take only `solutionId`
   (`router.ts:770-858`; client `index.ts:893,897`): add `operationId`; checks
   1–2 apply (`presignGet` names no record).
2. `pages.list` draft mode is design-plane, called by `connectSolution` with no
   operation (`client/src/index.ts:692`) and ungated (`router.ts:685`): only
   published mode becomes a no-app call; draft mode gated to solution admins.
3. **Solution admins who are not operation admins get locked out:**
   `connectSolution` fetches `records.partition` with `config.get` and
   `pages.list` in one `Promise.all` (`index.ts:691-701`), so a refusal fails
   `openSolution`, and the remembered operation is forgotten only after a
   successful connect (`console/src/sdm-runtime/engine.ts:106-117`). Connect
   with no records unless the caller administers that operation; list only those
   operations in the picker.
4. The no-app rule needs a closed list of the calls it governs; connect-time
   calls (`operations.get`, `config.getForOperation`, `me`, `apps.mine`,
   `perf.*`) stay open to the operation's users.
5. §2.6's "an operation admin cannot get in" is false: `me().console` has no
   consumer in `packages/console/src`; an operation admin reaches the
   operation's admin today and fails at `pages.publishedPaths`
   (`OperationMenuSection.tsx:30`). The real blockers: `config.get`,
   `publishedPaths`, the solution-scoped design connect.
6. The Console menu editor reads the menu through `operations.get`
   (`OperationMenuSection.tsx:26,46`), which §2.3 strips: `apps.list` returns
   the menu.
7. `apps.mine` must carry the page definitions, each app's `links`, and which
   of the operation's apps are made from each page (including ones the caller
   cannot run, to decide "the only one") — or links resolve on the server.
8. **Step 2 migration order:** `createDb` applies migrations on connect
   (`db/client.ts:42,59-63`), so the step 2 server would drop `sdm_menus`
   before the script reads it. Ship the drop in a later deploy, or run the
   script with `applyMigrations: false` first. State the window: old code
   refuses every model save once `rt_sys_apps` rows exist (`host.ts:651-662`).
9. A page on two menu items would give two leaves to one app, which §2.5
   refuses: say which wins.
10. `PageRecordDef.instances` removal is in no step, and the page runtime does
    read it (`pageAnchor.ts:57-77`, `validatePage.ts:175-195`; the page editor
    defaults to `'one'`, `PageEditor.tsx:370`): step 2, where `records.list`
    closes.
11. "Every workflow no record type points to is an app's list" breaks the
    Console: re-pointing a record type away from a workflow holding its CREATE,
    UPDATE or DELETE (`RecordTypesEditor.tsx:165`), and filling a workflow
    before its record type exists (`RecordTypesEditor.tsx:53-62`). `editConfig`
    already queries the database (`host.ts:651-656`): apply the app-list rules
    only to workflows a page names; refuse pointing a record type at a page's
    workflow, and treat it as dangling at run time.
12. Script sources: callbacks cannot `invoke` (`validatePage.ts:221-228`) but
    run activities via `services.activities.run` (`:245-257`) — walk those
    literal ids. RecordActivities / RecordList rows from a GET have no static
    record type: decide from the GET's `returns`, or list as unresolved for the
    user.
13. The script's new version is the latest published definition plus
    `workflow`, not the draft (which may hold unpublished work); the draft also
    gains `workflow`.
14. `checkInvokes` runs only over hooks and `returns` (`validateConfig.ts:325,330`),
    never datasources; the non-literal skip is at `:273-274`. Also cover a
    datasource calling a named function that invokes a GET — count its ids or
    refuse.
15. Step 5: name the one place the platform's `rt_sys_apps` / `wf_sys_apps`
    definitions live and which consumers get them (engine at run time,
    `validateConfig` at save).
16. Always refuse a call that sends an `rt_sys_apps` record id; with sign-in
    off check 5 passes (`computeReadable` returns null, `projection.ts:47`).
17. Docs: §2.4's "Configs are read only through…"; GLOSSARY *Page* "moves to its
    config"; SERVER_DATA_LOADING §6 says "without Console access" (the ruling is
    operation admins); spec lines repeating the end of §1.9 after §1.9; the
    reversal list adds USERS.md `:228-231`, CLIENT_TRUST_BOUNDARY `:171-173`,
    DSL_EDITOR_SPEC `:405-411`.
18. "Item" has three meanings (workflow list item, `page.activities` request
    item, menu `items`): call the second "an empty `{}` in the request".
    `ComponentContainer.tsx:152,173` is now `:156,175`.

---

## Names needing the user's OK

Approved: `sdm_activities` · `activity_ref` · `model.workflow_activities`
(2026-10-06) · `rt_sys_apps` (2026-10-04) · `appId` on calls and `app` in the
URL (the user's, 2026-10-15) · `PageDef.workflow`, the `rt_sys_apps` field
keys `page`, `label`, `roles`, and `wf_sys_apps` (2026-10-15).

Approved 2026-10-17:

- `definition` — the `rt_sys_apps` field holding what the app needs set for
  this operation (the user's, replacing `config`, which read `config.config`; `def` was not
  taken because pages and model entries already store a `def`).
- `show_condition` — an app's condition on an item of its list,
  `{ activity_ref, show_condition }` (the user's, in the model's existing form).
- `app` — a menu leaf's pointer, the id of an app in the list: `{ id, app }`.
- `appId` keeps its name: the id of an app in the apps list. `rt_sys_apps`
  keeps its name: its rows are the apps list's apps.
- `typeId` on runs — the name `page.activities` already uses.
- Server calls: `apps.list` (Console: an operation's apps list), `apps.put`
  (Console: add or change an app in the list), `apps.mine` (Runtime: the apps the caller
  may run, and the menu). `pages.publishedPaths` opens to operation admins, no
  new name.
- `wf_app_<page>` — the ids of the workflows the migration script creates,
  the page path's slashes made underscores.
- An empty item `{}` in `page.activities` asks for the app's own activities.

- ~~`links`~~ — approved 2026-10-17, **dropped 2026-10-18**: links read their
  target from the app's definition instead.

Approved 2026-10-18:

- `services.app.open(appId, params)` — the one way a page opens an app
  (the user's; replaces `services.page.open`).
- `context.app.definition` — how a page reads its app's definition.
- `sys_console_edit` ("Changed in the Console") and `sys_migration` ("Created
  by the migration") — the activity id and name on history entries for a
  Console change to an app in the apps list, and for the migration creating
  one.

Settled 2026-10-18, at the start of the step 2 build (the user's, on Claude's
playback; where they rename an earlier approval, the earlier text above and in
the cold review sections keeps the old name as written then):

- **A name holding an id ends in `Id`** (the user's: "if it's an id the name
  should include Id, same as operationId"). So: the `rt_sys_apps` fields `page`
  → `page_id` and `roles` → `role_ids` (record field keys are snake_case; calls
  spell them `pageId`, `roleIds`); a menu leaf `{ id, app }` → `{ id, appId }`;
  `context.app.page` → `context.app.pageId`; `services.app.open(appId,
  { recordId })`; `PageDef.workflow` → `PageDef.workflowId` (step 3). The URL
  stays `?operation=&app=&record=`, short like `operation=`; existing names
  holding ids (`PageDef.record.type`, a page's `path`, a history entry's
  `author`) are not renamed here.
- `apps.user` replaces `apps.mine` (the user's). It answers `apps` (`id`,
  `label`, `pageId`, `definition`), `pages`, `menu` and `appIdByPageId` (until
  step 6).
- `apps.list` answers `apps` (`id`, `pageId`, `label`, `roleIds`,
  `definition`) and `menu`, without history; **`apps.get`** answers one app
  with its `activityHistory`, for the dialog (the user asked why history came
  with every list). `apps.put` takes `id` absent to add, and answers `{ id }`.
- The **Apps** tab in the operation view, beside its Menu tab.
- `packages/server/scripts/apps-step2.ts` — the step 2 script; it prints what
  it would do, and writes only with `--apply`.

Settled 2026-10-18, at the start of the step 6 build:

- **`OpenApp`** — the button that opens an app, replacing `OpenPage`; its
  `target` holds the key in the app's definition whose value is the id of the
  app to open, on a page and in a RecordList action column alike (Claude's
  proposal, the user's OK). An app id cannot be stored there: the page is
  shared by every operation's apps made from it, and each has its own ids.
- `packages/server/scripts/apps-step6.ts` — the step 6 script (Claude's, in the
  playback). The keys it proposes are the target page's name in camelCase plus
  `LinkId` (`shiftReportLinkId`), like the spec's `jobLinkId`, printed for the
  user to check before `--apply`.
- The script's changes to definitions leave `sys_migration` history entries as
  the step 2 script's did, under the name "Created by the migration" (the user:
  not concerned with the history — the data so far is all testing).

None open.
