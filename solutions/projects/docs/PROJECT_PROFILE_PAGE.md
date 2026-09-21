# Project profile page + WBS lifecycle — Spec

Drafted 2026-09-13, from the user's brief; revised the same day with their
rulings (§10). **§9 is what remains to settle** — everything else is written as
a build instruction.

Reads against: [SPEC.md](SPEC.md) (the solution), root
[docs/BLUEPRINT.md](../../../docs/BLUEPRINT.md),
[page-runtime SPEC](../../../packages/page-runtime/docs/SPEC.md).

---

## 1. What this is

One page, `pages/project`, reached from the projects list. It is about **one
project record** and shows four things: who it is, what it is, its cost
breakdown and its work breakdown — with the acts that edit all of it in dialogs
**on that page**. No second page, no redirect.

Built out of the two components that are ready: **`Text`** and **`RecordList`**.
Nothing else is used, and **no component is changed to make it fit** (the user's
ruling — the point of this build is to find out what the platform can already
do, so where it is deficient it stays deficient and is written down).

**Scope of the data: the first project only.** The page works for any project
record — it reads whichever one the URL names — but only `P26-011` gets a CBS
and a WBS loaded. The other ten projects open with empty tables, which is the
honest state.

## 2. What already exists (do not rebuild)

| Thing | State |
| --- | --- |
| `rt_projects` | project_no (the record id), name, description, client, job_type, status, target_start, target_completion, approved_budget |
| `wf_projects` | `act_create_projects`, `act_modify_projects` (captures every field incl. status), `act_list_projects` (GET) |
| `rt_cbs_nodes` | code (record id), name, description, project_id, parent_id, budget_cost, budget_qty, unit, expired |
| `wf_cbs_nodes` | create / modify / move / delete (soft) / `act_list_cbs_nodes` (GET) |
| `rt_wbs_nodes` | code (record id), name, description, project_id → projects, parent_id → wbs_nodes, cbs_codes (text), expired |
| `wf_wbs_nodes` | create / modify / move / delete (soft, sets `expired`) / `act_list_wbs_nodes` (GET, takes project_id) |
| Data | P26-011, 7 CBS nodes (flat), 27 WBS nodes (5 phases, 22 children) in Neon dev |
| `RecordList` | columns with type/format/currency, action columns, selection, search, sort, column filters, **nested rows via `parentKey`** |
| `Text` | text (with `{{ }}` holes), style title/heading/subheading/body/caption, align, verticalAlign |
| Page anchor | `PageDef.record` → `?record=` in the URL; the record is live as `context.record` |
| Acts on a page | `RunActivity` / `OpenPage` — as a row action column, or standing alone in a panel |

So the **work is**: new fields on `rt_wbs_nodes`, new activities and gates, the
CBS's second level as data, one new page, one new column on the projects list.
The record types themselves stand.

## 3. The page

**Path** `pages/project` · **record** `{ "type": "rt_projects", "instances": "many" }`
· **access.open** `role_project_admin`, `role_project_user`.

Layout — one vertical root panel:

```
┌──────────────────────────────────────────────┐
│ slot-title      Text ×3            (fixed)   │
├──────────────────────────────────────────────┤
│ slot-actions    RunActivity ×4     (fixed)   │
├──────────────────────────────────────────────┤
│ slot-details    RecordList — property/value  │
├──────────────────────────────────────────────┤
│ slot-cbs        RecordList — nested  (flex)  │
│ slot-cbs-total  Text                (fixed)  │
├──────────────────────────────────────────────┤
│ slot-wbs        RecordList — nested  (flex)  │
│ slot-wbs-total  Text                (fixed)  │
└──────────────────────────────────────────────┘
```

### 3.1 Title

Three `Text` components, so what it is, its id and its name each read as
themselves:

| # | style | text |
| --- | --- | --- |
| 1 | `title` | `Project {{ context.record.project_no }}` |
| 2 | `subheading` | `{{ context.record.name }}` |
| 3 | `caption` | `{{ context.record.client }} · {{ context.record.job_type }} · {{ context.record.status }}` |

The root in a hole is **`context.record`** — the page-runtime SPEC's shorthand
`{{ record.x }}` is illustrative, not a root.

### 3.2 Details

A `RecordList` of two columns, `Property` and `Value`, `selection: 'none'`, no
search, no sort, no filters, no `newLabel`.

Its rows are **a literal list in the page's own dynamic prop** — no new GET, no
round trip, because the anchor record is already resolved and carries every
field:

```
[ { id: 'name',       property: 'Name',             value: context.record.name },
  { id: 'client',     property: 'Client',           value: context.record.client },
  { id: 'job_type',   property: 'Job type',         value: context.record.job_type },
  { id: 'location',   property: 'Location',         value: context.record.location },
  { id: 'geo_point',  property: 'GPS coordinate',   value: context.record.geo_point },
  { id: 'status',     property: 'Status',           value: context.record.status },
  { id: 'wbs_status', property: 'WBS',              value: context.record.wbs_status },
  { id: 'start',      property: 'Target start',     value: context.record.target_start },
  { id: 'finish',     property: 'Target completion',value: context.record.target_completion },
  { id: 'budget',     property: 'Approved budget',  value: context.record.approved_budget },
  { id: 'desc',       property: 'Description',      value: context.record.description } ]
```

Each row carries an `id` because the table keys and selects on it.

**Name joined the table 2026-09-22** — it had only ever been the page's
subheading, and a heading is a title rather than a field someone can look up.
The subheading stays; the row is the one Details is read for.

**Location and the coordinate joined the table 2026-09-22**, with the project's
two new fields (`location`, a plain description of where the works are, and
`geo_point`, a `geopoint` for their centre). The coordinate row passes **the bag
itself**, not `.lat + ', ' + .lng`: a point draws as degrees in any column
(page-runtime SPEC), and the dotted form throws on a project that has no
coordinate — which would take the whole Details table down with it, not just
that row.

### 3.2a Map

A `Map` below Details and above the WBS section, in an **`auto`** panel — the
component states its own size (700px wide, landscape), so the panel only has to
be as tall as what is in it. A `fixed` panel was tried first and collapsed to a
10px strip: `fixed` sets `flex-basis` alone, and every sibling in that column is
content-sized. Its
`lat`/`lng` are guarded — `iif(context.record.geo_point = '', '',
context.record.geo_point.lat)` — for the same reason, and the component draws
"No location" for a project with no point rather than the Gulf of Guinea.

**The known cost of a key/value table: one column, many types, so nothing
formats.** A column's `format` applies to the whole column, and the DSL has no
formatting function, so the date draws `2026-10-01` and the budget `30000000`.
Left deficient on purpose; if the raw values grate, the swap to a one-row table
of typed columns is one slot's config (§9-2).

### 3.3 The CBS

The money spine, on the page because the WBS points at it and reading one
without the other is guesswork. A `RecordList`, `parentKey: 'parent_id'`, rows
from the existing GET:

```
invoke('act_list_cbs_nodes', { project_id: context.record.id })
```

`search: true`, `sortable: true`, `columnFilters: true`, `selection: 'one'`,
`newLabel: ''`.

| key | label | type | format |
| --- | --- | --- | --- |
| `code` | Code | text | width 90 |
| `name` | Resource category | text | |
| `description` | Inclusions & operational scope | text | |
| `budget_cost` | Budget | decimal | `C0`, AUD |

Action columns: Edit (`act_modify_cbs_nodes`), Add child
(`act_create_cbs_nodes`, attribute `parent_id`), Move (`act_move_cbs_nodes`),
Delete (`act_delete_cbs_nodes`). Plus a placed "New code"
(`act_create_cbs_nodes`, attribute `project_id`, record `context.record.id`).

**The CBS is not frozen by WBS approval.** No lifecycle rule was given for it,
so it keeps today's behaviour: editable whenever.

### 3.4 The WBS

One `RecordList`, `parentKey: 'parent_id'`, rows from the existing GET:

```
invoke('act_list_wbs_nodes', { project_id: context.record.id })
```

`search: true`, `sortable: true`, `columnFilters: true`, `selection: 'one'`,
`newLabel: ''` (the create button is a placed `RunActivity` instead — §3.6).

| key | label | type | format |
| --- | --- | --- | --- |
| `code` | Code | text | width 90 |
| `name` | Name | text | |
| `cbs_codes` | CBS | text | width 90 |
| `baseline_budget` | Baseline | decimal | `C0`, AUD |
| `target_start` | Target start | datetime | `dd/MM/yyyy` |
| `target_completion` | Target finish | datetime | `dd/MM/yyyy` |
| `forecast_cost` | Forecast | decimal | `C0`, AUD |
| `forecast_start` | Forecast start | datetime | `dd/MM/yyyy` |
| `forecast_completion` | Forecast finish | datetime | `dd/MM/yyyy` |
| `actual_cost` | Actual | decimal | `C0`, AUD |

Then the action columns — one button per row, each opening the capture form as a
dialog over this page:

| label | component | target | attribute |
| --- | --- | --- | --- |
| Edit | RunActivity | `act_modify_wbs_nodes` | — |
| Add child | RunActivity | `act_create_wbs_nodes` | `wbs_parent` |
| Move | RunActivity | `act_move_wbs_nodes` | — |
| Delete | RunActivity | `act_delete_wbs_nodes` | — |

Ten data columns and six buttons is wide; the panel scrolls sideways. Looked at
before anything is dropped.

**A frozen act still draws its button.** `RunActivity` does not consult the
activity's availability condition; the refusal arrives as a message when it is
clicked. That is the 2026-08-26 ruling working as intended — a control is shown
whether or not you may use it, and the model says why. Greying out would be a
component change, which this build does not make.

### 3.5 Totals

One `Text` under each table, `style: caption`:

```
slot-cbs-total   Budget total  {{ invoke('act_total_cbs_nodes', { project_id: context.record.id }) }}
slot-wbs-total   Baseline {{ invoke('act_total_wbs_baseline', …) }} · Forecast {{ invoke('act_total_wbs_forecast', …) }}
```

> **BUILT, and it does not work — see §8-5.** The functions and the three total
> GETs are in the model and validate cleanly, but a decimal field is **stored as
> text** and the language has no way to turn text into a number, so the loop
> below concatenates instead of adding. The page carries the project's stored
> `approved_budget`, labelled as the contract figure, until that is fixed.

**Buildable with what exists — through a named function.** The query chain has
`count` and `first` and no `sum` (aggregation is deferred, DSL_SPEC §4.2/§12),
and a page cannot do the arithmetic itself because the Runtime app connects with
no records at all. But a GET's `returns` is an expression, a **named function**
is callable from an expression, and a function is the scripts tier — `let` and
`for each`. So each total GET is one line calling one small function:

```
returns:  wbsBaselineTotal(attributes.project_id)

function wbsBaselineTotal(project) {
  let total = 0
  for each n in records.wbs_nodes.where(project_id = project and expired <> 'true') {
    total = total + n.baseline_budget
  }
  return total
}
```

Functions are a first-class SDM collection (`sdm_functions`, DSL_SPEC §8) with
mandatory descriptions and save-time validation, so this adds no mechanism and
no component change — it is the platform's own answer to "expressions ask,
functions think". It runs on the server inside the GET and is logged like any
other read.

Adding `sum` to the query chain would make it a one-liner instead, and remains
worth doing on its own merits — but nothing here waits on it.

The totals draw unformatted (`30000000`) — same missing formatting function as
§3.2, same ruling: left deficient.

### 3.6 Placed acts (not row actions)

| slot | component | target | record | attribute |
| --- | --- | --- | --- | --- |
| slot-actions | RunActivity "Edit project" | `act_modify_projects` | `context.record.id` | — |
| slot-actions | RunActivity "Approve WBS" | `act_approve_wbs_projects` | `context.record.id` | — |
| slot-actions | RunActivity "Start project" | `act_activate_projects` | `context.record.id` | — |
| slot-actions | RunActivity "Complete project" | `act_complete_projects` | `context.record.id` | — |
| slot-wbs (header) | RunActivity "New node" | `act_create_wbs_nodes` | `context.record.id` | `project_id` |

The last row is why the table's own `newLabel` is blank: a toolbar create cannot
seed anything, and a root WBS node needs its project. A placed `RunActivity`
with `attribute: 'project_id'` fills it from the page's record.

### 3.7 Getting here

`pages/projects` gains one action column: `OpenPage`, label `Open`, target
`pages/project`. The row id is the project, so the URL becomes
`?page=pages/project&record=P26-011`.

## 4. Model changes

### 4.1 `rt_wbs_nodes` — seven new fields

| key | type | Notes |
| --- | --- | --- |
| `baseline_budget` | decimal | approved cost. Leaf only. |
| `target_start` | datetime | approved start. Leaf only. |
| `target_completion` | datetime | approved finish. Leaf only. |
| `forecast_cost` | decimal | live projection. Leaf only. |
| `forecast_start` | datetime | live projection. Leaf only. |
| `forecast_completion` | datetime | live projection. Leaf only. |
| `actual_cost` | decimal | **read-only — no activity captures it.** Nothing writes it today (§8-3). |

Names are snake_case because every field in this model is; the brief's
`baselineBudget` etc. are the same fields. `target_start` / `target_completion`
match `rt_projects`' own two on purpose.

**Parents hold nothing and show blank** in all seven columns — no roll-up
(§8-1, the user's ruling).

### 4.2 `rt_projects` — one new field

| key | type | Notes |
| --- | --- | --- |
| `wbs_status` | text | `draft` → `approved`. The freeze switch. |

"Every project points to exactly one WBS" needs no build: WBS nodes point at the
project, so there is exactly one by construction. There is no WBS-structure
record and none is proposed — the status lives on the project.

`status` becomes `Created` / `Active` / `Completed`. Existing rows carry
whatever the sample JSON held (P26-011 is `Active`) — they need checking and a
one-off correction before the gates mean anything.

### 4.3 `act_list_wbs_nodes` must be widened

Its `returns` names its fields explicitly, so **a new field is invisible until
the GET selects it** — the gotcha that drew empty cells on the projects page.
Add all seven.

### 4.4 The CBS gets its second level (data, not model)

The seven codes loaded today are the parents. Their children arrive as ordinary
records through `act_create_cbs_nodes`, with `parent_id` naming the thousand
above them — which is also what makes the WBS's existing `1200 / 1300 / 1400`
references resolve, since those codes did not exist until now.

Five of the seven parents are **renamed** to the wording supplied, through
`act_modify_cbs_nodes` like any other change.

| Code | Name | Scope |
| --- | --- | --- |
| **1000** | Direct Internal Labour | Your own company PAYG employees on the project |
| 1100 | Project Management & Engineering | PMs, site engineers, safety officers |
| 1200 | Site Supervision | Superintendents, foremen |
| 1300 | Skilled Wages | Coded welders, plant operators, riggers |
| 1400 | General Civil Labour | Trades assistants, ground crews, spotters |
| **2000** | Permanent Materials | Assets bought and left permanently in the ground or on site |
| 2100 | Primary Bulk Materials | Line pipe, asphalt, structural concrete, steel reinforcement |
| 2200 | Precast & Prefabricated Components | Pits, culverts, valves, structural skids |
| 2300 | Secondary Fixes & Architectural Fittings | Fasteners, instrumentation components |
| **3000** | Project Consumables | Items used up or exhausted entirely on site during execution |
| 3100 | Fuel, Oils & Lubricants | Diesel for heavy machinery, grease |
| 3200 | Trade Consumables | Welding rods, gases, grinding discs, formwork timber |
| 3300 | Environmental & Safety Consumables | Silt fencing, erosion blankets, PPE, safety tape |
| **4000** | Plant & Equipment Hire | Machinery used to build the work |
| 4100 | Heavy Earthmoving Plant | Excavators, bulldozers, graders, rollers |
| 4200 | Specialized Lifting & Access | Sidebooms, cranes, pin-booms, scissor lifts |
| 4300 | Site Vehicles & Support | Site utes, fuel trucks, water carts, small tools |
| **5000** | Subcontractors | Third-party fixed-price packages or specialist services |
| 5100 | Trade Subcontractors | Electrical contractors, specialised drilling, concrete placers |
| 5200 | Professional Technical Services | Surveyors, third-party NDT inspectors, soil testers |
| **6000** | Preliminaries & Project Indirects | The overhead costs required to run the job site |
| 6100 | Site Mobilisation & Demobilisation | Heavy haulage floats, site setup |
| 6200 | Site Compound & Facilities | Site hut hire, temporary toilets, power and water drop-ins |
| 6300 | Compliance & Fees | Council permits, environmental authority filings, land access fees |
| **7000** | Risk & Contingency | Monies held to mitigate project exceptions |
| 7100 | Unforeseen Site Anomalies | Latent ground conditions, rock strikes |
| 7200 | Weather & Delay Provisions | RDO extensions, wet weather delay overheads |

**Budget stays on the seven parents** ($30M in total, as loaded) because no
split across the children was supplied. That contradicts "figures live at the
leaf" — deliberately, until real numbers arrive — and it means the CBS total is
the sum of the parents while the WBS total is the sum of its leaves. Written
down rather than quietly reconciled.

`code` is the record id, so these 20 codes are unique across the whole
operation: a second project cannot have its own `1100`. Existing CBS design,
already flagged, unchanged here.

## 5. Activities

### `wf_wbs_nodes`

| Activity | Record map | Captures | Gate |
| --- | --- | --- | --- |
| `act_create_wbs_nodes` | CREATE | project_id, parent_id, code, name, description, cbs_codes | before hook: project's `wbs_status` must be `draft`. after hook: a parent that carried figures has all seven cleared — it has stopped being a leaf |
| `act_modify_wbs_nodes` — **"Edit WBS Node"** | UPDATE | code, name, description, cbs_codes, baseline_budget, target_start, target_completion, forecast_cost, forecast_start, forecast_completion — **each with its own `show_condition`** | availability: draft **or** leaf. Merged 2026-09-21; see below |
| `act_move_wbs_nodes` | UPDATE | parent_id | availability: draft |
| `act_delete_wbs_nodes` | UPDATE | expired, **sourced** `'true'` | availability: draft **and** leaf — a node with children is refused (below). Nothing is asked: the flag is filled from the model, so Delete has no form and runs on the click (2026-09-18) |
| `act_list_wbs_nodes` | GET | project_id | — |
| `act_total_wbs_baseline` | GET | project_id | calls a named function (§3.5) |
| `act_total_wbs_forecast` | GET | project_id | calls a named function (§3.5) |

**Why the baseline and the forecast are two activities, not one:** approval
blocks one and allows the other, and the thing approval acts on is the activity.
One activity capturing six fields could not be half-frozen.

**A delete takes one node, and only a childless one** (ruled 2026-09-13,
reversing the cascade written earlier the same day). A node with children is
refused at the gate — *"delete what is under it first"* — and the same leaf test
the baseline activity uses does the checking.

Why the reversal, since a cascade was specced and was buildable: it would have
run in the delete activity's after hook, and a hook write deliberately leaves
**no trail on the record it touches** (the 2026-08-09 ruling — one hook writing
500 rows must not grow 500 history arrays), while the mod-stamp and hook-history
table agreed alongside it are **not built**: neither is in the server schema. So
one click would have expired a branch with a single history entry to show for
it, and the nested loops only reached a fixed depth anyway, since the language
has no recursion. Deleting from the bottom takes more clicks and leaves one
history entry per node, on the node — which is the audit spine working as
designed.

**Leaf test**, in an availability condition on the node:
`records.wbs_nodes.where(parent_id = context.record.id and expired <> 'true').count = 0`

**Draft test on a CREATE** cannot be an availability condition — a CREATE has no
anchor record, so `context.record` is null. It is a before hook:
`if records.projects.where(id = attributes.project_id).first.wbs_status = 'approved' { fail('The WBS is approved — no new nodes.') }`

### `wf_projects`

| Activity | Record map | Captures | Gate |
| --- | --- | --- | --- |
| `act_create_projects` | CREATE | as today | — |
| `act_modify_projects` | UPDATE | name, description, client, job_type, target_start, target_completion, approved_budget — **status removed** | — |
| `act_approve_wbs_projects` | UPDATE | — (after hook sets `wbs_status: 'approved'`) | availability: `wbs_status = 'draft'`. before hook: the project must have at least one WBS node |
| `act_activate_projects` | UPDATE | — (after hook sets `status: 'Active'`) | availability: `status = 'Created' and wbs_status = 'approved'` |
| `act_complete_projects` | UPDATE | — (after hook sets `status: 'Completed'`) | availability: `status = 'Active'` |
| `act_list_projects` | GET | as today | — |

### `wf_cbs_nodes`

Unchanged, plus `act_total_cbs_nodes` (GET, project_id) for §3.5.

**Status stops being a typed-in field.** A transition is an act with a name in
the history — "Start project" — not a free edit of a text box, and it is the
only way the Created → Active rule can be enforced at all. This is a change to
an existing activity: `act_modify_projects` currently captures `status`.
(Ruled §10.)

A transition activity captures nothing and does its work in the after hook
(`context.record.update({ status: 'Active' })`). After hooks run in mutate mode;
this is the one shape that lets an activity *be* the transition.

## 6. The lifecycle, in one table

| | WBS draft (project `Created`) | WBS approved (project `Active` / `Completed`) |
| --- | --- | --- |
| Add node | yes | refused at the gate |
| Delete node | yes, childless ones — delete upward | refused |
| Move node | yes | refused |
| Rename / re-code / CBS link | yes | refused |
| Baseline + target dates | yes, leaf only | refused |
| Forecast cost + dates | yes, leaf only | **yes**, leaf only |

Approval is one-way. Nothing here un-approves a WBS; a re-baseline would be a
new act with its own name and its own history entry (§9-3).

## 7. Where this sits against the solution spec

[SPEC.md](SPEC.md) puts budget on the **CBS** — "the contracted position" — with
the WBS pointing at it. The brief puts baseline and forecast cost on **WBS
leaves**. Both now stand: **the CBS is what the contract says, the WBS is what
the work is planned and re-planned to cost**, and nothing reconciles the two
totals in v1. That is a real difference a commercial user reads on purpose, not
a contradiction to resolve.

Still open from the original spec: `cbs_codes` is free text and some WBS nodes
name two codes (`4000 | 1400`), where SPEC.md rules one pointer, at a leaf
(§9-4). The codes themselves now all exist (§4.4).

## 8. What stays deficient (the user's ruling: no component changes)

1. **No roll-up to parents.** The brief asks for parent figures calculated from
   children. Not possible without a component change or a language change: the
   DSL has no `sum`, a GET's `returns` cannot loop, and a stored roll-up needs a
   tree walk of unbounded depth that a language with no `while` and no recursion
   cannot express. RecordList could compute it in the browser — it already
   builds the tree — and that is **explicitly not being built**. Parents draw
   blank.

   *Recorded, not scheduled:* the in-platform way to solve it later is a
   **named function** (DSL_SPEC §8, a first-class SDM collection with its own
   table) called from the GET's `returns` — `wbsRows(attributes.project_id)`.
   A function is the scripts tier, so it has `let` and `for each`: it reads the
   flat rows, adds each leaf's figures onto its ancestors, and returns exactly
   the dataset the table draws. It runs on the server, inside the GET, and is
   logged like any other read. Its limit is depth — no `while` and no
   recursion, so it rolls up a fixed number of levels per pass.
2. **A control may seed exactly one attribute.** "Add child" seeds `parent_id`,
   so `project_id` is left for the user to pick in the dialog. Fix inside the
   model: make `project_id` optional on create and have the after hook fill it
   from the parent when blank.
3. **`actual_cost` has nothing to fill it.** No ledger, no cost lines, no period
   close — Phases 6–10 of the backlog. The field exists, stays blank, and no
   activity captures it, which is what "read-only, injected from an external
   module" means until the module exists.
4. **No formatting function in the DSL**, so the key/value details table and the
   totals draw raw values.
5. **Found while building (2026-09-14), and both are the user's call:**

   **A new field does not reach the records that predate it.** Adding a field to
   a record type touches no rows; defaults are applied in
   `MemoryAdapter.buildRecord`, the create path, and nowhere else. And the DSL
   reads a record's stored jsonb only: an absent key **throws** — `'wbs_nodes'
   has no field 'baseline_budget'` (evaluator.ts:615) — rather than reading as
   null. So one new field broke every GET, gate and total that named it, for
   every row loaded before today. `backfill-record-fields.ts` filled 38 rows.
   The proper fix is that a **declared** field absent from a row reads as its
   default: the validator has already proved the name is real at save time, so
   the runtime throw can only ever fire on a sparse row, never on a typo.

   **A page cannot scroll** (found 2026-09-14, driving the built page). Every
   panel shrinks to fit the viewport, so a page is always a fixed split and the
   only scrolling is inside a table. `PageRenderer.panelStyle` gives a fixed
   panel a `flexBasis` with no `flexShrink: 0`, and reads neither `minSize` nor
   `maxSize` — both of which `Panel` declares and the Console's **own layout
   canvas already honours** (`LayoutCanvas.tsx:42-52`), so the editor preview
   and the rendered page disagree. No page def can work around it. The fix is
   those three lines in `panelStyle`, which needs the parent's direction passed
   down the way the canvas does it.

   **Nothing can add up money.** A decimal field is stored as **text** — capture
   coerces for scripts, but what persists is what the user typed — and the
   language has no cast: `+` with a string concatenates, `-` and `*` throw on
   one, and there is no `number()` among the builtins (`iif`, `now`, `date`,
   `exact`, `len`, `lower`, `upper`, `trim`, `abs`, `round`, `fail`, `warn`,
   `invoke`). So `wbsBaselineTotal` returns `024000001260000018000004500000…`.
   Smallest fix: a `number(text)` builtin. `sum` on the query chain would be
   the nicer one and needs the same coercion underneath.

## 9. To settle before build

1. **Totals are built as named functions** (§3.5) — confirm, since it puts the
   first FluxScript functions into this solution. Nothing else in the spec needs
   a platform addition.
2. **Details as key/value (unformatted) or one row of typed columns
   (formatted)** — §3.2. Recommendation: key/value as asked, look at it, swap if
   it grates.
3. **Is approval reversible?** Nothing here un-approves.
4. **Does `cbs_codes` stay free text and many-per-node**, or become the single
   leaf pointer SPEC.md rules?
5. **Names to endorse**: `pages/project`, `wbs_status`, `baseline_budget`,
   `forecast_cost`, `actual_cost`, `act_baseline_wbs_nodes`,
   `act_forecast_wbs_nodes`, `act_approve_wbs_projects`,
   `act_activate_projects`, `act_complete_projects`, `act_total_cbs_nodes`,
   `act_total_wbs_baseline`, `act_total_wbs_forecast`.

## 10. Rulings taken on this spec (2026-09-13)

- **No component changes.** Where the platform is deficient it stays deficient
  and is recorded — the build is a test of what exists.
- **A leaf that gains a child loses its own figures** — all seven cleared by the
  create activity's after hook. It has stopped being a leaf, so it has stopped
  being where money and dates live.
- **A delete takes one childless node** — no cascade (reversed the same day, on
  the safer reading): a node with children is refused, and you delete from the
  bottom. Every deleted node then has its own history entry, which a hook-driven
  cascade would not have given.
- **Status is an act** — `Start project`, `Complete project`, `Approve WBS` —
  and `status` leaves `act_modify_projects`.
- **Roll-up: not built.** Parents blank.
- **Delete: no cascade, no childless rule.** While the WBS is unlocked, a delete
  is a delete.
- **A total is wanted, drawn with `Text`.**
- **The CBS joins the page**, and the first project gets the two-level CBS
  above.
- **Data for the first project only.**

## 11. Built — 2026-09-14

All of it, on the `projects-dev` operation of the Neon dev branch. Scripts live
in `packages/server/scripts/`, the convention for one-offs.

| Script | What it did |
| --- | --- |
| `wbs-lifecycle.ts` | 4 pool attributes, 7 fields on `rt_wbs_nodes`, `wbs_status` on `rt_projects`, 3 named functions (the solution's first), 2 new WBS activities, 3 project transitions, gates and hooks on the rest, 3 total GETs, both list GETs widened |
| `backfill-record-fields.ts` | 38 existing records given the new keys — see §8-5, the reason it had to exist |
| `load-cbs-detail.ts` | 7 CBS parents renamed, **20** children created, P26-011 moved to `Created` |
| `project-page.ts` | `pages/project` written, and the `Open` column added to `pages/projects` |
| `verify-wbs-lifecycle.ts` | the lifecycle driven end to end through the real engine, **never written back** — kept as the regression harness |
| `wbs-attributes.ts` (2026-09-15) | `wbs_parent` / `wbs_project` — a reference attribute that names the field it fills, and the project sourced from the page rather than picked |
| `wbs-delete-source.ts` (2026-09-18) | `expired` sourced to `'true'` on the delete activity — see below |
| `projects-new-button.ts` (2026-09-22) | `pages/projects` given its **New project** label — the `onNew` callback was already wired, so the list had a create path with no control to reach it |
| `wbs-one-edit.ts` (2026-09-21) | Modify + Baseline + Forecast merged into one **Edit** activity; the other two deleted |
| `wbs-page-buttons.ts` (2026-09-21) | the Baseline and Forecast buttons taken off the WBS table |
| `retire-id-field.ts` (2026-09-18) | `id_field` dropped from `rt_projects`, `rt_wbs_nodes`, `rt_cbs_nodes` — every record now gets an issued UUIDv7 |
| `projects-location.ts` (2026-09-22) | `location` + `geo_point` on `rt_projects` and both project activities; the eleven projects given a place, a coordinate and a description — **written straight to the records**, the user's ruling for demo data |
| `project-page-location.ts` (2026-09-22) | Name, Location and the coordinate added to Details; a `Map` panel between Details and the WBS. Edits the stored draft rather than rewriting it, so Console changes survive |
| `retire-cbs-page.ts` (2026-09-22) | the **Cost Breakdown** column taken off the projects list, `pages/cbs` deleted (draft + 4 published versions), and the attribute pool swept for unused entries — there were none |

**One Edit, not three** (2026-09-21, the user's call). Three activities existed
because availability is declared per activity: baseline and forecast fields
belong only to a leaf, and approval freezes the baseline while leaving the
forecast open. Splitting them was how that got said — at the cost of three
buttons on every row, and a "Baseline" column whose reader had to know it meant
the budget and not the dates.

It is said per attribute instead. An attribute usage carries its own
`show_condition`, evaluated against the record as the form opens and re-checked
by `validateSubmission`, so the approval freeze is still **enforced** rather than
merely undrawn:

| Fields | Offered when |
| --- | --- |
| code, name, description, cbs_codes | the project's WBS is unapproved |
| baseline_budget, target_start, target_completion | leaf **and** unapproved |
| forecast_cost, forecast_start, forecast_completion | leaf — after approval too |

The activity itself is offered on `draft or leaf`: an approved parent has
nothing left to edit, and a form with every field hidden is worse than no
button.

**The baseline's after hook went with it.** It copied the baseline into the
matching forecast fields, on the reasoning that a plan with no projection reads
as one nobody has looked at. Entering target dates and finding the forecast
dates silently filled was reported as a bug, and with one form a person fills
both in the same act if that is what they mean.

**The WBS was keyed on its code** until 2026-09-18, and that is what produced
`Record id "AAA" already exists` when a node was deleted and re-added: the id
outlives the record in the reporting rows. Codes are ordinary values now and
identity is issued (BLUEPRINT, "Record identity"). Two consequences for this
solution: nodes created before that date keep their code-shaped ids and nothing
re-keyed them, so the WBS table holds both shapes; and **a WBS code is no longer
unique by construction**. It was globally unique before, which was wrong anyway
— a second project could not have reused the first's codes — but the rule that
actually fits, unique *within a project*, has no expression in the model yet.

**Delete asked instead of acting** (found 2026-09-18, in use). `act_delete_wbs_nodes`
captured a bare `expired`, so the row action opened a form holding one text box,
and an UPDATE prefills from the record it is about — the box arrived reading
`false` and Run wrote false over false. The dev data carries four such runs,
every one capturing `{ expired: 'false' }`, and nothing ever expired. The answer
was never a question, so it is now sourced to the literal `'true'`; the activity
has nothing left to capture and Delete runs on the click. That drops a
confirmation step nobody had designed as one — `show_condition` still refuses a
node with children or an approved WBS, and the act reverses by flipping the flag
back. Re-running `wbs-lifecycle.ts` would undo this **and** the 2026-09-15
attributes; it predates both.

**Verified** (17 checks, all passing): a leaf takes a baseline and the forecast
copies from it; a parent is refused one; a leaf that gains a child loses its
figures; a node with children refuses to be deleted and a childless one goes; a
project cannot start before its WBS is approved; approval then refuses rename,
re-baseline, move, delete and new-node, while the forecast stays open; complete
works from Active. The page's every expression and hole evaluates, and every
activity it names exists — checked by `project-page.ts` before it wrote, since
a page written by a script never meets `validatePage`.

**Not working: the totals** (§3.5, §8-5) — the arithmetic gap.

**Pages are drafts.** `pages/project` and the changed `pages/projects` need
publishing in the Console before the Runtime app shows them.

**`pages/cbs` is gone** (2026-09-22, the user's call): the CBS lives on the
project page, so the standalone page and its four published versions were
deleted outright and the **Cost Breakdown** column came off the projects list.
Deleting published versions is normally forbidden — they are append-only, and
rollback is a republish — and it was done here because "remove the page
altogether" means that. **Until `pages/projects` is republished, the published
version the Runtime app renders still carries the Cost Breakdown button, and it
now opens nothing.**
