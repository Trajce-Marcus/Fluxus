# Apps and instances — idea being explored

**Status:** exploration, 2026-09-30. Not ruled, nothing built. The user's own
words: parts of it his gut is "not comfortable with yet". It re-explores
BLUEPRINT § Apps (agreed 2026-09-28), which said an app *contains* pages and
automations; here the page **is** the app. Earlier rulings were set aside
while exploring, on purpose.

Everything below is the user's idea unless marked **(Claude)**.

## The foundation

- **A page is an app with a UI**: a person chooses which activities to run.
- **An automation is an app with no UI**: what runs is decided in advance.
- Both rest on the same thing: activities from the model.

## The simplest app

A page given a record automatically gets that record's workflow activities to
run. That is the simplest possible app, and out of the box it is the
workbench.

## Activities

- **Narrowing**: an app may narrow its record's activities, at the page level.
- **App-only activities**: an app may add activities that are not in its
  record type's workflow, so the workflow is not cluttered with them. They
  still run against the app's record and are recorded in its history.
- **An activity pool**: activities move out of workflows into a pool at
  solution level. A workflow references activities from the pool, and so can
  an app. This also lets record types share an activity, such as "change postal
  address" on customers, suppliers and employees.
- **(Claude)** This is how attributes already work: pooled, and referenced per
  activity with settings for that use. Activities are stored inside their
  workflow today (`sdm_workflows.def`); the table comment already says splitting
  them out is "a migration with no API change".
- **(Claude)** A shared activity needs fields to fill on each record type. The
  plain exact-key match works across types when field keys are the same; an
  attribute naming its field in full (`rt_x.field`) ties it to one type.
- Activity id naming (`act_<verb>_<plural>`) no longer fits a shared activity.
  A tidy-up, not a design question.

## Every run belongs to a record

Kept as a firm rule. Where an app has no natural record, the platform supplies
a system record type, `rt_sys_apps`, and the app's **instance** is a record of
it. Activities run on it create, update and delete nothing on it; they only
leave history. Real changes happen in hooks on other records.

All of an app's runs pile onto that one record's history. Managed with data
retention.

## Instances

- **A page and an app are the same thing**: the definition, authored and
  published.
- **An instance** is that app set up and ready to use, with its own
  configuration. One operation may run several instances of one app, for
  example a scheduling app for the sewer group and another for the water group.
- Publishing the page updates every instance. An instance's configuration can
  be changed on its own.
- Some of what a page holds today, such as roles, may move to the instance.
- **Configuration is one `json` field** on `rt_sys_apps`, so every instance
  record has the same fields and each app decides what goes inside. It is edited
  in the Console only, never in the workbench.
- **The instances are the operation's menu.** A menu item already names the
  page, a label and roles, and lives on the operation (`operations.config.menu`);
  add configuration and it is an instance.
- **Every app has an instance**, even though most apps will have only one: the
  same pattern everywhere.
- **(Claude)** App and instance repeat solution and operation one level down: a
  published definition, and something linked to it with settings of its own.

## What a run carries

- **An instance and a record.** A page with its own record (a shift report) runs
  against that record; a page without one runs against the instance record.
- **(Claude)** The instance tells the server which app a run came from, and its
  roles say who may use it.
- **(Claude)** With no page record, leave the record off entirely and let the
  server use the instance record, rather than sending the same id twice. This
  works most cleanly if the instance *is* its `rt_sys_apps` record, its id the
  record id.
- **(Claude)** The instance implies the page and the operation, so today's
  `?operation=&page=&record=` could become `?instance=&record=`.

## The page keeps its record type

`PageDef.record` already stores it. It stays on the page, because the page's
components and expressions are written against that type's fields.
`rt_sys_apps` holds only what varies per instance.

**(Claude)** `instances: 'one'` (find or create the page's record when it
opens) becomes redundant, because the instance record now does that job.
`'many'` (the record id in the URL) stays.

## Open, to work through as they come up

1. **Activity pool**: which parts live on the pooled activity and which on the
   workflow's reference to it (`show_condition`, hooks, order, roles).
2. **App-only activities**: the server must check that the caller may use the
   instance the run names, because the app is what makes those activities
   allowed.
3. **The instance in two places**: the menu item on the operation, and the
   `rt_sys_apps` record. One has to be the source of truth. (Claude leans
   toward the record, with the menu item pointing to it.)
4. **The solution's default menu**: presumably the starting instances for a
   new operation.
5. **How configuration gets used**: passed to the page, read server-side, or
   both. **(Claude)** Probably both, since hooks and GETs run on the server; it
   could be supplied the way scope is, so no script names its instance.
6. **Creating and changing instances** are themselves activities, which clashes
   with "no create or update" on `rt_sys_apps`.
7. **A `json` field type**: new, since no field type holds a free-form value
   today (`composite` has a shape fixed by the model). The app checks the
   values against its own declared settings.
8. **Automations**: not explored beyond the foundation.
