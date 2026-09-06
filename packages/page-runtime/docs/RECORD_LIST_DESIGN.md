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
| 1.2 | Toolbar actions | **declared** — `actions: [{ label, callback }]` | Replaces today's hard-coded `newLabel`/`onNew`. A page declaring none gets a bare title; three gets three. First action drawn as the prominent one. |
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
| 4.1 | Sorting by clicking a heading | **fixed** behaviour, **declared** per column (`sortable?`, default on) | Sorts the rows already delivered, in the browser. Correct as long as every row is present — see 4.4. |
| 4.2 | Quick search box in the toolbar | **declared** on/off | Filters the delivered rows in the browser across all columns. No round trip. |
| 4.3 | Real filters (change what is fetched) | **not this component** | A filter bar is its own component: it writes the chosen values into page context, the table's `rows` expression reads them, the read re-runs. Listed here so it isn't built into the table by mistake. |
| 4.4 | Paging | **none — ruled 2026-08-28** | The read path has no limit or offset, so the table fetches and shows every row: a screen listing 5,000 records delivers 5,000. **Said plainly rather than hidden behind page buttons over the browser's own copy, which would leave the cost exactly where it is.** Real paging is a change to the read path, deferred until it is built properly. |
| 4.5 | Selection | **declared** — `selection: 'none' \| 'one' \| 'many'` | Both built: selecting rows is fundamental, not polish. `'one'` is today's behaviour. `'many'` adds a checkbox column and a select-all in the header. |
| 4.6 | What a multi-selection can be used for | **works today** | The table emits the selected records when the selection changes; that callback's script stores them with `services.page.setContext`; a toolbar action's script walks the list with `for each` and runs the activity once per record. Each run still carries one record as its anchor, so authorisation is untouched and the one-value callback contract holds. No platform change needed. **Unproven**: an activity that asks for confirmation goes through `runWithConfirm`, so fifty rows may raise fifty prompts. Prove it on one screen before this is a documented pattern. |
| 4.7 | Totals row | **declared**, optional | Three parts: which columns and what function (sum, average, count); which rows count — **the rows currently shown**, so searching changes the total, which is what people expect (a condition to include only some rows can come later); and what the row says on the left. |
| 4.8 | Grouping rows under headings | — | Deferred. It changes the table's shape considerably. |
| 4.9 | Editing a value in the table | **never** | Records change through activities. A row action opens the capture form. The one behaviour the platform forbids outright. |

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
   **A column must work with nothing but a `key`** — type, format and width all
   optional, with defaults that read sensibly, so a plain list of records needs
   no more than the field names. This is a rule for every step, not a hope: the
   measure of the table is what an implementer has to fill in before it works.
2. **Actions** — `actions` and `rowActions` as declared lists, the overflow rule,
   and the fixed `>` at the row end. Replaces the hard-coded five.
3. **Selection** — single and multiple, with checkboxes and select-all.
4. **Sort and search** — per-column `sortable`, one search box.
5. **Display conditions** — the rule list. Deliberately after 1, so a rule is a
   condition on top of a base display that already works.
6. **Totals row** — optional, per 4.7.

Paging stays out (4.4). Cell components (2.5) and grouping (4.8) are separate
work, not steps here.

## 8. What this replaces

`newLabel`, `editLabel`, `openLabel`, `onNew`, `onEdit` stop being properties;
they become entries in `actions` and `rowActions`. `onOpen` and `onSelect`
survive unchanged. `numeric` on a column becomes `type: 'number'`. Only two
pages exist, so converting them is not a concern.
