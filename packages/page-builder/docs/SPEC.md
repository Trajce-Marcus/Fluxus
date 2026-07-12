# @fluxus/page-builder — Living Spec

Current design truth for the page builder. Updated in the same commit as any behaviour/design change (see root CLAUDE.md). The layout editor has its own full spec: [LAYOUT_EDITOR_SPEC.md](LAYOUT_EDITOR_SPEC.md). The wiring design rationale and rulings live in [PAGE_WIRING_DESIGN.md](PAGE_WIRING_DESIGN.md).

## Shape

Two layers under `src/`:

- **`platform-components/shell/`** — IDE-style shell: activity bar, sidebar panel, tab bar, content area, console panel, header.
- **`platform-components/page-builder/`** — the builder itself: PageExplorer, PageEditor, ComponentsPanel, the layout editor, PageRenderer, ComponentContainer, and the DSL host surface (`pageHost.ts`, `validatePage.ts`, `ExpressionDialog.tsx`).

`src/components/` holds demo user components with prop schemas; `src/api.ts` exposes the `MyComponents` mount API (the original react-in-html mechanism for embedding registered components in arbitrary host pages).

## SDM runtime (Extraction stage 2)

`src/sdm-runtime/` makes the page builder the engine's second host:

- **`engine.ts`** — the platform singletons, created at module load, never in React state (fork 2): `LocalStorageAdapter` on the host's own key `fluxus:page-builder:records`, plus `createEngine`. Config-save-time validation runs at boot, same posture as the workbench. Components never import these — they reach the SDM only through the FluxScript wiring (expressions in, callback scripts out).
- **`config.ts`** — this host's own small sample SDM. Config distribution (one canonical config across hosts) is an open thread on the root ROADMAP; data is per-host until the backend makes "one model, many apps" literal.
- **`ActivityFormModal.tsx`** — the minimal standard capture form for app-triggered UI activities (text/date + `required`). Deliberately a subset of the workbench's form: peer hosts can't share React components, and where a full shared form should live is an open discussion.
- **`demoPage.ts`** — seeds `pages/work-orders-demo` (once, deletable): a `WorkOrderList` wired to the sample SDM in FluxScript, exercising every wiring mechanism.

## Page definition (persistence.ts)

A page is declarative config, persisted under `fluxus:page:<path>`:

```
PageDef {
  template?              — base template path
  layout?                — panel tree (LayoutDefinition; see LAYOUT_EDITOR_SPEC.md)
  componentDependencies? — [{ name, version }]
  contextSchema?         — ContextKeyDef[]: page-declared context.page seed keys
  slotConfigs?           — per-slot wiring (SlotConfig)
}
```

Every `savePage` runs `validatePage` and reports findings to the console — the page-file counterpart of the engine's config-save-time check. Findings never block the save; a page mid-edit may be broken, loudly. Pages written before the wiring redesign (dropdown-built config objects, overlays, platform context keys) load with layout and component lists intact; old wiring is dropped and re-authored.

## Page wiring — FluxScript everywhere (2026-07-12)

One language, one validator, every surface (PAGE_WIRING_DESIGN). The dropdown-built `DynamicPropConfig` / `CallbackAction` unions and the mock procedure registry are gone.

**The ctx root.** Page context IS the DSL's `context` root — no parallel construct. The engine bridge supplies `context.user`; the page host adds `context.app` and `context.page` via the bridge's `contextExtras`. `context.page` is page-local UI state: seeded from the page's declared `contextSchema` keys, written only via `services.page.setContext`. The validator treats `context.page.*` as opaque (ruled: permissive for MVP — wrong keys surface at runtime); per-page key declarations can tighten this later without migrating page files. Route params (`/work-orders/:id` → ctx) arrive with app-level navigation.

**Dynamic props are single expressions.** `SlotConfig.dynamicProps` maps propName → FluxScript expression source, e.g. `records.work_orders.where(status != 'Completed')`. Evaluated with **datasource posture**: `'read'` mode and a records host without a mutation surface, so effects and writes fail loudly. Results are flattened for SDM-blind components (`DslRecord {id, type, fields}` → `{id, ...fields}`, FkPointers → raw ids). Expressions are opaque, so the re-evaluation trigger is any `context.page` change or a completed activity run — not a declared key slice.

**Callbacks are scripts.** `SlotConfig.callbacks` maps callbackName → FluxScript script source. Components emit `(value, data?)`; the host packs both under the **`callbackData` root** (`callbackData.value` / `callbackData.data`). Scripts run in `'mutate'` mode (service effects execute) against a read-only records host — direct record writes throw: **mutations flow only through activities**. The validator's `'callback'` mode enforces the same statically.

**`services.page`** (pageHost.ts) — UI-local effects only this host injects; a page callback, a hook, and a future non-UI workflow differ only in which service modules their host provides:

- `setContext(key, value)` — write a `context.page` key.
- `hideComponent()` — hide the invoking component instance.
- `runActivity(activityId, record, data)` — the only mutation path from a page. The callback contract stays (record, one data object): UI activity (has attributes) → the standard capture form opens; non-UI → straight to the hooks with `data` as the hooks' `callbackData` root. One engine pipeline either way: availability gate, hooks, history. Warn soft-stops get the platform confirm dialog; errors land on the page's error surface; outcomes flow back by re-evaluating dynamic props after the run.

The old `show-overlay` action and `OverlayConfig` were cut (stub with no consumer — ruled in the design doc: complete or cut).

## Editor UI

Bindings render as read-only expression previews; clicking opens the **expression dialog** (`ExpressionDialog.tsx`): a Monaco editor registered with language id `fluxscript` (`fluxscriptLanguage.ts` — Monarch tokenizer mirroring the DSL keyword set; Monaco is bundled locally via `loader.config({ monaco })` + a Vite `?worker` import — the CDN default rendered a bare textarea when unreachable. Cost: the bundle carries the full editor; code-splitting is a floated cleanup). The dialog validates live — expressions via `validateExpression` (datasource posture, `attributes` banned), callbacks via `validateScript` in `'callback'` mode with `callbackData` as an extra root — and blocks Save on errors. Saving empty clears the binding. Richer affordances (jump-to-function, promote-to-function) are the agreed follow-up (design doc, crossover section).

## validatePage (validatePage.ts)

Save-time validation of the whole page file against the model (ROADMAP item 5):

- component names against the registry (`componentManifests`)
- static config keys and binding names against the component's prop schema (wrong kind is an error; a required dynamic prop with no expression is a warning)
- dynamic-prop expressions and callback scripts via the shared validators above
- literal activity ids passed to `services.page.runActivity` against real activities (AST walk; non-literal ids are left to runtime)

Findings report to the console with `[page <path>]` prefixes, same voice as the engine's `reportConfigFindings`.

## Planned upgrades (per root ROADMAP)

1. **Expression ↔ function crossover affordances:** jump from an expression into the functions it calls (and back); one-click promote-to-function. Acceptance bar agreed in PAGE_WIRING_DESIGN; where the inline/function line sits is left to evolve from usage.
2. **Manifest shape contracts** — *deferred by ruling (2026-07-11)*: with attributes captured by the standard form rather than mapped from payloads, contracts lost their main consumer; revisit if silent payload mapping ever becomes needed.
3. **App modules:** coarse-grained reusable apps (e.g. calendar scheduler) ship as manifest-bearing components, rewired per SDM through slot config. The pattern is model-agnostic (non-SDM backends can sit behind the wiring), but schema validation and the audit spine exist only with an SDM.
4. **Pages as SDM citizens:** a page file is a declarative definition validated against the model — same species as an entity file. Shape lands with the backend phase (same store, same write path, same audit).
