# Fluxus — Working Conventions

## What this repo is

A model-first platform monorepo in three tiers (restructured 2026-08-01):

- **Apps** — `@fluxus/console` (the design plane: author the SDM, build pages, host the workbench, administer operations/roles/publishing), `@fluxus/runtime` (the runtime plane: what end users sign into — their operation's menu and published pages) and `@fluxus/platform` (the platform plane: **ours**, above every org — registers orgs and their owners; usage and billing later). **Apps never import apps.**
- **Libraries** — `@fluxus/workbench` (the out-of-the-box record UI every SDM gets for free; the Console mounts it) and `@fluxus/page-runtime` (the run-a-page cluster both apps embed).
- **Core** — `@fluxus/engine` (the shared activity engine every host drives), `@fluxus/dsl` (the scripting language), `@fluxus/server` (activities as the API surface; Postgres), `@fluxus/client` (the apps' snapshot/run door to the server).

`solutions/` is **not** part of the platform — it holds design notes for
solutions built *on* Fluxus (their models are authored in the Console and live
in the database, never in this repo). Provisional home; may move.

Read [docs/BLUEPRINT.md](docs/BLUEPRINT.md) for the platform at a glance (built vs direction), [docs/VISION.md](docs/VISION.md) for why, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the parts connect, [docs/GLOSSARY.md](docs/GLOSSARY.md) for canonical terminology, [docs/ROADMAP.md](docs/ROADMAP.md) for phase interlocks.

UI packages export css **as a string** — no stylesheet imports, because the Console mounts its shell in a shadow root a document-level stylesheet never reaches.

## Docs-with-code rule (binding)

- Any change that alters a package's behaviour or design updates that package's `docs/SPEC.md` **in the same commit**. The SPEC is the living truth — a new session must be able to read it and know the current design.
- Completing a build phase produces a summary in the package's `docs/phases/`. Phase summaries are point-in-time snapshots: **append-only, never edited** after the phase closes.
- Cross-package changes update the relevant root doc (ARCHITECTURE / ROADMAP / GLOSSARY). New recurring terms get a GLOSSARY entry.
- Docs about one package live in that package; docs spanning packages live in root `docs/`. Never both.

## Package skeleton (every package follows this)

```
packages/<name>/
  README.md          — what it is, current status, how to run (½ page, links to docs/)
  docs/
    SPEC.md          — living spec: current design truth
    phases/          — append-only per-phase build summaries
    *                — reference material (schemas, sample configs)
  src/
```

## Naming

- Packages are named by **role**, not phase — never suffix with "poc"; phase status belongs in the README.
- npm scope `@fluxus/*`; localStorage keys prefixed `fluxus:<package>:`.
- SDM entities: record types / workflows plural (`rt_assets`, `wf_assets`, "Assets"); activity IDs `act_<verb>_<plural>`; activity display names singular. Collections are plural; actions act on one instance.

## Domain rules that look like bugs but aren't

- Records are never edited directly — all mutation flows through activities. Do not add direct write paths to custom fields; fields like `status` change only via hooks (currently no-op slots awaiting DSL Phase 2).
- Activity attribute → custom field mapping is exact-key only; unmatched captured attributes are **intentionally** dropped.
- DSL scripts are scope-blind: they must never name an organisation/operation/project — scope is injected via the four roots (`ctx`, `attrs`, `records`, `services`).

## Module authoring

See [docs/conventions.md](docs/conventions.md) for tree-shaking and module rules.
