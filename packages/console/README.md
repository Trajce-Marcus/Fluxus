# @fluxus/console

The **Console** — the design-plane app (`src/main.tsx`): where implementers author solutions (SDM, pages, workflows, roles) and administer the platform (implementer permissions, user→role assignments, operations, publishing solutions into operations). An IDE-style shell (activity bar, sidebar, tabs, console) over a layout editor, the SDM editor, the hosted workbench, and the ComponentContainer wiring layer that binds SDM-blind components to a data environment. See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) at the repo root for how it relates to the SDM and DSL.

**Renamed from `@fluxus/page-builder` (2026-08-01).** The old name described one view; the package is the whole Console app. The page builder lives on inside it as the page editor (`src/platform-components/page-builder/`).

**Status:** shell, layout editor, ComponentContainer, and FluxScript wiring complete. Pages speak the DSL everywhere (2026-07-12 redesign): dynamic props are FluxScript expressions with datasource posture, callbacks are scripts receiving the `callbackData` root, UI effects go through the host-injected `services.page` module, and every save runs `validatePage` against the model. Bindings are authored in a Monaco expression dialog (language id `fluxscript`). See [docs/PAGE_WIRING_DESIGN.md](docs/PAGE_WIRING_DESIGN.md) for the rulings. Since 2026-07-19 the run-a-page cluster (renderer, wiring host, component library, `validatePage`) lives in [`@fluxus/page-runtime`](../page-runtime/) — this package embeds it — and since M15 it hosts [`@fluxus/workbench`](../workbench/) as a solution-level tab.

## Run

```bash
npm run dev                # from repo root: server + Runtime app + Console together
# or individually: npm run dev:server (required) + npm run dev:console
# → http://localhost:5174 (server at :8787)
```

Since backend stage 2 (2026-07-12) SDM records live in `@fluxus/server`, shared with the Runtime app; the app boots by fetching the config + records via `@fluxus/client` and runs activities server-side. Opening a solution binds it to one of its **operations** — picked in the workbench's own side menu (ruled 2026-07-31) — so the model editor and page preview show the same records the workbench shows. Since backend stage 3 (2026-07-16) page definitions live on the server too (`pages` table, snapshot at connect, saves round-trip); the database is the source of truth and nothing prepopulates it — a fresh one has no solution and no pages until you author them here (the demo page file and the seed script that installed it went on 2026-08-05). No localStorage anywhere (bar UI preferences).

`VITE_FLUXUS_RUNTIME_URL` points at the deployed Runtime app — **Operations → Open** launches `${VITE_FLUXUS_RUNTIME_URL}/?operation=<id>` in a new tab (dev default `http://localhost:5173`).

## Docs

- [docs/SPEC.md](docs/SPEC.md) — living spec: current design truth
- [docs/LAYOUT_EDITOR_SPEC.md](docs/LAYOUT_EDITOR_SPEC.md) — full layout editor spec (panel model, splitters, properties)
- [docs/PAGE_WIRING_DESIGN.md](docs/PAGE_WIRING_DESIGN.md) — the wiring redesign: decisions, crossover acceptance bar, open questions
