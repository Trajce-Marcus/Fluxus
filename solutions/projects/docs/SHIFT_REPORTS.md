# Shift Reports & Work Groups — spec

**Status: spec, not built** (2026-09-22). Nothing in the model or the database
changes until this is agreed.

Started as a site diary for the demo. The discussion changed what is being
built, so the name changed with it: the record is a **shift report**, filed by a
**work group** manager. §1.1 records what moved and why.

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
- **Responsibility is enumerable** — work groups say who owes a report, so
  missing data can be *detected* rather than noticed.

The last point is the reason this is worth building. Tracked cost is only as
good as its coverage: if a crew has not filed, the total is wrong and nothing
says so.

### 1.1 What changed during the discussion, and why

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

## 2. Core concepts

**Work group** — the unit of responsibility. Cut operationally: welding crew,
earthworks crew, tie-in crew. One manager. A standard set of resources, which is
what makes filing fast and gives planned-versus-actual for free. Shared plant
lives in its own work group, and other managers draw from it; a resource may be
claimed by only one work group per shift, or it double-counts.

**Shift report** — one work group, one shift. Hours worked and lost, weather,
narrative, photos, the WBS nodes worked on with hours and quantity completed,
and the resources actually used. Filed and signed off by the manager.

**Resource usage** — one resource, one WBS node, one day, with a cost. Written
by the shift report today; by a docket or day sheet later.

**Defect** — raised from the shift report that found it, with a life of its own
afterwards. It is here as the worked example of a spawned record; delays and
safety events follow the same shape and are not built (§10).

**Coverage** — active work groups for a date versus reports submitted. Gaps are
named managers, not abstract holes.

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
  build (§11).
- **Lump-sum subcontracts** — same reasoning: fixed at award. What *does* move
  is variations, and those are captured as resource usage like anything else.
  Day-rate and hired subcontractors work as ordinary work groups.

**Where CBS comes from.** The manager picks a **WBS node only**. The CBS comes
from the resource, which named it once when the work group was defined —
excavator → `4100` Heavy Earthmoving Plant, welders → `1300` Skilled Wages. A
WBS node consumes several kinds of resource at once, so it cannot classify a
usage line; `rt_wbs_nodes.cbs_codes` is a budget-side mapping and a different
thing.

## 4. The model

### 4.1 `rt_work_groups`

| Field | Type | Notes |
| --- | --- | --- |
| `wg_code` | `text` | `WG-WELD`. Unique, immutable. |
| `parent_id` | `fk_ref` → `rt_work_groups` | Optional. A group may be **split** into sub-groups, each with its own manager (§4.2a). Reports are always filed against a leaf. |
| `name` | `text` | `Mainline welding crew`. |
| `project_id` | `fk_ref` → `rt_projects` | Sourced from the page. |
| `manager` | `text` | The person who owes the shift report. |
| `wg_type` | `text` | `Crew` / `Shared plant` / `Subcontractor`, from a fixed list. A shared-plant group is drawn from and **files nothing**, so it is never expected in coverage. |
| `active` | `text` | Whether it is currently expected to report. Closing a group ends the expectation without deleting history. |

### 4.2 `rt_wg_resources` — a work group's standard resources

| Field | Type | Notes |
| --- | --- | --- |
| `wg_id` | `fk_ref` → `rt_work_groups` | Sourced. |
| `cbs_id` | `fk_ref` → `rt_cbs_nodes` | **What kind of resource.** Named once here; every usage line inherits it. |
| `description` | `text` | `30t excavator + operator`, `Welder`. |
| `quantity` | `decimal` | Standard count per shift — 6 welders, 2 sidebooms. |
| `unit` | `text` | `hr`, `day`. Defaults from the CBS node. |
| `rate` | `decimal` | Defaults from the CBS node's `unit_rate`. |

### 4.2a Splitting a work group

A crew that works two fronts at once — two welders on the joint, two on
coating — cannot be costed accurately as one group, because hours spread
pro-rata across its WBS rows (§5) and those four people are not on the same
node.

Two ways to fix it, and the spec takes the second:

1. **Separate work groups with the same manager.** Works, but one person then
   files every report, which is the bottleneck work groups exist to remove.
2. **Split the group** — `parent_id` makes sub-groups, each with its own
   manager, so the split is delegated rather than centralised. The parent stays
   as the reporting unit for roll-ups.

Coverage counts **leaves only**, so splitting a group changes who owes reports
without changing the total expectation.

**Parent sign-off is specified, not built** (§10): the parent manager
confirming the day across their sub-groups is a workflow of its own, and the
demo does not need it.

### 4.3 `rt_shift_reports`

| Field | Type | Notes |
| --- | --- | --- |
| `report_no` | `text` | `SR-0001`. Unique per project, immutable — the project is a field, so it is not repeated in the number. |
| `project_id` | `fk_ref` → `rt_projects` | Sourced. |
| `wg_id` | `fk_ref` → `rt_work_groups` | Sourced from the page or picked by the manager. |
| `report_date` | `datetime` | |
| `shift` | `text` | `Day` / `Night`. |
| `shift_hours` | `decimal` | Hours the shift ran. WBS hours must total this. |
| `hours_lost` | `decimal` | Lost to weather or delay. The measurement only — a delay claim is a record of its own (§10). |
| `weather` | `text` | |
| `work_summary` | `text` (multiline) | |
| `site_notes` | `text` (multiline) | |
| `report_photos` | `photo` (`multi`, `max_count: 6`) | Photos of the shift. A defect's photos go on the defect. |
| `status` | `text` | `Draft` → `Submitted`. |

### 4.4 `rt_shift_wbs` — what was worked on

One row per WBS node the work group touched this shift.

| Field | Type | Notes |
| --- | --- | --- |
| `report_id` | `fk_ref` → `rt_shift_reports` | Sourced. |
| `wbs_id` | `fk_ref` → `rt_wbs_nodes` | |
| `hours` | `decimal` | Hours on this node. Across the report these total `shift_hours`. |
| `qty_completed` | `decimal` | Quantity done today — metres welded, m³ backfilled. |
| `qty_unit` | `text` | |
| `notes` | `text` | |

### 4.5 `rt_resource_usage`

| Field | Type | Notes |
| --- | --- | --- |
| `project_id` | `fk_ref` → `rt_projects` | Sourced. |
| `report_id` | `fk_ref` → `rt_shift_reports` | The report that raised it. Optional in shape, so a docket can write usage later with no report. |
| `wg_id` | `fk_ref` → `rt_work_groups` | Which group consumed it — including a resource drawn from shared plant. |
| `wbs_id` | `fk_ref` → `rt_wbs_nodes` | **Where the cost lands.** |
| `cbs_id` | `fk_ref` → `rt_cbs_nodes` | **What kind.** Inherited from the resource, not picked. |
| `usage_date` | `datetime` | |
| `description` | `text` | |
| `quantity` | `decimal` | Hours or days actually used. |
| `unit` | `text` | |
| `rate` | `decimal` | |
| `tracked_cost` | `decimal` | `quantity × rate`, written by a hook. Never typed, never written to `actual_cost`. |

### 4.6 `rt_defects`

| Field | Type | Notes |
| --- | --- | --- |
| `defect_no` | `text` | `DEF-001`. Unique per project, immutable. |
| `project_id` / `wbs_id` | `fk_ref` | Sourced / picked. |
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

### 4.7 One field added to an existing type

`rt_cbs_nodes.unit_rate` (`decimal`) — so a resource's rate comes from the
model rather than being typed each shift.

## 5. Filing a shift report

1. Manager opens the work group's page and starts a report for the date.
2. The usage lines are **pre-filled from the work group's standard resources** —
   quantity, unit, rate, CBS. Confirm, adjust, or remove.
3. Add WBS rows: node, hours, quantity completed. Hours must total
   `shift_hours`.
4. Add photos, narrative, hours lost.
5. Raise any defects found — each becomes its own record, citing this report.
6. Submit. The report is then read-only.

Confirm-and-adjust rather than type-from-blank is the point: it is why a
standard resource set exists.

### 5.1 How a shift's cost reaches the WBS

**Hours are the allocation basis.** The shift's usage cost spreads across the
report's WBS rows in proportion to their hours: a 10-hour shift with 6 hours on
`3.4` and 4 on `3.5` puts 60% of the shift's tracked cost on `3.4`.

A per-resource override exists for the case where one resource genuinely sat on
one node all shift while the rest moved — the manager names the node for that
line, and it is allocated directly instead of pro-rata.

**A tick matrix of every resource against every WBS node was designed and
dropped.** It is accurate in principle and unusable in practice: a manager
filing at the end of a shift will not tick a grid, and the common case — a crew
working nodes in sequence — is already right under pro-rata. Where a crew
genuinely splits across fronts, the answer is to split the work group
(§4.2a), not to make every report carry a grid.

**Indirect time spreads the same way.** Lost time and standby are resources
against an indirect CBS code, and they allocate pro-rata across the shift's WBS
rows like any other cost. That is the conventional treatment and it is only
misleading when a group's resources are genuinely working different nodes —
which is the case §4.2a exists to solve.

## 6. Coverage

Expectation = active **leaf** work groups of type `Crew` or `Subcontractor`
for a project. Shared-plant groups file nothing and a split group's parent is
covered by its children, so neither is expected. For a given date, **coverage = expected minus submitted**, listed by
work group and manager.

No roster in this build. A roster (which groups work which days, with a "no work
today" escape) is specified in §10 — it makes the expectation date-accurate and
lets the roster's own accuracy be measured, and it is the first thing to add if
the coverage panel proves useful.

**Missing reports are never estimated.** A gap is shown as a gap. Filling it
with an estimate would put an uncorrected number into the totals, which defeats
the reason coverage exists.

Any total the pages show carries its coverage state — "3 of 4 reports in" —
so a figure is never read as complete when it is not.

## 7. Totals

All read-time, nothing stored:

- Tracked cost per WBS node, per CBS node, per project, per date range.
- Hours per WBS node; quantity completed per WBS node.
- Planned versus actual resources: the work group's standard set against what
  the report recorded.

The arithmetic works as of 2026-09-22 — stored decimals were strings, which was
an engine defect, now fixed. The pattern is a GET whose `returns` calls a named
function looping with `for each`; `act_total_cbs_nodes` already does this.
`sum` on the query chain is still absent.

`actual_cost` on the WBS stays empty throughout, because no invoice has
arrived. Showing tracked against actual, with actual blank, is the
demonstration.

## 8. Pages

**Project page** gains three sections: **Work Groups** (with manager and
active state), **Shift Reports** (report no, date, shift, work group, hours,
status, Open), and **Defects** (defect no, raised, WBS, severity, status,
Open). A **coverage** line shows the latest date's expected-versus-submitted.

**`pages/shift-report`** — anchored on `rt_shift_reports`. Header (work group,
date, shift, manager), details, photos, WBS rows with hours and quantity,
resource usage with tracked cost, shift total, and defects raised.

**`pages/work-group`** — anchored on `rt_work_groups`. Its standard resources,
its recent shift reports, and a **New shift report** button.

**`pages/defect`** — anchored on `rt_defects`. Details, photos, lifecycle acts,
and a link back to the report that raised it.

## 8a. Build order

Two clean-ups come first, because everything after them depends on the data
being right:

1. **Delete the junk WBS nodes** — 19 test nodes (`AAA`, `N1`, `P1`, `WBS 1`,
   `W01`…) in the same operation as the real structure. Every WBS picker in
   this build shows them otherwise.
2. **Distribute P26-011's CBS budgets to the leaves.** The seven roots hold the
   totals (`1000` = 2,400,000) and their children are empty, which is backwards:
   costs belong on the leaves and roll up. Children get amounts summing exactly
   to each root's existing total, so no project total changes. `unit_rate` then
   goes on the leaves, where the resources point.

Then: the model (record types, activities, pages), then the demo data.

## 9. Demo data

**P26-011 — Cross-Country Steel Pipeline Project.**

Four work groups: `WG-EARTH` (earthworks), `WG-WELD` (mainline welding),
`WG-TIE` (tie-ins and crossings), `WG-PLANT` (shared plant, drawn from, does
not file). Each with a standard resource set.

Six consecutive working days, day shift. Two clean days, a wet day losing four
hours, a day the NDT subcontractor finds a repair, a heavy backfill day, a
river-crossing tie-in day.

Usage lands on the project's real WBS nodes (`3.1`, `3.2`, `3.4`, `3.5`, `3.7`,
`3.8`, `3.9`, `3.10`) against CBS leaves `1200`, `1300`, `3100`, `4100`, `4200`,
`4300`, `5100`. Roughly $25k–$40k per shift, ~$190k over six days against a
$30M budget.

`WG-WELD` is **split** into `WG-WELD-MAIN` and `WG-WELD-COAT`, each with its
own manager, so the split feature is visible in the demo and the two fronts
cost separately.

**One crew misses one day's report on purpose** — not the shared-plant group,
which files nothing by design — so the coverage panel shows a real gap with a
named manager.

Three defects in different states — open, rectified awaiting verification,
closed — each raised from the report that found it, each with a photo. Two to
four photos per shift report.

**Written straight to the records**, per the standing ruling for demo data: a
demonstration is not a history worth auditing. Model changes go through the
config writers. The activities are still built, because the pages need them.

## 10. Specified, not built

- **Roster** — which work groups work which dates, with a "no work today,
  roster wrong" escape so roster accuracy is itself measurable.
- **Parent sign-off on split groups** — the parent manager confirming the day
  across their sub-groups (§4.2a). Reports are filed at leaf level either way.
- **Delays** — cause, compensability, notice served, extension of time. The
  contract side is the depth; a toy version teaches the wrong thing. The shift
  report keeps `hours_lost` as a measurement.
- **Safety events** — type, severity, persons, immediate action, notifiable
  flag, investigation, closeout.
- **Subcontractor work orders** — rate cards, work orders as the payable
  document, RCTI instead of subcontractor invoicing. The work group figure
  stays the tracking number; the work order becomes the payable one.
- **Materials and committed cost** — purchase orders and subcontracts give
  material exposure at order time, weeks before site.
- **Actual cost and reconciliation** — invoices, payroll, plant charges, and
  matching each against the tracked figure it supersedes.
- **Voice capture** — the manager talks, an assistant drafts the report,
  questions what is missing, and the manager checks and signs. Already real in
  the market; a natural fit here because the shift report is structured.

## 11. Notes for later

**Quantity drift.** `qty_completed` accumulated daily will diverge from true
quantity-to-date over a long contract. The answer is periodic re-baselining
against a measured figure — the same method as a stocktake against running
inventory — not correcting each day's entry.

**Defect and report numbering** need a sequence rule — `SR-0001` per project.
The demo script numbers them directly; the model has no counter.

**Photographs.** R2 is configured. A loader must build the descriptor itself:
SHA-256 from `node:crypto`, dimensions from the JPEG header. Proposal: omit
`thumb_key` (display falls back to the full image) rather than add an image
dependency, and insert the attachments ledger row per photo so the storage fuse
stays honest. Images from Unsplash or Wikimedia Commons, with source and licence
recorded in the loader's header.

**Modules.** Work groups, shift reports, resource usage and defects are the
same in roads, water and pipelines, and need nothing of a host solution's model
but "which WBS". This is the blueprint's module shape. Modules are not built,
so for now these are record types in the projects solution.
