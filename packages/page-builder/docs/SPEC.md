# @fluxus/page-builder — Living Spec

Current design truth for the page builder. Updated in the same commit as any behaviour/design change (see root CLAUDE.md). The layout editor has its own full spec: [LAYOUT_EDITOR_SPEC.md](LAYOUT_EDITOR_SPEC.md).

## Shape

Two layers under `src/`:

- **`platform-components/shell/`** — IDE-style shell: activity bar, sidebar panel, tab bar, content area, console panel, header.
- **`platform-components/page-builder/`** — the builder itself: PageExplorer, PageEditor, ComponentsPanel, the layout editor, PageRenderer, and ComponentContainer.

`src/components/` holds demo user components with prop schemas; `src/api.ts` exposes the `MyComponents` mount API (the original react-in-html mechanism for embedding registered components in arbitrary host pages).

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
- `dynamicProps` — currently structural: `{ source: 'context', contextKey }` or `{ source: 'procedure', procedureName, args }` (procedures resolve from a mock registry). The container refetches when any referenced context key changes.
- `callbackActions` — currently UI-only: `set-context`, `hide-component`, `show-overlay`.

## Planned upgrades (locked design, per root ROADMAP)

1. **DSL Phase 1:** `dynamicProps` become DSL expressions — queries over the SDM with aliasing `select(...)` doing the field mapping to the component's shape. Dependency tracking generalises from context keys to the expression's statically-known references.
2. **DSL Phase 2:** fourth callback action `run activity`, with the callback payload injected as the `event` root — page apps mutate only via activities, preserving the audit spine. Slot dynamic props re-evaluate after an activity completes.
3. **Manifest shape contracts:** `dynamic-data` props declare item shapes (not bare `array`) so the validator can check wiring end-to-end (DSL projection ⟷ port shape) at page-save time.
4. **App modules:** coarse-grained reusable apps (e.g. calendar scheduler) ship as manifest-bearing components, rewired per SDM through slot config. The pattern is model-agnostic (non-SDM backends can sit behind the wiring), but schema validation and the audit spine exist only with an SDM.
