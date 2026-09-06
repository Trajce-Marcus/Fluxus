# @fluxus/page-runtime — Living Spec

Current design truth for the page runtime. Updated in the same commit as any behaviour/design change (root CLAUDE.md rule). The wiring design rationale and rulings live in the page builder's [PAGE_WIRING_DESIGN.md](../../page-builder/docs/PAGE_WIRING_DESIGN.md) (written before the extraction; the mechanisms it specifies now live here).

## Scope

The **run-a-page cluster** (GLOSSARY "Page runtime", named 2026-07-19): `PageRenderer`, `ComponentContainer`, the component registry (`componentManifests` + the component library), the page expression host (`pageHost.ts`), save-time `validatePage`, `ActivityFormModal`, and — since 2026-08-16 — the **standard capture form** (`capture/`) that every host opens to run a UI activity. Page *editing* (layout editor, palette, Monaco, `persistence.ts`'s save path) stays in `@fluxus/console`.

Extracted from the page builder 2026-07-19 as the first step of **workbench → Runtime app**: the same cluster renders the editor preview in the page builder and published pages in the SDM workbench.

## The PageRuntime handle

The whole cluster reaches the SDM through **one injected handle** — no package-level singletons:

```ts
const runtime = createPageRuntime({ client }); // client: a connected FluxusClient
```

A host creates it once at bootstrap (platform singleton, never React context — the Extraction fork 2 ruling) and passes it to `PageRenderer` / the editor's validation calls. Everything else derives from the client's snapshot:

- `store` = `client.adapter` (the engine `MemoryAdapter`; it holds the fetched partition in a host that asked for one, and **nothing** in a pages-only host — since 2026-08-16 the Runtime app connects with `records: 'none'`), `config` = `client.config`.
- `findActivity(id)` — resolve an activity id to its def + owning record type.
- `findRecordType(id)` — resolve a record type id to its def + workflow, or null (a page may name a type that was since renamed); how `validatePage` checks the page's record declaration.
- `getPage(path)` / `listPagePaths()` — reads over the client's page snapshot.
- `captureHost` — what the capture form runs against when a page opens one (below): this client's GET query, upload service and label resolution. No record picker.
- `evaluateExpression` / `runCallback` — the expression host, below.
- `validateExpression` / `validateCallback` / `validatePage` / `reportPageFindings` — the validators, below.

Activity runs round-trip the server through `client.runActivity` exactly as before the extraction; the client refreshes afterwards — the whole partition where there is one, otherwise just the records the host already holds.

## Rendering (PageRenderer + ComponentContainer)

**A slot scrolls; a split clips** (2026-08-20). `Panel.overflow` (`'hidden' | 'scroll'`) has been in LAYOUT_EDITOR_SPEC since the layout editor was designed and was never read by the renderer — every panel clipped. Unset, the default now depends on what the panel holds: a panel with **children** clips, which is what stops a split layout growing when one side fills; a panel holding a **component** scrolls, because clipping a leaf puts content out of reach with no scrollbar to say so. Found through a work order list whose Dispatch button sat just past the right-hand edge of its slot. `'scroll'` renders as `auto`.

`PageRenderer` takes `{ runtime, pagePath, slotConfigs, contextSchema, debug? }`: it reads the page's `layout` from `runtime.getPage(pagePath)`, renders the panel tree, and mounts a `ComponentContainer` per filled slot. `slotConfigs`/`contextSchema` stay props (not read from the stored page) so the editor can preview unsaved state. `debug` shows the collapsible `context.page` strip (was `import.meta.env.DEV`-gated pre-extraction; now the host decides — the editor preview passes its DEV flag, the workbench doesn't). Styles export as a `css` string (`pageRendererCss`): the page builder rides its shadow-DOM css channel, the workbench a plain `<style>` tag.

`ComponentContainer` evaluates dynamic props (re-evaluating on any `context.page` change or completed activity run), wires named callbacks, renders the component with its manifest css, and owns the activity-run surface: UI activity (has attributes) → `ActivityFormModal`, which since 2026-08-16 is chrome around the **shared** capture form (below); non-UI → straight to the server pipeline. A warn soft-stop is the form's own Continue/Cancel where there is a form, and the platform `window.confirm` for an attribute-less activity, which has none.

## The capture form (`capture/`, shared 2026-08-16)

One form runs a UI activity everywhere: every attribute type, `show_condition`, `required`, `validation`, `can_waive` waivers, composites and section markers, and the before-hook warning decision. The semantics are specified in the [workbench SPEC](../../workbench/docs/SPEC.md) (where the form was built and where its rules are still described); what belongs here is the seam.

It lives in this package because a page and a record UI open the same form and only the host behind it differs. **Dependency direction:** `@fluxus/workbench` imports it from here, not the other way round — the page runtime must not depend on the whole record UI to draw one dialog. Before this the page had a 60-line imitation that drew every attribute as a text box, so a page could not offer a dropdown at all.

**`CaptureHost`** (`capture/host.ts`) is what a host supplies, through `CaptureHostProvider`:

- `evaluate(source, script)` — a capture expression against the `attributes` / anchor-record / `activity` roots. Synchronous; the host decides the posture (the workbench evaluates in its own engine, so `context.user` and its service modules are the ones a condition sees anywhere else there; this package's `evaluateCapture` uses page posture: reads only).
- `query` — how a datasource that names a GET reaches it. Absent ⇒ `invoke` fails loudly and the dropdown reports it.
- `uploads` — the client's `UploadService`, for the file/photo widgets.
- `resolveDisplayLabel` / `resolveAttributeDisplayField` — a stored reference id → something readable.
- `recordPicker?` — **injected, not shared**. Browsing records to pick one needs the record snapshot a page does not have, so the workbench supplies its `RecordPickerDialog` and a page, supplying none, renders a reference as a typed id. It plugs in unchanged when a page can reach records through a GET.

**Only a datasource may round-trip** ([DATA_THROUGH_ACTIVITIES step 4](../../../docs/DATA_THROUGH_ACTIVITIES.md)). A list attribute's `datasource` is evaluated through the engine's `evaluateWithGets`, so it may name a GET (`invoke('act_get_crews', { region: attributes.region })`) — the same expression the server re-runs at submission, which is what makes the dropdown and its guard one declaration. One that names no GET resolves on the first round without touching the network, so the loading state shows only when something is genuinely being fetched, and a stale selection self-clears only once the options have landed. Show conditions and validation rules stay synchronous: they re-run on every keystroke and read what the host already holds.

`capture/attributeWidgets.tsx` moved here with the form — the pure, context-blind capture and display widgets for the file/photo/scalar types. The workbench imports the display ones (`PhotoThumbs`, `FileChips`, `PhotoCountCell`) for its grid, record view and history card. This is the `@fluxus/attribute-widgets` package the restructure sketched, landed as a directory in the package both consumers already import rather than as a fourth library.

## Page wiring — FluxScript everywhere (2026-07-12)

One language, one validator, every surface (PAGE_WIRING_DESIGN):

**The ctx root.** Page context IS the DSL's `context` root. The engine bridge supplies `context.user`; the page host adds `context.app` and `context.page` via `contextExtras`. `context.page` is page-local UI state: seeded from the page's declared `contextSchema` keys, written only via `services.page.setContext`. The validator treats `context.page.*` as opaque (ruled: permissive for MVP).

**Dynamic props are single expressions**, evaluated with **datasource posture**: `'read'` mode and a records host without a mutation surface, so effects and writes fail loudly. Results are flattened for SDM-blind components (`toComponentValue`: `DslRecord {id, type, fields}` → `{id, ...fields}`, FkPointers → raw ids).

**A dynamic prop may name a GET activity instead of carrying the query** (2026-08-10, [DATA_THROUGH_ACTIVITIES step 2](../../../docs/DATA_THROUGH_ACTIVITIES.md)) — `invoke('act_get_work_orders', { status: context.page.status })`. This needed no new syntax and no second binding shape: `invoke` is a DSL built-in legal in expressions, and until now this host simply left `EvalHost.invoke` absent so it failed loudly. The producer is named *in* the expression, not beside it, so one stored artifact covers both — and the same text runs unchanged server-side, where `invoke` is already native (which is what step 4's re-run of a declared producer will stand on). `runtime.evaluateExpression` is therefore **async**, and `ComponentContainer` evaluates a component's props together, discarding an answer overtaken by a newer run.

**How a synchronous evaluator waits.** The loop itself is `evaluateWithGets` in `@fluxus/engine` since 2026-08-16 — it was written here, and moved when a capture form's dropdown needed the same waiting; the page host now supplies only how to evaluate one round. Evaluation runs in **rounds**: a round evaluates the expression with an `invoke` that records what it is asked for and returns a placeholder; the round's requests are fetched together; the next round evaluates again with the answers in hand. A round that asks for nothing new is the answer. Re-evaluating is free by construction — datasource posture means the expression has no effects to repeat. Rounds beat walking the AST for `invoke` calls because an expression may reach one through a named function, which no walk of the expression alone can see, and because a GET whose parameters come from another GET's answer converges instead of being a special case. The placeholder is a **symbol**, not null: the evaluator reads an unknown object's members as nulls, which would quietly send the next GET a question nobody meant, whereas reaching into a symbol throws and the round is simply abandoned. Four rounds, then a loud failure. Answers are memoised per `(activity, parameters)` within one evaluation, so a GET named twice is asked once; a fresh evaluation re-asks, because something changed.

**A prop that reads records directly is flagged at authoring time** (2026-08-16). `validatePage` runs a second validation pass with `records` banned (`validateExpressionWithoutRecords` — the real parser, so a `records` inside a string literal or reached through a named function is judged correctly) and turns a hit into a **warning**: *"This reads records directly, so it shows nothing in the Runtime app — name a GET activity instead."* Inline reads stay legal; they simply answer with whatever the browser happens to hold, which is everything in the Console and nothing in the Runtime app. Whether inline goes altogether is still open, and belongs with the workbench's own snapshot question.

**`invoke` is not available in a callback** — a callback script is synchronous and returns nothing, so there is no round to wait in. `validatePage` says so at save time rather than leaving it to a runtime error. The gate's warnings go to the console, since a read has no soft stop to offer them to.

**The page's record rides with every ask** (2026-08-11, step 3): `client.query` is called with the page's own record as `recordId`, which is where the server lands the read's light entry. It is the **anchor, not the subject** — the question is still whatever the parameters say (DATA_THROUGH_ACTIVITIES §1). A pure view sends none and its reads stay untraced, which `validatePage` warns about when such a page names a GET.

## The record a page is about (2026-08-11)

Every run is about exactly one record, so a page that acts — running an activity, or asking a GET, which is an activity — needs one of its own before its first frame ([CLIENT_TRUST_BOUNDARY §7](../../../docs/CLIENT_TRUST_BOUNDARY.md)). `PageDef.record` says which:

```jsonc
"record": { "type": "rt_dispatch_boards", "instances": "one" }
```

- **`one`** — a single instance per operation ("the board"): `resolvePageAnchor` finds it, or **creates it through the record type's create activity** the first time anyone opens the page. There is no second way a record comes into being, so the board's history starts with "created" exactly like a work order raised by hand. Where a type wrongly holds two, the lowest id wins — deterministic beats flipping between boards, and `validatePage` is where the mistake gets said out loud.
- **`many`** — two groups, two boards: the id arrives from the host (the Runtime app reads `?record=` off the URL) and nothing is created.
- **absent** — a pure view. It renders, it reads, and its reads land nowhere.

The record type stays **ordinary**: nothing marks it as an app, and the same type can be a page's subject and a workbench record type at once. The only special thing is how you arrive at the record, and that is this declaration.

**The anchor is fetched, never read out of a snapshot** (2026-08-16). `resolvePageAnchor` goes through the client — `fetchRecord(id)` for `many`, `fetchRecords(type)` for `one` — because a pages-only host now connects with **no records at all** (`connect({ records: 'none' })`, DATA_THROUGH_ACTIVITIES step 5). Asking an empty snapshot whether the board exists yet would answer "no" every time and raise a second board on every page open. A host that does hold the partition pays one round trip and gets the same answer, so there is one path. The fetch is also the authorisation check: a record the caller may not read comes back as not-found.

`PageRenderer` resolves the anchor before rendering any component (a component that read first would fire an untraceable GET and then have to fire it again), shows `Opening…` while it does, and reports a failed resolution in place of the page. The resolved record becomes `PageContext.record` — so `context.record` is live in every expression and callback the page runs, the same root a workbench form sees — and the id it carries is the anchor sent with each GET.

**A control is shown whether or not it is wired** (ruled 2026-08-26, the user's call). `ComponentContainer` supplies a function for **every** callback the manifest declares; an unwired one reports *"'onDispatch' is not wired on this page"* through the host error channel when it is used. Components therefore render their controls unconditionally rather than gating on `onX &&`.

The reasoning, which reversed the earlier behaviour: a control that vanishes because nobody wired it looks exactly like one hidden by access control or an activity's show condition — and only those two are answers to *"may I do this?"*. Visibility is the model's business; wiring is the author's, and a missing wire is a gap, so it should be loud rather than invisible. `validatePage` says the same thing where it can still be fixed: an unwired declared callback is a **warning**.

**Callbacks are scripts.** Components emit one `value`; the host packs it under the **`callbackData` root**, so scripts read `callbackData.value`. The free-form second argument was removed 2026-08-09 ([DATA_THROUGH_ACTIVITIES §4](../../../docs/DATA_THROUGH_ACTIVITIES.md)) — `value` stays because it is the anchor, and an anchor is authorised on every run; anything else an activity needs it declares as an attribute and captures itself. Scripts run in `'mutate'` mode (service effects execute) against a read-only records host — direct record writes throw: **mutations flow only through activities**. The validator's `'callback'` mode enforces the same statically.

**`services.page` + `services.activities`** — two modules, one handler set (`PageServiceHandlers`, supplied per component instance by `ComponentContainer`):

- `services.page` — UI-local effects only this host injects: `setContext(key, value)`, `hideComponent()`.
- `services.activities.run(activityId, record)` — the host-neutral activity surface (ruled 2026-07-12): identical manifest across hosts, each host supplies its implementation. The only mutation path from a page; the callback contract is the anchor record alone; outcomes flow back by re-evaluating dynamic props after the run. Since 2026-08-16 the host **fetches** that anchor by id before opening the form or running (`client.fetchRecord`) rather than looking it up locally: the id the component emitted came out of a GET's answer, not out of anything the browser holds. The callback script has already returned by then, so a failure — including a record the caller may not read — surfaces through the host's error channel.

## Page definition (pageDef.ts, layout.ts, manifest.ts)

A `static-config` property of type `array` may also carry **`items`** (added 2026-08-28): the fields of one item, each described by a `PropSchema` of its own — the same type one level down, so there is no second way of describing a property. It exists for the page builder, which draws a row-per-item editor (a modal, opened from a summary line) from it and so can edit `RecordList.columns` or any other list without a line of component-specific code. A component that declares an array **without** `items` leaves that property read-only in the builder: nothing may guess what one item holds, and the single-line text box that stood there before replaced whole arrays with `[object Object],…` the moment anyone typed in it.

`PageDef` (`template?`, `layout?`, `componentDependencies?`, `contextSchema?`, `slotConfigs?`, `access?`), the layout types (`Panel`, `LayoutDefinition` — full property set in the page builder's LAYOUT_EDITOR_SPEC.md), and the component contract (`PropSchema` with kinds `static-config` / `dynamic-data` / `callback`; `ComponentManifest`) all live here — the renderer and the editor share one definition of a page. `access.open` (role ids that may open the page, **default deny** once the solution declares roles) was added to the type on 2026-08-10 so the Console could author it; the server has enforced the same shallow convention off the opaque def since M4 (`pageOpenable`), which meant a published page nothing could open — filtered out of the snapshot, and reported by the Runtime as missing. Pages persist on `@fluxus/server` (opaque jsonb); the Console-side write path (`savePage` + background round-trip) stays in the page builder's `persistence.ts`.

## validatePage

Save-time validation of a whole page file against the model, unchanged in substance from the page-builder original: the record declaration (below), component names against `componentManifests`, static keys and binding names against prop schemas (wrong kind = error; required dynamic prop unbound = warning), expressions/scripts via the shared validators, literal activity ids against real activities (AST walk). `reportPageFindings` consoles findings with `[page <path>]` prefixes. Callers hold a `PageRuntime`; the module itself takes the narrow `PageValidationHost` slice.

The **record declaration** is checked where it can still be fixed: an unknown record type is an error, and so is a one-instance page whose type has no create activity — both would otherwise strand the page at open. A create that requires attributes is a warning (nobody is there to fill a form in when a page opens its own record), and so is a page that names a GET while being about nothing, since that is legal but means the reads leave no trace.

The reference check is the only part that knows **which surface** a source came from: `services.activities.run(id, …)` resolves in callbacks, and `invoke(id, …)` resolves in dynamic props — where the named activity must also *be* a GET, since nothing else can answer — while an `invoke` in a callback is an error outright. Non-literal ids are left to runtime, as before. The Console's expression dialog still validates language-only (the shared `validateExpression`), so a mistyped activity id surfaces at save, not as you type.

**Package tests**: `test/pageHost.test.ts` covers the round machinery against a stub server — parameters computed from page context, memoisation, a GET fed by another GET never being asked with a placeholder, the round budget, a host with no door to the model, and the page record riding along as the anchor; `test/validatePage.test.ts` covers the reference check and the record declaration; `test/pageAnchor.test.ts` (step 3) covers find-or-create against a stub client whose store stands in for the *server's* while the browser's own stays deliberately empty — created through the create activity and not behind the pipeline's back, the second open reusing the first board, the resolution asking the server rather than the snapshot, determinism when a type wrongly holds two, and the four ways a page can be stranded; `test/capture.test.ts` covers the capture form's evaluation seam.

## Component library

The five demo components (`AppHeader`, `InventorList`, `InventorProfile`, `Map`, `WorkOrderList`) and `componentManifests` moved here with the cluster.

**Model-blind building blocks (2026-08-27).** `RecordList` and `RecordTree` are the first components meant for real solutions rather than the demo, and they are named for what they do, not for whoever uses them first — the demo components' names (`WorkOrderList`, `InventorProfile`) are the drift to avoid, since a platform must not grow one solution's vocabulary.

- **`RecordList`** — rows in, declared columns, `onOpen(record)` / `onNew(null)` out. Deliberately not the workbench grid: that one is the generic face of a *whole model* (every record type, every activity, import/export, schema navigation) and belongs inside the workbench, where the audience is an implementer. A page wants one list, the columns its author chose, and the two or three acts the page is about.
- **`RecordTree`** — any record type with a self-reference. Rows arrive flat, because that is what a GET answers with; the nesting is presentation, rebuilt in the component. A row whose parent is absent from the answer renders as a root, so a filtered answer still shows; cycles are broken rather than hanging. The page names the parent field, so nothing here knows what a cost breakdown is.

`RecordList` distinguishes **selecting** from **acting**: a row click selects and does nothing else, and each act is a button at the end of the row (`onEdit`, `onOpen`), labelled by the page. A click that silently starts an edit is a click nobody asked for.

One limit remains, unworked-around: **`services.activities.run(activityId, record)` carries an anchor and nothing else.** So "add a child *here*" cannot pre-fill the parent — the capture form has to ask for it. Fine for a CREATE with a handful of fields, awkward for tree editing, and the natural place a prefill argument would go if one is ever agreed.

## Navigation — `services.page.open` (2026-08-27)

```
services.page.open('pages/cbs', callbackData.value)
```

A page to open, and the record it is about (null for a pure view) — deliberately the same shape as `services.activities.run`. It invents no concept: the page-anchor model already ruled that `?page=` and `?record=` address what is open, so navigating *is* writing that pair.

The seam is `PageRuntime.openPage`, supplied by the **host**, because what navigating means is the host's idea and belongs to neither the component nor `ComponentContainer`:

- **Runtime app** — sets the shell's page state and the address bar, so a page opened from another page is the same link a menu item would have produced. The page runtime is a module singleton built before React exists, so `host.ts` holds the seam and `RuntimeProvider` fills it.
- **Console** — *not supplied*. Navigating in the page builder means opening a different page in the editor, which is Console work of its own. Until then the container reports "this host cannot open pages" rather than swallowing the click — the same posture as `invoke` without a query.

Being a manifest-carrying service function, unknown-function and arity errors fire at config-save time like any other.

**Deliberately not built:** save-time validation that the named page path exists. The menu editor already makes exactly this check, so the rule is established and this is a follow-up rather than an open question. The page builder keeps its palette registries (`SESSION_COMPONENTS`, `componentSchemas`) as separate lists importing from this package — deriving the three registries from the manifest is a floated cleanup, not agreed. Per-solution component libraries are a future concern; the registry is module-level for now.

## Hosts

- **`@fluxus/console`**: editor preview (`PageEditor`) + `ExpressionDialog` validation; creates the handle in `sdm-runtime/engine.ts` at bootstrap.
- **`@fluxus/runtime`** (2026-07-19 MVP slice, then the workbench's Pages section): the menu addresses published pages, and `PageView` swaps the content area to the rendered page; creates the handle in `host.ts`. First step of the workbench becoming the Runtime app. Since step 3 it also addresses **what is open** in the URL — `?page=<pageId>&record=<recordId>` beside the existing `?operation=` — and passes `recordId` to `PageRenderer`.
