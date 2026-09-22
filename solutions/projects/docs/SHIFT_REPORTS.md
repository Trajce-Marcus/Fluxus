# Shift Reports & Work Groups — spec

**Status: spec, not built** (revised 2026-09-23). The model, the activities,
the pages and the demonstration data are all still to be built. Two things have
happened: the cost codes have been rebuilt in the database (§8a), and the
design below was reworked in discussion on 2026-09-22/23 — §1.1 records what
moved and why.

Started as a site diary for the demo. The discussion changed what is being
built, so the name changed with it: the record is a **shift report**, filed by a
**work group** manager.

## 1. What this is

A site diary was one paper form per day, filled in by one supervisor, read
later, and compiled by hand into defects, delays and costs. The form is still
in use across the industry, now as an app. What has not changed is the shape:
one daily package, one author, and no way to know whether it is complete.

This builds the evolved version:

- **Events are recorded as they happen** — defects, resource usage — each in
  the record type that owns it, not inside a daily document.
- **The shift is the unit** — an interval with one responsible person, not a
  calendar day across a whole site. Large projects run several per day.
- **Responsibility is enumerable** — work groups say who owes a report, so a
  missing report can be *detected* rather than noticed.

The last point is the reason this is worth building. Tracked cost is only as
good as how much of it arrived: if a crew has not filed, the total is wrong and
nothing says so.

### 1.1 What changed during the discussion, and why

From 2026-09-22, before anything was written:

- **Not actual cost.** Actual cost arrives later from invoices, payroll and
  plant charges. A shift report prices the shift at the rates the model holds:
  a tracking figure available the same evening, trued up afterwards. The model
  never writes `actual_cost` from a shift report; the usage figure is
  `tracked_cost`.
- **Resource usage is its own record type**, not lines inside a report. Cost
  tracking depends on it, and a docket or day sheet should be able to write one
  without a report existing.
- **Work group, not supervisor.** One named person per shift report scales to
  one project; several crews on a pipeline spread need one responsible manager
  each.
- **Site diary → shift report.** A diary is a day; a report is a shift and an
  owner.

From 2026-09-23, after the first cold review:

- **There is a resource catalogue after all** (§4.2). The first cut had each
  work group inventing its own resource rows. The catalogue is the proper
  thing, the project needs it, and a work group's standard set is compiled from
  it.
- **Cost codes no longer carry a rate.** §4.7 proposed `unit_rate` on
  `rt_cbs_nodes`. Dropped: a cost code classifies, it does not price — `1300`
  Skilled Wages covers welders, labourers and foremen at three different rates.
  The rate belongs to the resource.
- **A cost code with children holds no amount of its own** (§8a). It is the sum
  of its children. An amount found on a code with children is a data problem,
  not a fallback, and the total ignores it.
- **Two usage record types, not one** (§4.6, §4.7). What a shift consumed, and
  where that cost lands on the WBS, are separate records written at different
  moments.
- **The cost lands at approval, not at submission** — so approval means
  something, and an unapproved report contributes nothing to a total.
- **No WBS-to-cost-code mapping.** It was proposed and dropped: the cost code
  is already on the line, having come from the resource. A WBS node draws on
  several kinds of cost at once, so it cannot classify a cost line.
- **Comparing the standard set against what was used is dropped.** A shift
  report records what happened; the standard set is a shortcut for entering it,
  not a plan to measure against.
- **Times, not hours** (§4.4). The manager enters start and end and the breaks;
  the hours are worked out.

## 2. Core concepts

**Work group** — the unit of responsibility. Cut operationally: welding crew,
earthworks crew, tie-in crew. One manager. A standard set of resources taken
from the catalogue, which is what makes filing fast. Shared plant lives in its
own work group, and other managers draw from it.

**Resource** — a thing that costs money by the hour or the day: a 30t excavator
and operator, a welder, a site ute. Held in a catalogue per project, each
naming the cost code it belongs to.

**Shift report** — one work group, one shift. Times worked and lost, weather,
narrative, photos, the WBS nodes worked on with hours and quantity completed,
and the resources actually used. Filed and approved.

**Resource usage** — what a shift consumed, and separately where that cost
lands on the WBS.

**Defect** — raised from the shift report that found it, with a life of its own
afterwards. It is here as the worked example of a record spawned from another;
delays and safety events follow the same shape and are not built (§11).

## 3. Costing, and what it measures

Cost is **duration-driven on purpose**. The pipeline is always 6 km; whether it
takes three weeks or twelve is where projects are won and lost, and that is
what hours against WBS nodes measure. Schedule slippage and labour productivity
are the most consistently cited overrun drivers, so this is the right primary
signal.

Deliberately excluded, with reasons:

- **Materials** — fixed at order, and a quantity or rate error is an estimating
  problem, not a site one. Chasing dockets into the shift report would be a
  large distraction from the measurement that matters. A materials view, driven
  by committed cost (purchase orders) rather than site capture, is a separate
  build (§11). `MAT` exists as a resource type so the catalogue can hold
  materials; nothing in this build consumes them.
- **Lump-sum subcontracts** — same reasoning: fixed at award. What *does* move
  is variations, and those are captured as resource usage like anything else.
  Day-rate and hired subcontractors work as ordinary work groups.

**Where the cost code comes from.** The manager picks a **WBS node only**. The
cost code comes from the resource, which named it once in the catalogue —
excavator → `4100` Heavy Earthmoving Plant, welder → `1300` Skilled Wages. A
WBS node consumes several kinds of resource at once, so it cannot classify a
usage line; `rt_wbs_nodes.cbs_codes` is a budget-side note and a different
thing, left exactly as it is and read by nothing.

**The cost code is decided once and copied twice.** It is chosen on the
catalogue resource, may be overridden on a work group's row where that group's
use of it is genuinely classified differently, and is then copied onto each
usage record as it is written. Copied rather than followed: reclassifying a
resource next year must not rewrite shifts already filed. The rate follows the
same rule for the same reason.

## 4. The model

Six new record types, one renamed field convention, and nothing added to the
existing three beyond what §8a already did.

### 4.1 `rt_work_groups`

| Field | Type | Notes |
| --- | --- | --- |
| `wg_code` | `text` | `WG-WELD`. Immutable. Unique per project — checked in a hook, not by the field (§10). |
| `parent_id` | `fk_ref` → `rt_work_groups` | Optional. Sub-groups, each with its own manager (§4.1a). Reports are filed against the ones with no children; the parent's manager approves them. |
| `name` | `text` | `Mainline welding crew`. |
| `project_id` | `fk_ref` → `rt_projects` | Taken from the page, never asked for. |
| `manager` | `text` | The person who owes the shift report. |
| `wg_type` | `text` | `Crew` / `Shared plant` / `Subcontractor`. A shared-plant group is drawn from and **files nothing**, so it is never expected to report. |
| `active` | `text` | `'true'` / `'false'`. Closing a group ends the expectation without deleting history. |
| `expired` | `text` | `'true'` / `'false'`, as every existing record type carries. |

### 4.1a Splitting a work group

A work group may hold **sub-groups**: `parent_id` points at the parent, and
shift reports are always filed against a group with no children. The parent's
manager approves what its children file.

The case it is for: one person owns a crew and a complete set of resources, and
that crew works several fronts at once — welding, coating, trenching. Each
front gets its own manager who files its report; the owner oversees and
approves.

Three things the nesting gives that a flat list cannot:

- **One set of resources.** The standard set is held on the parent and drawn on
  by the children. Duplicating it across flat groups lets the same excavator be
  claimed twice.
- **Roll-up.** Cost, hours and who-has-filed aggregate to the parent, so "what
  did this crew cost last week" is a query rather than a new mechanism.
- **One set to maintain**, rather than several that drift apart.

**A `delegate` column on a flat group was considered and rejected.** It is the
same idea spelled smaller — a sub-group's manager *is* the delegate — and it
gives neither sharing nor roll-up, while capping at one delegate per group.

**Granularity is the implementer's dial, not a rule.** On a pipeline, a group
per activity — trenching, welding, coating, tie-ins — maps close to one WBS
node per shift, which makes the split of cost across nodes (§5.1) nearly exact.
Finer groups cost more reports to chase each day. There is no correct cut; the
model carries either.

**Who is expected to file counts only the groups with no children** (§6), so
splitting changes who owes a report without changing the total expectation.

**Not built: a parent-level daily record.** The owner does not file a document
of his own on top of his children's reports. Approving each report gives the
same oversight without a second lifecycle.

**One resource may be claimed only once per shift.** This is a rule with no
field and no check behind it in this build, by decision. It is stated so the
demonstration data obeys it.

### 4.2 `rt_resources` — the catalogue

| Field | Type | Notes |
| --- | --- | --- |
| `code` | `text` | `PLT-EX30`. |
| `description` | `text` | `30t excavator + operator`. |
| `res_type` | `text` | `LAB` / `PLT` / `MAT` / `SUB`. |
| `unit` | `text` | `hr`, `day`. |
| `rate` | `decimal` | The current standard rate. |
| `cbs_id` | `fk_ref` → `rt_cbs_nodes` | **What kind of cost this is.** Named once, here. |
| `project_id` | `fk_ref` → `rt_projects` | Per project for this build (§11 — importing between projects, and shared libraries, come later). |
| `expired` | `text` | |

Changing a resource's `unit` changes what the resource *is* and should not be
allowed. Not enforced in this build; it belongs with resource management later.

### 4.3 `rt_wg_resources` — a work group's standard set

A selection from the catalogue with counts, held on whichever group owns them.
A parent's resources are drawn on by its children (§4.1a), as the shared-plant
group's are.

| Field | Type | Notes |
| --- | --- | --- |
| `wg_id` | `fk_ref` → `rt_work_groups` | Taken from the page. The owner — a group with no children, or a parent whose children draw on it. |
| `resource_id` | `fk_ref` → `rt_resources` | |
| `quantity` | `decimal` | Standard count per shift — 6 welders, 2 sidebooms. |
| `rate` | `decimal` | Optional. Blank means the resource's rate. To be used sparingly — a subcontractor at a negotiated figure. |
| `cbs_id` | `fk_ref` → `rt_cbs_nodes` | Optional. Blank means the resource's cost code. For where this group's use of it is genuinely classified differently. |
| `expired` | `text` | |

### 4.4 `rt_shift_reports`

| Field | Type | Notes |
| --- | --- | --- |
| `report_no` | `text` | `SR-0001`. Immutable. Unique per project — written by a hook (§10). |
| `project_id` | `fk_ref` → `rt_projects` | Taken from the page. |
| `wg_id` | `fk_ref` → `rt_work_groups` | Taken from the page, or chosen by the manager. |
| `report_date` | `datetime` | |
| `shift` | `text` | `Day` / `Night`. A label for grouping; the times below carry the information. |
| `start_time` / `end_time` | `time` | What the manager enters. |
| `break_hours` | `decimal` | Non-work time within the shift — meals, crib. |
| `work_hours` | `decimal` | Worked out: end minus start, less breaks. **This is what prices every resource.** The report's WBS hours must total it. |
| `hours_lost` | `decimal` | Lost to weather or delay. The measurement only — a delay claim is a record of its own (§11). Distinct from breaks. |
| `weather` | `text` | |
| `work_summary` | `text` (multiline) | |
| `site_notes` | `text` (multiline) | |
| `report_photos` | `photo` (`multi`, `max_count: 6`) | Photos of the shift. A defect's photos go on the defect. |
| `status` | `text` | `Draft` → `Submitted` → `Approved`. |
| `approved_by` / `approved_date` | `text` / `datetime` | Written by the Approve activity, available to the parent group's manager (§4.1a). A group with no parent is approved by its own manager. |
| `expired` | `text` | |

An approved report is not editable in this build; a correction is a new report.
Editing one would mean unwinding the cost it has already put on the WBS.

### 4.5 `rt_shift_wbs` — what was worked on

One row per WBS node the work group touched this shift.

| Field | Type | Notes |
| --- | --- | --- |
| `report_id` | `fk_ref` → `rt_shift_reports` | Taken from the page. |
| `wbs_id` | `fk_ref` → `rt_wbs_nodes` | |
| `hours` | `decimal` | Hours on this node. Across the report these total `work_hours`, checked when the report is submitted (§10). |
| `qty_completed` | `decimal` | Quantity done today — metres welded, m³ backfilled. |
| `qty_unit` | `text` | |
| `notes` | `text` | |
| `expired` | `text` | |

### 4.6 `rt_shift_report_resource_usage` — what the shift consumed

Written when the work group is chosen: one row per resource in that group's
standard set, priced at `work_hours`. Confirm, adjust, or remove.

| Field | Type | Notes |
| --- | --- | --- |
| `report_id` | `fk_ref` → `rt_shift_reports` | |
| `resource_id` | `fk_ref` → `rt_resources` | Blank for something added by hand that is not in the catalogue. |
| `description` | `text` | Copied from the resource. |
| `quantity` | `decimal` | `work_hours` × the standard count, adjustable. |
| `unit` / `rate` / `cbs_id` | `text` / `decimal` / `fk_ref` | Copied at the time and never changed afterwards. |
| `wbs_id` | `fk_ref` → `rt_wbs_nodes` | **Normally blank.** Set only to say this one resource sat on one node all shift, in which case its cost is not split (§5.1). |
| `tracked_cost` | `decimal` | `quantity × rate`, written by a hook. Never typed, never written to `actual_cost`. |
| `expired` | `text` | |

### 4.7 `rt_wbs_resource_usage` — where the cost landed

Written when the report is **approved**: each line above, divided across the
report's WBS rows in proportion to their hours. This is the record of cost
against the WBS.

| Field | Type | Notes |
| --- | --- | --- |
| `project_id` | `fk_ref` → `rt_projects` | |
| `report_id` | `fk_ref` → `rt_shift_reports` | |
| `source_line_id` | `fk_ref` → `rt_shift_report_resource_usage` | The line this portion came from. |
| `wbs_id` | `fk_ref` → `rt_wbs_nodes` | **Where the cost lands.** Always set. |
| `cbs_id` | `fk_ref` → `rt_cbs_nodes` | **What kind.** Copied from the line. |
| `usage_date` | `datetime` | |
| `quantity` | `decimal` | This node's share of the line's quantity. |
| `tracked_cost` | `decimal` | This node's share of the line's cost. |
| `expired` | `text` | |

Two record types rather than one, deliberately. A shift report shows six
resource lines, not eighteen; and the record of cost against the WBS holds only
approved figures, so it can be added up without qualification.

### 4.8 `rt_defects`

| Field | Type | Notes |
| --- | --- | --- |
| `defect_no` | `text` | `DEF-001`. Immutable. Unique per project — written by a hook (§10). |
| `project_id` / `wbs_id` | `fk_ref` | Taken from the page / chosen. |
| `report_id` | `fk_ref` → `rt_shift_reports` | Optional — the report that raised it. |
| `raised_date` / `raised_by` | `datetime` / `text` | |
| `location` | `text` | Chainage, joint number, structure. |
| `description` | `text` (multiline) | |
| `severity` | `text` | `Minor` / `Major` / `Critical`. |
| `defect_photos` | `photo` (`multi`) | |
| `assigned_to` | `text` | |
| `rectified_date` / `rectification_notes` | `datetime` / `text` | |
| `verified_date` / `verified_by` | `datetime` / `text` | |
| `status` | `text` | `Open` → `Rectified` → `Closed`. |
| `expired` | `text` | |

### 4.9 Attribute keys

Two of the existing shared attributes cannot be reused:

- **`parent_id`** declares that it points at cost codes. An attribute can name
  only one target, so a work group's parent is a new attribute, `wg_parent`,
  naming the field it fills (`rt_work_groups.parent_id`) exactly as
  `wbs_parent` does. Every new reference attribute follows that spelling.
- **`description`** is single-line, which suits a resource and not a defect. A
  defect gets `def_description`.

An attribute's use by an activity may override where its value comes from,
whether it is shown, whether it is required, and its validation — but not the
attribute's own settings, which is why single-line versus multiline cannot be
varied per use. Extending that was considered and rejected as unnecessary
complexity for now.

Everything else — `project_id`, `code`, `name`, `unit`, `location`, `expired` —
is reused as it stands. The rule of thumb: reuse where you can, create a new
one where you cannot.

## 5. Filing a shift report

1. The manager starts a report and enters the date, start time and end time.
   Total hours follow.
2. Breaks are entered; `work_hours` follows.
3. The work group is chosen. **Its standard resources are written as usage
   lines immediately**, each priced at `work_hours` × its standard count, with
   the rate, unit and cost code copied. Confirm, adjust, or remove; add
   anything used that is not in the set.
4. Add WBS rows: node, hours, quantity completed. Hours must total
   `work_hours`.
5. Add photos, narrative, hours lost.
6. Raise any defects found — each becomes its own record, citing this report.
7. Submit. The report is then read-only.
8. The parent group's manager approves it. **On approval the cost is divided
   across the WBS rows** and written to `rt_wbs_resource_usage`.

Confirm-and-adjust rather than type-from-blank is the point: it is why a
standard set exists. The work group is chosen without checking who the person
filing is; access is not enforced in this build.

### 5.1 How a shift's cost reaches the WBS

**Hours decide the split.** Each usage line's cost is divided across the
report's WBS rows in proportion to their hours: a 10-hour shift with 6 hours on
`3.4` and 4 on `3.5` puts 60% of each line on `3.4` and 40% on `3.5`.

Worked through: six welders at $95 for a 10-hour shift is $5,700 against cost
code `1300`; two sidebooms at $310 is $6,200 against `4100`. The shift consumed
$11,900. Node `3.4` receives $7,140 of it and `3.5` receives $4,760 — and the
cost codes are unaffected by the split, because each line carried its own.

**A per-line exception**: where one resource genuinely sat on one node all
shift while the rest moved, `wbs_id` is set on that line and its cost goes
whole to that node instead of being divided.

**A grid of every resource against every WBS node was designed and dropped.**
It is accurate in principle and unusable in practice: a manager filing at the
end of a shift will not tick a grid, and the common case — a crew working nodes
in sequence — is already right. Where a crew genuinely splits across fronts,
the answer is to split the work group (§4.1a), not to make every report carry a
grid.

**Lost and idle time divides the same way.** It is a resource against an
indirect cost code and it spreads across the shift's WBS rows like anything
else.

**A division by zero is possible** — a report whose WBS hours total nothing —
and the DSL throws rather than returning zero. The approval hook must not
attempt the split when there are no hours.

## 6. Knowing who has not filed

Who owes a report is a query over work group records: active, no children, type
`Crew` or `Subcontractor`, for a project. Shared-plant groups file nothing and
a split group's parent is covered by its children, so neither is expected.

Because cost lands at approval, each expected group is in one of three states
for a date, and they mean different things:

- **nothing filed** — chase the manager;
- **filed, not approved** — chase the approver, and the cost is not in the
  total yet;
- **approved** — counted.

No roster in this build. A roster (which groups work which days, with a "no
work today" escape) is specified in §11 — it makes the expectation
date-accurate and lets the roster's own accuracy be measured, and it is the
first thing to add if this proves useful.

**A missing report is never estimated.** A gap is shown as a gap. Filling it
with an estimate would put an uncorrected number into the totals, which defeats
the reason for showing it at all.

Any total the pages show says how much of it arrived — "3 of 4 reports in, 2
approved" — so a figure is never read as complete when it is not.

## 7. Totals

All worked out when read, nothing stored:

- Tracked cost per WBS node, per cost code, per project, per date range — all
  of them sums over `rt_wbs_resource_usage`, which holds approved figures only.
- Hours per WBS node; quantity completed per WBS node.

The pattern is a GET whose `returns` calls a named function looping with `for
each`; `act_total_cbs_nodes` already does this. `sum` on a query is still
absent. A named function may call itself, and a function called from `select`
receives the outer row — but a query written inline inside `select` silently
binds to the wrong row, so correlation must go through a named function.

**A cost code with children is the sum of its children** (§8a). The three
existing total functions add up every node at every level and must be changed
to count only the codes with no children, so that an amount wrongly left on a
parent is ignored rather than double-counted.

`actual_cost` on the WBS stays empty throughout, because no invoice has
arrived. Showing tracked against actual, with actual blank, is the
demonstration.

## 8. Pages

**Project page** gains three sections: **Work Groups** (with manager and active
state), **Shift Reports** (report no, date, shift, work group, hours, status,
Open), and **Defects** (defect no, raised, WBS, severity, status, Open). Its
existing cost code and WBS lists get `parentKey` set, so they nest instead of
lying flat.

**`pages/shift-report`** — anchored on `rt_shift_reports`. Header (work group,
date, shift, manager), times and hours, photos, WBS rows with hours and
quantity, the shift's resource lines with tracked cost, the shift total, and
defects raised.

**`pages/work-group`** — anchored on `rt_work_groups`. Its standard resources,
its recent shift reports, and a **New shift report** button.

**`pages/defect`** — anchored on `rt_defects`. Details, photos, lifecycle
activities, and a link back to the report that raised it.

**`pages/resources`** — a plain list of the project's catalogue. Nothing more.

**`pages/shift-reports`** — a dashboard. Its centrepiece is the `Contributions`
component, one row per work group and one column per date, green approved,
amber filed but not approved, red nothing filed — so a gap is a hole in a row with
the manager's name beside it. Alongside it: what is submitted and awaiting
approval, what was recently approved, and a way into a report. Three or four
panels; it is expected to change once it is seen.

### 8a. Groundwork — done, and one thing dropped

**The cost codes were rebuilt on 2026-09-23** (`packages/server/scripts/cbs-budgets-to-leaves.ts`,
applied to Neon dev). P26-011's seven top codes held the whole budget and their
twenty children were empty, which is the rule upside down. The children now
carry the amounts, the parents are empty, and the project's approved budget
moved to **40,620,000** — skilled wages and general civil labour were weighted
to dominate, as they do on a pipeline, which took the project past its old
30,000,000. The figures are invented; P26-011 is a demonstration.

**Deleting the junk WBS nodes was dropped.** The 19 test nodes belong to
`P24-042`, `P25-004` and `P25-014`; P26-011's 27 nodes are all real. The list
activity already filters by project and by `expired`, so they cannot appear
where this build looks. They stay until a clean-up is asked for.

### 8b. Build order

The three components come first, each specified, reviewed cold, built and then
tested, before any of the model is written:

1. **The record picker** — `packages/page-runtime/docs/RECORD_PICKER.md`.
   Needed because a page today offers a text box for a record id, and this
   build asks a manager to choose one WBS node out of 46.
2. **The `Contributions` component** — a square per work group per date — `packages/page-runtime/docs/CONTRIBUTIONS.md`.
3. **Photos in a component** — `packages/page-runtime/docs/COMPONENT_PHOTOS.md`.

A fourth was designed and then found to exist: nesting a list under a parent is
`RecordList`'s `parentKey`, built 2026-09-13, and it already sorts within
siblings, draws an orphan as a root, breaks cycles and keeps a search hit's
ancestors visible.

Then the model (record types, attributes, activities), then the pages, then the
demonstration data. Model changes go through the config writers, as the
existing scripts in `packages/server/scripts` do. Demonstration data is written
straight to the records, per the standing ruling: it is a demonstration, not a
history worth auditing.

## 9. Demonstration data

**P26-011 — Cross-Country Steel Pipeline Project**, $40,620,000.

A resource catalogue of roughly fifteen entries, each naming its cost code:
excavators and dozers against `4100`, sidebooms and cranes against `4200`,
utes and water carts against `4300`, welders and operators against `1300`,
supervisors against `1200`, fuel against `3100`, the NDT subcontractor against
`5100`.

Work groups cut per pipeline activity, which is the cut that makes the split of
cost nearly exact:

- `WG-SPREAD` — the mainline spread, manager Hughie. **Parent**, holds the
  crew's standard resources, files nothing, approves what its children file.
  - `WG-TRENCH` — trenching and excavation.
  - `WG-WELD` — mainline welding.
  - `WG-COAT` — field joint coating.
- `WG-TIE` — tie-ins and river crossing. Flat, its own manager and resources.
- `WG-PLANT` — shared plant. Drawn on, files nothing.

Six consecutive working days, day shift. Two clean days, a wet day losing four
hours, a day the NDT subcontractor finds a repair, a heavy backfill day, a
river-crossing tie-in day.

Cost lands on the project's real WBS nodes (`3.1`, `3.2`, `3.4`, `3.5`, `3.6`,
`3.7`, `3.8`, `3.9`, `3.10`) against cost codes `1200`, `1300`, `3100`, `4100`,
`4200`, `4300`, `5100`. Roughly $25k–$40k **per day across all groups**, so
about $190k over six days.

Four groups file each day — the three spread children and `WG-TIE`. Hughie
approves the spread's three; `WG-TIE`'s manager approves their own. Some
reports are left `Submitted` rather than `Approved`, so all three states show
on the grid — and the cost of those reports is deliberately absent from the WBS
totals, which is the point of approval meaning something.

**One crew misses one day's report on purpose** — not the shared-plant group,
which files nothing by design — so the grid shows a real hole with a named
manager.

Three defects in different states — open, rectified awaiting verification,
closed — each raised from the report that found it, each with a photo. Two to
four photos per shift report.

## 10. Rules with no field behind them

Things the model cannot express, handled in hooks or not at all:

- **`report_no` and `defect_no`** are written by the create activity's after
  hook, counting the project's existing records and adding one. It races, and
  it skips a number after a delete. Field-level `unique` is not used, because
  it compares across every record of the type rather than within a project.
- **WBS hours must total `work_hours`** — checked by a `fail()` in the before
  hook on Submit, not as rows are added, because a before hook may only
  validate and there is no `sum`.
- **The fixed lists** — `wg_type`, `res_type`, `shift`, `severity`, both
  `status` sets — are enforced at capture by a `list` attribute naming its
  values. Nothing constrains the stored field, so demonstration data written
  straight to the records must be correct by construction.
- **One resource claimed once per shift** — not enforced (§4.1a).
- **A resource's `unit` never changes** — not enforced (§4.2).

## 11. Specified, not built

- **Sharing resources beyond one project** — importing a catalogue into a
  project, shared libraries, and what a rate change means across projects.
- **Roster** — which work groups work which dates, with a "no work today,
  roster wrong" escape so roster accuracy is itself measurable.
- **Delays** — cause, compensability, notice served, extension of time. The
  contract side is the depth; a toy version teaches the wrong thing. The shift
  report keeps `hours_lost` as a measurement.
- **Safety events** — type, severity, persons, immediate action, notifiable
  flag, investigation, closeout.
- **Subcontractor work orders** — rate cards, work orders as the payable
  document, RCTI instead of subcontractor invoicing.
- **Materials and committed cost** — purchase orders and subcontracts give
  material exposure at order time, weeks before site.
- **Actual cost and reconciliation** — invoices, payroll, plant charges, and
  matching each against the tracked figure it supersedes.
- **Voice capture** — the manager talks, an assistant drafts the report,
  questions what is missing, and the manager checks and signs. Already real in
  the market; a natural fit here because the shift report is structured.

## 12. Notes for later

**Quantity drift.** `qty_completed` accumulated daily will diverge from true
quantity-to-date over a long contract. The answer is periodic re-baselining
against a measured figure — the same method as a stocktake against running
inventory — not correcting each day's entry.

**Photographs.** R2 is configured. A loader must build the descriptor itself:
SHA-256 from `node:crypto`, dimensions from the JPEG header, and a row in the
attachments ledger per photo. `thumb_key` is left out — display falls back to
the full image. Images from Unsplash or Wikimedia Commons, with source and
licence recorded in the loader's header.

**A module, later.** Work groups, resources, shift reports, resource usage and
defects are the same in roads, water and pipelines, and need nothing of a host
solution's model but "which WBS". Modules are not built, so for now these are
record types in the projects solution.
