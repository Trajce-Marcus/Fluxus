# DSL Editor — spec

**Status: BUILT 2026-09-21.** Spec corrected the same day after an independent
spec review, built, then independently tested — 14 defects found and fixed, and
the spec amended below where the build had to differ. An admin tool in the Console for running FluxScript ad hoc
against an operation's records, read-only, plus running an activity.

The first version is deliberately small. It is built with extension in mind,
not as a throwaway, but a later clean slate is accepted as possible.

---

## 1. Why it exists

The workbench can list and inspect records of one type. It cannot query them.
This tool adds the querying: filter, project, and look at subsets. That is the
whole purpose, and it is why it is an admin function.

Second use: somewhere to try an expression before pasting it into a hook or a
datasource.

## 2. Relation to the read rule

[docs/DATA_THROUGH_ACTIVITIES.md](../../../docs/DATA_THROUGH_ACTIVITIES.md) §1
requires application reads to go through GET activities, so they are declared in
the model, authorised, and logged on the record they anchor to. That document is
about the **application** data path — a page serving an end user.

This tool is not on that path. It is workbench-class admin inspection, and the
workbench is already outside it: the Console takes the whole operation partition
at connect precisely because the workbench evaluates locally against it
(DATA_THROUGH_ACTIVITIES, header note).

Running the query server-side is **narrower** than what exists today: the
browser gets the filtered subset instead of every record in the operation.

**It is not logged.** A history entry lives on a record, and an ad-hoc query has
no anchor. This is accepted for v1 and recorded as debt against the open
unified-log design, where a non-record-anchored entry would belong.

Writes are a different matter — see §3.

## 3. No ad-hoc writes

Scripts here cannot mutate. Rule 1 (*all change goes through activities*) holds:
an ad-hoc `records.x.create(...)` lands in no history and the reporting
projection misses it.

Change is available by **running an activity** (§8), through the normal
pipeline, recorded in history.

Rejected: a `run(activityId, params)` built-in inside scripts. It is a language
change, and a script failing halfway would leave committed activities behind
with no transaction over them. `invoke` already covers GET activities.

## 4. Where it lives

A Console section, **Data → DSL Editor**, sibling to Workbench — one entry in
`shell/sections.tsx` (`DATA_GROUP`).

Not a tab inside the workbench: the workbench's frame is one record type at a
time, and a query is not.

### Layout

```
┌──────────────────────────────────────────────────────────┐
│ operation · anchor record (optional)        [ Run ▸ ]    │
├──────────────────────────────────────────────────────────┤
│   Monaco — fluxscript, error markers, selection-runs     │
├──────────────────────────────────────────────────────────┤
│ 142 rows · 84 ms                       [copy ▾]          │
├───────────────────────────────────┬──────────────────────┤
│   result grid                     │   row inspector      │
└───────────────────────────────────┴──────────────────────┘
```

Two draggable splitters, both built here (no splitter component existed):
editor/results vertically (percentages of the container, clamped 15–80%) and the
inspector's width horizontally (measured from the right edge, clamped so it can
be neither shut nor dragged over the grid). Neither position is stored —
deferred with the rest of persistence.

**The inspector is a column of the whole view**, not of the results pane, so it
keeps full height however the horizontal split is set. Reading a tall record
through whatever the splitter left over was the reason to move it.

**Light, unlike the rest of the Console chrome.** This is a data surface and the
workbench next door is light for the same reason; the palette is the
workbench's so the two Data sections match. Monaco runs the `vs` theme. Colours
are stated explicitly rather than taken from the shell's variables, which carry
the dark values.

**Monaco's css is injected once, by the Shell.** It cannot come from a
document-level stylesheet — the Console mounts in a shadow root — and it must
not come from each section either: with a second Monaco surface that meant
~309KB of exact duplicate parsed on every load. It belongs to the shell because
it belongs to neither section.

## 5. Scope

Inherits the open solution. Picks an operation using the same shell state and
action as the workbench (`dataOperationId`, `dataOperations`,
`openSolution(solutionId, operationId)` — `workbench/WorkbenchView.tsx`).

**Build a small picker in the Console.** `OperationPicker` is not exported from
`@fluxus/workbench` and takes no props — it reads `useWorkbench()`, so it is
unusable outside a `WorkbenchProvider`.

The operation is one shared choice: switching it here switches the workbench.

**The buffer is kept between visits** (added 2026-09-21, after real use — the
tool is flicked in and out of constantly). One script and the anchor id, in
`localStorage` under `fluxus:console:dsl-editor:<solutionId>`, written on every
change and restored on mount.

Per solution, because a script names that solution's record types and means
nothing against another's. Restoring on mount is also what closes the rough edge
that `selectOperation` bumps `scopeVersion`, remounting every solution-scoped
view and discarding whatever was typed.

Unreadable, unparseable or blocked storage is an empty editor, never an error.

This is the smallest useful piece of persistence, not the whole story — saved
snippets, named scripts and files are still out of scope (§11).

Scripts stay scope-blind. The operation is injected, never named in source.

## 6. Read-only — how it is actually enforced

At run time, two ways, both structural:

1. **`readonlyRecords: true`** deletes `records.mutate` from the eval host
   (`engine/src/bridge.ts:457`). The capability is not on the object.
2. **`mode: 'read'`** refuses mutations and effect-kind service calls
   (`dsl/src/evaluator.ts:306`, `:758`, `:1063`).

**There is no static enforcement, and the spec must not claim one.**
`validateScript` defaults to `'after'` mode, which allows mutations; GET purity
runs through `validateExpression`, not `validateScript`. Static checking is also
defeatable by indirection — a model function's body is validated separately, so
a mutating function passes at the call site.

The validator is still used, as **editor feedback only** (§7).

### Quotas

`DEFAULT_QUOTAS` is `maxSteps: 100_000` (AST nodes, not loops), `maxRows:
10_000`, `timeoutMs: 1_000` (`dsl/src/host.ts`).

The endpoint sets **its own quotas**, a per-call field on the eval host
(`quotas?: Partial<Quotas>`, merged in `evaluator.ts:185`): `maxRows: 100_000`,
`maxSteps: 2_000_000`, `timeoutMs: 15_000`. All three are raised, `maxSteps`
twentyfold. Hooks keep the defaults.

Why that is safe: `loadOperationHost` already loads the operation's whole record
set into memory before the script runs, so the row cap is not protecting server
memory at that point.

**The row quota throws, it does not cap** (`evaluator.ts:1038`) — and it throws
in `readAll`, before `where` runs. So a record type larger than `maxRows` cannot
be queried at all, even by id. Nothing in this tool truncates or reports partial
results. The real fix is query pushdown compiling `where` to SQL
(DSL_SPEC §9, *Scale strategy*) — deferred, out of scope here.

## 7. The script pane

- Monaco, language `fluxscript` — `registerFluxscript` already exists.
- **Validation 300 ms after the last keystroke**, not on every one — the same
  wait the record picker's search uses (`SEARCH_DEBOUNCE_MS`). A script is
  invalid for most of the time it is being typed, so validating per keystroke
  paints the editor red while you are still writing the line. Run validates the
  text it is about to send **synchronously**, so the debounce never lets an
  invalid script through on a stale verdict — and because a run may carry only
  the selection while the shown verdict was formed over the whole buffer.
- **Validation** uses `validateExpression` in `'expression'` mode, which is
  the mode matching the tiers this tool admits and the one GET's `returns` uses.
  Not `validateScript`.
- **Error markers** — `Diagnostic` carries `line` and `col`, so diagnostics map
  to Monaco markers. Nothing wires markers today; `ExpressionDialog` only lists
  them underneath. Build markers here; the page builder can adopt them.
- Run is blocked while errors stand.

Accepts the **expressions** and **queries** tiers.

**`services` is left undeclared, deliberately.** Built as
`validateExpression(source, { types }, { bannedRoots: ['attributes'], functions })`
— not `pageRuntime.validateExpression`, which declares the *page* registry
(`page`, `activities`) and therefore reported `services.notify.*` and
`services.geo.*` as unknown modules, disabling Run on scripts the server would
have run. An undeclared registry makes the validator pass service calls through
untyped, which is the honest posture: the browser cannot know what the server
registered, and a wrong registry is worse than none. Service errors surface at
run time instead. Pinned by `packages/engine/test/dslEditorValidation.test.ts`.

**`anchorType` is not passed**, so `context.record.<field>` is unchecked — a
misspelled field validates clean and fails at run time. Deferred: the type is
only knowable after resolving the record id.

Two of the validator's mutation messages are hook advice ("move update() to the
after hook"). They are restated at the point of display (`plainMessage`), not
changed in `@fluxus/dsl`, where they are correct for every other caller.

### Running one script out of several

One editor. **Run acts on the selection if there is one, otherwise on the whole
buffer.** `Cmd/Ctrl+Enter`, and a Run button that states which it will do.

No separator token, no statement splitting. One run = one request = one result.

### Roots

| Root | Available | Note |
|---|---|---|
| `records` | yes | the operation's records |
| `context` | yes | `context.user`; `context.record` only with an anchor |
| `services` | read-kind only | effect kinds refused by `mode: 'read'` |
| `attributes` | no | no activity in flight; ban is static only — `buildEvalHost` always supplies `attributes: {}` |

**`model.*` is declared here and nowhere else.** The editor merges
`modelSchemaTypes()` into its schema so a model query validates in the browser
exactly as the endpoint answers it; the page builder's dialog and every hook
leave them out. Design: `docs/QUERYING_THE_MODEL.md`.

`invoke(activityId, params?)` reaches GET activities only, and **is wired** —
the endpoint supplies it from `host.engine.invoke` with the anchor. It was
missing in the first build, which made §3's argument for rejecting a `run()`
built-in ("`invoke` already covers GET activities") false. Because a GET through
`invoke` records a light history entry, the run writes back even though the
script itself cannot mutate.

### The anchor record

Optional. Name a record id and `context.record` resolves to it, following
`activities.query`'s pattern (`host.adapter.getRecord`). With none,
`buildEvalHost` sets `record: null` — it is a null at run time, not an absence,
and statically it is unchecked without `anchorType`.

## 8. Running an activity

A separate action in the tool, not something a script can do.

The picker carries each activity's **owning record type** through to the form —
that is what resolves reference display labels, not the anchor's type, which
differs whenever the anchor is of another type and is empty for a CREATE.

An activity that needs an anchor it does not have is **called out in the picker**
rather than refused: anything but CREATE runs against an existing record, and
without a matching anchor it would submit with no record id and fail in the
engine. Said, not enforced — the anchor can be set after seeing it.

**Built over `@fluxus/page-runtime`, not the workbench.** The capture form is
page-runtime's and shared since 2026-08-16: `AttributesForm`,
`ActivityFormModal`, `CaptureHostProvider`, `CaptureHost`. The workbench's
`WorkbenchCaptureHost` is a thin wrapper that adds its own record picker.

`RecordPickerDialog` is workbench-only and unexported, so **record-reference
attributes take a plain id field in v1**.

Runs through `activities.run` and the normal pipeline. The activity needs an
anchor record for anything but CREATE — use the anchor from §7.

## 9. Results and errors

### Grid versus value

The evaluator returns a plain value. The pane decides, by one rule:

- **array of objects** → grid
- **array of scalars** → single-column grid
- anything else → formatted value

**The grid-or-value decision is made over the whole array, never over row 0.**
An optional field gives an array whose first element is an object and whose
later ones are null (`values(photo_field)` across records where some are unset),
and judging on the first element then walking every row as an object crashed the
Console — `Object.keys(null)` during render, with no error boundary anywhere in
the app. Columns are the union of the keys present, so rows need not agree on
their shape. An empty array stays a grid and says "No rows".

**Two different row shapes must both work:**

- `records.<type>` with no `.select()` returns `DslRecord` objects —
  `{ id, type, fields }` (`dsl/src/host.ts`). Rendering the rule naively gives
  three columns. Flatten `fields` into columns, keeping `id`.
- `.select(...)` returns flat rows with FKs already unwrapped to raw ids
  (`evaluator.ts:959`), so the target type is gone and the id is all there is.
  **No FK display value in v1** — `FkDisplay` is workbench-internal and needs
  `useWorkbench()` anyway.

### Grid

Plain rendering with a **display cap** of 500 — no virtualisation library. There
is no windowing dependency in the repo and adding one is not justified here.

- null, empty string and absent must be visually distinct
- row count and elapsed time shown
- select a row to open the **side panel** with formatted JSON (a panel, not a
  dialog: you click row after row). Collapsible is not built — it is a `<pre>`.
- double-click a cell to copy it

### Copy

- one cell
- selected row as JSON
- whole result as JSON, and as CSV
- error message

### Errors — two kinds

Four kinds cannot be distinguished today: quota and ordinary runtime errors are
both `FluxRuntimeError` with no code, and syntax and validation both return
untagged `Diagnostic[]`. Adding codes is new surface in a core package and is
deferred (§11).

| Kind | Source | Shown as |
|---|---|---|
| `compile` | `FluxSyntaxError` — the server parses too | message at its position |
| `runtime` | `FluxRuntimeError` / `FluxFailError`, including quotas | message, with position |

Both arise **server-side**: `engine.evaluate` parses as well as evaluates, so a
syntax error lands in the same catch. Two live routes reach it despite the
editor blocking Run on errors — a keybinding press, and a **selection run**,
where validation ran over the whole buffer but the request carried the
selection. `scripts.query` classifies on the error's class name; neither DSL
error class has a `position` object, both carry `line`/`col` as own fields.

Messages cross with their `(line n, col n)` suffix stripped — the editor puts
the error on the line itself. **An error that is neither DSL class is internal
and its text is not forwarded**, only that the script failed.

Positioned errors are clickable and move the cursor. A failed run leaves the
previous result visible.

DSL error messages cross as written — they name the author's own fields and
ids, which is the point. Non-DSL throws are replaced with a generic line, so
adapter and database detail never reaches the browser.

## 10. Server side

Runs server-side against the operation's records.

**Scripts are capped at 4,000 characters.** This is a tRPC *query*, so the input
travels in the URL and Node's default 16KB header limit counts the request line;
a longer script died as an opaque transport failure rather than a script error.
Raising it means POSTing queries (`methodOverride` on the client link), which
changes transport for every query in the app — not worth it for a scratchpad.

**`scripts.query`** — a new `scripts` router group, matching the router's
plural-noun convention and leaving room for `scripts.validate` later. `query`
rather than `run` because it sits beside `activities.run`, which mutates.

Shaped on `activities.query` (`server/src/router.ts`): resolve the user,
`loadOperationHost`, then evaluate.

**Use `engine.evaluate`, not `executeScript`.** `executeScript` returns the
value of a top-level `return` and `null` otherwise, so a bare expression or
query yields null. `engine.evaluate` (`engine/src/engine.ts:536`) is
`evaluateExpression` over `buildEvalHost` and already threads `readonlyRecords`,
`anchorRecord` and `invoke`. Quotas are spread onto the host at the call site.

**Write-back runs on both paths** — a GET reached through `invoke` records a
light history entry, so the run is written back even though the script itself
cannot mutate (§7). An earlier draft of this line said the opposite.

It accepts arbitrary script text. That is deliberate, and the reason §6's
enforcement is structural rather than a validation pass.

### Payload

- `value` — the result, as JSON
- `rowCount` — when the value is a list
- `elapsedMs`
- on failure: `kind` (`compile` | `runtime`), `message`, and `line`/`col` where
  there is one

No column or type metadata in v1.

**The value is walked before it is sent** (`forWire`). Two things would
otherwise be wrong:

- **A `Date` would serialise as a UTC instant.** `date('2026-07-01')` parses at
  *local* midnight and a date field read in a script is coerced the same way, so
  on a server ahead of UTC the tool would report `2026-06-30T14:00:00.000Z` —
  the day before the one the record holds. What persists in a record is the raw
  wall-clock string, so that is what goes back: `YYYY-MM-DD`, with the time when
  there is one.
- **An `FkPointer` would serialise as a bare `{ targetType, id }`** and draw as
  raw JSON in a cell. Only the id is of use, so that is what crosses.

A tRPC transformer was the wrong fix: it preserves the `Date`, and the browser
then renders it in the *browser's* zone — moving the shift rather than removing
it — while changing transport for every query in the app.

Pinned by `packages/server/test/scriptResultWire.test.ts`.

### Access

**Entry gate only: `requireOpUser`** — the same gate the workbench's data door
uses.

**This reverses the first draft of this spec**, which required operation admins
(and named a non-existent `op_users.admin` column). Ruled by the user
2026-09-21: access should match the workbench, because the Console is reachable
only by solution designers. Recorded as a reversal rather than quietly changed.

Worth stating plainly, since it is the wider door: `scripts.query` is a tRPC
procedure, so anyone holding a token for anyone in `op_users` can call it
directly and read every record type in the operation — including types
`computeReadable` hides from them through `records.partition`.

Deliberate departure: `records.partition` also filters rows by role-readable
types (`router.ts:747`). This endpoint does **not** — a script reads every type
in the operation. Accepted, given who reaches the Console.

Note `requireOpUser` returns early when auth is unconfigured
(`server/src/gates.ts`), as every gate but platform-admin does. On a deployment
without auth this endpoint is open.

### Client

`@fluxus/client` has no generic call door — every procedure is a hand-written
method. `scripts.query` needs one added.

## 11. Out of v1

Saved snippets, named scripts and files — the buffer is kept (§5), but anything
beyond one script per solution is its own later design ·
run history · file export · autocomplete · combining record types in one query
(see §13) · statement-under-cursor running · editor tabs · cross-operation
queries · virtualised grid · four error kinds · FK display values · record
picker for reference attributes · logging admin reads · cancelling a running
script.

## 12. Done when

- A query over a record type returns a grid, with row count and elapsed time.
- Both row shapes render: `records.<type>` and `.select(...)`.
- Selecting a row opens the inspector; its JSON copies.
- A mutation in a script fails at run time, and the error says why.
- `compile` and `runtime` errors are distinguishable, and a positioned one moves
  the cursor when clicked.
- Highlighting a fragment and running gets that fragment only.
- Switching operation re-scopes results, and the workbench agrees.
- An activity runs from the tool and appears in that record's history.
- A user who is not in the operation is refused (auth configured).

## 12a. Known gaps in this build

- **`context.record.<field>` is unvalidated** (no `anchorType`, §7).
- **The endpoint is open when auth is unconfigured**, as every gate but
  platform-admin is.
- **A syntax error can still reach the server** — validation runs over the whole
  buffer while a selection run sends a fragment. It comes back correctly
  classified as `compile`, so it reports properly; it is a wasted round trip,
  not a wrong answer.

## 13. Known gaps recorded elsewhere

- **Combining record types in one query.** A query has one root collection, with
  FK auto-dereference reaching outward along declared foreign keys. Joining
  unrelated types, unions and grouping do not exist. Record as a language gap in
  `packages/dsl/docs/DSL_SPEC.md` §12; ad-hoc investigation is where the lack is
  felt first.
- **Logging admin reads** — belongs in the unified-log design.
- **Query pushdown** — DSL_SPEC §9.

## 14. Docs on build

Same commit: `packages/server/docs/SPEC.md` (the procedure),
`packages/client/docs/SPEC.md` (the new method),
`packages/console/docs/SPEC.md` and `docs/CONSOLE_RUNTIME_SPEC.md` §3 (the
section registry), and a note in `docs/DATA_THROUGH_ACTIVITIES.md` recording the
admin-inspection exemption in §2. GLOSSARY if "DSL Editor" sticks.
