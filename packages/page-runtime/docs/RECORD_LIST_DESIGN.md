# RecordList — what the table does

Drafted 2026-08-28, settled and ordered for build 2026-09-07. Nothing here is
built yet beyond what the notes mark as built.

The table will be the most-used component on any page, so the cost of getting it
wrong is paid on every screen. This lists what it does, and for each behaviour
whether it is **fixed** (the component decides, every screen looks the same) or
**declared** (the implementer decides, in the page builder). Every declared
property is power for the implementer and one more decision they must make.

**It is built in steps** (§7), not in one go. Each step ships something usable,
and each adds properties rather than reshaping the ones before it, so being
wrong about a later step costs nothing now. Where a behaviour needs something
the platform doesn't have, this says so rather than proposing a way round it.

---

## 1. Structure

| # | Behaviour | Fixed / declared | Decision |
|---|---|---|---|
| 1.1 | Toolbar above the table: title left, actions right | **fixed** | The layout is what makes every screen look the same. Not arrangeable. |
| 1.2 | Toolbar actions | **declared** — `actions: [{ label, callback }]`; the bulk half **BUILT 2026-09-08** as `bulkActions` | Replaces today's hard-coded `newLabel`/`onNew`. A page declaring none gets a bare title; three gets three. First action drawn as the prominent one. **Split by what an act is about**: a toolbar action over *no* record (a second `New`) is still unbuilt; one over *the checked records* is `bulkActions`, built with step 3 and shown only once something is checked. |
| 1.3 | Row actions, at the end of the row | **declared** — `rowActions: [{ label, callback }]` | Replaces `editLabel`/`openLabel`/`onEdit`/`onOpen`. Multiple per row was always the intent. Beyond about three, the rest collapse into an overflow menu — **fixed**, so rows never grow a wall of buttons. |
| 1.4 | The open control — `>` at the very end of the row | **fixed** position and appearance, **declared** callback (`onOpen`) | Kept separate from row actions on purpose: "go to this record" means the same thing on every screen, so it always looks the same and always sits last. This is also what master-detail hangs off (§5). |
| 1.5 | Columns | **declared** — `{ key, label?, width?, type?, format? }` | `key` and `label` built 2026-08-28. `width` is a hint; blank means auto. `type` and `format` are §2. |
| 1.6 | Column alignment | **fixed**, from the column's type | Numbers and currency right, everything else left. No separate alignment property — today's `numeric` flag disappears into `type`. |
| 1.7 | Empty message | **declared** (built) | |
| 1.8 | Row click | **fixed**: selects, nothing more | A click that silently starts an edit is a click nobody asked for. |

## 2. How a value is drawn

Two layers, and keeping them apart is what stops this multiplying:

- **The column** says how its value is drawn **always** — the type, and the
  format that goes with it.
- **Display conditions** (§3) change that **when something is true**. They only
  reach style, plus a format override.

| # | Behaviour | Fixed / declared | Decision |
|---|---|---|---|
| 2.1 | Column type | **declared** — `type` | Reuses the model's own attribute types (text, number, date, boolean, photo, …) rather than inventing a second vocabulary. A `photo` column draws the file descriptor the platform already produces, with the same storage behind it — not a URL someone assembles by hand. |
| 2.2 | Which types exist | — | Add one when a screen needs it. Text, number, date, boolean and photo cover what exists now. Coordinates, icons and links wait. |
| 2.3 | Column format | **declared** — `format` | Established format strings, so nobody learns ours: `dd/mm/yyyy`, `C2`, `N2`. |
| 2.4 | Per-type settings (a thumbnail's size, a currency's code) | **declared**, on the column | These belong with the type. A currency's code either sits on the column (every row the same) or names another field in the row (each row its own) — the column shape must allow both. |
| 2.5 | A cell drawn by another component | **deferred, on purpose** | The long-term answer for thumbnails, icons, sparklines, and it stops the type list growing. But a cell renderer has to be a registered component with its own properties — that is the composition question arriving inside a cell, and it gets designed on its own. Not a third key slipped into a column. |
| 2.6 | Working the type out instead of declaring it | **not possible today** | Rows come from a GET's `returns` expression, so nothing knows a field is money or a photo. If GETs ever declared the fields they return, type and a default format could be worked out and the implementer would only override. That is bigger than the table; it is also the same gap behind sorting and filtering. |

## 3. Display conditions

A list of rules, each applying to a row or to named cells within it:

```
[
  { columns: [],         when: "row.status == 'overdue'", style: { tone: 'danger' } },
  { columns: ['status'], when: "row.status == 'overdue'", style: { bold: true } },
]
```

| # | Behaviour | Fixed / declared | Decision |
|---|---|---|---|
| 3.1 | Where a rule applies | **declared** — `columns` | Named columns, or the whole row when empty. |
| 3.2 | The condition | **declared** — a FluxScript expression over the row | Not a second condition language. We have one language, the expression dialog already edits it, the validator already checks it. |
| 3.3 | What a rule may change | **fixed set** | Emphasis (bold) and a tone — warning / danger / good / muted — mapped to the theme's colours. **Not raw CSS**: `color: 'red'` lets every implementer pick their own red, screens stop matching, and nothing survives a dark theme. |
| 3.4 | Overriding the format | **declared**, optional | A rule may override the column's format when it fires. The column still carries the format that always applies. |
| 3.5 | Two rules setting the same thing | **fixed** | Rules apply top to bottom; the later one wins. |
| 3.6 | Cost | — | With no paging, every rule is evaluated against every row: 5,000 rows and three rules is 15,000 evaluations per render. |

## 4. Working with the rows

| # | Behaviour | Fixed / declared | Decision |
|---|---|---|---|
| 4.1 | Sorting by clicking a heading | **fixed** behaviour, **declared** once for the table (`sortable`, default **off**) | **BUILT 2026-09-12; per-column control retired 2026-09-13** — finer than any screen needed, and an array-item boolean has nowhere honest to keep a default-on, since the array editor seeds every one to `false`. Sorts the rows already delivered, in the browser, by the **underlying** value and the column's type. Correct as long as every row is present — see 4.4. A third click restores the order the rows arrived in. |
| 4.2 | Quick search box in the toolbar | **declared** on/off (`search`) | **BUILT 2026-09-12.** Filters the delivered rows in the browser across all columns, matching the **drawn** cell so a date is searched as it is written. No round trip. It narrows what is shown, never what is ticked. Per-column filtering is 4.10, not this. |
| 4.3 | Real filters (change what is fetched) | **not this component** | A filter bar is its own component: it writes the chosen values into page context, the table's `rows` expression reads them, the read re-runs. Listed here so it isn't built into the table by mistake. **Not to be confused with 4.10**, which narrows rows already in hand and fetches nothing. |
| 4.4 | Paging | **none — ruled 2026-08-28** | The read path has no limit or offset, so the table fetches and shows every row: a screen listing 5,000 records delivers 5,000. **Said plainly rather than hidden behind page buttons over the browser's own copy, which would leave the cost exactly where it is.** Real paging is a change to the read path, deferred until it is built properly. |
| 4.5 | Selection | **declared** — `selection: 'none' \| 'one' \| 'many'` | **BUILT 2026-09-08.** Both, because selecting rows is fundamental, not polish. `'one'` is the default and what the table always did. `'many'` adds a checkbox column and a select-all in the header, and the row click toggles. |
| 4.6 | What a multi-selection can be used for | **BUILT 2026-09-08 as `bulkActions`** | The table emits the selected records when the selection changes; that callback's script stores them with `services.page.setContext`; a toolbar action's script walks the list with `for each` and runs the activity once per record. Each run still carries one record as its anchor, so authorisation is untouched and the one-value callback contract holds. **Superseded 2026-09-08**: the run-once-per-record pattern is not what was built. `bulkActions` runs the activity **once**, with the ticked ids in a nominated attribute and the hook doing the work — so there is one form, one confirmation, one pipeline entry, and the fifty-prompts doubt never arises. The script and the page-context round trip are gone with it. |
| 4.7 | Totals row | **declared**, optional | Three parts: which columns and what function (sum, average, count); which rows count — **the rows currently shown**, so searching changes the total, which is what people expect (a condition to include only some rows can come later); and what the row says on the left. |
| 4.8 | Grouping rows under headings | — | Deferred. It changes the table's shape considerably. **Not 4.11**: grouping invents a heading out of a *value* several rows share, while nesting shows records that genuinely point at one another. |
| 4.9 | Editing a value in the table | **never** | Records change through activities. A row action opens the capture form. The one behaviour the platform forbids outright. |
| 4.10 | A filter per column, Excel-style | **declared** — `columnFilters` on/off, default **off** | **BUILT 2026-09-13.** Two switches, two audiences, and keeping them apart is the whole of it. **`columnFilters` is the author's**: whether this table offers the feature at all. **The toggle is the reader's**: a control in the toolbar, itself off until pressed, that reveals a filter per column heading. A table full of filter boxes nobody asked for is a worse table, so neither switch is on by default. Like the search box (4.2) it narrows **the rows already delivered** — it is not 4.3 and fetches nothing. One filter is the set of **drawn** values a column keeps; the contains box in the popup keeps what it matches as you type, so a contains filter is made of ticks in bulk rather than a second predicate. |
| 4.11 | Nested rows — a record type that points at itself | **declared** — `parentKey` | **Ruled 2026-09-13: one component, not two.** A tree is this table with its rows in a different order — parents, then their children, indented, with an expander — and that is a pure function of the rows exactly as searching and sorting are. Everything else a hierarchy screen needs is already here: the column types, action columns (an "add a child here" is `RunActivity` with an `attribute`, built in step 2), selection, bulk actions, search, sort, filters. `RecordTree` was the same table built again with none of it, so it is superseded rather than extended. Blank `parentKey` is the flat table, unchanged. |

## 5. States

| # | Behaviour | Fixed / declared | Decision |
|---|---|---|---|
| 5.1 | Loading | **fixed, already handled** | `ComponentContainer` tracks reads in flight and shows "Loading…" in place of the component. What's left is polish: it swaps the whole component out, so the headings vanish and return rather than the table standing still and filling in. Revisit if it grates in use. |
| 5.2 | A read that failed | **fixed, already handled** | Failures go to the page's error channel via `onError`. Nothing for the table to add. |
| 5.3 | Nothing there | **declared** message, **fixed** appearance | Built. |

## 6. Reusing the table inside something bigger

**Master-detail** — a list on one side, the chosen record's detail on the other.
**Two components on a page**, not one. The layout editor already splits panels;
the table writes the selected record into page context (1.4 or 4.5); the detail
component reads it. No new component, and the implementer arranges it. It
generalises for free: the same table can feed a chart, a map, or three panels.

**A Gantt chart with a table down its left** — **one component**. The rows and
the bars must line up and scroll together, pixel for pixel, and nothing can
guarantee that across two panels.

> If the parts must stay lined up on screen, it is one component.
> If they only need to agree on which record is selected, it is two components
> and page context.

Consequence for the build: the table's guts — headings, rows, columns, sorting —
must be usable **without** the toolbar and outer frame, so a Gantt can embed
them. Not a second entry in the manifest, just an inner piece the table wraps.
Worth building that seam from the start; it cannot be retro-fitted cheaply.

## 7. Build order

Progressive on purpose: trying to settle all of it up front would fail, and each
step below adds properties rather than reshaping the ones before it.

1. **Columns** — `width`, `type`, `format`; `numeric` disappears into `type`.
   No conditions yet. The table becomes properly usable on its own.
   **BUILT 2026-09-07** — types are the model's own (`text`, `int`, `decimal`,
   `datetime`, `time`, `photo`, `file`) plus `boolean`; `currency` is one
   property carrying both shapes (`AUD`, or `row.<field>`). A `photo` draws the
   file's **name**, not a thumbnail: a component has no door to the upload
   service, and that seam is not built here. See the page-runtime SPEC.
   **A column must work with nothing but a `key`** — type, format and width all
   optional, with defaults that read sensibly, so a plain list of records needs
   no more than the field names. This is a rule for every step, not a hope: the
   measure of the table is what an implementer has to fill in before it works.
2. **Actions** — `actions` and `rowActions` as declared lists, the overflow rule,
   and the fixed `>` at the row end. Replaces the hard-coded five.
   **BUILT 2026-09-08, in a different shape.** A list of callbacks is the one
   thing the platform cannot express — callbacks are declared one by one in a
   component's schema — so honouring `[{ label, callback }]` would have needed a
   new prop kind. Built instead: **a row action is a column**. An unbound column
   (no `key`) names an action component and a target; RecordList draws it once
   per row with that row's record. `RunActivity` and `OpenPage` are ordinary
   registered components, so the same button works on a page on its own. This
   **supersedes 1.4** — the `>` is not a fixed control, it is one more action
   column — and it is 2.5 arriving early, for actions only. The toolbar half of
   1.2 is **not** built. See the page-runtime SPEC.
3. **Selection** — single and multiple, with checkboxes and select-all.
   **BUILT 2026-09-08**, with bulk actions alongside. One property,
   `selection: 'none' | 'one' | 'many'`, defaulting to `one` so no page
   changed; `many` draws a checkbox per row and a part-fillable select-all in
   the heading, and the row click toggles rather than replaces. **`onSelect`
   always emits a list** — one id or twenty — so no script is written against a
   mode. The arithmetic is pure, in `components/selection.ts`.
   **`bulkActions: [{ label?, target, attribute }]`** are the table's own
   controls over its own selection (so a property, not a component like a row
   action): drawn above the table, shown only once something is checked. The
   activity runs **exactly once**, with the ticked ids landing in the attribute
   the action names — so the crew is asked for once and the hook does the
   forty. Values reach an activity only as declared attributes, so a component
   may now fill one: `runActivity(activityId, record, seed?)`, with the seed
   always a list and the attribute's cardinality deciding what it becomes.
   `services.activities.run` stays two-parameter — a **script** still cannot
   pass values in. `RunActivity` took the same `attribute`, which closes "add
   a child here". The run is **about the page's own record** (the app record),
   never about a row: the ticked rows are what it carries. See the
   page-runtime SPEC.
4. **Sort and search** — per-column `sortable`, one search box.
   **BUILT 2026-09-12, as written.** Both over the rows already delivered.
   Search matches the **drawn** cell (so `12/03/2026` finds the date on screen),
   sort orders the **underlying** value (so `N2` grouping cannot decide 1,000
   comes before 9). A heading cycles ascending → descending → the order the
   rows arrived in, because a GET's own order can be the meaningful one.
   Blanks sort last both ways. Ruled here: a search narrows what is *shown*,
   never what is *ticked* — select-all adds or removes the shown rows rather
   than replacing the selection, and the count says how many are off screen.
   Pure in `components/searchSort.ts`. See the page-runtime SPEC.
5. **Column filters** — per 4.10, and after 4 on purpose: a filter is the same
   narrowing the search box does, one column at a time, so it is built on top of
   a table that already knows how to show a subset of its rows without losing
   what is ticked. **BUILT 2026-09-13**, with these settled in the building:
   - **What one filter is.** The set of the column's **drawn** values it keeps,
     ticked from a list — 4.2's rule again, that a reader filters what they can
     see. The "contains" box the draft left open is there, and the draft was
     right to want it decided on a real screen: it first narrowed only **the
     choices**, leaving the rows to a further click, and that read as a bug
     within minutes of use. It now filters on the keystroke — the column keeps
     what the term matches — so a contains filter is still made out of ticking,
     in bulk, rather than being a second kind of filter to combine.
   - **Which columns get one.** Any column naming a field. The draft said
     `filterable` per column, default on; 2026-09-13's ruling on `sortable`
     retired exactly that shape hours earlier, for the reason that applies here
     unchanged — an array-item boolean has nowhere honest to keep a default-on,
     since the builder's array editor seeds every one to `false`. An action
     column never gets one: it holds no value.
   - **Unfiltered is not empty.** A column absent from the map keeps everything
     and shows every box ticked; a column with an empty list is a reader who
     unticked everything and meant it, and shows no rows. They look alike and
     are opposites. Keeping them apart is what lets the first untick *exclude* a
     value rather than keep only it, which is what a reader means by it.
   - **How they combine.** Every filter and the search box narrow together
     (AND). Turning the toggle off clears nothing, so the toolbar says how many
     columns are filtering — hiding the controls must not hide the fact.
   - **What it does to a selection.** The rule steps 3 and 4 settled, unchanged:
     narrowing changes what is **shown**, never what is **ticked**.
   - **Cost.** No paging, so the distinct set for a column is computed over
     every delivered row — and deliberately over *every* row rather than the
     ones the other filters left, or a choice would vanish into a dead end the
     reader cannot undo from inside the popup.
6. **Nested rows** — per 4.11, and it lands here because it is the *last* of the
   row-order steps: nesting has to agree with sorting, searching and filtering,
   which is cheap to state once those exist and impossible to guess before.
   `parentKey` names the field holding a row's parent; blank leaves the flat
   table exactly as it is. What it settles:
   - **Hierarchy is row order, nothing more.** Flat rows in — that is what a GET
     answers with — and the nesting is rebuilt for display, as it always was in
     `RecordTree`. A row whose parent is absent from the answer is a root, so a
     partial or filtered answer still draws; a cycle is broken rather than hung.
   - **Sorting orders siblings under their parent**, never the whole table, or
     the tree comes apart. The comparison is the same one a flat table uses.
   - **A search or filter hit keeps its ancestors**, which are drawn as context
     though they do not match. Without that the path to a hit disappears and a
     deep row reads as a root. It follows step 4's rule rather than bending it:
     narrowing changes what is **shown**, and an ancestor is part of showing it.
   - **Ticking a parent does not tick its children.** A tick is one row, and a
     bulk action acts on exactly what is ticked — a checkbox that quietly
     selects forty descendants is the kind of thing nobody can undo. Collapsing
     is narrowing, so it too changes what is shown, never what is ticked.
   - **The expander lives in the first column that holds a value**, with the
     indent, since an action column has nothing to indent.
7. **Display conditions** — the rule list. Deliberately after 1, so a rule is a
   condition on top of a base display that already works.
8. **Totals row** — optional, per 4.7.

Paging stays out (4.4). Cell components (2.5) and grouping (4.8) are separate
work, not steps here.

## 8. What this replaces

`newLabel`, `editLabel`, `openLabel`, `onNew`, `onEdit` stop being properties;
they become entries in `actions` and `rowActions`. `onOpen` and `onSelect`
survive unchanged. `numeric` on a column becomes `type: 'number'`. Only two
pages exist, so converting them is not a concern.
