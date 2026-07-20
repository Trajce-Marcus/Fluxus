# @fluxus/page-builder — Living Spec

Current design truth for the page builder. Updated in the same commit as any behaviour/design change (see root CLAUDE.md). The layout editor has its own full spec: [LAYOUT_EDITOR_SPEC.md](LAYOUT_EDITOR_SPEC.md). The wiring design rationale and rulings live in [PAGE_WIRING_DESIGN.md](PAGE_WIRING_DESIGN.md); the mechanisms it specifies (expression host, callbacks, `services.page`/`services.activities`, `validatePage`, the renderer) live in **`@fluxus/page-runtime`** since the 2026-07-19 extraction — see that package's [SPEC](../../page-runtime/docs/SPEC.md). This package is the Console side: the editor.

## Shape

Two layers under `src/`:

- **`platform-components/shell/`** — IDE-style shell: activity bar, sidebar panel, tab bar, content area, console panel, header. **Two-level IA (CONSOLE_RUNTIME_SPEC §3):** the store's `solutionId` splits the shell into a *workspace* mode (activity bar = **Workspace** → `AdminSidebar`: Solutions/Operations/governance) and a *solution* mode (a solution open → **Pages/SDM/Components/Search**). `enterSolutionScope`/`exitSolutionScope` toggle it; `scopeVersion` keys `shell-body` so opening/switching a solution (or an SDM config save) remounts every solution-scoped view to re-read the fresh snapshot.
- **`platform-components/page-builder/`** — the editor: PageExplorer, PageEditor, ComponentsPanel, the layout editor, `ExpressionDialog.tsx`, `persistence.ts` (the save path). Mounts as a **solution-level** activity. Rendering and validation are imported from `@fluxus/page-runtime` (`PageRenderer`, `componentManifests`, the validators via the `pageRuntime` handle).
- **`platform-components/admin/`** — workspace-level admin panels (Solutions, Operations, Role assignments, Implementer levels, Operation menu) over `ConsoleClient`. `SolutionsAdmin`'s **Open** action enters a solution's design scope.
- **`platform-components/sdm-builder/`** — solution-level SDM editor (slice 1): `SdmSidebar` + `SdmView` route `sdm/record-types|attributes|roles` to `RecordTypesEditor`/`AttributesEditor`/`RolesEditor`. Each edits a local clone of `sdmClient.config` and persists via `useSolutionConfig.commitConfig` (→ `saveConfig` → `reloadSolution` → remount). Workflow/activity/hook (FluxScript) authoring is deferred.

The app component library (AppHeader, InventorList, InventorProfile, Map, WorkOrderList and their prop schemas) moved to `@fluxus/page-runtime`; `src/components/index.ts` re-exports it for the `MyComponents` mount API (`src/api.ts` — the original react-in-html mechanism for embedding registered components, and the real entry: index.html loads it and mounts `Shell`; `src/main.tsx` is a dead POC leftover). The palette registries (`sessionComponents.ts`, `componentSchemas.ts`) stay here as separate lists by standing decision (deriving the three registries from the manifest is a floated cleanup, not agreed).

## SDM runtime (Extraction stage 2; repointed at backend stage 2; slimmed at the page-runtime extraction)

`src/sdm-runtime/engine.ts` holds the platform singletons (fork 2: never in React state). `initSdmRuntime()` (kicked off by `api.ts` at module load; every `mount` awaits it) now only runs the auth gate and creates the solution-independent `consoleClient` — the Console **boots into workspace mode** with no solution connected. Opening a solution calls `openSolution(id)`, which assigns the design-scoped singletons; `reloadSolution()` re-runs it after a config save:

- **`consoleClient`** — `ConsoleClient` for the workspace admin surface (solutions/operations CRUD, publish/versions/governance). Created once at boot; solution-independent.
- **`sdmClient`** — `FluxusClient.connectSolution(solutionId)` (design plane: config + draft pages by `solutionId`, no operation, empty partition) into the engine's `MemoryAdapter`. Reassigned on each `openSolution`; undefined in workspace mode (only solution-level views read it). `saveConfig` persists the SDM config.
- **`pageRuntime`** — `createPageRuntime({ client: sdmClient })`, the injected handle the runtime cluster (and this package's editor validation) reaches the SDM through. Rebuilt alongside `sdmClient` on each open.

Components never import these — they reach the SDM only through the FluxScript wiring (expressions in, callback scripts out).

The demo page (`pages/work-orders-demo`) is a repo file — `pages/work-orders-demo.json` in this package — pushed by the server seed script: a `WorkOrderList` wired to the shared SDM in FluxScript, exercising every wiring mechanism. The list is empty until work orders exist in the scope — create one in the workbench and it appears here (one model, many apps, observably).

## Page persistence (persistence.ts)

Pages live on `@fluxus/server` (backend stage 3, 2026-07-16 — the `pages` table, one row per `(scope, path)`; no localStorage, hard cutover like stage 2). They ride the config pipeline: the server is runtime truth, repo files under this package's `pages/` are the deploy input (the seed script upserts every `*.json`, page path = file path minus extension prefixed `pages/` — **deploying pages = deploying files**, and a deploy overwrites live edits by design). The client snapshots the scope's page set at connect, so `persistence.ts` reads stay synchronous; writes update the snapshot and round-trip in the background, logging loudly on failure.

The `PageDef` shape and `validatePage` live in `@fluxus/page-runtime` (page defs are opaque jsonb to the server, so unlike the SDM config there is no server-side save-time validation). Every `savePage` here runs `pageRuntime.reportPageFindings` — the page-file counterpart of the engine's config-save-time check. Findings never block the save; a page mid-edit may be broken, loudly.

## Editor UI

Bindings render as read-only expression previews; clicking opens the **expression dialog** (`ExpressionDialog.tsx`): a Monaco editor registered with language id `fluxscript` (`fluxscriptLanguage.ts` — Monarch tokenizer mirroring the DSL keyword set; Monaco is bundled locally via `loader.config({ monaco })` + a Vite `?worker` import — the CDN default rendered a bare textarea when unreachable. Cost: the bundle carries the full editor; code-splitting is a floated cleanup). The dialog validates live via the `pageRuntime` handle — expressions with datasource posture (`attributes` banned), callbacks in `'callback'` mode with `callbackData` as an extra root — and blocks Save on errors. Saving empty clears the binding. Richer affordances (jump-to-function, promote-to-function) are the agreed follow-up (design doc, crossover section).

The PageEditor preview column embeds `PageRenderer` with the live (possibly unsaved) slot configs and context schema, passing `debug={import.meta.env.DEV}` for the `context.page` debug strip.

## Planned upgrades (per root ROADMAP)

1. **Expression ↔ function crossover affordances:** jump from an expression into the functions it calls (and back); one-click promote-to-function. Acceptance bar agreed in PAGE_WIRING_DESIGN; where the inline/function line sits is left to evolve from usage.
2. **Manifest shape contracts** — *deferred by ruling (2026-07-11)*: with attributes captured by the standard form rather than mapped from payloads, contracts lost their main consumer; revisit if silent payload mapping ever becomes needed.
3. **App modules:** coarse-grained reusable apps (e.g. calendar scheduler) ship as manifest-bearing components, rewired per SDM through slot config. The pattern is model-agnostic (non-SDM backends can sit behind the wiring), but schema validation and the audit spine exist only with an SDM.
4. **Pages as SDM citizens:** a page file is a declarative definition validated against the model — same species as an entity file. Shape lands with the backend phase (same store, same write path, same audit).
