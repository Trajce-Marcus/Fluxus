# @fluxus/page-builder

The page/app builder: an IDE-style shell (activity bar, sidebar, tabs, console), a layout editor, and the ComponentContainer wiring layer that binds SDM-blind components to a data environment. See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) at the repo root for how it relates to the SDM and DSL.

**Status:** shell, layout editor, and ComponentContainer architecture complete. Wiring is currently structural (context keys + mock procedures) and callbacks are UI-only; both upgrade to the DSL per the [ROADMAP](../../docs/ROADMAP.md) — dynamic props become DSL expressions (Phase 1), callbacks gain `run activity` (Phase 2).

## Run

```bash
npm run dev:page-builder   # from repo root, or `npm run dev` in this package
# → http://localhost:5173
```

Browser-only; pages persist in localStorage (`fluxus:page:*`).

## Docs

- [docs/SPEC.md](docs/SPEC.md) — living spec: current design truth
- [docs/LAYOUT_EDITOR_SPEC.md](docs/LAYOUT_EDITOR_SPEC.md) — full layout editor spec (panel model, splitters, properties)
