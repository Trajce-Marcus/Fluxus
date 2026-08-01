# Fluxus

A model-first platform for digitising an organisation's data and processes.

Most app builders treat the data model as a byproduct of each app — every app gets its own tables, connectors, and private definitions, and the organisation's knowledge fragments across them. Fluxus inverts this: the **SDM** (Shared Data Model) defines record types, workflows, and activities once; apps, pages, hooks, and integrations are all projections over that one model, scripted in one language. See [docs/VISION.md](docs/VISION.md).

## The parts

**Apps** — never import each other:

| Package | What it is |
|---|---|
| [`@fluxus/console`](packages/console/) | The design plane: author the SDM, build pages, host the workbench, administer operations, roles and publishing. |
| [`@fluxus/runtime`](packages/runtime/) | The runtime plane: what end users sign into — their operation's menu and its published pages. Carries the sample asset-maintenance model ("Aber") as seed input. |

**Libraries** — mounted by the apps:

| Package | What it is |
|---|---|
| [`@fluxus/workbench`](packages/workbench/) | The out-of-the-box record UI every SDM gets for free: record types → grid → record view with activities. The Console mounts it. |
| [`@fluxus/page-runtime`](packages/page-runtime/) | The run-a-page cluster: renderer, wiring host, component library, `validatePage`. |

**Core**:

| Package | What it is |
|---|---|
| [`@fluxus/engine`](packages/engine/) | The shared activity engine: the one activity pipeline, the `Store` contract, the DSL bridge, config validation. |
| [`@fluxus/dsl`](packages/dsl/) | The scripting language: one DSL for hooks, attribute datasources, page bindings, and headless workflows. |
| [`@fluxus/server`](packages/server/) | Activities as the API surface; Postgres. The source of truth for a solution. |
| [`@fluxus/client`](packages/client/) | The apps' snapshot/run door to the server. |

## Documentation

- [Vision](docs/VISION.md) — the model-first thesis: why Fluxus exists
- [Architecture](docs/ARCHITECTURE.md) — how the parts connect
- [Glossary](docs/GLOSSARY.md) — canonical definitions of platform terms
- [Roadmap](docs/ROADMAP.md) — cross-package phases and their interlocks
- [Conventions](docs/conventions.md) — tree shaking, module authoring rules, review checklist

Each package carries its own docs: `README.md` (what/status/run), `docs/SPEC.md` (living spec), `docs/phases/` (per-phase build summaries).

## Getting started

Prerequisites: Node.js 18+, npm 8+ (workspaces).

```bash
npm install

npm run dev                # server + both apps together
# or individually:
npm run dev:server         # required by both apps        → http://localhost:8787
npm run dev:runtime        # Runtime app                  → http://localhost:5173
npm run dev:console        # Console                      → http://localhost:5174
npm run seed:server        # load the demo SDM once
```

Records, config and pages live in `@fluxus/server` (Postgres — PGlite locally, Neon deployed); the apps fetch a snapshot at boot and run every activity server-side. There is no localStorage fallback: if the server is down, boot fails loudly.

## Project structure

```
fluxus/
├── package.json           # Root workspace config
├── CLAUDE.md              # Working conventions (docs-with-code rule, package skeleton)
├── docs/                  # Platform-level docs (cross-package concerns only)
└── packages/
    ├── console/           # @fluxus/console       (app)
    ├── runtime/           # @fluxus/runtime       (app)
    ├── workbench/         # @fluxus/workbench     (library)
    ├── page-runtime/      # @fluxus/page-runtime  (library)
    ├── engine/            # @fluxus/engine        (core)
    ├── dsl/               # @fluxus/dsl           (core)
    ├── server/            # @fluxus/server        (core)
    └── client/            # @fluxus/client        (core)
```
