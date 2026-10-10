# Apps and instances — spec

**Status:** draft for review, 2026-10-04. Nothing built. Built from the
exploration in [ideas/apps-and-instances.md](ideas/apps-and-instances.md) and
the user's rulings of 2026-10-04 (below). Two build parts, built and checked
one at a time: **Part 1, the activity pool**, then **Part 2, apps and
instances**. Part 2 has decisions still open (§ Decisions needed); Part 1 does
not depend on them.

## What this changes, in one paragraph

Activities move out of workflows into one list per solution, the **activity
pool**. A workflow lists the pool activities it uses, in order, so one activity
can serve several record types. An activity runs only through a workflow. A
**page is an app**, and may have a workflow of its own. An app with a record
type gets that type's workflow plus its own, and may remove activities from
either. An app with no record type has only its own. An **instance** is
an app set up for one operation: a record of the platform's own record type
`rt_sys_apps`, holding label, roles, menu placement and settings. The
operation's instances are its menu. Every page run carries its instance; a page
with no record of its own runs against the instance record, so its runs leave
history there.

## Rulings this spec rests on (user, 2026-10-04)

- **A workflow is a named, ordered list of pool activities.** A record type
  points to one workflow, as today. An app points to one workflow of its own.
  (An earlier suggestion in the same discussion — an app gets an "activity
  list", not a workflow — was dropped: the list was a workflow by another name.)
- **An activity runs only through a workflow**, a record type's or an app's. A
  pool activity no workflow includes cannot run, GETs included.
- **An app may change which activities it has, but only narrow how each is
  used.** It adds through its own workflow and removes from either workflow. An
  activity's own rules (availability condition, hooks) apply wherever it runs;
  an app may tighten them, never loosen them.
- **A shared activity must fit every record type that uses it**, and that is
  the author's responsibility. Save checks it against each type and reports
  what does not fit; the author makes separate activities where it cannot.
  This includes CREATE: a CREATE reached through two record types is an error.
- **Record types keep their workflow.** Marking each activity with its record
  type instead (a model the user has used before) was considered and not taken.
- **Page settings stay on the page; the instance overlays them.** Roles stay on
  the page. Publishing a page updates every instance of it.
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
  (approved by the user 2026-10-06). Today the server runs any UPDATE, DELETE
  or log-only activity against any readable record, whether or not that
  record's type lists it (`activities.run` checks the anchor is readable, never
  that its workflow holds the activity). The server now rejects a run whose
  activity is not in the anchor's record type's workflow. Part 2 widens this to
  include the app's own workflow (§2.5). CREATE (no anchor) and GET (a
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
- The server refuses an UPDATE, DELETE or log-only run on a record whose type's
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

## Part 2 — apps and instances

Built only after Part 1 is checked, and after § Decisions needed is settled.

### 2.1 The page is the app

- A page may point to a **workflow of its own** (`PageDef.workflow`) — an
  ordinary workflow, authored in the Workflows editor, that no record type
  points to.
- A page with a record type (`PageDef.record`) gets that type's workflow plus
  its own. It may **remove** activities from either (`PageDef.remove`).
- A page with no record type has only its own workflow.
- A page's own workflow's scripts are checked (§1.4) against the page's record
  type, or `rt_sys_apps` when the page has none.
- **Its own workflow's activities run only against the app's record** — the page's record,
  or the instance record when the page has none — and are recorded in its
  history. They exist so a record type's workflow is not cluttered with
  activities that belong to one app.
- **Removed activities cannot run through this app**, on any record. They still
  run from the workbench and anywhere else their workflow applies.
- **`RecordActivities`** on the page's own record shows the app's activities
  (record type's workflow + the page's own − removed), each still subject to its availability condition. On any
  other record it shows that record's workflow, as now. The workbench is
  unchanged.
- **`PageRecordDef.instances: 'one'` is removed.** The instance record now does
  its job. Measured on the dev database 2026-10-04: no page uses it. `'many'`
  (the record id in the URL) stays.

### 2.2 `rt_sys_apps`

- Defined in platform code and added to every solution's model when it is
  loaded. It is never stored in `sdm_record_types`, never shown in the model
  builder, and an author cannot change it.
- **Fields:** `page` (page path), `label`, `roles` (list of role ids), `group`
  (text; items with the same group show together), `order` (number; order
  within the group, and of groups by their first item), `config` (string
  holding JSON — the instance's settings).
- **Workflow:** an empty one, defined with the type. Activities run on an
  instance come from its page's own workflow (§2.1), never from the type.
- **Rows live in `records`**, per operation, like any record: an id, the fields
  above, and the activity history that app use leaves.
- **Reads:** instance records are not returned by general record reads (the
  runtime partition, `records.*` in scripts, `RecordList`). The runtime receives
  the caller's instances through the menu (§2.4). The Console reads them all.
- **The Console workbench** lists `rt_sys_apps` like any type, read only, so an
  instance's history can be seen. It offers no activities (its workflow is
  empty).

### 2.3 Instances in the Console

- **The operation's menu editor becomes the instance editor**
  (`admin/MenuItemsEditor`). Add an instance (pick a published page), set label,
  group, order, roles and config (a plain text box), remove one. These are
  direct writes.
- **Removing an instance deletes it and its history**, after a confirmation
  saying so — the rule a DELETE activity follows. See § Decisions needed.
- **The solution's default menu** (`sdm_menus`, edited in the model builder's
  Menu editor) changes shape to the instance fields: a flat list of
  `{ page, label, roles, group, order, config }`. Today's one level of nested
  groups becomes the `group` text.
- **Creating an operation** copies the default menu into instance records for
  it. After that the operation owns them; nothing is inherited at runtime.
- **`operations.config.menu` is removed.**

### 2.4 Runtime

- **The menu** is built from the operation's instances the caller holds a role
  on, grouped by `group`, sorted by `order`. The server filters, not the
  browser.
- **The URL** becomes `?operation=&instance=&record=`. The instance names the
  page; `page=` is dropped.
- **Opening another page** (`services.page.open(path, record)`) needs an
  instance of that page. See § Decisions needed.

### 2.5 What a run carries, and what the server checks

- Page runs (`activities.run`, `activities.query`) carry `instanceId`, and a
  `recordId` when there is a record. With no `recordId`, a non-CREATE run's
  anchor is the instance record.
- The server, for a run that names an instance:
  1. loads it from the run's operation; not found → not found;
  2. the caller must hold one of the instance's roles (when RBAC is enforced);
  3. the activity must not be in the page's `remove` list;
  4. if the activity reaches the app only through the page's own workflow, the
     anchor must be the app's record;
  5. otherwise Part 1's rules apply.
- Runs that name no instance (the workbench, outside callers) follow Part 1's
  rules only. An activity only a page's own workflow includes cannot run
  without that page's instance.
- **GETs on a page with no record** now have an anchor, the instance record, so
  their runs are logged there. This finishes DATA_THROUGH_ACTIVITIES step 3 for
  pure views.

### 2.6 Migration

- Each solution's `sdm_menus` reshaped (nested groups → `group` text, `order`
  from position). Dev database 2026-10-04: two default menus, one item each.
- For every operation, its solution's default menu copied into instance records.
  Dev database: no operation has its own menu, so nothing else to carry over.
- `instances: 'one'` dropped from page defs (none on dev).

### 2.7 Not in Part 2

- How pages and hooks read an instance's `config`.
- A page added to a solution reaching existing operations.
- Automations (the app with no UI).
- Search and pinning as the way to find apps.
- Review before publish for instances.

### 2.8 Done when

- An operation's menu comes from its instances, filtered by role on the server.
- Two instances of one page on one operation show as two menu items with
  separate histories.
- A page with no record type runs an activity from its own workflow, and the
  entry lands on its instance record.
- A page with a record type removes a workflow activity (gone on the page, still
  in the workbench) and adds one through its own workflow (runs on the page's
  record only).
- The server refuses: a run naming an instance the caller holds no role on; a
  removed activity through the app; an activity from the page's own workflow on
  another record or without the instance.
- New operation gets the default menu as instances.
- SPECs, GLOSSARY (*app*, *instance*), ARCHITECTURE and BLUEPRINT § Apps updated.

---

## Decisions needed before Part 2

1. **Pages that are not on the menu.** Detail pages are reached only from other
   pages (in the `projects` solution, seven of eight pages; its default menu has
   one item). Every run carries an instance, so they need one too. Suggested: an
   instance with no `label` is not shown on the menu, and creating an operation
   makes one such instance for every published page not in the default menu.
2. **Instance roles and page roles together.** Suggested: both must pass — the
   page's roles say who may ever use the app, the instance's who may use this
   one. The alternative is the instance's roles replacing the page's when set.
3. **Opening a page that has several instances** (`page.open`). Suggested: the
   first one, by group and order, that the caller holds a role on.
4. **Removing an instance deletes its history.** Suggested as written (§2.3);
   the alternative is refusing removal once it has history.

## Names needing the user's OK

Approved 2026-10-06: `sdm_activities` · `activity_ref` (on a workflow's
reference) · `model.workflow_activities`.

Still open: `PageDef.workflow` and `PageDef.remove` ·
the `rt_sys_apps` field keys `page`, `label`, `roles`, `group`, `order`,
`config` · the instance URL parameter `instance` · the name of `rt_sys_apps`'s
empty workflow (suggested `wf_sys_apps`).
