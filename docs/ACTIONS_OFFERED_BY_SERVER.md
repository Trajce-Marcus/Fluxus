# Actions offered by the server — spec

**Status:** spec, not built. Agreed 2026-10-11 (BLUEPRINT *Access*, "the server
decides which actions are offered"); found while building the inspections
assigned-inspector checks. Ready for cold review. Three choices are Claude's
proposals awaiting the user's confirmation (*Decisions to confirm*, at the end).

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
| A page's Actions (`RecordActivities`) | the browser: `ComponentContainer.listActivities` fetches the record and runs `availableActivities` (`page-runtime/src/availableActivities.ts`) | none — page expressions are built without a user (`pageHost.ts`), so the engine's placeholder applies (`DEMO_USER`: no email, no roles) |
| The Console workbench's actions and its create button | the browser: `engine.isActivityAvailable` (`WorkbenchContext.tsx`, `AvailableActivities.tsx`, `RecordsGrid.tsx`) | the browser engine's user |
| Running an action | the server: the availability gate in `runActivity` | the real user, with email and roles |

In the Runtime, a condition about the user — "the assigned inspector", "an
Admin" — is false in the browser for everyone, so the button is never drawn
although the server would allow the action. The Runtime host also builds its
own user with roles stubbed empty (`runtime/src/host.ts`).

## 2. The change

### 2.1 The server answers which actions are offered

One new server call (name a proposal: `activities.available`):

- **Asks** for one or more anchors, each either a **record** (its actions) or a
  **record type with no record yet** (the actions offered with no record — what
  the workbench's create button needs).
- **Answers**, for each anchor, the actions offered — id and display name — in
  the workflow's order.
- **The rule**, unchanged from today's browser rule and moved to the engine so
  the server owns it:
  - the record type's workflow lists the candidates; **GETs are excluded**;
    a CREATE is offered like any other action when its condition allows
    (ruled 2026-09-28);
  - an action with no condition is offered;
  - otherwise its condition must be **strictly `true`**, evaluated by the
    engine's `activityAvailabilityAsync` with the **signed-in user** (email
    and roles) and the record as `context.record`;
  - a condition that errors hides its action and is logged — it fails closed,
    as the run gate does.
- **A record the caller may not read** answers an empty list, never an error
  that tells it apart from a missing record (proposal). The check is the one
  `activities.run` applies to its record today, so read conditions, when
  built, apply here too.
- **Batched** so a list can ask for all its rows at once later. The first users
  ask for one anchor at a time.

### 2.2 The browser asks instead of deciding

- **Client:** a method on `FluxusClient` for the call.
- **Runtime pages and the Console page preview:** `ComponentContainer`'s
  `listActivities` asks the server instead of fetching the record and
  evaluating. `RecordActivities` draws what comes back, and asks again after an
  action runs, as it does now.
- **Console workbench:** `AvailableActivities` and `RecordsGrid`'s create
  button ask the server (proposal: included, so there is one rule everywhere).
  Both become asynchronous: nothing is drawn until the answer arrives.
  `isActivityAvailable` leaves the workbench context.
- **`availableActivities.ts`** leaves the page runtime; its rule now lives in
  the engine (2.1).

### 2.3 The browser stops receiving actions' conditions

- The client's copy of the model (`projectConfig`, `server/src/projection.ts`)
  drops each activity's `show_condition`. `ClientActivityRawDef` loses the
  field; the server's full model keeps it.
- Named functions that only those conditions used stop being shipped
  (`shippedExpressions` no longer counts them).
- The Console's design plane is unchanged: designers get the whole model
  (`config.get`) and edit conditions as now.

### 2.4 Unchanged

- A form's question conditions, validation and dropdown datasources run in the
  browser.
- The server's availability gate when an action runs, and its answers.
- What `activities.run` and `activities.query` return.

## 3. What it makes possible

- **Conditions about the user work in the Runtime.** The inspections
  assigned-inspector checks (Start Inspection, Add Finding, Update Finding,
  Remove Finding, Inspection Details, Assessment, Finish Inspection: the
  assigned inspector or an Admin) go straight into availability conditions:
  the button is hidden from others and the run is refused for them, from one
  rule.
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

One request each time a page shows a record's actions, where today the browser
evaluated locally (in the Runtime it already fetched the record for that). The
server evaluates with the request's record cache (`DatabaseStore`), so
conditions following references read each record once.

## 6. Build list

1. **Engine:** the availability rule of 2.1 as one function over a record type,
   an optional record and the engine's user, beside `activityAvailabilityAsync`.
2. **Server:** the call of 2.1, with the read check of `activities.run`'s
   anchor; the caller's user resolved as for every operation call.
3. **Client:** the method.
4. **Page runtime:** `listActivities` asks the server; `availableActivities.ts`
   removed with its tests moved to the engine.
5. **Workbench:** `AvailableActivities` and the create button ask the server.
6. **Projection:** activity `show_condition` no longer shipped;
   `ClientActivityRawDef` without it; the projection tests say so.
7. **Docs:** server, client, page-runtime, workbench and engine SPECs;
   CLIENT_TRUST_BOUNDARY (*What the client is given*, the activities row);
   BLUEPRINT *Access* (direction → built).

## 7. Tests

- An action whose condition names the user: offered to that user, not to
  another — and refused to the other when run.
- An action whose condition names a role: offered only to holders.
- No condition: offered. A condition that errors: hidden and logged. A
  condition answering anything but `true`: hidden.
- GETs never offered; a CREATE offered when its condition allows; workflow
  order kept.
- A record type with no record: what its conditions allow with
  `context.record` null.
- A record the caller may not read: an empty list, the same as a missing id.
- Several anchors in one call: each answered on its own.
- The client model carries no activity `show_condition`; question conditions
  still there.
- Runtime page: the Actions list shows what the server answered. Workbench:
  the actions and the create button follow the server.

## Decisions to confirm

Claude's proposals; none is ruled yet.

- **The call's name, `activities.available`** (2.1).
- **An unreadable record answers an empty list** rather than an error (2.1).
- **The Console workbench switches too** (2.2), so one rule decides
  everywhere; otherwise the workbench would keep evaluating in the browser,
  where conditions about the user also fail.
