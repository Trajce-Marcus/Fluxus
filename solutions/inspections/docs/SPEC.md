# Inspections — Spec

Drafted 2026-10-04. Living document. Covers **Pre-Purchase Inspection** only.

> Record type, attribute and activity ids below are **proposals**, not endorsed
> names. They need a pass before anything is authored in the Console.

## What it is

A system for a small Melbourne building-inspection firm to run domestic
inspections and record what they find. Scope is conducting the inspection and
capturing its findings. Requests for quote and billing are out; a quote is
recorded as a price only.

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
3. **Any defects?** — yes / no.
4. **Defect** — only when yes. A search dialog listing **only the defects mapped
   to the chosen area**. Changing the area clears a defect already picked.
5. **Category** — only when yes. Major defect, minor defect or safety hazard;
   the inspector chooses, because the same defect can be either (a hairline
   crack and a 10 mm crack are both cracking).
6. **Photos** — any number, with or without a defect.
7. **Comments / notes** — with or without a defect.

A finding can be reopened and changed (**Update Finding**) until the inspection
is finished. Several defects in the same area and location are several
findings.

**Every area needs at least one finding** before the inspection can be
finished, even if it is "no defects".

The job's findings show as a list on the job page — a `RecordList` to start.

## Master data

Three lists and two mappings, maintained by an admin, used by the walk-through.
Sample data is in [sample-data/](sample-data/).

- **Inspection areas** — the ten walk-through areas: Site, Roof and Gutter, Hot
  Water System, Exterior, Garage – Carport, Stairs – Pergola – Balconies – Decks,
  Interiors, Bathroom(s), Kitchen & Laundry, Roof Void.
- **Defects** — anything observable on a walk-through, each with a default
  category.
- **Code references** — code clauses with an extract of their text.
- **Area ↔ defect** — which defects can be recorded in which area. Drives the
  defect list in Add Finding.
- **Defect ↔ code reference** — which clauses relate to which defect. Used by the
  report, later.

## Record types

### `rt_jobs`

| Attribute | Type | Notes |
| --- | --- | --- |
| `job_type` | text | Pre-Purchase Inspection (the other two later) |
| `status` | text | see *The job's life* |
| `customer_name` | text | |
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
| `declaration_confirmed` | bool | captured at Finish Inspection |

### `rt_findings`

| Attribute | Type | Notes |
| --- | --- | --- |
| `job` | ref → `rt_jobs` | |
| `area` | ref → `rt_inspection_areas` | |
| `location` | text | |
| `has_defect` | bool | |
| `defect` | ref → `rt_defects` | blank when no defect |
| `category` | text | Major defect / Minor defect / Safety hazard; blank when no defect |
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
| `default_category` | text | Major defect / Minor defect / Safety hazard |

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

## Workflows

### `wf_jobs`

| Activity | Display name | Kind | Captures | Allowed when | Status after |
| --- | --- | --- | --- | --- | --- |
| `act_create_jobs` | Create Pre-Purchase Job | CREATE | customer name, address, details, notes | always | Requested |
| `act_quote_jobs` | Quote | UPDATE | quoted amount, quote notes | not Cancelled or Inspected | Quoted from Requested; otherwise unchanged |
| `act_accept_jobs` | Accept Quote | UPDATE | — | Quoted | Accepted |
| `act_cancel_jobs` | Cancel Job | UPDATE | reason (required) | not Cancelled or Inspected | Cancelled |
| `act_schedule_jobs` | Schedule | UPDATE | date/time, inspector's name, instructions | Accepted or Scheduled | Scheduled |
| `act_start_jobs` | Start Inspection | UPDATE | access, weather, checklist | Scheduled | In Progress |
| `act_finish_jobs` | Finish Inspection | UPDATE | declaration confirmed (must be yes) | In Progress, and every area has a finding | Inspected |
| `act_list_jobs` | — | GET | — | — | — |

Schedule is rerun to reschedule. Quote is rerun to change the price.

**Finish Inspection needs a finding for every area** — at least one finding on
the job for each record in the areas list, "no defects" findings included. The
before hook checks it and its refusal names the areas still missing.

### `wf_findings`

| Activity | Display name | Kind | Captures | Allowed when |
| --- | --- | --- | --- | --- |
| `act_add_findings` | Add Finding | CREATE | job, area, location, any defects, defect, category, photos, comments | the job is In Progress |
| `act_update_findings` | Update Finding | UPDATE | the same, except job | the job is In Progress |
| `act_list_findings` | — | GET | for one job | — |

- **The job reaches Add Finding as a declared attribute** — a control on the job
  page fills it (the "add a child here" mechanism). A CREATE has no anchor
  record, so "the job is In Progress" is checked by the before hook against the
  job named, not by a show condition.
- **Defect** is a reference whose datasource names a GET returning the defects
  mapped to `attributes.area`, filtered by the search `term`. It shows only when
  any defects is yes; so does category, which is then required.
- **Defect and category are cleared** by the hook when any defects is no, so a
  finding that changes its answer does not keep a stale defect.

### Master data workflows

Each of the five admin record types gets the same three, e.g. for defects:

| Activity | Kind | Captures |
| --- | --- | --- |
| `act_create_defects` | CREATE | its attributes |
| `act_modify_defects` | UPDATE | its attributes |
| `act_list_defects` | GET | — |

The area ↔ defect GET (`act_list_area_defects`) takes an area and a search term
and returns defects — it is what the Add Finding defect dialog names.

## Roles

| Role | Runs |
| --- | --- |
| Admin | everything on jobs, and all master data |
| Inspector | Start Inspection, Add Finding, Update Finding, Finish Inspection |

A person may hold both.

## Pages

1. **Jobs** — list of jobs, with Create Pre-Purchase Job. The way in.
2. **Job** — header with status; the job's activities; its details; its
   findings as a `RecordList` with Add Finding (filling the job) and Update
   Finding on each row.
3. **Finding** — one finding with its photos (`Photos`).
4. **Inspection areas**, **Code references** — lists with create and modify.
5. **Defects** — list with create and modify.
6. **Defect** — one defect, with two lists: the areas it applies to and its code
   references, each with add and remove. The mappings are maintained here.

## Decided while writing — check these

Claude's calls, not discussed:

- Quote rerun after acceptance changes the price but **not the status** — a
  re-quote does not undo an acceptance.
- Schedule is allowed from Accepted or Scheduled only; once started, a job is
  not rescheduled.
- Category is a fixed set of three, not its own record type.
- The role split in *Roles*.
- Mappings are maintained from the Defect page rather than from pages of their
  own.

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
- **The report** — sections 11–16 (Conclusion, Property and Inspection
  Information, Access and Restrictions, Timber Pest Findings, Conducive
  Conditions, Overall Assessment) and producing it. A report as a document (a
  PDF to email) is a platform gap: Fluxus has no document output.
- **Timber pest** findings.
- Mandatory and Independent Stage Inspections.

## Open

- **Retiring master data.** A defect in use by findings cannot be deleted (the
  platform refuses while anything points at it). Whether retiring one needs an
  `active`-style flag the lists filter on.
- **Code references on old findings.** The report reads a finding's code
  references through the mapping, so changing the mapping later changes what an
  old report would cite. Whether a finding keeps its own copy.
- **Loading the sample data** — entered through the admin activities; how to
  bulk-load it is not settled. Nothing may be seeded.
- Record type, attribute and activity ids need endorsement.
