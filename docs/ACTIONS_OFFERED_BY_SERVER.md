# Actions offered by the server — spec

**Status:** spec, not built. Agreed 2026-10-11 (BLUEPRINT *Access*, "the server
decides which actions are offered"); found while building the inspections
assigned-inspector checks. Claude's three proposals were settled by the user the
same day (*Settled*, at the end). Cold-reviewed 2026-10-11; the findings are
folded in below (*Review*, at the end), and the user approved them.

## What this changes, in one paragraph

Today the browser decides which of a record's actions to draw, by evaluating
each action's availability condition itself, and the server evaluates the same
condition again when the action runs. After this change the server answers
which actions a record offers the signed-in user, evaluated with the real user,
and the browser draws only those. The browser stops receiving actions'
availability conditions. A form's own question conditions stay in the browser,
because they react to typing, and the server still checks every action when it
runs.

## Rulings this spec rests on (user, 2026-10-11)

- **The server decides everything about data and permission; the browser draws
  what it is given.** Easier to show safe: only the server needs auditing.
- **Action availability moves to the server first.** The user's wider aim is
  that the server does more of the work before a page reaches the browser, for
  needs not identified yet.
- **Form question conditions stay in the browser.** They react as the user
  types; the server repeats the check when the form is submitted.

## 1. Today, and why it fails

| Where | What decides | With which user |
| --- | --- | --- |
| A page's Actions (`RecordActivities`) | the browser: `ComponentContainer.listActivities` takes the record (the page's own, or fetched) and runs `availableActivities` (`page-runtime/src/availableActivities.ts`) | none — page expressions are built without a user (`pageHost.ts`), so the engine's placeholder applies (`DEMO_USER`: no email, no roles) |
| The Console workbench's actions and its create button | the browser: `engine.isActivityAvailable` (`WorkbenchContext.tsx`, `AvailableActivities.tsx`, `RecordsGrid.tsx`) | the signed-in designer, with roles stubbed empty (`console/.../workbench/WorkbenchView.tsx`) |
| Running an action | the server: the availability gate in `runActivity` | the real user, with email and roles |

In the Runtime, a condition about the user — "the assigned inspector", "an
Admin" — is false in the browser for everyone, so the button is never drawn
although the server would allow the action. In the workbench a condition about
a role is false for everyone the same way.

## 2. The change

### 2.1 The server answers which actions are offered

One new server call, **`page.activities`** (the user's name). `page` is a new
group of calls for what the server prepares for a page — the user's wider aim —
and is separate from `pages`, which holds page definitions. The Console
workbench calls it too, although it is not a page.

- **Asks** for a list of items, each either a **record** (`{ recordId }`) or a
  **record type** (`{ typeId }`, the actions offered with no record yet — what
  the workbench's create button needs).
- **Answers**, for each item in the same order, the actions offered — id and
  display name — in the workflow's order.
- **The rule** moves to the engine (`engine.offeredActivities`) so the server
  owns it:
  - **For a record:** the candidates are its record type's workflow, **GETs
    excluded**. A CREATE is a candidate like any other action (ruled
    2026-09-28), and its condition sees **the record it is shown on** as
    `context.record` — today's page behaviour. A CREATE still *runs* with no
    record, so the run gate sees null; the offer and the run differ here on
    purpose. It is what lets `context.record is null` keep a create action off
    a record's own page — every inspections create action relies on it.
  - **For a record type:** the candidates are its workflow's **CREATEs only**,
    each condition evaluated with `context.record` null — exactly what the run
    gate sees. No read check, as a CREATE's run has none today (BLUEPRINT
    *Access*).
  - An action with no condition is offered.
  - Otherwise its condition must be **strictly `true`**, evaluated by the
    engine's `activityAvailabilityAsync` with the **signed-in user** (email
    and roles).
  - A condition that errors hides its action and is logged — it fails closed,
    as the run gate does.
- **Not quite today's browser rule.** The browser accepted any non-empty
  answer; the server accepts only `true`. The browser also let a condition see
  page information (`context.page`, `context.app`) and call `invoke`; the
  server gives it what the run gate gives — `context.user`, `context.record`,
  `context.activity`, `records`, services and named functions. Measured on the
  live model 2026-10-11: no activity condition uses page information or a
  named function, and every one answers true or false, so nothing changes
  today.
- **A record the caller may not read** answers an empty list, never an error
  that tells it apart from a missing record. The check is the one
  `activities.run` applies to its record today, so read conditions, when
  built, apply here too. An unknown record type answers an empty list too.
- **Batched** so a list can ask for all its rows at once later. The first users
  ask for one item at a time.

### 2.2 The browser asks instead of deciding

- **Client:** `FluxusClient.pageActivities(items)` for the call.
- **Runtime pages and the Console page preview:** `ComponentContainer`'s
  `listActivities` asks the server instead of taking the record and
  evaluating. `RecordActivities` draws what comes back.
- **Asking again after a run is explicit.** Today it happens as a side effect
  of the page re-reading its record. After this change `listActivities`
  depends on the page's run counter (`refreshTick`, bumped whenever any
  component's run lands), so the actions list asks again after every run.
- **Console workbench:** `AvailableActivities` and `RecordsGrid`'s create
  button ask the server, so there is one rule everywhere.
  - The record panel **keeps leaving CREATEs out**, as today
    (page-runtime SPEC): it runs an action with the record, which the server
    refuses for a CREATE.
  - The create button asks with the record type and uses the first CREATE
    offered, as today.
  - Both become asynchronous: nothing is drawn until the answer arrives. They
    ask again whenever the workbench's data refreshes (after every run).
  - `isActivityAvailable` leaves the workbench context.
  - The workbench now answers with the designer's real roles in the chosen
    operation — the same user check `records.partition` already applies.
- **`availableActivities.ts`** leaves the page runtime; its rule now lives in
  the engine (2.1). The engine's immediate availability functions
  (`activityAvailability`, `isActivityAvailable`) lose their last callers and
  are removed; the waiting ones stay — the run gate uses them.

### 2.3 The browser stops receiving actions' conditions

- The client's copy of the model (`projectConfig`, `server/src/projection.ts`)
  drops each activity's `show_condition`. `ClientActivityRawDef` loses the
  field; the server's full model (`ActivityRawDef`) keeps it.
- Named functions that only those conditions used stop being shipped
  (`shippedExpressions` no longer counts them). Measured 2026-10-11: no live
  activity condition calls a named function, so nothing stops shipping.
- The Console's design plane is unchanged: designers get the whole model
  (`config.get`) and edit conditions as now.

### 2.4 Unchanged

- A form's question conditions, validation and dropdown datasources run in the
  browser.
- The server's availability gate when an action runs, and its answers.
- What `activities.run` and `activities.query` return.

## 3. What it makes possible

- **Conditions about the user work in the Runtime.** For the inspections
  assigned-inspector checks (the assigned inspector or an Admin):
  - **Start Inspection, Inspection Details, Assessment and Finish Inspection**
    go straight into availability conditions: the button is hidden from others
    and the run is refused for them, from one rule.
  - **Update Finding and Remove Finding** are buttons on the findings list's
    rows, which are not checked against availability (§4): they still show to
    others, and the same condition refuses them when run.
  - **Add Finding** is a CREATE, which runs with no record, so its check goes
    in its before hook against the job named.
- **More server work before the page**, as needs appear.

## 4. Not in this spec

- **Page display expressions still see the placeholder user.** A page showing
  `{{ context.user.name }}` shows "Demo User" in the Runtime. A separate, small
  fix; nothing needs it yet.
- **Action buttons in a list's rows** (`RunActivity` columns in `RecordList`)
  are not checked against availability today: they show, and the server
  refuses when run. Unchanged; the batched call can serve them later.
- **Read conditions** — [RECORD_READ_CONDITIONS](RECORD_READ_CONDITIONS.md).
- **File links** — `files.presignGet` gives a link for any file key without a
  record check. A known gap, separate.

## 5. Cost

One request each time a page shows a record's actions. Today the common case —
the page's own record — costs none, since the browser already holds it and
evaluates locally; a record other than the page's is fetched. The server
evaluates with the request's record cache (`DatabaseStore`), one condition
after another, so conditions following the same reference read it once.

## 6. Build list

1. **Engine:** `engine.offeredActivities(activities, record)` — the rule of
   2.1 over a workflow's activities and an optional record, beside
   `activityAvailabilityAsync`; `ActivityOption` (id, name) moves to the
   engine. `activityAvailability` and `isActivityAvailable` removed.
2. **Server:** `page.activities` — `{ operationId, items }`, the read check of
   `activities.run`'s record; the caller's user resolved as for every
   operation call.
3. **Client:** `FluxusClient.pageActivities(items)`.
4. **Page runtime:** `listActivities` asks the server and depends on
   `refreshTick`; `availableActivities.ts` removed with its tests moved to the
   engine.
5. **Workbench:** `AvailableActivities` and the create button ask the server
   and ask again on every data refresh; `isActivityAvailable` leaves the
   context.
6. **Projection:** activity `show_condition` no longer shipped;
   `ClientActivityRawDef` without it; the projection tests say so.
7. **Docs:** server, client, page-runtime, workbench, runtime and engine SPECs;
   CLIENT_TRUST_BOUNDARY (*What the client is given*, the activities row);
   RECORD_READ_CONDITIONS §4 (a sixth place the read check applies);
   BLUEPRINT *Access* (direction → built).

## 7. Tests

- An action whose condition names the user: offered to that user, not to
  another — and refused to the other when run.
- An action whose condition names a role: offered only to holders.
- No condition: offered. A condition that errors: hidden and logged. A
  condition answering anything but `true`: hidden.
- GETs never offered; workflow order kept.
- A CREATE asked about with a record: its condition sees that record
  (`context.record is null` hides it).
- A record type with no record: only its CREATEs, with `context.record` null.
- A record the caller may not read: an empty list, the same as a missing id.
- Several items in one call: each answered on its own.
- The client model carries no activity `show_condition`; question conditions
  still there.
- Runtime page: the Actions list shows what the server answered, and asks
  again after a run. Workbench: the actions and the create button follow the
  server.

## Settled

Claude's proposals, each decided by the user on 2026-10-11:

- **The call is `page.activities`** — the user's name, in place of Claude's
  `activities.available`.
- **An unreadable record answers an empty list** — approved.
- **The Console workbench switches too** — approved.

## Review

Cold review, 2026-10-11. Claude's resolutions, approved by the user the same
day ("make the changes and start building"):

- A CREATE asked about with a record sees that record (today's page
  behaviour); asked about with a record type, only CREATEs, with no record.
- The workbench record panel keeps leaving CREATEs out.
- "Unchanged from today's browser rule" corrected: strictly `true`, and no
  page information — no live condition affected.
- Asking again after a run made explicit (`refreshTick`; workbench data
  refresh).
- The engine's immediate availability functions removed.
- §3 corrected: only four inspections actions get a hidden button.
- Docs added to the build list; cost line corrected.
