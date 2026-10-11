# Inspections — Spec

Drafted 2026-10-04. Living document. Covers **Pre-Purchase Inspection** only,
built in two parts:

- **Part 1 — up to Inspected.** Job intake, quote, scheduling, the walk-through
  and Finish Inspection. Everything from *The job's life* to the Part 1 *Open*
  list.
- **Part 2 — after Inspected** (added 2026-10-10). The inspector's review, the
  report as a PDF, the payment request, recording payment and emailing the
  report. See [Part 2](#part-2--after-inspected). Part 2 needs platform
  additions that Part 1 does not.

> Record type, attribute and activity ids below are **proposals**, not endorsed
> names. They need a pass before anything is authored in the Console.

## What it is

A system for a small Melbourne building-inspection firm to run domestic
inspections and record what they find. Scope is conducting the inspection and
capturing its findings. Requests for quote are out; a quote is recorded as a
price only. Billing is out beyond Part 2's payment request and payment record.

It is a test of how Fluxus goes, not a move into the inspection-software
market. Hello Inspections (pre-purchase) and PermAssist (mandatory inspections)
do similar things; this does not copy them.

Only the firm's own people use it. Clients never sign in.

## Job types

Every engagement is **one job**, whatever its type. Stages and re-inspections,
when they come, are separate records under the job.

| Job type | Client | Who may inspect | This spec |
| --- | --- | --- | --- |
| Pre-Purchase Inspection | the buyer | anyone — no licence needed | **yes** |
| Mandatory Stage Inspection | the building surveyor | a registered inspector | later |
| Independent Stage Inspection | the owner | a registered inspector | later |

## The job's life

| Status | Reached by |
| --- | --- |
| Requested | Create Pre-Purchase Job |
| Quoted | Quote |
| Accepted | Accept Quote |
| Scheduled | Schedule |
| In Progress | Start Inspection |
| Inspected | Finish Inspection |
| Cancelled | Cancel Job — from any status before Inspected |

Status changes only through the activities' hooks.

## The walk-through

Between Start Inspection and Finish Inspection the inspector records what they
found, in **two levels** (2026-10-12, the user's design):

- an **area inspection** — one area at one location, and what came of
  inspecting it (its **outcome**), with photos and comments about the area as a
  whole;
- under it, the **findings** — one defect each, with its own photos and
  comments.

So three defects in Bedroom 1 are one area inspection with three findings,
rather than Bedroom 1 typed three times. Until 2026-10-12 a finding held both
(area, location, access, "any defects?" and one defect); the levels were split
and the old findings deleted with the sample jobs, by the user's call.

**Add Area Inspection** (from the Job page's Findings tab) asks, in order:

1. **Inspection area** — one of the areas list.
2. **Location** — free text, e.g. "Bedroom 1".
3. **Outcome** — Inspected – defects, Inspected – no defects, Cannot inspect or
   Not applicable. It replaces the old Access and "Any defects?" questions.
   **Not applicable** is an area the property does not have (no garage, a
   subfloor on a slab), so that Finish's every-area rule can be met without
   calling it inspected or uninspectable.
4. **Restriction** — shown for every outcome except Not applicable; **required
   for Cannot inspect**, optional for the two Inspected outcomes (an area
   inspected only partly). A pick list: Furniture and belongings, Stored goods,
   Vehicles, Insulation, Ducting, Low clearance, Height or safety, Vegetation,
   Locked or no key, No access hatch, Wet or slippery surfaces.
5. **Photos** and 6. **Comments** — about the area as a whole.

**Add Finding** (from the Area Inspection page) asks:

1. **Defect** — required. A search dialog listing **only the defects mapped to
   the area inspection's area**; the before hook also refuses one that is not.
2. **Category** — required. Major defect or Minor defect; the inspector
   chooses, because the same defect can be either (a hairline crack and a
   10 mm crack are both cracking).
3. **Safety hazard** — required; true / false. **Separate from the category**
   (2026-10-11): a minor defect can also be a safety hazard.
4. **Photos** and 5. **Comments**.

Findings can be added only to an area inspection whose outcome is **Inspected
– defects**, and while it has findings its outcome and area cannot be changed
and it cannot be removed — remove the findings first.

Timber pest items — evidence of termite damage, borers, timber in contact with
soil — are **ordinary defects** in the defects list, mapped to areas and
recorded like any other (2026-10-11). The firm does not do timber pest
inspections, so there is no separate checklist.

Area inspections and findings can be changed (**Update …**) or deleted
altogether (**Remove …**, a button on each row) until the inspection is
finished — the report is still being compiled, so a removed one leaves no
trace.

**Every area needs at least one area inspection** before the inspection can be
finished, whatever its outcome.

## Starting the inspection and the assessment

Added 2026-10-11, for the report's Property and Inspection Information,
Conclusion and Overall Assessment.

**Start Inspection** captures, on site: access, weather and the pre-start
checklist. **Inspection Details** (consolidated 2026-10-11) holds everything
else about the visit, in one place: the **property facts**, entered whenever
they are known — the footings or the age are often not known at the door —
and corrections to access, weather and the checklist (optional there). It is
rerunnable while the inspection is in progress. The property facts:

| Fact | Answer |
| --- | --- |
| Building type | House, Unit, Townhouse, Apartment |
| Construction | Brick veneer, Double brick, Weatherboard, Clad frame, Rendered, Mud brick, Other |
| Roof cladding | Concrete tiles, Terracotta tiles, Metal sheet, Slate, Other |
| Footings | Concrete slab, Stumps, Strip footings, Other |
| Storeys | a number |
| Approximate year built | a number, optional |
| Occupied | true / false |
| Furnished | Unfurnished, Partly furnished, Fully furnished |
| People present | free text, optional |
| Water, electricity, gas connected | true / false each, optional |
| Signs of concealed defects | true / false, optional, with a note |

The answer lists are fixed for now; any of them can become master data later.
The required facts are building type, construction, roof cladding, footings,
storeys, occupied and furnished.

**Assessment** records the inspector's judgement, rerunnable while the
inspection is in progress:

| Question | Answer |
| --- | --- |
| Major defects, compared with similar homes | Low, Typical, High |
| Minor defects, compared with similar homes | Low, Typical, High |
| Overall condition | Below average, Average, Above average |
| Overall assessment | free text |

**Finish Inspection refuses** until the Assessment is done and the required
property facts are filled in. An activity cannot be made mandatory as such —
whether it ran is told by the answers it saved — so this is the check.

The defect **counts** — major, minor, safety hazards — are worked out from the
findings, never entered. A finding recorded before 2026-10-11 with the expired
"Safety hazard" category counts as a safety hazard.

## Master data

Five lists and two mappings, used by the walk-through. **Each sample-data file
is a record type with its own page**, and that page is where the data is
entered and maintained. Sample data is in [sample-data/](sample-data/).

**Nothing here is deleted — it expires.** Findings point at this data, so every
record (the mappings included) carries an `expires_on` date. From that date it
is no longer offered in any picker and no longer counts, but it stays, with its
history, and old findings and reports still show it. A blank date never
expires; clearing the date brings a record back. The date is set through the
record's Update activity.

- **Inspection areas** — the ten walk-through areas: Site, Roof and Gutter, Hot
  Water System, Exterior, Garage - Carport, Stairs - Pergola - Balconies - Decks,
  Interiors, Bathroom(s), Kitchen & Laundry, Roof Void.
- **Defects** — anything observable on a walk-through, each with a default
  category.
- **Defect categories** — Major defect and Minor defect, each with its meaning.
  "Safety hazard" was a category until 2026-10-11 and is now **expired**:
  safety is its own flag on a finding. Old findings keep it as history.
- **Access restrictions** — *reversed 2026-10-11, no longer master data.* They
  were built as their own record type and page; the user had asked for a pick
  list, and a record type holding only names was more than the job needed. They
  are now a pick list on the finding (Add Finding, question 4), changed by
  editing the model in the Console. The four findings that had one were given
  the reason's name in place of the record's id; their history keeps the id
  entered at the time.
- **Code references** — code clauses with an extract of their text.
- **Area ↔ defect** — which defects can be recorded in which area. Drives the
  defect list in Add Finding.
- **Defect ↔ code reference** — which clauses relate to which defect. Used by the
  report, later.

## Inspectors

Added 2026-10-11. The people who can be scheduled to a job, kept as records:
name, email, start date and finish date.

- **The email is how the platform knows the inspector.** The person signed in
  is known only by the email they sign in with, so an inspector record matches
  whoever signs in with its email. It is typed in and **not checked** against
  the operation's users (the user's call, 2026-10-11: too much building for
  now). A mistyped email means the inspector simply matches nobody.
- **One inspector per email** — Create and Update Inspector refuse an email
  another inspector has.
- **Current** inspectors — started, and not yet at their finish date — are the
  ones offered when scheduling. From the finish date they are no longer offered,
  the same reading as an expiry date (and the same mid-morning effect, *Open*).
  Inspectors are never deleted.

## Record types

### `rt_inspectors`

| Attribute | Type | Notes |
| --- | --- | --- |
| `name` | text | |
| `email` | text | the email they sign in with; unique |
| `start_date` | date | offered for scheduling from this date |
| `finish_date` | date | no longer offered from this date; blank: still working |

### `rt_jobs`

| Attribute | Type | Notes |
| --- | --- | --- |
| `job_no` | text | **J-0001**, J-0002… set by Create's hook (2026-10-11), never typed or edited; jobs created before it were numbered directly in the database, in creation order |
| `job_type` | text | always "Pre-Purchase Inspection" for now — set by Create's hook |
| `status` | text | see *The job's life* |
| `customer_name` | text | |
| `customer_email` | text | required at intake; Part 2 emails the customer at it |
| `address` | text | |
| `details` | text, multiline | |
| `notes` | text, multiline | |
| `quoted_amount` | decimal, 2 places | |
| `quote_notes` | text, multiline | |
| `cancel_reason` | text, multiline | |
| `scheduled_at` | datetime | |
| `inspector` | ref → `rt_inspectors` | one per job; picked from the current inspectors (typed in as a name until 2026-10-11) |
| `instructions` | text, multiline | |
| `access` | text, multiline | captured at Start Inspection |
| `weather` | text | captured at Start Inspection |
| `checklist` | text, multiline | captured at Start Inspection; a brief pre-start checklist |
| `building_type`, `construction`, `roof_cladding`, `footings` | text (pick list) | captured at Start Inspection |
| `storeys`, `year_built` | int | captured at Start Inspection |
| `occupied`, `water_connected`, `electricity_connected`, `gas_connected`, `concealment` | text, `true` / `false` | captured at Start Inspection |
| `furnished` | text (pick list) | captured at Start Inspection |
| `people_present`, `concealment_note` | text | captured at Start Inspection |
| `major_incidence`, `minor_incidence`, `overall_condition` | text (pick list) | captured by Assessment |
| `overall_assessment` | text, multiline | captured by Assessment |
| `declaration_confirmed` | text | `true` / `false` (dropdown); captured at Finish Inspection |

### `rt_area_inspections` (2026-10-12)

| Attribute | Type | Notes |
| --- | --- | --- |
| `job` | ref → `rt_jobs` | taken from the Job page |
| `area` | ref → `rt_inspection_areas` | |
| `location` | text | |
| `outcome` | text (pick list) | Inspected – defects / Inspected – no defects / Cannot inspect / Not applicable |
| `restriction` | text (pick list) | required for Cannot inspect; cleared for Not applicable |
| `photos` | photo, multi | |
| `comments` | text, multiline | |

Read by Admin and Inspector, as findings are.

### `rt_findings` (one defect each since 2026-10-12)

| Attribute | Type | Notes |
| --- | --- | --- |
| `area_inspection` | ref → `rt_area_inspections` | taken from the Area Inspection page |
| `defect` | ref → `rt_defects` | |
| `category` | ref → `rt_defect_categories` | |
| `safety_hazard` | text | `true` / `false` |
| `photos` | photo, multi | |
| `comments` | text, multiline | |

### `rt_inspection_areas`

| Attribute | Type | Notes |
| --- | --- | --- |
| `code` | text | `A01` |
| `name` | text | |
| `sequence` | int | report order |

### `rt_defects`

| Attribute | Type | Notes |
| --- | --- | --- |
| `code` | text | `D01` |
| `name` | text | |
| `description` | text, multiline | |
| `default_category` | ref → `rt_defect_categories` | |

### `rt_defect_categories`

| Attribute | Type | Notes |
| --- | --- | --- |
| `name` | text | |
| `meaning` | text, multiline | |

### `rt_code_references`

| Attribute | Type | Notes |
| --- | --- | --- |
| `code` | text | `R01` |
| `source` | text | e.g. NCC 2025 Housing Provisions |
| `clause` | text | e.g. 11.3.4 |
| `title` | text | |
| `extract` | text, multiline | |
| `attribution` | text | required wording for CC BY material |
| `link` | text | |

### `rt_area_defects`

| Attribute | Type | Notes |
| --- | --- | --- |
| `area` | ref → `rt_inspection_areas` | |
| `defect` | ref → `rt_defects` | |

### `rt_defect_code_references`

| Attribute | Type | Notes |
| --- | --- | --- |
| `defect` | ref → `rt_defects` | |
| `code_reference` | ref → `rt_code_references` | |

**Every master-data record type** (areas, defects, categories, code
references, both mappings) also has `expires_on` (date, blank = never).

**Display fields** — what shows when a record points at another: a job shows
its `address`; an area, a defect and a category their `name`; a code
reference its `code`.

**Codes are unique** — creating or updating an area, defect or code reference
with a `code` already in use is refused.

**True / false** is a `list` attribute of `true` and `false`, stored as text,
the way existing solutions do it.

## Workflows

### `wf_jobs`

| Activity | Display name | Kind | Captures | Allowed when | Status after |
| --- | --- | --- | --- | --- | --- |
| `act_create_jobs` | Create Pre-Purchase Job | CREATE | customer name, customer email (required), address, details, notes | only where there is no record — the Jobs page | Requested |
| `act_quote_jobs` | Quote | UPDATE | quoted amount, quote notes | not Cancelled or Inspected | Quoted from Requested; otherwise unchanged |
| `act_accept_jobs` | Accept Quote | UPDATE | — | Quoted | Accepted |
| `act_cancel_jobs` | Cancel Job | UPDATE | reason (required) | not Cancelled or Inspected | Cancelled |
| `act_schedule_jobs` | Schedule | UPDATE | date/time, inspector (a current inspector, from `act_search_inspectors`), instructions | Accepted or Scheduled | Scheduled |
| `act_start_jobs` | Start Inspection | UPDATE | access, weather, checklist | Scheduled; the assigned inspector or an Admin | In Progress |
| `act_update_jobs` | Inspection Details | UPDATE | the property facts; access, weather, checklist (optional) | In Progress; the assigned inspector or an Admin | unchanged |
| `act_assess_jobs` | Assessment | UPDATE | major incidence, minor incidence, overall condition, overall assessment | In Progress; the assigned inspector or an Admin | unchanged |
| `act_finish_jobs` | Finish Inspection | UPDATE | declaration confirmed (must be `true`) | In Progress; the assigned inspector or an Admin; every area has a finding, the Assessment is done, and the required property facts are filled in | Inspected |
| `act_summarise_findings` | — | GET | job | — | — (one line of counts for the Job page) |
| `act_list_jobs` | — | GET | — | — | — (every job for an Admin; otherwise only the jobs assigned to the signed-in inspector) |

Schedule is rerun to reschedule. Quote is rerun to change the price. Create's
hook sets `job_type` to "Pre-Purchase Inspection" and the **job number**: the
count of jobs, the new one included, padded to four digits. Jobs are never
deleted, so the count only grows.



**The inspection steps are the assigned inspector's or an Admin's** (ruled and
built 2026-10-11). Start Inspection, Inspection Details, Assessment, Finish
Inspection and the three finding actions run only for the inspector the job is
assigned to — matched on the email they sign in with, ignoring case — or a
holder of `role_admin`:
`'role_admin' in context.user.roles or lower(<job>.inspector.email) = lower(context.user.email)`.
It is part of each action's availability condition, so the server neither
offers nor runs it for anyone else
([ACTIONS_OFFERED_BY_SERVER](../../../docs/ACTIONS_OFFERED_BY_SERVER.md)). Two
exceptions: Add Finding is a CREATE, which runs with no record, so its before
hook checks the job named and refuses with "Only the inspector assigned to this
job, or an Admin, can add findings."; and Update Finding and Remove Finding are
buttons on the findings list's rows, which are not asked about — they still
show to others, and the server refuses them when clicked. Applied live by
`scripts/inspections-assigned-inspector.ts`, one activity at a time.

**Finish Inspection needs an area inspection for every area** — at least one
on the job for each unexpired record in the areas list, whatever its outcome
(2026-10-12; a finding for every area before). The before hook checks it and
its refusal names the areas still missing.

### `wf_area_inspections` (2026-10-12)

| Activity | Display name | Kind | Captures | Allowed when |
| --- | --- | --- | --- | --- |
| `act_add_area_inspections` | Add Area Inspection | CREATE | job, area, location, outcome, restriction, photos, comments | the job is In Progress; the job's assigned inspector or an Admin |
| `act_update_area_inspections` | Update Area Inspection | UPDATE | the same, except job | the job is In Progress; the job's assigned inspector or an Admin |
| `act_remove_area_inspections` | Remove Area Inspection | DELETE | — | the job is In Progress; the job's assigned inspector or an Admin; no findings |
| `act_list_area_inspections` | — | GET | for one job, with each one's finding count | — |

- **The job is filled from the page** — Add Area Inspection's `job` takes the
  Job page's record (`source: 'context.page.record.id'`). A CREATE has no
  anchor record, so "the job is In Progress" and "the assigned inspector or an
  Admin" are checked by the before hook against the job named. Its availability
  condition is `context.record is null`, so it is not offered among an area
  inspection's own actions.
- **Cannot inspect needs a restriction** (before hook); **Not applicable
  clears it** (after hook).
- **While it has findings** (`context.record.findings.count > 0`), Update
  refuses a change of outcome away from Inspected – defects or a change of
  area, and Remove refuses outright.
- **The finding count** in the list comes from a named function,
  `findingCount(areaInspection)`: a `select` names the row's fields, not the
  row, so a reverse reference cannot be written there.

### `wf_findings`

| Activity | Display name | Kind | Captures | Allowed when |
| --- | --- | --- | --- | --- |
| `act_add_findings` | Add Finding | CREATE | area inspection, defect, category, safety hazard, photos, comments | the job is In Progress; the job's assigned inspector or an Admin; the outcome is Inspected – defects |
| `act_update_findings` | Update Finding | UPDATE | defect, category, safety hazard, photos, comments | the job is In Progress; the job's assigned inspector or an Admin |
| `act_remove_findings` | Remove Finding | DELETE | — | the job is In Progress; the job's assigned inspector or an Admin |
| `act_list_findings` | — | GET | for one area inspection | — |
| `act_summarise_findings` | — | GET | job | — (one line of counts for the Job page) |

- **The area inspection is filled from the page** — Add Finding's
  `area_inspection` takes the Area Inspection page's record. Its checks are in
  the before hook, against the area inspection named; its availability
  condition is `context.record is null`, as for Add Area Inspection.
- **Update Finding carries the area inspection hidden** (`show_condition:
  'false'`), filled from the finding, so the defect picker knows which area's
  defects to offer. A hidden question is not submitted.
- **Defect** is a reference whose datasource is `act_search_area_defects`: the
  unexpired defects mapped, by unexpired mappings, to the area inspection's
  area, filtered by the search `term`.
- **Category** is a reference whose datasource is `act_search_defect_categories`.
- **The before hook refuses** a defect not mapped to the area. Only the
  mapping's expiry is checked, never the area's or the defect's own
  (2026-10-11). On Update it applies only when the defect is being changed, so
  an old finding whose defect has since expired can still be updated.
- **Remove** is the platform's delete: it asks for confirmation, then the
  record and its history go, leaving no trace.

### `wf_inspectors`

| Activity | Display name | Kind | Captures |
| --- | --- | --- | --- |
| `act_create_inspectors` | Create Inspector | CREATE | name, email, start date (required); finish date |
| `act_update_inspectors` | Update Inspector | UPDATE | the same |
| `act_list_inspectors` | — | GET | — (every inspector, finished included — the page) |
| `act_search_inspectors` | — | GET | search term (current only — the Schedule picker) |

### Master data workflows

Areas, defects, defect categories and code references
each get the same four,
e.g. for defects:

| Activity | Display name | Kind | Captures |
| --- | --- | --- | --- |
| `act_create_defects` | Create Defect | CREATE | its attributes |
| `act_update_defects` | Update Defect | UPDATE | its attributes, and expires on |
| `act_list_defects` | — | GET | — (every record, expired included — the page) |
| `act_search_defects` | — | GET | search term (unexpired only — pickers) |

The two mappings get the same three, e.g. for area ↔ defect:

| Activity | Display name | Kind | Captures |
| --- | --- | --- | --- |
| `act_create_area_defects` | Add Area Defect Mapping | CREATE | area, defect |
| `act_update_area_defects` | Update Area Defect Mapping | UPDATE | expires on |
| `act_list_area_defects` | — | GET | — |

- **Adding** refuses a mapping that already exists and has not expired.
- **No deletes** anywhere in the master data — see *Master data*.
- **Pickers offer only unexpired records**: each picker names its type's
  `act_search_*` GET, which leaves out records whose `expires_on` has passed.
  The page lists name `act_list_*` and show everything, with the expiry date
  as a column.
- **Pickers:** area → `act_search_inspection_areas`, a mapping's defect →
  `act_search_defects`, code reference → `act_search_code_references`,
  category → `act_search_defect_categories`.

`act_search_area_defects` returns the defects mapped to an area, filtered by a
search term — the Add Finding defect dialog.

## Roles

**Being set up by the user in the Console** (2026-10-11). The platform is now
strict — a solution with no roles shows nothing (BLUEPRINT, *Access*) — so
until roles exist the operation shows nothing in the Runtime. For each role:
the record types it may read (Inspectors need jobs, findings, inspection areas,
defects, defect categories and the area mapping, or Add
Finding's pickers will not open), the pages it may open (Page Access), the
menu items it sees, and the users who hold it (the operation's Users screen).
Actions follow the page; one is restricted further only in its availability
condition.

## Pages

1. **Jobs** — list of jobs (job number, address, customer, status, scheduled
   date, inspector), with a button for Create Pre-Purchase Job. The way in, and the
   only place a job is created. A row opens the Job page.
   **An Admin sees every job; anyone else only the jobs assigned to them**
   (2026-10-11) — the jobs whose inspector has the email they signed in with,
   ignoring capital letters, as the inspection steps do. The filter is in the list's GET, so it holds on the server. It is the list
   only: a job opened by a link still shows, until read conditions are built
   ([RECORD_READ_CONDITIONS](../../../docs/RECORD_READ_CONDITIONS.md)).
2. **Job** — always at the top: the header (job number and address; customer
   and status), a
   **summary line of counts** ("Major defects: 3 · Minor defects: 5 · Safety
   hazards: 1"), the job's activities, and a **tab strip** that shows one
   section at a time (2026-10-11):
   - **Job** — customer, email, address, details, notes, quote, schedule,
     inspector, instructions, cancel reason.
   - **Inspection** — access, weather, checklist and the property facts
     (Start Inspection and Inspection Details), the Assessment, and the
     declaration.
   - **Findings** — an Add area inspection button, and the job's area
     inspections as a `RecordList` titled Area inspections (No. — the area's
     order, area, location, outcome, restriction, how many findings, photos)
     with Update and Remove on each row and Open to its Area Inspection page.
     **They show in the order entered**; clicking the No. heading sorts them by
     area. The tab keeps the name Findings (the user's call, 2026-10-12).

   Part 2's report and payment details will most likely be a fourth tab.
3. **Area Inspection** (2026-10-12) — the area, location, outcome,
   restriction, comments and photos, its actions, then an Add finding button and its findings as a `RecordList` (defect, category, safety
   hazard, photos) with Update, Remove and Open on each row.
4. **Finding** — one defect with its photos (`Photos`).

   Neither page links back up (2026-10-12, the user's call): the header's back
   arrow does it.

One page per sample-data file — the source of that data:

| Data file | Page | On it |
| --- | --- | --- |
| inspection_areas.csv | **Inspection Areas** | list (code, name, order); create; update per row |
| defects.csv | **Defects** | list (code, name, default category); create; update per row |
| defect_categories.csv | **Defect Categories** | list (name, meaning); create; update per row |
| code_references.csv | **Code References** | list (code, source, clause, title); create; update per row; a row opens the Code Reference page |
| — | **Code Reference** | one code reference, with its full extract, attribution and link |
| area_defects.csv | **Area Defect Mappings** | list (area, defect); add; update per row |
| defect_code_references.csv | **Defect Code Reference Mappings** | list (defect, code reference); add; update per row |

Every data page's list shows the expiry date as a column.

**Inspectors** — list (name, email, start date, finish date); create; update per
row. No expiry column: inspectors finish instead.

When Schedule became a pick list (2026-10-11), the seven jobs with "Nick
Petrovski" typed in were pointed at his inspector record, written directly;
their history keeps the typed name. His start date, 2026-10-04, was Claude's
choice — the day the solution started, before any of his jobs.

**Menu** (the solution's default menu): Jobs, Inspectors, then the six data
pages. Built 2026-10-11 with the access the user had set up for the others: the
Inspectors page and its menu item are Admin's; Admin and Inspector read
inspectors (an inspector's Job page shows the inspector's name).

## Decided while writing

Claude's calls, approved by the user 2026-10-10:

- Quote rerun after acceptance changes the price but **not the status** — a
  re-quote does not undo an acceptance.
- Schedule is allowed from Accepted or Scheduled only; once started, a job is
  not rescheduled.
- Codes are unique; the display fields above.
- (2026-10-11) The property-fact and assessment answer lists; storeys and year
  built as numbers; utilities as three true/false answers (a script cannot join
  a list into words for display).
- (2026-10-11) Finish Inspection requiring the Assessment and the required
  property facts.
- (2026-10-11) The finding's access field was `area_access`, because `access`
  is already the job's free-text access note. Replaced by the area
  inspection's `outcome` (2026-10-12).
- (2026-10-12) While an area inspection has findings, its outcome cannot move
  off Inspected – defects and its area cannot change — its findings were
  recorded against both.
- (2026-10-11) The summary line counts by category **name** ("Major defect",
  "Minor defect"), so renaming a category breaks it.
- (2026-10-11) No spec review for this change, by the user's decision — a small
  adjustment to what is built; the cold test still runs.
- One verb for edits: `update`.
- The ids in this spec are approved as written.

## Built — Part 1

Built 2026-10-10 (revised 2026-10-11) into Neon dev by three scripts in `packages/server/scripts/`:
`inspections-model.ts` (solution `inspections`, operation `inspections-dev`,
the model), `inspections-pages.ts` (ten pages and the default menu) and
`inspections-sample-data.ts` (the sample-data files and ten invented jobs at
every Part 1 stage, all through activities; no photos).

**Two levels, 2026-10-12** — applied live by `inspections-area-inspections.ts`
(one transaction: the old jobs and findings deleted with their reporting rows,
then the model per entity, then the Job, Area Inspection and Finding pages,
the Job page keeping the user's own layout). The sample jobs were then
reloaded, as the Console login (an Admin), by `inspections-sample-data.ts`.

**Known gap — the Runtime menu.** With sign-in on, the Runtime shows a menu
item only to someone holding one of its roles, even when the solution declares
none. Roles are ignored for now, so the menu items list none and the Runtime
falls back to its plain list of pages. Raised, not worked around.

## Out of this spec

- **Prefilling** a finding's category from the defect's default (the area and
  location no longer repeat — they are the area inspection's). Wanted later. Needs a platform
  addition: a question's starting value from an expression. None exists.
- **A signature** at Finish Inspection — a confirmation stands in for now.
- **Cards** for findings in place of the `RecordList`.
- **Refining the master data** — more defects, their default categories, and
  how code references are cited for an existing house.
- **The report** — producing it is [Part 2](#part-2--after-inspected). Its
  structure is not settled. What is settled (2026-10-11): sections 14 Timber
  Pest Findings and 15 Conducive Conditions are **dropped** (the firm does no
  timber pest inspections); Conclusion and Overall Assessment come from the
  Assessment and the counts; Property and Inspection Information from Start
  Inspection; Access and Restrictions from the area inspections' outcome and
  restriction.
- **Recommendations per finding** — not wanted (2026-10-11); advice goes in the
  comments.
- **Cost estimates** — none.
- **Timber pest inspections** (AS 4349.3) — not offered; timber pest defects are
  ordinary defects.
- Mandatory and Independent Stage Inspections.

## Open

- **Expiry takes effect mid-morning, not at midnight** (found 2026-10-11).
  Scripts compare dates in UTC, so a record with an expiry date of 11 October
  stops being offered at 11:00 on 11 October in Melbourne (10:00 outside
  daylight saving). The platform has no operation time zone for a script to
  ask. Raised as a platform gap, not worked around.
- **Code references on old findings.** The report reads a finding's code
  references through the mapping, so changing the mapping later changes what an
  old report would cite. Whether a finding keeps its own copy.
- **Loading the sample data** — entered through the admin activities; how to
  bulk-load it is not settled. Nothing may be seeded.

---

## Part 2 — after Inspected

Added 2026-10-10. Builds on Part 1 unchanged except where *Changes to Part 1*
says otherwise. Ids are proposals, as above.

Part 2 needs four platform additions, recorded as direction in the blueprint
([Documents and email](../../../docs/BLUEPRINT.md#documents-and-email--direction-agreed-2026-10-10)):
real email delivery with attachments, a service that turns an HTML template
into a PDF, a service saving a file onto a record from the server, and a page
component that opens a file saved on a record. None is built. Each needs its
own platform spec before Part 2 is built.

### The job's life, continued

| Status | Reached by |
| --- | --- |
| Inspected | Finish Inspection (Part 1), or Reopen Report |
| Report Ready | Finalise Report |
| Awaiting Payment | Send Report Ready |
| Paid | Record Payment |
| Cancelled | Cancel Job — from any status except Cancelled and Paid |

### The steps

1. **Review — status stays Inspected.** The inspector reviews their own report.
   Findings can still be added and changed (Add Finding, Update Finding).
2. **Finalise Report → Report Ready.** The after hook gathers the job and its
   findings, fills the job type's report template, has it turned into a PDF and
   saves the PDF on the job. Changes after this need Reopen Report.
3. **Reopen Report → Inspected.** Allowed in Report Ready and Awaiting Payment.
   The job goes back to review; Finalise Report makes the PDF again. Payment
   can be recorded only once the job is back in Awaiting Payment, so Send
   Report Ready runs again and the customer gets the payment request again —
   even if they have already paid.
4. **Send Report Ready → Awaiting Payment.** A manual step — it never follows
   Finalise Report on its own. Emails the customer that the report is ready and
   that payment is due, with the amount (the quoted amount) and the firm's
   bank details.
5. **Record Payment → Paid.** Captures the amount, the date and a reference. If
   the amount differs from the quoted amount, a reason is required. Once the
   payment is saved, the report is emailed to the customer with the PDF
   attached.

**When an email fails**, nothing is built for it, and the failure may not show
anywhere a person looks — some failures reach only the server log. Follow-up is
human: a customer who does not receive an email calls, and an admin downloads
the PDF from the job and sends it from their own email.

### Emails

Both come from the firm's no-reply address (`sender_email` on the firm details
record), on the firm's own domain. The firm adds the email provider's DNS
records to its domain once.

| Sent by | To | Says | Attachment |
| --- | --- | --- | --- |
| Send Report Ready | `customer_email` | the report for the address is ready; the amount due; BSB, account number and account name; how to pay | — |
| Record Payment | `customer_email` | payment received; the report is attached | the job's `report` |

Both are `queue`d in the after hook, so they go only once the activity's
changes are saved. Exact wording is settled when built.

### The report

- **The template belongs to the solution**, not to an operation: HTML and CSS
  with Handlebars placeholders, written by hand. Claude writes the first one
  once the model exists in the Console. It lives in the database, never in the
  repo. **How a solution stores it is open** — records belong to operations, so
  a template is a new kind of solution content, a platform decision.
- **Operation-specific details** — firm name, BSB, account — come from the
  operation's firm details record and are passed in with the data.
- **The data** Finalise Report passes: the job's attributes, the firm details,
  and its findings
  grouped by area in the areas' `sequence` order, each with location, defect
  name, category, comments, photos and the defect's code references (through
  the defect ↔ code reference mapping).
- **The content** for now is the job details and the findings by area.
  Sections 11–16 come later.
- **The PDF** is saved on the job's `report` attribute, replacing any earlier
  one.

### Record types — Part 2

`rt_jobs` gains:

| Attribute | Type | Notes |
| --- | --- | --- |
| `report` | file, single, PDF | set by Finalise Report |
| `amount_paid` | decimal, 2 places | captured at Record Payment |
| `paid_on` | date | captured at Record Payment |
| `payment_reference` | text | captured at Record Payment |
| `payment_difference_reason` | text, multiline | required when `amount_paid` ≠ `quoted_amount` |

#### `rt_firm_details`

One record, maintained by the firm.

| Attribute | Type | Notes |
| --- | --- | --- |
| `firm_name` | text | |
| `sender_email` | text | the no-reply address emails come from |
| `bsb` | text | |
| `account_number` | text | |
| `account_name` | text | |

#### Report template — solution content, not a record type

| Holds | Notes |
| --- | --- |
| job type | which job type it is for — Pre-Purchase Inspection |
| name | |
| body | HTML and CSS with Handlebars placeholders |

### Workflows — Part 2

#### Changes to Part 1

| Activity | Was allowed when | Now allowed when |
| --- | --- | --- |
| `act_cancel_jobs` Cancel Job | not Cancelled or Inspected | not Cancelled or Paid |
| `act_add_findings` Add Finding | the job is In Progress | the job is In Progress or Inspected |
| `act_update_findings` Update Finding | the job is In Progress | the job is In Progress or Inspected |
| `act_remove_findings` Remove Finding | In Progress | In Progress or Inspected |
| `act_update_jobs` Inspection Details | In Progress | In Progress or Inspected |
| `act_assess_jobs` Assessment | In Progress | In Progress or Inspected |
| `act_quote_jobs` Quote | not Cancelled or Inspected | not Cancelled, Inspected, Report Ready, Awaiting Payment or Paid |

#### `wf_jobs` gains

| Activity | Display name | Kind | Captures | Allowed when | Status after |
| --- | --- | --- | --- | --- | --- |
| `act_finalise_jobs` | Finalise Report | UPDATE | — | Inspected | Report Ready |
| `act_reopen_jobs` | Reopen Report | UPDATE | — | Report Ready or Awaiting Payment | Inspected |
| `act_notify_jobs` | Send Report Ready | UPDATE | — | Report Ready | Awaiting Payment |
| `act_pay_jobs` | Record Payment | UPDATE | amount, date, reference, difference reason | Awaiting Payment | Paid |

- **Finalise Report** refuses when there is no template for the job's type.
  If the PDF conversion fails, the job stays Inspected and its history keeps
  the Finalise Report entry with nothing changed — the platform's normal
  handling of a failed after hook, accepted as is.
- **Send Report Ready** refuses when there is no firm details record.
- **Record Payment**'s before hook refuses when the amount differs from
  `quoted_amount` and no reason is given; the refusal names the quoted amount.

#### Firm details

The same three as the master data: `act_create_firm_details`,
`act_modify_firm_details`, `act_list_firm_details`.

### Roles — Part 2

Ignored for now, as in Part 1. The split below applies when roles come back.

| Role | Runs |
| --- | --- |
| Admin | everything below, and firm details |
| Inspector | Add Finding and Update Finding while Inspected, Finalise Report, Reopen Report |

Send Report Ready and Record Payment are Admin only.

### Pages — Part 2

- **Job** — opens the report through the new file component, and shows the
  payment details always — blank until paid.
  The new activities appear with the job's other activities.
- **Firm details** — the one record, with modify.

### Decided while writing — check these (Part 2)

Claude's calls, not discussed:

- Add Finding, as well as Update Finding, is allowed during review.
- Quote is not allowed from Inspected on — the price is fixed once the report
  exists.
- Send Report Ready and Record Payment are Admin only.
- The sender address sits on the firm details record.
- A template is chosen by the job's type.
- Reopen Report keeps the old PDF until Finalise Report replaces it.

### Out of Part 2

- Report sections 11–16.
- Anything built for failed emails — handled by hand.
- Sending Report Ready automatically.
- A page used as the report template — templates are hand-written HTML.

### Open — Part 2

- ~~The payment reference~~ — settled 2026-10-11: the **job number**.
- **Photos in the PDF.** The converter has to reach them: short-lived links or
  embedded in the HTML. Settled in the PDF service's spec.
- **Where the template is stored** in the solution — see *The report*.
- **Saving the PDF from the server.** The uploads ledger and the storage limit
  count only files captured by an activity — part of the server-side file save
  addition.
