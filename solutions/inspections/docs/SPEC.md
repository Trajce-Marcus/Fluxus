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

Between Start Inspection and Finish Inspection the inspector records
**findings**. A finding says: in this area, at this location, there was this
defect (or none), with photos and comments. The inspector reports on every area
inspected, whether it had defects or not.

**Add Finding** is one form, not one question per screen. The questions, in
order:

1. **Inspection area** — one of the areas list.
2. **Location** — free text, e.g. "Bedroom 1".
3. **Any defects?** — a true / false dropdown for now; a yes/no control later.
4. **Defect** — only when true, and then required. A search dialog listing
   **only the defects mapped to the chosen area**. A defect already picked stays
   picked if the area changes (the platform's picker does not clear it), so
   Add Finding and Update Finding **refuse a defect not mapped to the area**.
5. **Category** — only when true, and then required. One of the defect
   categories (Major defect, Minor defect, Safety hazard); the inspector
   chooses, because the same defect can be either (a hairline crack and a
   10 mm crack are both cracking).
6. **Photos** — any number, with or without a defect.
7. **Comments / notes** — with or without a defect.

A finding can be reopened and changed (**Update Finding**) or deleted
altogether (**Remove Finding**, a button on its row) until the inspection is
finished — the report is still being compiled, so a removed finding leaves no
trace. Several
defects in the same area and location are several findings.

**Every area needs at least one finding** before the inspection can be
finished, even if it is "no defects".

The job's findings show as a list on the job page — a `RecordList` to start.

## Master data

Four lists and two mappings, used by the walk-through. **Each sample-data file
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
- **Defect categories** — Major defect, Minor defect, Safety hazard (AS 4349.1),
  each with its meaning.
- **Code references** — code clauses with an extract of their text.
- **Area ↔ defect** — which defects can be recorded in which area. Drives the
  defect list in Add Finding.
- **Defect ↔ code reference** — which clauses relate to which defect. Used by the
  report, later.

## Record types

### `rt_jobs`

| Attribute | Type | Notes |
| --- | --- | --- |
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
| `inspector` | text | the inspector's name, typed in; one per job |
| `instructions` | text, multiline | |
| `access` | text, multiline | captured at Start Inspection |
| `weather` | text | captured at Start Inspection |
| `checklist` | text, multiline | captured at Start Inspection; a brief pre-start checklist |
| `declaration_confirmed` | text | `true` / `false` (dropdown); captured at Finish Inspection |

### `rt_findings`

| Attribute | Type | Notes |
| --- | --- | --- |
| `job` | ref → `rt_jobs` | |
| `area` | ref → `rt_inspection_areas` | |
| `location` | text | |
| `has_defect` | text | `true` / `false` (dropdown) |
| `defect` | ref → `rt_defects` | blank when no defect |
| `category` | ref → `rt_defect_categories` | blank when no defect |
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
| `act_schedule_jobs` | Schedule | UPDATE | date/time, inspector's name, instructions | Accepted or Scheduled | Scheduled |
| `act_start_jobs` | Start Inspection | UPDATE | access, weather, checklist | Scheduled | In Progress |
| `act_finish_jobs` | Finish Inspection | UPDATE | declaration confirmed (must be `true`) | In Progress, and every area has a finding | Inspected |
| `act_list_jobs` | — | GET | — | — | — |

Schedule is rerun to reschedule. Quote is rerun to change the price. Create's
hook sets `job_type` to "Pre-Purchase Inspection".



**Finish Inspection needs a finding for every area** — at least one finding on
the job for each unexpired record in the areas list, "no defects" findings included. The
before hook checks it and its refusal names the areas still missing.

### `wf_findings`

| Activity | Display name | Kind | Captures | Allowed when |
| --- | --- | --- | --- | --- |
| `act_add_findings` | Add Finding | CREATE | job, area, location, any defects, defect, category, photos, comments | the job is In Progress |
| `act_update_findings` | Update Finding | UPDATE | the same, except job | the job is In Progress |
| `act_remove_findings` | Remove Finding | DELETE | — | the job is In Progress |
| `act_list_findings` | — | GET | for one job | — |

- **The job is filled from the page** — Add Finding's `job` takes the Job
  page's record (`source: 'context.page.record.id'`, as the projects
  solution's WBS create does). The list's own add button cannot fill it. A
  CREATE has no anchor record, so "the job is In Progress" is checked by the
  before hook against the job named, not by a show condition.
- **Area** is a reference whose datasource is `act_search_inspection_areas`.
- **Defect** is a reference whose datasource is `act_search_area_defects`: the
  defects mapped to `attributes.area`, filtered by the search `term`. It shows
  only when any defects is `true`, and is then required; so is category.
- **Category** is a reference whose datasource is `act_search_defect_categories`.
- **The before hook refuses** a defect not mapped to the area. Only the
  mapping's expiry is checked, never the area's or the defect's own
  (2026-10-11): a record's own expiry matters only when mappings are put
  together.
- **Remove Finding** is the platform's delete: it asks for confirmation, then
  the finding and its history go, leaving no trace.
- **Expired master data:** the defect search offers only unexpired defects
  through unexpired mappings. The "defect not mapped to the area" refusal
  applies only when the area or defect is being changed, so an old finding
  whose defect has since expired can still be updated.
- **Defect and category are cleared** by the hook when any defects is `false`,
  so a finding that changes its answer does not keep a stale defect.

### Master data workflows

Areas, defects, defect categories and code references each get the same four,
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

**Ignored for now** (2026-10-10). No activity checks a role in this build.
When roles come back: activities have no role setting, so each check goes in
the activity's show condition, and the Inspector needs read access to jobs,
findings, areas, defects and the area mapping, or Add Finding's pickers will
not open.

## Pages

1. **Jobs** — list of jobs (address, customer, status, scheduled date,
   inspector), with a button for Create Pre-Purchase Job. The way in, and the
   only place a job is created. A row opens the Job page.
2. **Job** — header with address and status; the job's activities; its
   details; its findings as a `RecordList` (area order, area, location, defect,
   category, photo count), with an Add Finding button, and Update Finding and
   Remove Finding on each row. A row opens the Finding page. **Findings show in
   the order entered**; clicking the Area order heading sorts them by area,
   again reverses, and a third click returns to the order entered.
3. **Finding** — one finding with its photos (`Photos`).

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

**Menu** (the solution's default menu): Jobs, then the six data pages.

## Decided while writing

Claude's calls, approved by the user 2026-10-10:

- Quote rerun after acceptance changes the price but **not the status** — a
  re-quote does not undo an acceptance.
- Schedule is allowed from Accepted or Scheduled only; once started, a job is
  not rescheduled.
- Codes are unique; the display fields above.
- One verb for edits: `update`.
- The ids in this spec are approved as written.

## Built — Part 1

Built 2026-10-10 into Neon dev by three scripts in `packages/server/scripts/`:
`inspections-model.ts` (solution `inspections`, operation `inspections-dev`,
the model), `inspections-pages.ts` (ten pages and the default menu) and
`inspections-sample-data.ts` (the sample-data files and eight invented jobs at
every Part 1 stage, all through activities; no photos).

**Known gap — the Runtime menu.** With sign-in on, the Runtime shows a menu
item only to someone holding one of its roles, even when the solution declares
none. Roles are ignored for now, so the menu items list none and the Runtime
falls back to its plain list of pages. Raised, not worked around.

## Out of this spec

- **Prefilling** the next finding's area and location from the previous one,
  and the category from the defect's default. Wanted later. Needs a platform
  addition: a question's starting value from an expression. None exists.
- **A signature** at Finish Inspection — a confirmation stands in for now.
- **Cards** for findings in place of the `RecordList`.
- **Picking the inspector from a list.** For now the name is typed in. A form
  cannot list the operation's users — users are platform data, not records, and
  no datasource reaches them — so a pick list needs either a list of inspectors
  kept as records in the solution, or a platform addition that offers the
  operation's users with a role.
- **Refining the master data** — more defects, their default categories, and
  how code references are cited for an existing house.
- **The report** — producing it is [Part 2](#part-2--after-inspected). Its
  sections 11–16 (Conclusion, Property and Inspection Information, Access and
  Restrictions, Timber Pest Findings, Conducive Conditions, Overall Assessment)
  are in neither part; they come later.
- **Timber pest** findings.
- Mandatory and Independent Stage Inspections.

## Open

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

- **The payment reference** the customer is asked to use — job number,
  address or something else. Records have no human-readable number today.
- **Photos in the PDF.** The converter has to reach them: short-lived links or
  embedded in the HTML. Settled in the PDF service's spec.
- **Where the template is stored** in the solution — see *The report*.
- **Saving the PDF from the server.** The uploads ledger and the storage limit
  count only files captured by an activity — part of the server-side file save
  addition.
