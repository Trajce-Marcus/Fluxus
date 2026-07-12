# @fluxus/page-builder

The page/app builder: an IDE-style shell (activity bar, sidebar, tabs, console), a layout editor, and the ComponentContainer wiring layer that binds SDM-blind components to a data environment. See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) at the repo root for how it relates to the SDM and DSL.

**Status:** shell, layout editor, ComponentContainer, and FluxScript wiring complete. Pages speak the DSL everywhere (2026-07-12 redesign): dynamic props are FluxScript expressions with datasource posture, callbacks are scripts receiving the `callbackData` root, UI effects go through the host-injected `services.page` module, and every save runs `validatePage` against the model. Bindings are authored in a Monaco expression dialog (language id `fluxscript`). See [docs/PAGE_WIRING_DESIGN.md](docs/PAGE_WIRING_DESIGN.md) for the rulings.

## Run

```bash
npm run dev:page-builder   # from repo root, or `npm run dev` in this package
# → http://localhost:5173
```

Browser-only; pages persist in localStorage (`fluxus:page:*`).

## Docs

- [docs/SPEC.md](docs/SPEC.md) — living spec: current design truth
- [docs/LAYOUT_EDITOR_SPEC.md](docs/LAYOUT_EDITOR_SPEC.md) — full layout editor spec (panel model, splitters, properties)
- [docs/PAGE_WIRING_DESIGN.md](docs/PAGE_WIRING_DESIGN.md) — the wiring redesign: decisions, crossover acceptance bar, open questions
