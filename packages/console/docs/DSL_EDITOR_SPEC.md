# DSL Editor — spec

**Status: NOT BUILT. Spec finalised 2026-09-21, ready to build** once §12 is
answered. An admin tool in the Console for running FluxScript ad hoc against an
operation's real data.

**Built with extension in mind, not as a throwaway.** The first cut is small
and deliberately adds no language surface, no new storage and no new write path
— every mechanism underneath already exists. It may still turn out that the
later requirements want a clean slate and this is restarted; that is accepted
as possible, not assumed, and it is not the plan. Each cut should leave the
seams usable by the next.

---

## 1. Why it exists

Two gaps, both real today:

- There is nowhere to *try* a query or an expression. A hook or a datasource is
  written blind and debugged by running the activity it sits on.
- An administrator investigating live data can only look through the workbench's
  record-type-at-a-time frame. A question spanning types has no answer short of
  reaching for the database.

It is also the human-facing version of the tool set the AI-assistance direction
needs (BLUEPRINT → *Building by AI assistance*): read the model, validate, run
an activity.

## 2. What it is not

**It does not mutate records.** Rule 1 (*all change goes through activities*)
is not negotiable for this tool: an ad-hoc `records.x.create(...)` lands in no
history, is anchored on no record, and the reporting projection silently misses
it. Scripts here are read-only, enforced twice over (§5).

Change is still available — by **running an activity**, the same act the
workbench already offers, through the same pipeline, landing in history with the
caller named (§7).

Specifically rejected for v1: a `run(activityId, params)` built-in inside
scripts. It is a language change, it destroys the static purity property that
justifies exposing the endpoint at all, and a script failing halfway would leave
committed activities behind with no transaction over them. `invoke` already
covers calling GET activities from a script.

## 3. Where it lives

Its own Console section — **Data → DSL Editor**, sibling to Workbench, one entry
in `src/platform-components/shell/sections.tsx` (`DATA_GROUP`).

Not a tab inside the workbench. The workbench's frame is "pick a record type,
see its rows" and its side nav *is* the model; a script spans types and does not
fit that. It is also self-contained by design, and entangling this with
`WorkbenchContext` buys nothing while making both harder to grow.

## 3a. Layout

Three regions, top to bottom:

```
┌──────────────────────────────────────────────────────────┐
│ operation picker · anchor record (optional) ·  [ Run ▸ ] │  scope bar
├──────────────────────────────────────────────────────────┤
│                                                          │
│   Monaco — fluxscript, markers, selection-runs           │  editor
│                                                          │
├──────────────────────────────────────────────────────────┤
│ 142 rows · 84 ms · capped          [copy ▾]              │  status strip
├───────────────────────────────────┬──────────────────────┤
│                                   │                      │
│   result grid                     │   row inspector      │  results
│                                   │   (formatted JSON)   │
└───────────────────────────────────┴──────────────────────┘
```

Editor and results split vertically, draggable. The inspector opens on the
right of the results region when a row is selected, and closes with it.

## 4. Scope — solution and operation

Inherits the open solution. Picks an operation, **exactly as the workbench
does**: the same shell state (`dataOperationId`, `dataOperations`) and the same
action (`openSolution(solutionId, operationId)`, then bump `scopeVersion`) —
see `workbench/WorkbenchView.tsx`.

The operation is therefore **one shared choice**: switching it here switches the
workbench too. That is the intent, not a side effect.

`OperationPicker` is not exported from `@fluxus/workbench` (only `Workbench` and
`useWorkbench` are). Open, §11.

Scripts stay **scope-blind** — the operation is injected, never named in source.

## 5. Read-only, enforced twice

Both layers exist already; neither is new code.

1. **Statically** — `validateScript` against the solution's `DslSchema`, before
   anything runs. Same check GET activities pass for purity.
2. **At run time** — `executeScript(src, host, { mode: 'read' })`, the mode
   before hooks run under (`dsl/src/evaluator.ts`). Mutations, `effect`-kind
   service calls and `queue` all fail.

Quotas are the interpreter's existing ones: row cap, loop cap, timeout
(`DEFAULT_QUOTAS`).

## 6. The script pane

- Monaco, language `fluxscript` — `registerFluxscript` already exists and is
  used by the page builder's expression dialog.
- **Live validation** as you type, the way `ExpressionDialog` does it.
- **Inline error markers** — `Diagnostic` carries `line` and `col`, so
  diagnostics map to Monaco markers (squiggles). Nothing wires markers today;
  the page builder only lists diagnostics beneath the editor. Build it here and
  the page builder can adopt it.
- Run is blocked while errors stand.

Accepts the **expressions** and **queries** tiers. Multi-statement scripts
(`let`, `for each`) are out of v1 — see §10.

### Keeping several scripts, running one

One editor, holding as much as the admin wants to keep — the scratchpad the
tool is for. **Run acts on the selection if there is one, otherwise on the
whole buffer.** `Cmd/Ctrl+Enter` runs; a Run button does the same and states
which of the two it is about to do.

This is the convention every SQL tool already teaches, and it invents nothing:
no separator token, no statement-splitting, no second language rule. One run =
one request = one result.

Rejected for v1, both re-openable: **statement-under-the-cursor** running, which
needs boundaries FluxScript does not have while v1 is one expression or query
per run; and **editor tabs**, which are more machinery and still would not
answer "run just this bit".

Extension points this leaves open: a splitter that finds boundaries later, tabs
or named snippets over the same run contract, and a stack of results instead of
one — none of which change the endpoint.

### Roots available

| Root | Available | Note |
|---|---|---|
| `records` | yes | the operation's partition |
| `context` | yes | `context.user`; no anchor record, so `context.record` is absent |
| `services` | read-kind only | effect kinds are refused by `mode: 'read'` |
| `attributes` | **no** | no activity in flight — same ban as a page embedding point |

`invoke(activityId, params?)` is available and reaches GET activities only, as
everywhere else.

### The anchor record

`context.record` needs a record to point at. Without one, most hook expressions
— the first thing §1 says this tool is for — cannot be tried here at all.

So the scope bar carries an **optional anchor record**: name a record id and
`context.record` resolves to it; leave it empty and `context.record` is absent
and referencing it is an error like any other.

Cheap, because the pattern exists: `activities.query` already takes an optional
`recordId`, resolves it through `host.adapter.getRecord`, and checks it against
`computeReadable`. The same three lines.

**Cuttable.** If it is dropped, §1's first gap is only half served and the tool
is for investigating data rather than for trying hook expressions.

## 7. Running an activity

A second, separate act in the tool — not something a script can do.

Pick an activity, fill its attributes, submit. Goes through `activities.run` and
the one pipeline; availability gate, validation, hooks and history all apply
unchanged. Reuses the workbench's capture host rather than growing a second
capture path.

Result is the run outcome, not a result set.

## 8. Results and errors

The bar is a tool an administrator would choose to use, not a debug textarea.

### What decides grid versus value

The evaluator returns a plain value; the pane decides how to show it, by one
stated rule rather than by guessing per case:

- an **array of objects** → grid, columns from the projection
- an **array of scalars** → single-column grid
- anything else (scalar, single object, null) → formatted value

The rule is in the UI, not the endpoint. The endpoint returns the value and the
metadata (§9a); a later pane can render the same payload differently.

### Result set

- **A list of records or rows → grid.** A column per projected field, in the
  order the projection named them. Virtualised — the row cap is high enough
  that rendering naively will not do.
- **A scalar or a single structure → formatted value**, not a one-cell grid.
- **Null, empty string and absent are visually distinct.** Reading a query
  result wrongly on this point is how an admin reaches a false conclusion.
- **FK values show their display value**, with the id available on inspection —
  the workbench's `FkDisplay` already solves this.
- **Row count and elapsed time** alongside every result.
- **Truncation is stated, loudly.** When the row quota capped the result, the
  UI says so — a partial answer that looks complete is worse than an error.

### Inspecting one row

Selecting a row opens a **side panel** with the object as formatted, collapsible
JSON.

A panel rather than a dialog: the use is clicking row after row and comparing,
and a dialog has to be dismissed each time. It also leaves the grid on screen,
which is where the selection lives.

### Copying

Copy is first-class, not an afterthought — the output of this tool routinely
goes somewhere else:

- copy one cell
- copy the selected row as JSON
- copy the whole result as JSON, and as CSV
- copy an error message

### Errors

Four kinds, and the tool distinguishes them rather than showing one red string:

| Kind | Where it comes from | Shown as |
|---|---|---|
| Syntax | parse | inline marker + message, at its position |
| Validation | `validateScript` against the model | inline marker + message, at its position |
| Quota | interpreter caps (rows, loops, timeout) | which cap, and its limit |
| Runtime | evaluation | message, and position where the evaluator gives one |

Positioned errors are **clickable — they move the cursor to the offending
token**. Nothing is swallowed, nothing is collapsed to "something went wrong",
and a failed run leaves the previous result visible rather than blanking the
pane.

## 9. Server side

Runs **server-side against the operation's real data**, not the browser
snapshot — the whole point is seeing data the app does not show.

One new tRPC procedure — **`scripts.query`** (decided 2026-09-21). A new
`scripts` group, matching the router's plural-noun convention and leaving room
for a sibling (`scripts.validate`) without a rename. `query` rather than `run`
because it sits beside `activities.run`, which mutates, and the verb should
carry the difference. Shaped closely on
`activities.query` (`server/src/router.ts`): resolve the user,
`loadOperationHost`, validate, then `executeScript` under `mode: 'read'` with
`buildEvalHost`. No write-back, since nothing mutates.

**It accepts arbitrary script text.** That is a deliberate choice, and the
reason the read-only property is enforced statically *and* at run time before
the endpoint is exposed.

### 9a. What the endpoint returns

One shape, whatever the script yielded:

- `value` — the evaluator's result, as JSON
- `rowCount` — rows when the value is a list
- `truncated` — whether a quota capped it
- `elapsedMs`
- on failure: `kind` (syntax · validation · quota · runtime), `message`, and
  `line`/`col` where there is one

The four error kinds are carried on the wire, not inferred from message text in
the browser.

### Access

**Operation admins only** (`op_users.admin`). The gate is load-bearing rather
than cosmetic: a raw script bypasses role-filtered reads entirely — the
`computeReadable` filter that narrows what a role may see applies to records
requests, not to a script's `records` root. Anyone who can open this tool can
read every record type in the operation.

Not decided: whether solution-level or org-level admins reach it too (§11).

## 10. Out of v1

Saved snippets · run history · file export (copy covers the need first) ·
autocomplete against the model · multi-statement scripts (`let`, `for each`) ·
statement-under-cursor running · editor tabs · cross-operation queries ·
explain/plan output · cancelling a running script (needs server support).

## 11. Done when

- A query over a record type returns a grid, with row count, elapsed time and a
  truncation notice when the cap bites.
- Selecting a row opens the inspector; its JSON copies.
- A mutation in the script is refused — statically, with a marker, before the
  request is made — and refused again server-side if it somehow arrives.
- Each of the four error kinds renders as its own kind, and a positioned one
  moves the cursor when clicked.
- Highlighting a fragment and running gets that fragment only.
- Switching operation re-scopes the results, and the workbench agrees.
- An activity runs from the tool and appears in that record's history.
- A non-admin cannot reach the endpoint.

## 12. Open — needs an answer before build

One decided, three still open, each with a recommendation so it is a one-word
decision:

1. **Picker reuse** — export `OperationPicker` from `@fluxus/workbench`, or
   duplicate a small one in the Console.
   *Recommend the export*: one picker to change, and the tool is not a
   throwaway.
2. **Endpoint name** — ✅ **decided: `scripts.query`** (2026-09-21, Claude
   recommended, user approved). `dslQuery` was the user's first choice; changed
   to match the router's grouped convention and to keep a package name out of
   the API surface.
3. **Who may open it** beyond operation admins.
   *Recommend operation admins only for v1*, widened when asked for rather than
   guessed at, since the gate is load-bearing (§9).
4. **Section label** — "DSL Editor" is the working name. *Recommend keeping
   it*: it says what it is, and it is your word.

Plus one scope call: the **anchor record** (§6) is in, and cuttable.

## 13. Docs on build

The server procedure updates `packages/server/docs/SPEC.md` in the same commit;
the Console section updates `packages/console/docs/SPEC.md`. Per the
docs-with-code rule.
