# Fluxus

A model-first platform for digitising an organisation's data and processes.

Most app builders treat the data model as a byproduct of each app — every app gets its own tables, connectors, and private definitions, and the organisation's knowledge fragments across them. Fluxus inverts this: the **SDM** (Structured Data Model) defines record types, workflows, and activities once; apps, pages, hooks, and integrations are all projections over that one model, scripted in one language. See [docs/VISION.md](docs/VISION.md).

## The three parts

| Package | What it is |
|---|---|
| [`@fluxus/sdm`](packages/sdm/) | The SDM runtime: record types, workflows, activities, activity history, and the record workbench UI. Currently carries a sample asset-maintenance model ("Aber"). |
| [`@fluxus/page-builder`](packages/page-builder/) | The page/app builder: layout editor, ComponentContainer wiring layer, reusable app components. |
| [`@fluxus/dsl`](packages/dsl/) | The scripting language: one DSL for hooks, attribute datasources, page bindings, and headless workflows. |

## Documentation

- [Vision](docs/VISION.md) — the model-first thesis: why Fluxus exists
- [Architecture](docs/ARCHITECTURE.md) — how the three parts connect
- [Glossary](docs/GLOSSARY.md) — canonical definitions of platform terms
- [Roadmap](docs/ROADMAP.md) — cross-package phases and their interlocks
- [Conventions](docs/conventions.md) — tree shaking, module authoring rules, review checklist

Each package carries its own docs: `README.md` (what/status/run), `docs/SPEC.md` (living spec), `docs/phases/` (per-phase build summaries).

## Getting started

Prerequisites: Node.js 18+, npm 8+ (workspaces).

```bash
npm install

npm run dev:sdm            # SDM record workbench → http://localhost:5173
npm run dev:page-builder   # Page builder shell   → http://localhost:5173
```

Both apps run entirely in the browser (localStorage persistence) — no external services.

## Project structure

```
fluxus/
├── package.json           # Root workspace config
├── CLAUDE.md              # Working conventions (docs-with-code rule, package skeleton)
├── docs/                  # Platform-level docs (cross-package concerns only)
└── packages/
    ├── sdm/               # @fluxus/sdm
    ├── page-builder/      # @fluxus/page-builder
    └── dsl/               # @fluxus/dsl
```
