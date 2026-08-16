# @fluxus/page-runtime — Living Spec

Current design truth for the page runtime. Updated in the same commit as any behaviour/design change (root CLAUDE.md rule). The wiring design rationale and rulings live in the page builder's [PAGE_WIRING_DESIGN.md](../../page-builder/docs/PAGE_WIRING_DESIGN.md) (written before the extraction; the mechanisms it specifies now live here).

## Scope

The **run-a-page cluster** (GLOSSARY "Page runtime", named 2026-07-19): `PageRenderer`, `ComponentContainer`, the component registry (`componentManifests` + the component library), the page expression host (`pageHost.ts`), save-time `validatePage`, and `ActivityFormModal` — everything a host embeds to turn a stored `PageDef` into working UI against live records. Page *editing* (layout editor, palette, Monaco, `persistence.ts`'s save path) stays in `@fluxus/console`.

Extracted from the page builder 2026-07-19 as the first step of **workbench → Runtime app**: the same cluster renders the editor preview in the page builder and published pages in the SDM workbench.

## The PageRuntime handle

The whole cluster reaches the SDM through **one injected handle** — no package-level singletons:

```ts
const runtime = createPageRuntime({ client }); // client: a connected FluxusClient
```

A host creates it once at bootstrap (platform singleton, never React context — the Extraction fork 2 ruling) and passes it to `PageRenderer` / the editor's validation calls. Everything else derives from the client's snapshot:

- `store` = `client.adapter` (the engine `MemoryAdapter` holding the fetched partition), `config` = `client.config`.
- `findActivity(id)` — resolve an activity id to its def + owning record type.
- `findRecordType(id)` — resolve a record type id to its def + workflow, or null (a page may name a type that was since renamed); how `validatePage` checks the page's record declaration.
- `getPage(path)` / `listPagePaths()` — reads over the client's page snapshot.
- `evaluateExpression` / `runCallback` — the expression host, below.
- `validateExpression` / `validateCallback` / `validatePage` / `reportPageFindings` — the validators, below.

Activity runs round-trip the server through `client.runActivity` exactly as before the extraction; the client refreshes the partition snapshot after each run.

## Rendering (PageRenderer + ComponentContainer)

`PageRenderer` takes `{ runtime, pagePath, slotConfigs, contextSchema, debug? }`: it reads the page's `layout` from `runtime.getPage(pagePath)`, renders the panel tree, and mounts a `ComponentContainer` per filled slot. `slotConfigs`/`contextSchema` stay props (not read from the stored page) so the editor can preview unsaved state. `debug` shows the collapsible `context.page` strip (was `import.meta.env.DEV`-gated pre-extraction; now the host decides — the editor preview passes its DEV flag, the workbench doesn't). Styles export as a `css` string (`pageRendererCss`): the page builder rides its shadow-DOM css channel, the workbench a plain `<style>` tag.

`ComponentContainer` evaluates dynamic props (re-evaluating on any `context.page` change or completed activity run), wires named callbacks, renders the component with its manifest css, and owns the activity-run surface: UI activity (has attributes) → `ActivityFormModal` (the minimal standard capture form — text/date + `required`; deliberately a subset of the workbench's form, shared-form home undiscussed); non-UI → straight to the server pipeline; warn soft-stops get the platform `window.confirm`.

## Page wiring — FluxScript everywhere (2026-07-12)

One language, one validator, every surface (PAGE_WIRING_DESIGN):

**The ctx root.** Page context IS the DSL's `context` root. The engine bridge supplies `context.user`; the page host adds `context.app` and `context.page` via `contextExtras`. `context.page` is page-local UI state: seeded from the page's declared `contextSchema` keys, written only via `services.page.setContext`. The validator treats `context.page.*` as opaque (ruled: permissive for MVP).

**Dynamic props are single expressions**, evaluated with **datasource posture**: `'read'` mode and a records host without a mutation surface, so effects and writes fail loudly. Results are flattened for SDM-blind components (`toComponentValue`: `DslRecord {id, type, fields}` → `{id, ...fields}`, FkPointers → raw ids).

**A dynamic prop may name a GET activity instead of carrying the query** (2026-08-10, [DATA_THROUGH_ACTIVITIES step 2](../../../docs/DATA_THROUGH_ACTIVITIES.md)) — `invoke('act_get_work_orders', { status: context.page.status })`. This needed no new syntax and no second binding shape: `invoke` is a DSL built-in legal in expressions, and until now this host simply left `EvalHost.invoke` absent so it failed loudly. The producer is named *in* the expression, not beside it, so one stored artifact covers both — and the same text runs unchanged server-side, where `invoke` is already native (which is what step 4's re-run of a declared producer will stand on). `runtime.evaluateExpression` is therefore **async**, and `ComponentContainer` evaluates a component's props together, discarding an answer overtaken by a newer run.

**How a synchronous evaluator waits.** The loop itself is `evaluateWithGets` in `@fluxus/engine` since 2026-08-16 — it was written here, and moved when a capture form's dropdown needed the same waiting; the page host now supplies only how to evaluate one round. Evaluation runs in **rounds**: a round evaluates the expression with an `invoke` that records what it is asked for and returns a placeholder; the round's requests are fetched together; the next round evaluates again with the answers in hand. A round that asks for nothing new is the answer. Re-evaluating is free by construction — datasource posture means the expression has no effects to repeat. Rounds beat walking the AST for `invoke` calls because an expression may reach one through a named function, which no walk of the expression alone can see, and because a GET whose parameters come from another GET's answer converges instead of being a special case. The placeholder is a **symbol**, not null: the evaluator reads an unknown object's members as nulls, which would quietly send the next GET a question nobody meant, whereas reaching into a symbol throws and the round is simply abandoned. Four rounds, then a loud failure. Answers are memoised per `(activity, parameters)` within one evaluation, so a GET named twice is asked once; a fresh evaluation re-asks, because something changed.

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

`PageRenderer` resolves the anchor before rendering any component (a component that read first would fire an untraceable GET and then have to fire it again), shows `Opening…` while it does, and reports a failed resolution in place of the page. The resolved record becomes `PageContext.record` — so `context.record` is live in every expression and callback the page runs, the same root a workbench form sees — and the id it carries is the anchor sent with each GET.

**Callbacks are scripts.** Components emit one `value`; the host packs it under the **`callbackData` root**, so scripts read `callbackData.value`. The free-form second argument was removed 2026-08-09 ([DATA_THROUGH_ACTIVITIES §4](../../../docs/DATA_THROUGH_ACTIVITIES.md)) — `value` stays because it is the anchor, and an anchor is authorised on every run; anything else an activity needs it declares as an attribute and captures itself. Scripts run in `'mutate'` mode (service effects execute) against a read-only records host — direct record writes throw: **mutations flow only through activities**. The validator's `'callback'` mode enforces the same statically.

**`services.page` + `services.activities`** — two modules, one handler set (`PageServiceHandlers`, supplied per component instance by `ComponentContainer`):

- `services.page` — UI-local effects only this host injects: `setContext(key, value)`, `hideComponent()`.
- `services.activities.run(activityId, record)` — the host-neutral activity surface (ruled 2026-07-12): identical manifest across hosts, each host supplies its implementation. The only mutation path from a page; the callback contract is the anchor record alone; outcomes flow back by re-evaluating dynamic props after the run.

## Page definition (pageDef.ts, layout.ts, manifest.ts)

`PageDef` (`template?`, `layout?`, `componentDependencies?`, `contextSchema?`, `slotConfigs?`, `access?`), the layout types (`Panel`, `LayoutDefinition` — full property set in the page builder's LAYOUT_EDITOR_SPEC.md), and the component contract (`PropSchema` with kinds `static-config` / `dynamic-data` / `callback`; `ComponentManifest`) all live here — the renderer and the editor share one definition of a page. `access.open` (role ids that may open the page, **default deny** once the solution declares roles) was added to the type on 2026-08-10 so the Console could author it; the server has enforced the same shallow convention off the opaque def since M4 (`pageOpenable`), which meant a published page nothing could open — filtered out of the snapshot, and reported by the Runtime as missing. Pages persist on `@fluxus/server` (opaque jsonb); the Console-side write path (`savePage` + background round-trip) stays in the page builder's `persistence.ts`.

## validatePage

Save-time validation of a whole page file against the model, unchanged in substance from the page-builder original: the record declaration (below), component names against `componentManifests`, static keys and binding names against prop schemas (wrong kind = error; required dynamic prop unbound = warning), expressions/scripts via the shared validators, literal activity ids against real activities (AST walk). `reportPageFindings` consoles findings with `[page <path>]` prefixes. Callers hold a `PageRuntime`; the module itself takes the narrow `PageValidationHost` slice.

The **record declaration** is checked where it can still be fixed: an unknown record type is an error, and so is a one-instance page whose type has no create activity — both would otherwise strand the page at open. A create that requires attributes is a warning (nobody is there to fill a form in when a page opens its own record), and so is a page that names a GET while being about nothing, since that is legal but means the reads leave no trace.

The reference check is the only part that knows **which surface** a source came from: `services.activities.run(id, …)` resolves in callbacks, and `invoke(id, …)` resolves in dynamic props — where the named activity must also *be* a GET, since nothing else can answer — while an `invoke` in a callback is an error outright. Non-literal ids are left to runtime, as before. The Console's expression dialog still validates language-only (the shared `validateExpression`), so a mistyped activity id surfaces at save, not as you type.

**Package tests**: `test/pageHost.test.ts` covers the round machinery against a stub server — parameters computed from page context, memoisation, a GET fed by another GET never being asked with a placeholder, the round budget, a host with no door to the model, and the page record riding along as the anchor; `test/validatePage.test.ts` covers the reference check and the record declaration; `test/pageAnchor.test.ts` (step 3) covers find-or-create against a stub client — created through the create activity and not behind the pipeline's back, the second open reusing the first board, determinism when a type wrongly holds two, and the four ways a page can be stranded.

## Component library

The five demo components (`AppHeader`, `InventorList`, `InventorProfile`, `Map`, `WorkOrderList`) and `componentManifests` moved here with the cluster. The page builder keeps its palette registries (`SESSION_COMPONENTS`, `componentSchemas`) as separate lists importing from this package — deriving the three registries from the manifest is a floated cleanup, not agreed. Per-solution component libraries are a future concern; the registry is module-level for now.

## Hosts

- **`@fluxus/console`**: editor preview (`PageEditor`) + `ExpressionDialog` validation; creates the handle in `sdm-runtime/engine.ts` at bootstrap.
- **`@fluxus/runtime`** (2026-07-19 MVP slice, then the workbench's Pages section): the menu addresses published pages, and `PageView` swaps the content area to the rendered page; creates the handle in `host.ts`. First step of the workbench becoming the Runtime app. Since step 3 it also addresses **what is open** in the URL — `?page=<pageId>&record=<recordId>` beside the existing `?operation=` — and passes `recordId` to `PageRenderer`.
