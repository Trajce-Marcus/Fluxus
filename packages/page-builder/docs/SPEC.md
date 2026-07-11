# @fluxus/page-builder — Living Spec

Current design truth for the page builder. Updated in the same commit as any behaviour/design change (see root CLAUDE.md). The layout editor has its own full spec: [LAYOUT_EDITOR_SPEC.md](LAYOUT_EDITOR_SPEC.md).

## Shape

Two layers under `src/`:

- **`platform-components/shell/`** — IDE-style shell: activity bar, sidebar panel, tab bar, content area, console panel, header.
- **`platform-components/page-builder/`** — the builder itself: PageExplorer, PageEditor, ComponentsPanel, the layout editor, PageRenderer, and ComponentContainer.

`src/components/` holds demo user components with prop schemas; `src/api.ts` exposes the `MyComponents` mount API (the original react-in-html mechanism for embedding registered components in arbitrary host pages).

## SDM runtime (Extraction stage 2)

`src/sdm-runtime/` makes the page builder the engine's second host:

- **`engine.ts`** — the platform singletons, created at module load, never in React state (fork 2): `LocalStorageAdapter` on the host's own key `fluxus:page-builder:records`, plus `createEngine`. Config-save-time validation runs at boot, same posture as the workbench. Components never import these — they reach the SDM only through the declarative wiring (procedures in, run-activity callbacks out).
- **`config.ts`** — this host's own small sample SDM. Config distribution (one canonical config across hosts) is an open thread on the root ROADMAP; data is per-host until the backend makes "one model, many apps" literal.
- **`ActivityFormModal.tsx`** — the minimal standard capture form for app-triggered UI activities (text/date + `required`). Deliberately a subset of the workbench's form: peer hosts can't share React components, and where a full shared form should live is an open discussion.
- **`demoPage.ts`** — seeds `pages/work-orders-demo` (once, deletable): a `WorkOrderList` wired to the sample SDM, exercising every stage 2 mechanism.

Procedures can now be store-backed (`sdm.listWorkOrders` in `mockFunctions.ts`) — same function-call-by-name shape the backend keeps (tRPC per root ARCHITECTURE.md), so wiring never changes when localStorage swaps out.

## Page definition (persistence.ts)

A page is declarative config, persisted under `fluxus:page:<path>`:

```
PageDef {
  template?           — base template path
  layout?             — panel tree (LayoutDefinition; see LAYOUT_EDITOR_SPEC.md)
  componentDependencies? — [{ name, version }]
  contextSchema?      — ContextKeyDef[]: typed page/platform context keys
  slotConfigs?        — per-slot wiring (SlotConfig)
  overlays?           — overlay component configs
}
```

## ComponentContainer — the wiring layer

The reuse seam of the whole platform (see root ARCHITECTURE.md). Components are model-blind; a **manifest** declares the contract (`name`, `version`, `component`, prop schema with kinds `static-config` / `dynamic-data` / `callback`, optional css). Per-slot **SlotConfig** adapts the contract to the environment:

- `staticConfig` — literal props.
- `dynamicProps` — structural: `{ source: 'context', contextKey }` or `{ source: 'procedure', procedureName, args }` (procedures resolve from the registry in `mockFunctions.ts`, which may be store-backed). The container refetches when any referenced context key changes, or after a run-activity completes.
- `callbackActions` — `set-context`, `hide-component`, `show-overlay`, and **`run-activity`** (Extraction stage 2, ruled 2026-07-11):
  - The implementer associates a component's named callback with an activity id in the slot wiring; the **callback contract is (record, one data object)**.
  - UI activity (has attributes) → the standard capture form opens; non-UI (no attributes) → nothing to fill in, the run passes straight to the hooks. Either way it is the one engine pipeline: availability gate, hooks, history.
  - The data object reaches hooks as the **`callbackData` root**; hooks may write attributes onto the entry and log via `services.logger` (see engine SPEC).
  - Warn soft stops get the platform-generic confirm dialog (`window.confirm` for now); activity errors (including a closed availability gate) land on the page's error surface.
  - Outcomes flow back to the app by re-evaluating the slot's dynamic props after the run.

## Planned upgrades (per root ROADMAP)

1. **DSL Phase 1 pickup:** `dynamicProps` become DSL expressions — queries over the SDM with aliasing `select(...)` doing the field mapping to the component's shape. Dependency tracking generalises from context keys to the expression's statically-known references.
2. **Manifest shape contracts** — *deferred by ruling (2026-07-11)*: with attributes captured by the standard form rather than mapped from payloads, contracts lost their main consumer; revisit if silent payload mapping ever becomes needed.
3. **App modules:** coarse-grained reusable apps (e.g. calendar scheduler) ship as manifest-bearing components, rewired per SDM through slot config. The pattern is model-agnostic (non-SDM backends can sit behind the wiring), but schema validation and the audit spine exist only with an SDM.
