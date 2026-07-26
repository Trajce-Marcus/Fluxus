# @fluxus/page-builder

The page/app builder: an IDE-style shell (activity bar, sidebar, tabs, console), a layout editor, and the ComponentContainer wiring layer that binds SDM-blind components to a data environment. See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) at the repo root for how it relates to the SDM and DSL.

**Status:** shell, layout editor, ComponentContainer, and FluxScript wiring complete. Pages speak the DSL everywhere (2026-07-12 redesign): dynamic props are FluxScript expressions with datasource posture, callbacks are scripts receiving the `callbackData` root, UI effects go through the host-injected `services.page` module, and every save runs `validatePage` against the model. Bindings are authored in a Monaco expression dialog (language id `fluxscript`). See [docs/PAGE_WIRING_DESIGN.md](docs/PAGE_WIRING_DESIGN.md) for the rulings. Since 2026-07-19 the run-a-page cluster (renderer, wiring host, component library, `validatePage`) lives in [`@fluxus/page-runtime`](../page-runtime/) — this package is the Console-side editor that embeds it.

## Run

```bash
npm run dev                # from repo root: server + workbench + page builder together
# or individually: npm run dev:server (required) + npm run dev:page-builder
# → http://localhost:5174 (server at :8787; seed the demo SDM once with npm run seed:server)
```

Since backend stage 2 (2026-07-12) SDM records live in `@fluxus/server`, shared with the workbench; the app boots by fetching the config + records via `@fluxus/client` and runs activities server-side. Opening a solution binds it to one of its **operations** — the header's **Data** picker — so the model editor and page preview show the same records the workbench shows. Since backend stage 3 (2026-07-16) page definitions live on the server too (`pages` table, snapshot at connect, saves round-trip); the database is the source of truth and files under [pages/](pages/) only bootstrap an empty one. No localStorage anywhere (bar UI preferences).

## Docs

- [docs/SPEC.md](docs/SPEC.md) — living spec: current design truth
- [docs/LAYOUT_EDITOR_SPEC.md](docs/LAYOUT_EDITOR_SPEC.md) — full layout editor spec (panel model, splitters, properties)
- [docs/PAGE_WIRING_DESIGN.md](docs/PAGE_WIRING_DESIGN.md) — the wiring redesign: decisions, crossover acceptance bar, open questions
