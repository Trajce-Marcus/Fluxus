# @fluxus/page-runtime — Living Spec

Current design truth for the page runtime. Updated in the same commit as any behaviour/design change (root CLAUDE.md rule). The wiring design rationale and rulings live in the page builder's [PAGE_WIRING_DESIGN.md](../../page-builder/docs/PAGE_WIRING_DESIGN.md) (written before the extraction; the mechanisms it specifies now live here).

## Scope

The **run-a-page cluster** (GLOSSARY "Page runtime", named 2026-07-19): `PageRenderer`, `ComponentContainer`, the component registry (`componentManifests` + the component library), the page expression host (`pageHost.ts`), save-time `validatePage`, and `ActivityFormModal` — everything a host embeds to turn a stored `PageDef` into working UI against live records. Page *editing* (layout editor, palette, Monaco, `persistence.ts`'s save path) stays in `@fluxus/page-builder`, the Console side.

Extracted from the page builder 2026-07-19 as the first step of **workbench → Runtime app**: the same cluster renders the editor preview in the page builder and published pages in the SDM workbench.

## The PageRuntime handle

The whole cluster reaches the SDM through **one injected handle** — no package-level singletons:

```ts
const runtime = createPageRuntime({ client }); // client: a connected FluxusClient
```

A host creates it once at bootstrap (platform singleton, never React context — the Extraction fork 2 ruling) and passes it to `PageRenderer` / the editor's validation calls. Everything else derives from the client's snapshot:

- `store` = `client.adapter` (the engine `MemoryAdapter` holding the fetched partition), `config` = `client.config`.
- `findActivity(id)` — resolve an activity id to its def + owning record type.
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

**Callbacks are scripts.** Components emit `(value, data?)`; the host packs both under the **`callbackData` root**. Scripts run in `'mutate'` mode (service effects execute) against a read-only records host — direct record writes throw: **mutations flow only through activities**. The validator's `'callback'` mode enforces the same statically.

**`services.page` + `services.activities`** — two modules, one handler set (`PageServiceHandlers`, supplied per component instance by `ComponentContainer`):

- `services.page` — UI-local effects only this host injects: `setContext(key, value)`, `hideComponent()`.
- `services.activities.run(activityId, record, data)` — the host-neutral activity surface (ruled 2026-07-12): identical manifest across hosts, each host supplies its implementation. The only mutation path from a page; callback contract (record, one data object); outcomes flow back by re-evaluating dynamic props after the run.

## Page definition (pageDef.ts, layout.ts, manifest.ts)

`PageDef` (`template?`, `layout?`, `componentDependencies?`, `contextSchema?`, `slotConfigs?`), the layout types (`Panel`, `LayoutDefinition` — full property set in the page builder's LAYOUT_EDITOR_SPEC.md), and the component contract (`PropSchema` with kinds `static-config` / `dynamic-data` / `callback`; `ComponentManifest`) all live here — the renderer and the editor share one definition of a page. Pages persist on `@fluxus/server` (opaque jsonb); the Console-side write path (`savePage` + background round-trip) stays in the page builder's `persistence.ts`.

## validatePage

Save-time validation of a whole page file against the model, unchanged in substance from the page-builder original: component names against `componentManifests`, static keys and binding names against prop schemas (wrong kind = error; required dynamic prop unbound = warning), expressions/scripts via the shared validators, literal activity ids against real activities (AST walk). `reportPageFindings` consoles findings with `[page <path>]` prefixes. Callers hold a `PageRuntime`; the module itself takes the narrow `PageValidationHost` slice.

## Component library

The five demo components (`AppHeader`, `InventorList`, `InventorProfile`, `Map`, `WorkOrderList`) and `componentManifests` moved here with the cluster. The page builder keeps its palette registries (`SESSION_COMPONENTS`, `componentSchemas`) as separate lists importing from this package — deriving the three registries from the manifest is a floated cleanup, not agreed. Per-solution component libraries are a future concern; the registry is module-level for now.

## Hosts

- **`@fluxus/page-builder`** (Console): editor preview (`PageEditor`) + `ExpressionDialog` validation; creates the handle in `sdm-runtime/engine.ts` at bootstrap.
- **`@fluxus/sdm`** (workbench, 2026-07-19 MVP slice): "Pages" sidebar section; selecting a page swaps the content area to the rendered page; creates the handle in `host.ts`. First step of the workbench becoming the Runtime app.
