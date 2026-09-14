# Projects — Backlog

Drafted 2026-08-26. Ordered. Nothing built.

The point of this build is as much to find out what the platform can't do yet as
it is to get the solution. Expect platform gaps to be logged as they surface.

## Phase 1 — Model

- [ ] Endorse record type and attribute ids (see SPEC "Open")
- [ ] `rt_projects`
- [ ] `rt_cbs_nodes` with budget cost, hours, quantity, unit
- [ ] `rt_wbs_nodes` with the `cbs_node` pointer, dates, baseline dates
- [ ] `rt_activities` — minimal placeholder
- [ ] `rt_cost_lines` with the LAB/PLT/SUB/MAT kind
- [ ] `rt_rates`
- [ ] Activities (platform sense) to create and amend each

## Phase 2 — Projects list

- [ ] Listing page: number, name, description, status
- [ ] Create a project (dialog, per house rule)
- [ ] Open a project → its planning pages

## Phase 3 — CBS tree

- [ ] Tree view of a project's CBS
- [ ] Add, rename, re-parent, delete a node
- [ ] Budgets editable on a node
- [ ] Roll-up of budget to parents

## Phase 4 — WBS tree

- [ ] Tree view of a project's WBS
- [ ] Add, rename, re-parent, delete a node
- [ ] Set a leaf's CBS pointer
- [ ] **Enforce: a node with a CBS pointer takes no children**
- [ ] Show which leaves have no CBS pointer

## Phase 5 — Gantt

- [ ] Bars over WBS nodes: start, finish, duration
- [ ] Edit dates from the chart or the grid beside it
- [ ] Summary bars roll up from children
- [ ] Set baseline; show baseline against current
- [ ] Explicitly out: predecessors, critical path, calendars, levelling,
      histograms, activities on the chart

## Phase 6 — Activities and cost

- [ ] Design `rt_activities` properly
- [ ] Capture what was done and effort: LAB, PLT, SUB, MAT
- [ ] Rates turn hours into dollars
- [ ] Cost rolls to the WBS node, and via its pointer to the CBS node
- [ ] Planned vs adhoc entry paths over the one record type

## Phase 7 — Drill-down

- [ ] Click a WBS or CBS node → flat listing of activities and cost lines
- [ ] Later: grouping, pivoting, column choice

## Phase 8 — Unassigned cost

- [ ] Worklist of cost with no CBS
- [ ] Resolve by setting the WBS leaf's pointer
- [ ] Later: auto-match by code

## Phase 9 — Progress

- [ ] Quantity to date against budget quantity
- [ ] Percent complete rolled up the WBS
- [ ] Target vs forecast completion dates

## Phase 10 — Cost spreading

- [ ] Period concept and a close
- [ ] Enter or import actual cost per pool from finance (LAB, PLT)
- [ ] Compare applied total to actual, compute the variance
- [ ] Spread by a stated driver into adjustment cost lines, each naming its close
- [ ] Cost spreading page: period, actuals, variance, driver, **preview before
      commit**, commit, reverse, history of past closes
- [ ] Reverse a close
- [ ] Indirect pools: applied cost in, absorbed to direct work as a second pass
- [ ] Land the pool on contract indirect CBS items where they exist, instead of
      absorbing

## Phase 11 — Forecast

- [ ] Its own page
- [ ] Budget, actual, variance by CBS node
- [ ] Cost to complete, forecast final cost
- [ ] Needs committed cost to be honest — see SPEC "Finance"

## Later, not scheduled

- Contracts record type; `contract` on the project
- CSV export and import for finance
- Reusable cost code libraries across projects
- Line-level CBS override on a cost line
- Effective-dated rates
