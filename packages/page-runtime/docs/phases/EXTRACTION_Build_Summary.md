# Page-runtime extraction — Build Summary (2026-07-19)

Point-in-time record of the extraction of `@fluxus/page-runtime` from `@fluxus/page-builder` and the first workbench embedding. Append-only; the living truth is [../SPEC.md](../SPEC.md).

## Mandate (settled the previous session, 2026-07-19 direction/naming session)

- Package name **@fluxus/page-runtime** endorsed; "page runtime" defined in the root GLOSSARY.
- Scope: the run-a-page cluster — PageRenderer, ComponentContainer, component registry, page expression host (`pageHost`), `ActivityFormModal`. Page *editing* stays Console-side.
- Break the cluster's hard-wiring to the page builder's `sdm-runtime` singletons (`sdmClient`/`sdmStore`/`config`/`findActivity`); inject the dependency instead. Component library moves too; editor/Monaco stays.
- Approved workbench MVP slice: "Pages" section in the sidebar; clicking a page swaps the content area to the rendered page; record grid/view untouched.
- Sequencing: renderer extraction first, auth design in parallel, then auth build, then RBAC stage 1 + menu.

## What was built

**New package `@fluxus/page-runtime`** (TS-source like engine/client: `main: src/index.ts`, `sideEffects: false`; deps client + dsl + engine + react). Contents:

- `runtime.ts` — **`createPageRuntime({ client })` → `PageRuntime`**, the one injected handle. The endorsed injection sketch was `{client, engine, adapter}`; built as client-only because the other two derive from it (`store = client.adapter`, `config = client.config`) and no cluster code uses an `Engine` instance — expressions go through the engine package's free `buildEvalHost`. Widening the input later is additive. The handle carries `findActivity`, page-snapshot reads (`getPage`/`listPagePaths`), `evaluateExpression`/`runCallback`, and the validators.
- `pageHost.ts` — moved; functions now take `(store, config, …)` parameters instead of importing singletons. Semantics untouched (datasource posture, `callbackData` root, `services.page` + `services.activities`, `toComponentValue` flattening).
- `ComponentContainer.tsx`, `PageRenderer.tsx` — moved; take a `runtime` prop. PageRenderer reads the page's layout via `runtime.getPage(pagePath)` (was `loadPageLayout` from persistence); `slotConfigs`/`contextSchema` stay props so the editor previews unsaved state.
- `ActivityFormModal.tsx` — moved unchanged from `sdm-runtime/`.
- `validatePage.ts` — moved; takes the narrow `PageValidationHost` slice of the handle (no import cycle with `runtime.ts`).
- `pageDef.ts` / `layout.ts` / `manifest.ts` — the page-definition, layout (`Panel`/`LayoutDefinition`), and component-contract (`PropSchema`/`ComponentManifest`) types, moved from `persistence.ts` / `layout-editor/types.ts` / `components/schema.ts`+`manifest.ts`.
- `components/` + `componentManifests.ts` — the five demo components and the registry, moved.

**Page builder rewired** (Console side):

- `sdm-runtime/engine.ts` slimmed to two singletons: `sdmClient` + `pageRuntime = createPageRuntime({ client: sdmClient })`. The `sdmStore`/`config`/`findActivity` exports and the **unused local `Engine` instance** (`sdmEngine` — created since backend stage 2 but consumed by nothing; expressions always went through `buildEvalHost`) were removed.
- `persistence.ts` keeps the save path (`savePage` → client round-trip + `pageRuntime.reportPageFindings`) and re-exports the moved types for existing editor imports; `layout-editor/types.ts` is now a re-export shim.
- `ExpressionDialog` validates via `pageRuntime.validateExpression`/`validateCallback`; `PageEditor` imports `PageRenderer` from the package and passes `runtime` + `debug={import.meta.env.DEV}`.
- `components/index.ts` (the `MyComponents` mount registry) and `componentSchemas.ts` import the library from the package. The three palette registries stay un-derived (standing decision), though the original circular-dependency reason is gone now that the components live outside the Shell's import graph.

**Workbench embedding** (`@fluxus/sdm`, the approved MVP slice):

- `host.ts` creates `pageRuntime = createPageRuntime({ client })` at `initHost`.
- `AppContext` gains `pagePaths` / `selectedPage` / `selectPage`; `selectRecordType` clears the page selection (returning to the grid/view pair).
- New `PagesList` sidebar section (hidden when the scope has no pages, styled like RecordTypeList) and `PageView` content component (renderer css via a plain `<style>` tag — light DOM, no shadow root). Both carry UAT `ComponentLabel`s.

## Deliberate deltas

- **Debug strip is a prop.** The `context.page` debug `<details>` was `import.meta.env.DEV`-gated inside PageRenderer; a shared package shouldn't decide that per-bundler, so it's now `debug?: boolean`. The editor preview passes its DEV flag (behaviour preserved); the workbench doesn't (end-user surface).
- `PageRenderer`'s css export is re-exported as `pageRendererCss` from the package index (was a named `css` import from the module).

## Verified

All tsc clean (7 packages via root `npm run build`, including both vite production builds — proving `.tsx` from a linked workspace package bundles fine in both hosts). Tests: dsl 187, server 28, sdm 20, engine 17, client 6 — all green. **No browser smoke this session** (flagged-cost rule; cheap verification only): the workbench Pages section and the page-builder preview have not been exercised in a real browser yet.

## Open threads

- Per-solution component libraries: `componentManifests` is module-level; making the registry part of the `PageRuntime` handle is the natural seam when solutions carry their own components.
- The shared capture form: `ActivityFormModal` is still the deliberate text/date subset; where the full shared form lives remains undiscussed.
- Deriving the palette registries (`SESSION_COMPONENTS`, `componentSchemas`) from `componentManifests` — floated cleanup, now unblocked by the move, still not agreed.
- Workbench pages next steps (not in this slice): record-carrying navigation, authored menu, my-work inbox — per the user-app functional spine sketch and the agreed auth-first-then-RBAC sequencing.
