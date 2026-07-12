# Page Wiring Redesign — FluxScript everywhere

**Status: BUILT (2026-07-12) — decisions 1–7 implemented; SPEC.md carries the current truth.** Implementation notes: the ctx root keeps the DSL's canonical name `context` (this doc's `ctx` was shorthand); the callback payload packs as `callbackData.value` / `callbackData.data` (components emit `(value, data?)`); `show-overlay` was **cut** (the stub had no consumer); the validator gained a `callback` script mode (effects allowed, mutations rejected) and page callbacks run in `mutate` mode against a mutation-less records host; activity runs moved off `services.page` onto the host-neutral **`services.activities.run(activityId, record, data)`** (ruled 2026-07-12) — same manifest in every host, so activity-running scripts are portable to the Phase 4 headless host. **Not yet built** (tracked on the ROADMAP): the crossover acceptance bar (expression↔function traversal, promote-to-function), and the open questions below — including the callback error contract, so run outcomes still surface through the host (confirm dialog + page error banner), not as script return values.

Supersedes-in-intent: the dropdown-built `DynamicPropConfig` / `CallbackAction` unions in `persistence.ts`. Interlocks: root ROADMAP "DSL Phase 1 → page-builder: dynamic props become DSL expressions" (this doc is that pickup, extended to callbacks) and ROADMAP sequence item 5 (save-time `validatePage` — the same rewire is what gives it expressions to validate).

## Why

Today a component's data props and callbacks are wired through dropdown-built config objects (`{source: 'context'|'procedure', ...}`, `{type: 'set-context'|'run-activity'|...}`). That is a second, weaker wiring language next to FluxScript. The DSL was built to prevent exactly this: scripts never construct their environment — the host injects the roots — "which is why the same script runs unchanged in the browser, in Lambda, and inside the page builder" (DSL_SPEC §"Every script is a function"). The page builder has hosted the engine and bridge since Extraction stage 2. One language, one validator, every surface: attribute expressions, hooks, page wiring, and (forward) non-UI workflows.

## Agreed decisions (2026-07-12)

1. **Page context IS the `ctx` root — no parallel construct.** The current `PLATFORM_CONTEXT` constants + `ContextKeyDef` schema + `set-context` plumbing collapse into one notion: the DSL's host-injected `ctx`. Platform supplies the built-ins (user, app, route/page params); page-local UI state (selection, filters) is a page-owned layer within it. There are currently NO built-in record/route keys — `currentUser` and `appName` are hardcoded demo constants; this redesign is where real built-ins arrive.

2. **Data props become single FluxScript expressions.** One expression per dynamic prop — `records.work_orders.where(status != 'Completed')` or `openWorkOrders(ctx.page.workgroup)` — evaluated with datasource posture (reads only; mutations rejected by the validator, same as attribute datasources). The stored artifact is the expression; any picker UI merely writes it.

3. **"Callbacks", not "actions" (naming ruling).** A component's named callback binds to a FluxScript script receiving the payload as the `callbackData` root (exists since Extraction stage 2). Mutations flow only through activities: a callback script requests an activity run; it never writes records directly.

4. **Callback results return to the caller.** An activity run triggered from a callback reports its outcome back to the invoking component — gate fail, soft-stop, validation errors (e.g. dispatch invalid: crew missing a skill) — so the component/app decides presentation. The run's truth still lands on the record's history per the pipeline rules; the return path is UX, not a second log.

5. **UI-local actions become a page-host service module: `services.page`.** `setContext`, `showOverlay`, `hideComponent` are effect functions on a module only the page-builder host injects. Then everything is FluxScript, and a page callback, a hook, and a future non-UI workflow differ only in which service modules their host provides. (Ruled: `set-context` goes through `services.page`, not a declarative enum.)
   - Note: `show-overlay` today is a stub — it sets a `__overlay_<id>` context key nothing consumes; `OverlayConfig` persists but never renders. No working behaviour to preserve; complete or cut it as part of this work.

6. **MVP editor UI: replace the dropdowns with a button opening an expression dialog** (Monaco, language id `fluxscript`, per the DSL spec's authoring posture). Richer affordances later; see the crossover section for the two that matter.

7. **Validation: same validator, both artifact types.** Page-file expressions are schema-validated at save by the engine validator — this is the substance of ROADMAP item 5 (`validatePage`): component names against the registry, props against component schemas, expressions/callback scripts against the SDM schema + declared roots, activity references against real activity ids.

## The expression ↔ function crossover (evolving, deliberately)

The language doctrine is "expressions ask, functions think" (DSL_SPEC §8): inline until you need intermediate variables, then promote to a named function and the config becomes a one-line call. That is right for the language but taxes the implementer with a packaging decision, and the two halves live in different places. Parallel: SQL inline queries vs stored procs — never settled by doctrine, made tolerable by navigation and convention.

**Acceptance bar (agreed): straightforward traversal, not a premature rule.**
- From any expression, jump into the functions it calls (and back).
- One-click **promote to function**: select an inline expression/script, name it + description, config becomes the call. No retyping.

Where the inline/function line actually sits is left to evolve from real usage.

## Open questions

- **Function discoverability / curation.** No public flag exists; the flat namespace makes every function callable, including junk. Lean (not ruled): discoverability is governance metadata + computed usage, NOT a new language root — once pages are SDM citizens (below), "what references this function" is a query over definitions; the function browser shows provenance ("used by 3 pages, 2 hooks"); a `published`/`draft` curation flag covers deliberate hiding. Scripts stay runtime-blind to pages.
- **Pages as SDM citizens.** A page file is a declarative definition validated against the model — same species as an entity file. When the SDM moves behind the backend, pages belong in the same store, same single write path, same audit. Direction agreed in spirit; shape lands with the backend phase.
- **Route params → `ctx`.** How `/work-orders/:id` style params enter the context; interacts with app-level navigation, which doesn't exist yet.
- ~~Page context declaration~~ — **ruled 2026-07-12 (user): permissive for MVP.** The validator treats `ctx.page.*` as opaque — any key, unknown type; wrong keys surface at runtime. Everything else stays strictly validated. Per-page key declarations can tighten this later without migrating any page files or scripts.
- **Callback error contract.** Shape of the returned outcome (decision 4): full `RunActivityResult`, or a page-facing projection of it.

## What this touches when built

`persistence.ts` (PageDef types), `ComponentContainer.tsx` (resolution/execution), `PageEditor.tsx` (binding UI → expression dialog), `PageRenderer.tsx` (ctx assembly), a new `services.page` module in the page-builder host, bridge wiring for expression evaluation with datasource posture, `validatePage`. SPEC.md updates ride the implementing commits per the docs-with-code rule.
