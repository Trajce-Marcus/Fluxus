# Shift Reports & Work Groups — spec

**Status: model and pages built** (2026-09-23, branch `feat/console-users-ui`).
The pages (§8) are the latest pass — see the note at the end of this section
and §8's own. **The demonstration data (§9) is still to be built** — a
separate session, per the standing instruction.

**Status: model built, second pass** (2026-09-23, branch `feat/console-users-ui`).
The first pass (below) built the eight record types against the design as it
stood before the cold review in §1.1; this pass rebuilds the pieces that
review changed — work-group splitting (§4.1a), the Submit/Approve hours
warning (§5.2), Reject and Cancel (§5.3), and amendments (§5.4) — and adds
`services.math.distribute` to the engine (`packages/engine/docs/SPEC.md`,
beside `services.time`), which Approve now calls instead of the hand-rolled
largest-remainder arithmetic §10a found wrong on its first attempt. All of it
is written to Neon dev through `packages/server/scripts/shift-reports-model.ts`
and passes `check-model.ts` clean.

Concretely, this pass: made `act_create_work_groups` ask for `wg_parent`
instead of sourcing it blank, added the one-level-nesting refusal and the
expire-unexpired-children refusal (§10), dropped `standardResourceSet`'s
fall-back to a parent's resources, moved `report_date`/`start_time`/`end_time`
off the record-type's own `required` (so an amendment can leave them blank)
and onto the ordinary Create/Modify activities' attribute usage instead,
added `act_reject_shift_reports` and renamed the existing "Delete Shift
Report" to `act_cancel_shift_reports` (same mechanism, the name §5.3 actually
uses), and brought `wbs_id` back onto `rt_shift_report_resource_usage`
alongside a `notes` field, with `amended_report_id` new on `rt_shift_reports`.
Approve's after hook now branches on a line's own `wbs_id` — set posts the
line whole (an amendment's signed quantity carries straight through pricing
into `rt_wbs_resource_usage`), blank divides by hours via `distribute()`. The
amendment's own activity set landed on the same workflow as the ordinary
report (`wf_shift_reports`, `wf_shift_report_resource_usage`): `Raise
Amendment`, `Add/Adjust Amendment Line`, `Edit Notes`, and the shared
Submit/Reject/Cancel/Approve. `packages/server/scripts/verify-shift-reports.ts`
drives all of it — `distribute()` directly, the one-level cap and the
expire-children-first order, the Submit/Approve warning (needs-confirmation,
then `acknowledgedWarnings`), Reject, Cancel, and an amendment posting a
negative quantity and cost undivided — through the real engine with no
`writeBack`; every check passes, including the whole first pass's suite
unchanged.

A cold test on the second pass found the amendment/ordinary activity-set split
(§5.4) was a page's choice, not a gate — an amendment's line could be added to
an ordinary report and vice versa, and Calculate threw a raw error on an
amendment. Three cold-test passes over the fix, each re-deriving every
activity's classification from scratch rather than trusting the last pass's
tally, closed it fully: every amendment-only and ordinary-only activity in
`wf_shift_reports` and `wf_shift_report_resource_usage` now carries a
`before_hook` gate, symmetric, no exemption — see §5.4's own "Each set refuses
the other's records" and §10a's new note on `attributes.*` vs `records.*`
blank semantics, which the third pass's fix surfaced and which also fixed a
pre-existing, unrelated bug in `act_list_defects` (the "no report filter"
branch never fired, so the GET always returned zero defects for a whole
project). All now built and covered by `verify-shift-reports.ts`.

A cold-test pass against this build (§10a's own method, run cold against the
spec and the diff) found three real gaps, since closed or corrected:

- **§5.1's per-line "pin to one WBS node" exception was reachable by no
  activity.** The field existed and Approve's hook handled both branches
  correctly, but nothing ever let a person set it. Rather than build the
  missing activity, the exception itself was removed (2026-09-23) — it was
  judged to buy limited accuracy for the complexity of a mechanism nobody
  could reach. §5.1 and §4.6 reflect the removal; §10a's write-up on
  blank-fk-is-not-null is kept as the general lesson (still load-bearing
  elsewhere — the work-group leaf checks, `standardResourceSet`'s parent
  lookup), decoupled from the feature that originally surfaced it.
- **§4.1a's split work groups could not be created at all** — `wg_parent` was
  sourced as the literal `''` on create, always, so a WG-TRENCH could never be
  put under a WG-SPREAD. Resolving it settled what splitting actually is
  (2026-09-23), and §4.1a is rewritten: **one level only, the parent chosen at
  create and never changed, and no sharing downward.** A child is an ordinary
  work group — its own resources, its own manager, renamed, modified and
  expired exactly as a standalone group is — and the umbrella buys approval by
  the owner and roll-up, nothing else. The WBS's `act_move_wbs_nodes` is
  **not** the pattern here and no move activity is built; a group put in the
  wrong place is expired and made again. What follows from that, now built:
  create asks for the parent rather than sourcing it blank, the one-level cap
  and the expire-children-first rule use the hooks §10 specifies, and
  `standardResourceSet`'s fall back to the parent's set is gone — a child with
  no resources reads as empty. §9's WG-SPREAD no longer holds the crew's
  resources; its three children carry their own.
- **Submit's gate did not reverify the WBS-hours-equals-work_hours
  invariant** — it checked only that resource lines were marked `calculated`,
  which editing a report's times after Calculate does not clear. Working out
  what should happen settled what Calculate *is* (2026-09-23): **a shortcut,
  not a gate.** The resource usage is the thing being made accurate; the work
  group's set plus the WBS split is a fast way to arrive at it, Recalculate is
  available whenever the filer wants it, and lines may be adjusted by hand.
  Nothing reaches back into a priced report. So a stale split is not a defect
  to block — §5.2 has Submit and Approve **`warn()`** about it, naming both
  figures, and acknowledging is a legitimate answer. Built in the second pass.

  Three further decisions came out of the same thread, all now specified and
  built: **§5.3** fixes who submits and who approves (anyone submits; the
  parent's manager approves a child's report; convention, since `manager` is
  text and the engine cannot check it); **§5.4** rules out reopening a
  submitted report in favour of an amending report carrying the difference,
  negatives and all; and §4.6 gains a `notes` field per usage line, its
  rate/cost-code wording corrected — those are copied once and never re-pulled
  from the catalogue, but the filer may correct them while the report is
  Draft. **Reject** and **Cancel** were added with §5.3: approval may not be
  possible, so a submitted report goes back to `Draft` and is then either
  resubmitted or cancelled, and a cancelled report reads as a hole in §6
  rather than papering over one.

  **An amendment is a shift report whose `amended_report_id` names the report it
  corrects** (§5.4), raised by a button on that report. No separate flag: the
  pointer and the fact are one field, and the test is `amended_report_id <> ''`
  — the blank-fk idiom, not a null check (§10a). It is deliberately not the
  pooled `report_id`, which makes a different claim (§4.9). Two designs were tried and
  dropped on the way: a second shift report carrying the difference with a zero
  `work_hours` (which restated times and WBS rows for no reason), and a pair of
  record types of its own (which duplicated the lifecycle). What settled it:
  **one record type, two sets of activities.** The lifecycle — statuses,
  `approved_by`, the approver rule, the numbering — is genuinely shared and
  should stay shared; the filing differs, and filing lives on activities, which
  the amendment page names for itself. Still eight record types.

  An amendment asks for notes and hand-entered resource usage lines and nothing
  else: no Calculate, no hours check, no WBS rows, no photos. Its lines carry a
  **signed** quantity and a `wbs_id` naming where the correction lands, so
  approval posts them to the ledger undivided — which brings `wbs_id` back onto
  `rt_shift_report_resource_usage`, this time with something that writes it.
  §8's contributions grid folds a day's amendments into that day's colour: green
  only when the report and every amendment against it are approved.

One departure from this spec's own wording, made during the build and flagged
here rather than silently taken: §10's "both status sets... enforced at
capture by a list attribute" is **not** how `sr_status`/`def_status` ended up
built. Neither got a pool attribute; `status` is written straight inside each
transition's after hook (`context.record.update({ status: 'Approved' })`),
exactly as `rt_projects.status`/`wbs_status` already work, for the reason §5
argues at length for Approve: a captured attribute whose key matches the field
auto-applies as part of the activity's own write, outside the after hook's
transactional boundary, so it survives a hook failure that leaves the rest of
the transition half-done. `wg_type`, `res_type`, `shift` and `severity` did
get real `list` attributes — proving the mechanism on real interactive capture
(`severity`) as well as small fixed sets.

Previously: two things had happened ahead of this build — the cost codes were
rebuilt in the database (§8a), and the design was reworked in discussion on
2026-09-22/23 (§1.1 records what moved and why).

**The pages (§8) were built in a following session** (2026-09-23), through
`packages/server/scripts/shift-reports-pages.ts`. Five GET activities landed
alongside them, beyond the model's own build — none of them a redesign, all
of them a page reading something no existing GET returned:

- **`act_list_shift_report_contributions`** — nothing returned the
  per-work-group-per-date state the Contributions grid draws (§8's colour
  rule: green only when the report and every amendment against it are
  approved). The fold-in is a correlated count that has to go through a named
  function (`amendmentsAllApproved`, §7's own rule — a query written inline
  inside `select` binds to the wrong row) called from the GET's own `select`,
  verified directly against the real engine before it was trusted: an
  approved report with no amendment reads `approved`, one with a still-open
  amendment reads `inflight`.
- **`act_list_shift_report_amendments`** — `act_list_shift_reports`
  deliberately excludes amendments (§6), so a report had no way to list what
  was raised against it, which the shift-report page needs.
- **`act_list_contribution_rows`**, **`act_list_reports_awaiting_approval`**,
  **`act_list_recently_approved_reports`** — found only once the pages were
  written and run through the real `validatePage`: `invoke(...).where(...)`
  and `.select(...)` chains work at the DSL evaluator (the chain methods are
  generic over any array, not only a live `records.X` query — verified
  directly), but the *static* validator cannot resolve a bare field name
  against an `invoke()` result, whose shape it cannot see. Each is a narrower
  cut of an existing GET, the same shape `act_list_work_group_reports`
  already is beside `act_list_shift_reports` — not a chain on the page.

**A known rough edge, raised and deliberately left as-is, the user's own
call:** `RecordList` has no way to turn a stored reference id into a readable
label — that lives only in the capture form's resolver, which a page's read
side does not have. Every existing GET the pages reuse
(`act_list_shift_reports`, `act_list_defects`, `act_list_shift_wbs`,
`act_list_shift_report_resources`) returns a raw id for a work group, WBS node
or cost code, so a column meant to read "work group" or "WBS" shows the id
until a person opens the record's own page. Touching those GETs was weighed
against "the model is built, don't redesign it" and set aside; every list
carries an **Open** action to the record's own page, where the real fields
are.

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

Seven new record types and nothing added to the existing three beyond what §8a
already did.

**Two things about how these tables read.** A field's declaration carries only
its key, label, type, what it points at, its default, and whether it is
required, unique, immutable or indexed — there is no settings object on a
field at all. So `photo (multi, max_count: 6)` and `text (multiline)` below
describe the **attribute** that fills the field, not the field itself. And the
Console's record-type editor offers only text, int, decimal, bool, date,
geopoint and fk_ref — so every `datetime`, `time` and `photo` field here must
be written by a script and cannot afterwards be edited there. There is
precedent: `rt_projects.target_start` is already a script-written `datetime`.

### 4.1 `rt_work_groups`

| Field | Type | Notes |
| --- | --- | --- |
| `wg_code` | `text` | `WG-WELD`. Typed. Unique per project — checked in a hook, not by the field (§10). Not `immutable`: see §10. |
| `parent_id` | `fk_ref` → `rt_work_groups` | Optional. Child groups, each with its own manager and resources (§4.1a). One level only, set at create and never changed. Reports are filed against the groups with no children; the parent's manager approves them. |
| `name` | `text` | `Mainline welding crew`. |
| `project_id` | `fk_ref` → `rt_projects` | Taken from the page, never asked for. |
| `manager` | `text` | The person who owes the shift report. |
| `wg_type` | `text` | `Crew` / `Shared plant` / `Subcontractor`. A shared-plant group is drawn from and **files nothing**, so it is never expected to report. |
| `active` | `text` | `'true'` / `'false'`. Closing a group ends the expectation without deleting history. |
| `expired` | `text` | `'true'` / `'false'`, as every existing record type carries. |

### 4.1a Splitting a work group

A work group may hold **child work groups**: `parent_id` points at the parent,
and shift reports are always filed against a group with no children. The
parent's manager approves what its children file.

The case it is for: one person owns a crew that works several fronts at once —
welding, coating, trenching. Each front gets its own manager who files its
report; the owner oversees and approves.

**One level only.** A child may not itself hold children. A group whose
`parent_id` is set cannot be chosen as a parent, and the create activity
refuses it (§10).

**A child is an ordinary work group.** It holds its own resources, its own
manager, files its own reports, and is renamed, modified and expired exactly as
a standalone group is. Nothing about being a child locks any of it.

**The parent shares nothing downward.** It is an umbrella, not a pool: a child
never draws on its parent's resource set, and a child with no resources of its
own reads as empty rather than borrowing. A parent holds a resource set only in
its own right, as any work group does.

Two things the umbrella gives that a flat list cannot:

- **Approval by the owner.** The parent's manager approves what its children
  file, so oversight follows the real line of responsibility without a second
  document.
- **Roll-up.** Cost, hours and who-has-filed aggregate to the parent, so "what
  did this crew cost last week" is a query rather than a new mechanism.

**The parent is chosen when the child is created, and never changes.** Two ways
in, both landing on the same create activity: pick the parent in the form, or
open a parent and create a child under it, which seeds the picker. **There is
no re-parenting** — no move activity, and `wg_parent` is absent from Modify, so
a group's place is settled at birth. A group put in the wrong place is expired
and made again.

**Expiring, not deleting.** A work group is never removed — shift reports,
usage rows and defects carry its id — so retiring one sets `expired` and
nothing else. **A parent cannot be expired while it still has unexpired
children:** they are expired first, and the check counts live children only, an
already-expired child being no obstacle (§10).

**A `delegate` column on a flat group was considered and rejected.** It is the
same idea spelled smaller — a child's manager *is* the delegate — and it gives
neither roll-up nor a manager who files a report of their own, while capping at
one delegate per group.

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

A selection from the catalogue with counts, held on the group that owns them.
Every work group holds its own set — a child never draws on its parent's
(§4.1a).

| Field | Type | Notes |
| --- | --- | --- |
| `wg_id` | `fk_ref` → `rt_work_groups` | Taken from the page. The group that owns the set, parent or child alike. |
| `resource_id` | `fk_ref` → `rt_resources` | |
| `quantity` | `decimal` | Standard count per shift — 6 welders, 2 sidebooms. |
| `rate` | `decimal` | Optional. Blank means the resource's rate. To be used sparingly — a subcontractor at a negotiated figure. |
| `cbs_id` | `fk_ref` → `rt_cbs_nodes` | Optional. Blank means the resource's cost code. For where this group's use of it is genuinely classified differently. |
| `expired` | `text` | |

### 4.4 `rt_shift_reports`

| Field | Type | Notes |
| --- | --- | --- |
| `report_no` | `text` | `SR-0001`. Written by a hook, so neither `required` nor `immutable` — see §10. |
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
| `amended_report_id` | `fk_ref` → `rt_shift_reports` | Blank on an ordinary report. **Set on an amendment** — the approved report it corrects, sourced from the page that raised it. One field does both jobs: a report that amends another *is* an amendment (§5.4). Not the pooled `report_id`, which means "the report this record belongs to" (§4.9) and would be a different claim here. |
| `approved_by` / `approved_date` | `text` / `datetime` | Written by the Approve activity, available to the parent group's manager (§4.1a). A group with no parent is approved by its own manager. |
| `expired` | `text` | |

An approved report is not editable in this build; a correction is a new report.
Editing one would mean unwinding the cost it has already put on the WBS.

### 4.5 `rt_shift_wbs` — what was worked on

One row per WBS node the work group touched this shift.

**Only a node with no children may take hours.** Nine of P26-011's
twenty-seven nodes are parents, and hours booked to `3.0` rather than `3.4`
would sit on a node that is meant to be the sum of the ones below it. This is
the same rule already settled for cost codes.

It is enforced by **which GET the attribute names**, not by the picker, which
draws whatever it is handed: `act_search_wbs_leaves` returns only nodes with no
children and is named by this row's WBS attribute, while `act_search_wbs_nodes`
returns every node and is named where a parent is the right answer — choosing
the parent of a new node. Same component, same attribute type, different
candidates. No further check: demonstration data is written straight to the
records and would not pass through one anyway, so the loader is correct by
construction.

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
| `notes` | `text` (multiline) | The filer's note on this line — why a rate was overridden, why a quantity is not the standard one. Optional, and read by nothing. |
| `quantity` | `decimal` | `work_hours` × the standard count, adjustable. **Signed on an amendment's lines** — four excavator hours overstated is `-4`. |
| `wbs_id` | `fk_ref` → `rt_wbs_nodes` | Blank on an ordinary line, whose cost is divided across the report's WBS rows by hours (§5.1). **Set on an amendment's lines**, which name where the correction lands and are not divided. |
| `calculated` | `text` | `'true'` once Calculate has priced this line; cleared when it is run again. |
| `unit` / `rate` / `cbs_id` | `text` / `decimal` / `fk_ref` | Copied from the resource when the line is written, and **never re-pulled from it afterwards** — repricing the catalogue next year does not touch shifts already filed. The filer may correct any of them on the line itself while the report is still Draft; that is what Adjust is for, and `notes` is where the reason goes. |
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
| `defect_no` | `text` | `DEF-001`. Written by a hook, so neither `required` nor `immutable` — see §10. |
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
  `wbs_parent` does.

  **Only `parent_id` needs that spelling.** An attribute naming a field names
  exactly one record type and one field, so applying it everywhere would mean
  roughly thirteen reference attributes instead of five — `cbs_id` appears on
  four of the new record types, `wbs_id` on three, `report_id` on three. Where
  every type spells the field the same way and points at the same place, one
  shared attribute serves them all, which is how `project_id` already works
  across two record types. The field-naming spelling is for the case it was
  built for: two record types disagreeing about the target.
- **`description`** is single-line, which suits a resource and not a defect. A
  defect gets `def_description`.
- **`status`** does not exist as an attribute at all today, only as a field on
  `rt_projects` — **and it stays that way. Neither `sr_status` nor `def_status`
  was built.** They were specified here on the reasoning that two value sets
  cannot share a key, which is true but beside the point: status is never
  captured. Each transition writes it inside its own after hook
  (`context.record.update({ status: 'Approved' })`), exactly as
  `rt_projects.status` and `wbs_status` already do, so that the write lives or
  dies with the rest of the transition (§5). A captured status would commit
  outside the hook's boundary and survive a hook that failed.

  `wg_type`, `res_type`, `shift` and `severity` did get real `list` attributes;
  those are captured, and the list is doing its job.

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
   `work_hours` follows, less the breaks entered — worked out by
   `services.time.hoursBetween`, which crosses midnight so a night shift from
   18:00 to 06:00 is twelve hours, not an error.
2. WBS rows: node, hours on it, quantity completed.
3. The work group's standard resources appear as lines, taken from its set.
   Confirm, adjust, remove, or add something used that is not in the set.
   **Nothing is priced yet.**
4. Add photos, narrative, hours lost.
5. Raise any defects found — each becomes its own record, citing this report.
6. **Calculate.** This checks the WBS hours total `work_hours`, failing with a
   message if they do not, and then prices every line at quantity × rate. It
   may be run again as often as the report changes; each run clears what the
   last one wrote.
7. Submit. The report is then read-only — there is no reopen, and a correction
   is a new report that amends it (§5.4). **A report that has not been
   calculated cannot be submitted** — that one is a refusal. If the WBS hours
   no longer total `work_hours`, Submit **warns** rather than refuses (§5.2).
8. It is approved — by the parent group's manager, or by the group's own where
   there is no parent (§5.3). **On approval the cost is divided across the WBS
   rows** and written to `rt_wbs_resource_usage`.

**The Approve activity must capture nothing and write `status` inside its own
hook**, the way `act_approve_wbs_projects` already does. A failing after hook
does not undo the activity's own field change — that is deliberate, and it is
written into the server: the history entry and the mapped field change are
applied before the hook runs and persist even when it throws. So an Approve
that maps a captured status would leave a report reading Approved with no cost
against it and, behind a show condition, no way to run it again. Writing the
status inside the hook makes the whole thing succeed or fail together: the
hook's own writes do roll back as one.

**Calculate is a shortcut, not a gate.** The work group's resource set and the
WBS split are a fast way to arrive at resource usage; Calculate does the
arithmetic. What matters is that the resource usage is right, and it is the
filer's to get right — lines may be adjusted by hand, and in most reports they
should not need to be. The user's design, 2026-09-23.

Two things follow, and they are not defects:

- **Nothing reaches back.** Changing the work group's standard set after
  Calculate has run does not alter a report already priced. A report is a
  record of a shift, not a live view of the crew.
- **Recalculate is available whenever the filer wants it**, and each run
  clears what the last one wrote. There is no window to police — the filer
  re-runs it or edits the lines, whichever gets to the right answer.

### 5.1 How a shift's cost reaches the WBS

**Hours decide the split.** Each usage line's cost is divided across the
report's WBS rows in proportion to their hours: a 10-hour shift with 6 hours on
`3.4` and 4 on `3.5` puts 60% of each line on `3.4` and 40% on `3.5`.

Worked through: six welders at $95 for a 10-hour shift is $5,700 against cost
code `1300`; two sidebooms at $310 is $6,200 against `4200`
Specialized Lifting & Access. The shift consumed
$11,900. Node `3.4` receives $7,140 of it and `3.5` receives $4,760 — and the
cost codes are unaffected by the split, because each line carried its own.

**A per-line "pin to one node" exception was designed, built, then removed**
(2026-09-23, after the model landed). On an ordinary report every resource line
divides by hours — no exception. The idea was a way for one resource that
genuinely sat on one node all shift to skip the split; the accuracy it bought
was limited and it was never reachable — no activity in the built model ever
offered a way to set it — so it went rather than being finished.

**`wbs_id` is back on the line, for a different reason** (§5.4). An
amendment's lines name the node their correction lands on and are posted
whole; an ordinary report's leave it blank and divide. So the branch the pin
once fed is live again, but this time something writes it. **The test is the
line's own `wbs_id <> ''`** — not anything about the report, and not a null
test (§10a).

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

**The split is `services.math.distribute`, not arithmetic in the hook.** Given
the WBS rows' hours as weights, the line's cost as the total and a precision,
it returns shares that sum to exactly the total — the largest-remainder rule,
which §10a found this model needed and got wrong on its own first attempt. It
is an engine service (`packages/engine/docs/SPEC.md`) rather than a recipe
repeated in every hook that divides, for the reason `hoursBetween` is one:
operators are language, calculations are capability. Approve's hook names it
and does no rounding of its own.

**Removed lines must be filtered explicitly.** Reaching a report's children
through the record — its WBS rows, its resource lines — returns every incoming
row and ignores `expired`. A line removed during filing is soft-deleted, as
every record type here is, so without `where(expired <> 'true')` it would still
be priced and still be divided across the WBS.

### 5.2 The one thing that is warned about

`work_hours` and the WBS rows' hours total are checked when Calculate runs. If
the report's times are edited afterwards, or a WBS row is changed, the two can
part company — and the only way that happens is a deliberate edit, quite
possibly one where the filer simply forgot to recalculate.

So it is **surfaced, not blocked**. Submit's before hook `warn()`s when the two
disagree, naming both figures, and Approve does the same for the parent's
manager. The filer either goes back and recalculates or acknowledges the
warning and submits.

`warn()` is an existing builtin: the engine returns a before hook's warnings
and persists nothing, and the same run repeated with `acknowledgedWarnings`
goes through. Nothing new is needed for this.

**The division stays at approval** rather than moving into Calculate, so the
cost table holds only approved money and every total over it is a plain sum
with no "does this one count" filter.

Confirm-and-adjust rather than type-from-blank is the point of a standard set.
The work group is chosen without checking who is filing; access is not enforced
in this build.

### 5.3 Who submits, who approves

**Every report is submitted and then approved.** Both steps, always — there is
no shortcut when one person would do both.

- **Anyone may compile and submit.** The group's manager usually, but whoever
  was on site will do. Submit is not gated on a name.
- **Who approves is fixed by the group, not by who filed.** A child group's
  report is approved by the **parent** group's manager. A group with no parent
  is approved by its own manager.
- One person doing both steps is fine where the roles land on them — having
  submitted does not disqualify the approver.
- A child group's own `manager` gates nothing. It is the name §6 puts against
  the hole when that group has not filed.

**This is convention, not enforcement.** `manager` is a text field — a label,
not a link to a user account — so nothing in the engine can check that the
person pressing Approve is the one named. The pages follow the rule; the model
does not police it. Tying work groups to real users is a later piece (§11).

**Approval may not be possible, so a report can be rejected.** Reject sends a
submitted report back to `Draft`. Nothing has posted at that point — cost is
divided at approval and not before (§5.1) — so this costs nothing and no
amendment is involved. From `Draft` the report takes one of two paths:

- **Resubmitted**, once whatever was wrong is fixed. It is editable again in
  the ordinary way while it sits in `Draft`.
- **Cancelled**, if it should not stand at all. Cancelling sets `expired` and
  the report stops counting as filed — **§6 then reads that group and that day
  as missing**, exactly as though nothing had ever been entered. That is the
  point of it: a report that should not exist must not paper over a hole.

Cancelling is available on a `Draft` report only, which is where Reject leaves
one. **An approved report is never rejected or cancelled** — its cost is in the
ledger, and the way back is an amendment (§5.4).

### 5.4 Correcting an approved report

**An approved report is never edited.** There is no reopen. A *submitted* one
can still be sent back — that is Reject (§5.3), and it is free because nothing
has posted yet. Once approved, that window is shut. The reason is the ledger:
Approve divides cost into `rt_wbs_resource_usage` (§5.1), and editing the
source of posted cost means un-posting and re-posting it.

**A correction is an amendment: a shift report whose `amended_report_id` names
the report it corrects**, raised by a button on that report, which sources it.
There is no separate flag — a report with a parent report is an amendment, and
one without is not. It is
submitted and approved like any report, and on approval its lines post to the
ledger — so the ledger stays append-only and both the mistake and the fix
survive in full.

It is deliberately a little awkward. Getting the resources and the WBS split
right the first time is the cheaper path, and it should feel that way.

**One record type, two sets of activities.** An amendment shares the table and
the lifecycle — `Draft` → `Submitted` → `Approved`, `approved_by`, the
approver rule (§5.3), the numbering — because those are genuinely the same and
should stay the same. What differs is the filing, and filing lives on
activities, not on the record: the amendment page names its own set and simply
does not name the rest. Separate record types were considered and rejected;
they would have duplicated the lifecycle, which is the half most likely to
change.

**What an amendment asks for** — and it is the whole of it:

- **Notes.** Why the correction is needed.
- **Resource usage lines, added entirely by hand.** Resource, quantity, rate,
  cost code, and the WBS node the correction lands on. Nothing is seeded from
  the work group's standard set, and **there is no Calculate** — no division,
  no hours check, no `calculated` flag. The filer states the correction.

Everything a report needs and an amendment does not — date, shift, times,
`work_hours`, WBS hours rows, photos — is simply not asked for, because
required-ness lives on the activity rather than the field (§4.9). The fields
sit blank and no gate looks at them.

Two things follow:

- **Quantities are signed.** Four excavator hours overstated is `-4`. Pricing
  and the write to the ledger both carry the sign, which nothing else in this
  model does and which the build must not quietly reject.
- **An amendment is not a filing.** §6 counts ordinary reports only, and the
  §8 grid folds a day's amendments into that day's colour rather than showing
  them as extra filings.

**The amendment page owns its activity set, and it is listed in §8.** A later
session extending the shift-report page is not extending this one — if an
amendment should gain something, it is added here deliberately.

**Each set refuses the other's records, in a hook.** A page naming an activity
is not a gate: an activity reachable through one page is reachable through any
caller, so the model has to say which records it accepts. The rule is
symmetric, with **one exemption — Remove**, which both pages share: taking a
line off a draft report is the same act whichever kind of report it is, and it
cannot plant anything. Everything that *writes* a line is gated:

- **An amendment's activities refuse a record with `amended_report_id = ''`.**
  Without this, an amendment's line — signed, naming its own `wbs_id`, never
  Calculated — can be added to an ordinary report, where Approve posts it whole
  and undivided into the ledger. That is the "pin one resource to one node"
  exception §5.1 removed, reachable again under another name.
- **A report's activities refuse a record with `amended_report_id <> ''`.**
  Including **Calculate, which refuses outright rather than being made to
  work** — an amendment has no WBS rows and no `work_hours`, so there is
  nothing to calculate and blank-guarding the check would paper over that. The
  same applies to the ordinary line activities, which would otherwise seed an
  amendment from the work group's standard set.

**Submit and Approve are shared, and their hours warning (§5.2) is skipped on
an amendment** for the same reason: it has no WBS rows and no `work_hours`, so
the comparison means nothing and would warn every time.

**Variations are the same shape and are not this.** Additional scope agreed
mid-project is its own thing, and it is not built here (§11).

## 6. Knowing who has not filed

Who owes a report is a query over work group records: active, no children, type
`Crew` or `Subcontractor`, for a project. Shared-plant groups file nothing and
a split group's parent is covered by its children, so neither is expected.

**Two exclusions.** A cancelled report is `expired` and reads as nothing filed
(§5.3) — that is what cancelling is for — so this query filters
`expired <> 'true'`. And **amendments are not filings**: who-owes-a-report
counts ordinary reports only, `amended_report_id = ''`, or a group that corrected a
mistake would read as having filed twice.

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

To be clear about what that change is and is not: **none of the three returns a
wrong number today**, because the parents now hold blank and blank contributes
nothing. It is a guard against bad data arriving later, not a repair.

Two traps, both verified, that the change must not fall into:

- **The blank guard is load-bearing and must survive the edit.** Every empty
  numeric field in this model stores `''`, not null, and `0 + ''` evaluates to
  the string `'0'` because `+` concatenates when either side is text. The
  existing `iif(x = '' or x = null, 0, x)` stays.
- **"Has no children" written inline inside a query silently passes every
  row.** `.where(... and records.cbs_nodes.where(parent_id = id).count = 0)`
  returns all 27 nodes, not the 20 leaves: both `parent_id` and `id` bind to
  the inner row, so the inner count is zero every time. No error. It must go
  through a named function taking the row's id, or through
  `not (id in records.cbs_nodes.values(parent_id))`. **§6's "who owes a report"
  carries the same test** — written inline it would count the parent group and
  the shared-plant group, which is exactly the number the dashboard exists to
  get right.

`actual_cost` on the WBS stays empty throughout, because no invoice has
arrived. Showing tracked against actual, with actual blank, is the
demonstration.

## 8. Pages

**Built** (2026-09-23), through `packages/server/scripts/shift-reports-pages.ts`
— see the intro's note on the five GET activities that landed with it and the
raw-id rough edge left open. Drafts only; publishing each is a person's act in
the Console. Not built: the "Raise amendment" button is always shown rather
than hidden until approval — the page-runtime has no way to condition a
placed button's visibility on the record's own state (only `RecordActivities`
computes a live `show_condition`, and it structurally excludes CREATE
activities); the model's own gate refuses the click cleanly instead.

**Project page** gains three sections: **Work Groups** (with manager and active
state), **Shift Reports** (report no, date, shift, work group, hours, status,
Open), and **Defects** (defect no, raised, WBS, severity, status, Open). Its
existing cost code and WBS lists get `parentKey` set, so they nest instead of
lying flat.

**`pages/shift-report`** — anchored on `rt_shift_reports`. Header (work group,
date, shift, manager), times and hours, photos, WBS rows with hours and
quantity, the shift's resource lines with tracked cost, the shift total, and
defects raised. Once approved it gains a **Raise amendment** button, which
creates an amendment against it (§5.4).

**`pages/shift-report-amendment`** — anchored on `rt_shift_reports` as well,
and reached only for a record whose `amended_report_id` is set. It shows the report it
corrects, the notes, and the correction lines — resource, quantity (signed),
rate, cost code, WBS node — added by hand, with the amendment's total.

**This page names its own activities, and they are the whole set an amendment
has**: create (from the report, sourcing `amended_report_id`), add a line, adjust a line, remove a line, edit the notes, Submit, Reject,
Cancel, Approve. **No Calculate**, no WBS hours rows, no photos, no defects.
Adding to `pages/shift-report` does not add to this page (§5.4).

**`pages/work-group`** — anchored on `rt_work_groups`. Its standard resources,
its recent shift reports, and a **New shift report** button.

**`pages/defect`** — anchored on `rt_defects`. Details, photos, lifecycle
activities, and a link back to the report that raised it.

**`pages/resources`** — a plain list of the project's catalogue. Nothing more.

**`pages/shift-reports`** — a dashboard. Its centrepiece is the `Contributions`
component, one row per work group and one column per date — so a gap is a hole
in a row with the manager's name beside it.

**A cell's colour covers the day's whole set — the report and any amendments
against it.** The states the page names:

- **green** — everything for that group and date is approved;
- **amber** — something exists but is not all approved, whether that is a
  report awaiting approval or an approved report with an amendment still in
  flight;
- **red** — nothing filed at all. A cancelled report leaves red behind (§5.3).

Amber rather than two shades: what the grid answers is "is this day settled",
and an unapproved amendment means it is not. The component decides none of
this — it draws the state and colour the page gives it. Alongside it: what is submitted and awaiting
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

- `WG-SPREAD` — the mainline spread, manager Hughie. **Parent**, files nothing,
  approves what its three children file. Holds no resources of its own: each
  child carries the set it works with (§4.1a).
  - `WG-TRENCH` — trenching and excavation.
  - `WG-WELD` — mainline welding.
  - `WG-COAT` — field joint coating.
- `WG-TIE` — tie-ins and river crossing. Flat, its own manager and resources.
- `WG-PLANT` — shared plant. Drawn on, files nothing.

**Four weeks, six days a week — 24 shifts per group, 96 reports in all.** Each
group is sized at roughly double a minimum crew, which puts a day across the
four filing groups near $64,000 and the four weeks near **$1.5M, about 3.8% of
the budget**. That is proportionate rather than arbitrary: four weeks of what
would be an eighteen-month pipeline is around 5% of its duration, so 3–4% of
its cost is what early progress should look like. Six days at $32k read as
0.47% and showed nothing.

Within those four weeks, day shift throughout. Two clean days, a wet day losing four
hours, a day the NDT subcontractor finds a repair, a heavy backfill day, a
river-crossing tie-in day.

Cost lands on the project's real WBS nodes (`3.1`, `3.2`, `3.4`, `3.5`, `3.6`,
`3.7`, `3.8`, `3.9`, `3.10`) against cost codes `1200`, `1300`, `3100`, `4100`,
`4200`, `4300`, `5100`. Roughly $60k–$70k **per day across all groups**.

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
  hook, counting the project's records — **not counting and adding one.** The
  record the activity just made is already stored by the time the after hook
  runs, so it is in its own count; adding one skips every number from the
  first. Verified by running it.

  Two further constraints, both verified: a **`required`** field blocks the
  create before the hook can run, and an **`immutable`** field rejects the
  hook's write even from blank, because the check compares new against stored
  and blank-to-value is a change. So a hook-written number is neither. It
  races, and it skips a number after a delete.

  Zero-padding has no builtin — `iif(len(n) = 1, '000', '') + n` and so on.

  Field-level `unique` is not used, because it compares across every record of
  the type rather than within a project.
- **WBS hours must total `work_hours`** — checked by a `fail()` in the before
  hook on **Calculate** (§5 step 6), not as rows are added, because a before
  hook may only validate and there is no `sum`.

  **Submit and Approve check it again, and `warn()` rather than `fail()`**
  (§5.2). Editing a report's times or its WBS rows after Calculate does not
  clear any line's `calculated` flag, so the "has it been calculated" gate
  cannot see a split that has since gone stale. The warning names both
  figures; acknowledging it is a legitimate answer.
- **`work_hours`** comes from `services.time.hoursBetween(start_time, end_time)`
  less `break_hours`. The DSL has no duration arithmetic of its own — a `time`
  field holds `'17:00'` as a string and subtracting two of them errors — so a
  small `time` service module is built beside `geo` in the engine, available to
  every solution and every host. Operators are language; calculations are
  capability, and this is a calculation.
- **The fixed lists** — `wg_type`, `res_type`, `shift`, `severity`, both
  `status` sets — are enforced at capture by a `list` attribute whose
  `datasource` is a list literal. There is no `values` setting; the only legal
  settings on a list are its datasource, its key field, its display field and
  its columns, and anything else is rejected when the model is saved.

  **There is no `list` attribute anywhere in this repo today** — not in the
  projects model, not in any script. Six of them arrive at once here, so this
  is untested ground and the first one should be proven before the rest are
  written.

  Nothing constrains the stored field either way, so demonstration data written
  straight to the records must be correct by construction.
- **Work-group nesting is one level deep** — checked by a `fail()` in Create's
  before hook: if the chosen parent itself has a parent, the create is refused.
  A field cannot express a depth cap, and there is no re-parenting activity to
  check a second time, so this one hook is the whole of it.

  The test is `p.parent_id <> ''`, **not** a null test. A blank `fk_ref` is not
  null (§10a), so `is not null` is true for every group and the cap never
  fires.
- **A parent is expired only after its children** — checked by a `fail()` in
  Expire's before hook, or by the activity's `show_condition`, counting
  **unexpired** children only: `records.work_groups.where(parent_id =
  context.record.id and expired <> 'true').count = 0`. A group that has already
  been expired is no obstacle to expiring its parent. The existing childless
  check written as `not (id in records.work_groups.values(parent_id))` does not
  do this — it ignores `expired` — and must be replaced wherever it gates
  expiry. §6's "who owes a report" leaf check is a different question and stays
  as it is.
- **One resource claimed once per shift** — not enforced (§4.1a).
- **A resource's `unit` never changes** — not enforced (§4.2).

## 10a. What the hook review established

Both hooks were written out and run against the engine on 2026-09-23. They
work: 12 resource lines across 3 WBS nodes produced 36 cost rows in 2 ms, using
1.8% of the step budget, and re-running Calculate after a change re-priced
correctly. Nested loops are legal, an after hook may update the record the
activity ran on and create records of another type in the same run with no
ordering constraint, and a service function may be called from a before hook,
an after hook and a `returns` expression provided it declares itself as a read.

**Four things bite, none of them obvious, all of them measured.**

**A blank reference is not null.** A blank `fk_ref` stores `''` and reaches a
script as a pointer with an empty id, so `line.wbs_id is not null` was **true
for every line**. Written that way, the per-line exception §5.1 described at
the time (since removed — see §5.1) took the whole-to-one-node branch for all
twelve lines and wrote twelve rows with a blank node instead of thirty-six —
no error, no warning. **`<> ''` is the only test that separates a blank
reference from a set one**, and the same applies anywhere else a reference is
tested for emptiness — the lesson outlived the feature that surfaced it, and
the model still relies on it elsewhere (the leaf checks in §6/§7, the
work-group uniqueness check).

**A captured value's blank is the opposite: `null`, not `''`.** The rule above
is about a **stored** field, read through `records`/`context.record`. A
**captured** value, read through `attributes` inside a hook, goes the other
way: `coerceCapturedValue` maps an empty string to `null` before the hook ever
sees it. Two amendment-symmetry gates (2026-09-23, closing the gap §5.4
records) were first written `attributes.x <> ''` and silently never matched a
genuinely blank `x` — `Raise Amendment`'s own `amended_report_id` requirement,
and `act_list_defects`'s `report_id` "no filter" branch, which always came
back empty for a report-less call until this was found and fixed the same way.
Three more instances of the identical miscoding (`act_create_work_groups`'s
`wg_parent` check, both resource-autofill checks) tested the wrong thing but
stayed harmless because the query underneath resolved to nothing regardless —
fixed anyway, since a comment claiming the wrong test is worse than no comment.
**Test a captured value with `= null`/`<> null`; test a stored one with `=
''`/`<> ''`. Never guess which root you are reading from the punctuation.**

**Float equality cannot be used on hours.** Hours of 0.1, 8.2 and 1.7 total
9.999999999999998, so `total <> work_hours` rejects a correct report. The check
compares `round(total, 6)`. `decimal` is float-backed and the attribute
documentation says plainly it is not money-grade.

**A blank number poisons a total.** `0 + ''` evaluates to the string `'0'`, and
`'0' = 0` is false. One WBS row with its hours left blank turns the running
total into text, so the hours check never matches and the division-by-zero
guard never fires — the run then dies further down with a type error instead.
Every accumulation guards each value, not just the result.

**The divided shares do not add up.** $100 across three equal nodes rounds to
$33.33 three times — $99.99. Nothing in the codebase allocates remainders.
Across the demonstration that is up to $11.52 present in the shift's lines and
absent from the cost rows, and since §7's totals read only the cost rows,
nothing reconciles the two and the gap is silent.

**The rule: largest remainder.** Every share is rounded, and the difference
between their sum and the line's total is given to the largest share. The parts
then always equal the whole, which is the property that matters when the two
tables are compared. *(Since recorded here, this became
`services.math.distribute` in the engine rather than DSL repeated in every hook
that divides — see §5.1.)*

**Two smaller facts worth holding.** A failed after hook still leaves a history
entry, so a failed approval is visible rather than silent. And the binding
limit is rows, not steps: reaching a record's children reads that whole record
type and is capped at 10,000 rows in the operation, so this stops working
somewhere near 277 reports at twelve lines and three nodes. The demonstration
is 96.

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
