# Projects — Spec

Drafted 2026-08-26. Living document.

> Record type and attribute ids below are **proposals**, not endorsed names.
> They need a pass before anything is authored in the Console.

## What it is

A construction project system that tracks two things and joins them: the
**work** (what has to be done, when, how far along) and the **cost** (what it
is being charged against, budget vs actual).

Lightweight on purpose. A site engineer or project administrator should be able
to run it without training. Calendars, resource levelling, critical path,
histograms and multi-currency are all out.

## The core idea

Every project is broken down twice, into two independent trees.

- The **CBS** (cost breakdown structure) is the money spine. Its codes come from
  the contract — the cost codes you get paid and report against. You don't
  control it and it barely changes once signed. On a pipeline contract that's
  survey, clearing, stringing, trenching, welding, joint coat, NDT, lower-in,
  backfill, hydrostatic testing.
- The **WBS** (work breakdown structure) is the work spine. It's cut physically
  — spreads, sections, geography — and it gets re-planned constantly. Pipeline 1
  with its breakdown, Pipeline 2 with its breakdown.

They often align and sometimes align exactly, but alignment is never forced.
Welding appears once in the CBS and three times in the WBS, once per pipeline.

Forcing them into one tree means either the contract dictates how you execute,
or every re-plan disturbs the structure you bill and audit against.

**The join is a single pointer, one direction.** A WBS node names at most one
CBS node. Cost is incurred against work, so cost reaches the money spine by
following that pointer up. A CBS node therefore has many WBS nodes under it,
which is exactly the welding case. No mapping matrix — those rot.

## Rules

1. A WBS node that names a CBS node **cannot have children**. The pointer is set
   at the leaf, where work and cost actually happen.
2. A WBS node's CBS pointer may be **blank**. That is a normal state, not an
   error — cost from it is *unassigned* and has to be resolved.
3. Activities hang off WBS **leaf** nodes.
4. Records are never edited directly — everything moves through activities
   (platform sense). Status changes via hooks.

## Record types

### `rt_projects`

| Attribute | Type | Notes |
| --- | --- | --- |
| `project_no` | text | `PR-2026-001` |
| `name` | text | |
| `description` | text | |
| `status` | text | planning / active / complete |

Deferred: `contract` — FK to a contracts record type not yet designed.

### `rt_cbs_nodes`

| Attribute | Type | Notes |
| --- | --- | --- |
| `project` | ref → `rt_projects` | |
| `parent` | ref → `rt_cbs_nodes` | blank at root |
| `code` | text | contract cost code |
| `name` | text | |
| `budget_cost` | number | |
| `budget_qty` | number | |
| `unit` | text | m, ea, t, … |

Budget lives on the CBS because that's the contracted position.

Budgeted hours are not held — quantity and unit carry the measure. Splitting
`budget_cost` by LAB / PLT / SUB / MAT is likely useful and is a later addition,
not v1.

### `rt_wbs_nodes`

| Attribute | Type | Notes |
| --- | --- | --- |
| `project` | ref → `rt_projects` | |
| `parent` | ref → `rt_wbs_nodes` | blank at root |
| `code` | text | |
| `name` | text | |
| `cbs_node` | ref → `rt_cbs_nodes` | optional; leaf only |
| `start` | date | |
| `finish` | date | |
| `duration` | number | days |
| `baseline_start` | date | set once when the plan is approved |
| `baseline_finish` | date | as above |
| `budget_qty` | number | for measured progress |
| `unit` | text | |

### `rt_activities`

Placeholder — designed properly in its own phase. A thing that needs to be
done, or was done.

| Attribute | Type | Notes |
| --- | --- | --- |
| `wbs_node` | ref → `rt_wbs_nodes` | leaf only |
| `name` | text | |
| `status` | text | planned / complete |
| `target_date` | date | planned work |
| `done_date` | date | |

Planned and adhoc are the **same record**, entered at different points.
A hydro test is created weeks ahead with a target date because a specialist has
to be engaged. Welding is created at the end of the day, already done —
W1 to W60, 8 hrs, 1 TA, 1 rig. Status distinguishes them. Do not split the type.

### `rt_cost_lines`

| Attribute | Type | Notes |
| --- | --- | --- |
| `activity` | ref → `rt_activities` | |
| `kind` | text | LAB / PLT / SUB / MAT — Australian industry standard |
| `resource` | text | |
| `quantity` | number | hours for LAB and PLT |
| `rate` | number | |
| `amount` | number | |

One record type with a kind, not four types. Split later only if the
differences prove real.

### `rt_rates`

| Attribute | Type | Notes |
| --- | --- | --- |
| `project` | ref → `rt_projects` | |
| `code` | text | |
| `kind` | text | LAB / PLT |
| `rate` | number | |

Turns 8 hrs and 1 rig into dollars. Effective-dating deferred.

## Workflows

The activity list is **derived from what the component does**, then widened by
asking what else acts on the record type. It is not a mirror of the buttons —
acts that are the same act get one activity (renaming and changing a budget are
both *modify*), and acts no button drives still belong (importing contract cost
codes).

Edits commit **incrementally**, as they are made. The component keeps local
state and updates optimistically so it feels immediate, but each act posts on
its own. There is no "save the tree" activity: batch save would need a diff
engine in the component and would flatten the audit trail. The cost is that
there is no cancel — you fix an edit by editing again, which is acceptable for a
cost structure.

Concurrency is not designed for. A CBS is owned by one person at a time.

### `wf_projects`

| Activity | Kind | Captures |
| --- | --- | --- |
| `act_create_projects` | CREATE | project number, name, description |
| `act_modify_projects` | UPDATE | name, description, status |
| `act_list_projects` | GET | — |

### `wf_cbs_nodes`

| Activity | Kind | Captures |
| --- | --- | --- |
| `act_create_cbs_nodes` | CREATE | project, parent, code, name, budget cost, budget quantity, unit |
| `act_modify_cbs_nodes` | UPDATE | code, name, budget cost, budget quantity, unit |
| `act_move_cbs_nodes` | UPDATE | parent |
| `act_delete_cbs_nodes` | UPDATE | expired |
| `act_list_cbs_nodes` | GET | project |

`wf_wbs_nodes` follows the same five, plus dates and the cost code link.

### Delete is soft, because the platform's is deferred

`record_map: DELETE` and `records.<type>.delete` are deliberately unbuilt in the
platform — they need SDM-level decisions first (DSL_SPEC §"Deferred"). So
delete here sets an `expired` field and the list activity filters it out, which
is the pattern the existing demo model already uses. It converts to a real
delete when the platform grows one.

## Unassigned cost

Cost from a WBS leaf with no CBS pointer is unassigned. It must be listed and
resolvable, never silently lost. Resolution is by setting the leaf's pointer,
which fixes everything under it at once. Line-level override is **not** built
until someone asks for it. Auto-matching by code similarity is a later idea.

## Standard vs actual cost

Rates here are approximate. The finance system holds the actual. If wages are
$100K and this solution's rates produce $110K, the $10K gap has to be dealt with
or nobody trusts either number.

This is **standard costing** — work is charged out at a standard rate, actual
cost lands in the ledger, and the difference is a rate variance. In construction
it usually appears as burden recovery: labour charged at a burdened rate
covering super, leave, workers comp, payroll tax and allowances, all estimated,
with the gap being over- or under-recovery.

Two mainstream approaches:

- **Revalue** — at period end compute the actual rate (actual cost ÷ hours) and
  restate every posting at it. Every job then carries true cost in one number.
  SAP does this. The price is that history moves.
- **Spread as a separate adjustment** — leave captured cost at standard and post
  the difference as its own line, pro-rata on a driver. This is what most
  contractors do by hand in spreadsheets.

**We take the second.** Captured cost lines record what happened, and this
platform's model is that records change only through audited activities —
revaluing history in place fights that. The variance is also a management number
in its own right: rates running 10% hot every month is the signal to fix the
rates, and revaluation hides it. And a close that produces adjustment lines can
be reversed; a revaluation is painful to unwind.

### How it works

1. Rates produce **applied cost** on cost lines.
2. A **period close** takes the actual figure per pool from finance — LAB
   against payroll, PLT against plant running costs — and compares it to the
   applied total for the period.
3. The difference is spread by a driver (labour hours or applied dollars, stated
   explicitly) to whatever consumed the pool, creating **adjustment cost lines**
   flagged as such and naming the close that created them.
4. Adjustment lines roll up the WBS and CBS like any other cost, so CBS totals
   reconcile to the ledger.

Budgets are never touched by a close.

MAT and SUB normally need none of this — they come from real invoices, so there
is no rate to be wrong.

### Indirects

Indirect work — yard duty, stocktakes, wet time — is not merely a destination
for the spread. Those are activities that consume hours, so they earn applied
cost like any other work, into an indirect pool. That pool is then absorbed onto
direct work as a **second pass**.

So it is two passes, not one: **reconcile the rate first, then absorb the
indirect pools.** Conflating them is where hand-built spreadsheets go wrong.

Exception: where the contract CBS carries its own items for indirect cost —
mobilisation, management fees, preliminaries — the pool lands on those CBS items
instead of being absorbed onto direct work. The contract wins.

### Scope note

This needs a period concept and a close, neither of which exists elsewhere in
this spec. It belongs with forecast, after activities are working — not before.

## Pages

1. **Projects list** — the way in.
2. **CBS tree** — view and edit, with budgets.
3. **WBS tree** — view and edit, with the CBS pointer and the no-children rule.
4. **Gantt** — cut-down MS Project. Bars over WBS nodes, dates and durations
   only. **No activities on the Gantt.** No predecessors, no critical path.
5. **Node drill-down** — click a WBS or CBS node, get a flat listing of its
   activities and cost lines. Grouping and pivoting later; full listing first.
6. **Cost spreading** — run a period close: actual per pool against applied,
   the variance, the driver, a **preview before committing**, commit and
   reverse, and a history of past closes so a drifting rate shows up. Its own
   page — a commercial user monthly, not the project manager daily.
7. **Forecast** — its own page, later.

## Finance

The accounting system is the book of record for money. This is the book of
record for work. They meet at the cost code: CBS code ↔ the finance system's
job/project dimension plus GL account.

Labour and plant originate here. Materials and subcontract originate over there
— re-keying a supplier invoice is how you end up with two truths.

**v1 does not integrate.** CSV in, CSV out. One-way push later, two-way only if
customers ask. Integration is where lightweight products go to die.

**Committed cost** — a PO or subcontract raised but not yet invoiced — is not
in scope yet but belongs on the forecast page. Most of the money on a
construction project is committed long before it is spent, so forecast without
commitments is fiction.

## Extension

The activity and its cost lines are the part a maintenance solution and a
timesheet solution share. Only what the activity *hangs off* differs — a WBS
leaf here, a work order there.

Per `docs/BLUEPRINT.md` "Solutions working together", a timesheet that must see
both project and maintenance work needs one data pool, which means
**composition**: a base solution owning activities and cost lines, with
projects, maintenance and timesheets each depending on it and adding their own
links. Dependents add links into a base's types; the base is never modified.

What earns its own solution is **sale and lifecycle, not tidiness**. Nobody buys
a CBS alone, so CBS and WBS stay here. Someone buys timesheets alone.

For now this is built as one solution. The seam is kept by keeping
`rt_activities` free of project-specific attributes beyond `wbs_node`, so the
split stays cheap.

## Open

- Record type and attribute ids need endorsement.
- Whether `duration` is stored or derived from start and finish.
- What sets the baseline, and whether it can be re-set.
- How progress is claimed — quantity to date on the activity, or on the WBS node.
- Contracts record type, and where cost codes come from when they're reusable
  across projects.
