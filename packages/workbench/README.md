# @fluxus/workbench

The **workbench**: the out-of-the-box vanilla UI every SDM gets for free — record type list → records grid → record view with activities. The generic face of whatever model the config carries: a usable tool with zero app-building, and the proving ground for DSL features. Pages are the optional bespoke layer on top; the workbench comes with the model.

Shipped as **one component** a host mounts:

```tsx
<Workbench client user? operationId? operations? onSelectOperation? operationError? />
```

It owns everything record-shaped in its own context (`WorkbenchContext`) and builds its own engine from the client it is handed. A host passes a connected `@fluxus/client` and knows nothing more.

**Status:** extracted from the Runtime app (then `@fluxus/sdm`) at the package restructure, 2026-08-01 — a move, no behaviour change. Working: list record types → create via CREATE activity → run capture activities → view history; FK refs with related records, Schema Navigator, CSV import/export, the file/photo/scalar attribute widgets, FluxScript show conditions / validation / waivers / list datasources.

**Hosts:** the **Console** (`@fluxus/console`), mounted as a solution-level tab against the M9 data operation — its only host today (CONSOLE_RUNTIME_SPEC §4). The Runtime app deliberately does *not* mount it: raw record access, running any activity, CSV import and the schema navigator are implementer work (M15).

## Library rules

- **css ships as a string.** `Workbench.tsx` exports `css` (re-exported as `workbenchCss`) and renders `<style>{css}</style>` inside its own subtree. No stylesheet imports — the Console mounts its shell in a **shadow root**, which a bundler-injected document-level stylesheet never reaches. All rules are scoped under `.workbench`.
- **Scope-blind.** The component never names an organisation, solution or operation; the host injects scope via the client and the operation props.
- **Attribute widgets are pure controlled components** — value in, `onChange` out, config as props, upload service injected, zero imports from this package's context. That is deliberate groundwork: they lift to `@fluxus/attribute-widgets` unchanged when the page builder becomes the second consumer.

## Run

No app of its own — it renders inside a host. Drive it through the Console:

```bash
npm run dev            # from repo root: server + Runtime app + Console
# → Console at http://localhost:5174 (server at :8787)
```

## Docs

- [docs/SPEC.md](docs/SPEC.md) — living spec: current design truth
- The SDM schema it renders: [`@fluxus/runtime` docs/SDM_Schema_Reference.md](../runtime/docs/SDM_Schema_Reference.md) (wins on any conflict)
- The pipeline it drives: [`@fluxus/engine` docs/SPEC.md](../engine/docs/SPEC.md)
