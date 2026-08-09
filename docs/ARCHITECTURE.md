# Fluxus — Architecture

How the parts connect. Package-level detail lives in each package's `docs/SPEC.md`; this document covers only what spans packages.

## The parts

```
┌─────────────────────────────────────────────────────────────────┐
│                        @fluxus/dsl                              │
│  grammar · interpreter · schema-aware validator                 │
│  (expressions → queries → scripts; the one language)            │
└───────────────────────────┬─────────────────────────────────────┘
                            │ evaluated through
┌───────────────────────────▼─────────────────────────────────────┐
│                       @fluxus/engine                            │
│  the activity pipeline (runActivity) · Store contract ·         │
│  DSL bridge · config validation · core SDM types                │
└──────┬──────────────────────┬──────────────────────┬────────────┘
       │ hosted by            │ hosted by            │ hosted by
┌──────▼──────────┐  ┌────────▼───────────┐  ┌───────▼────────────┐
│ @fluxus/runtime │  │  @fluxus/console   │  │  @fluxus/server    │
│  the Runtime    │  │  the Console:      │  │  activities as the │
│  app: menu +    │  │  layout editor ·   │  │  API surface (tRPC)│
│  published      │  │  SDM editor ·      │  │  · Postgres        │
│  pages          │  │  admin · publish   │  │                    │
└──────┬──────────┘  └───┬────────────┬───┘  └───────▲────────────┘
       │                 │            │ mounts       │
       │                 │     ┌──────▼───────────┐  │
       │                 │     │@fluxus/workbench │  │
       │                 │     │ record types →   │  │
       │                 │     │ grid → record    │  │
       │                 │     │ view + activities│  │
       │                 │     └──────────────────┘  │
       │   both apps embed the page runtime          │
       │   and reach the server via the client       │
┌──────▼─────────────────▼──┐                        │
│   @fluxus/page-runtime    │                        │
│   render stored pages:    │                        │
│   PageRenderer · wiring   │                        │
│   host · capture form     │                        │
└─────────────┬─────────────┘                        │
       ┌──────▼─────────────┐                        │
       │  @fluxus/client    │────────────────────────┘
       │  config+partition  │  config.getForOperation (runtime)
       │  +pages snapshot   │  config.get (design) · records.partition
       │  · runs            │  · pages.* · activities.run
       └────────────────────┘
```

Dependency direction is strict: `dsl` ← `engine` ← hosts. The language knows nothing about records or workflows (scope-blindness is load-bearing); anything two hosts share is a package they both import: the pipeline (`engine`), the server door (`client`), and since 2026-07-19 the run-a-page cluster (`@fluxus/page-runtime` — PageRenderer, ComponentContainer, the component registry, the page expression host, the standard capture form; extracted from the page builder so the Runtime app can render published pages, the first step of workbench → Runtime app). A host wraps its connected client in one injected `PageRuntime` handle; page *editing* stays in the Console.

**Three tiers, and apps never import apps** (restructured 2026-08-01):

| Tier | Packages | Rule |
|---|---|---|
| **Apps** | `@fluxus/console`, `@fluxus/runtime`, `@fluxus/platform` | Deployed browser apps. None imports another, and none has a library face. |
| **Libraries** | `@fluxus/workbench`, `@fluxus/page-runtime` | Mountable UI an app embeds. Export css **as a string**, never a stylesheet import — the Console mounts its shell in a shadow root a document-level stylesheet never reaches. |
| **Core** | `@fluxus/engine`, `@fluxus/dsl`, `@fluxus/server`, `@fluxus/client` | Host-agnostic. No UI. |

This replaced the one deliberate exception M15 had left standing: the workbench had moved to the Console but stayed inside `@fluxus/sdm`, which exposed a library face alongside its app so `page-builder` could import it — a knowingly temporary edge, pending a name endorsement for a third package. The 2026-08-01 restructure closed it: the workbench became `@fluxus/workbench`, `@fluxus/sdm` became `@fluxus/runtime` and lost its library face, and `@fluxus/page-builder` became `@fluxus/console` because the package was never one view — it is the whole Console. **No app→app dependency exists or may be added.** Each host supplies the engine a `Store` implementation, the SDM config, and its service modules. Since backend stage 2 the browser hosts' Store is a fetched snapshot: `@fluxus/client` loads the scope's config + record partition from `@fluxus/server` into the engine's `MemoryAdapter` (expressions keep evaluating locally and synchronously), and every mutation is a server-side `activities.run` followed by a partition re-fetch — hooks and persistence run server-side only. Page definitions ride the same pipeline (backend stage 3, 2026-07-16): stored per `(solution, path)` on the server as opaque jsonb, snapshotted at connect, authored in the page builder. **The database is the source of truth for a solution** (config + pages; ruled 2026-07-26): both are versioned server-side (`page_versions`, `sdm_config_versions` — append-only, readme required), git carries code and migrations, and the repo's config/page files are a bootstrap fixture for an empty database rather than a deploy channel. Since 2026-08-08 the model is **stored as tables, one per collection** (`sdm_attributes`, `sdm_workflows`, `sdm_record_types`, `sdm_functions`, `sdm_roles`, `sdm_menus`), and the `sdm_configs` blob dropped outright (2026-08-09): the consistency unit is the whole graph but the change unit is one entity, and a blob made the write unit the whole graph too — so two people editing two different record types lost each other's work. Validation stays global; only the write narrows. The model is assembled on read in one query, so there is no second copy of it anywhere; published versions (`sdm_config_versions`) are whole configs, but that is immutable history rather than live truth. See the server SPEC's "Model storage: the SDM config as tables". Since 2026-08-09 the **model reaches a browser trimmed**, through two separate procedures: the design plane's `config.get` (sol admin, the whole model, hooks included — authoring them is the job) and the runtime plane's `config.getForOperation`, which returns a `ClientSolutionConfig` with no hooks, no access rules and no record type the caller cannot read. The data had been filtered since RBAC stage 1; the model had not, and that asymmetry was the finding (docs/CLIENT_TRUST_BOUNDARY.md §2). The Console binds a solution to one of its operations for the records it builds against, so the design and runtime hosts show the same data.

## The three planes

Each app is a plane, and the planes differ by **who they admit**, not by what they render:

| Plane | App | Audience | Scope |
|---|---|---|---|
| Design | `@fluxus/console` | an org's builders and admins | one org, one solution at a time |
| Runtime | `@fluxus/runtime` | an org's end users | one operation |
| Platform | `@fluxus/platform` | **us** — the vendor | across every org |

The platform plane arrived 2026-08-03 to answer the two questions the org tier structurally cannot: **who creates an org** (not an org admin — there is no org to be admin of yet) and **who sees across orgs** (nobody could: every query in the API is scoped to one org by construction). `npm run bootstrap` was that tier in disguise — a script outside the request path, writing the first row because nothing inside it was allowed to. `platform.registerOrg` now writes an org and its owner **in one act**, which demotes the script to lockout recovery. Platform admins are an **env allowlist** (`FLUXUS_PLATFORM_ADMINS`), not a table, because a table recreates the same chicken-and-egg one tier up; `isPlatformAdmin` is the seam that swaps for one later. Design detail: `packages/platform/docs/SPEC.md`.

It is a separate app rather than a Console section because the Console is scoped to one org by construction — folding cross-org data into it would ship tenant-spanning code in every customer-facing deploy.

**The org lives in the URL** (ruled 2026-08-03, Neon's shape): both browser apps read it from `/o/<orgId>/…` via `orgFromPath()` in `@fluxus/client`, and that is the only place org identity lives client-side — no picker, no localStorage, so a link is a complete address and two orgs can be open in two tabs. The Console passes it to `ConsoleClient.create({ orgId })` once at boot, which carries it into every org-scoped call. The Runtime still derives its org from the operation server-side and merely *checks* the prefix, so a link naming the wrong org fails loudly instead of half-applying. Registering the second org also turned `org_id` from decoration into a boundary and exposed what that had been hiding — operations that ignored their solution's org, and admin gates that asked "are you an admin?" without asking "of which org?"; both closed the same day (SPEC §5).

## The SDM is the centre

Each SDM defines: standalone **attributes**, **record types** (custom fields, FK refs), and **workflows** of **activities** (with before/after hooks). Records are never edited directly — all mutation flows through activities, producing the **activity history** (the audit spine).

## The DSL is the shared language

Every scripted surface uses the same language, in three tiers: **expressions** (show conditions, defaults), **queries** (attribute datasources, page bindings), **scripts** (hooks, headless workflows — expressions + queries plus `if` / `for each` / `let` / `fail()` / `queue`).

Every script is a function whose environment is dependency-injected by the host at call time, through exactly four roots:

| Root | Contents |
|---|---|
| `context` | user, anchor record, activity, workflow — populated by whichever host is executing |
| `attributes` | captured attribute values for the activity in flight (incl. previously captured attributes) |
| `records` | the SDM-scoped data graph — query and mutation |
| `services` | global add-on modules (notify, geocode, published functions) — SDM-agnostic |

Scripts are **scope-blind**: they never name their org, repo, or SDM. Scope arrives via injection. (The platform hierarchy — org + SDM, with org-defined repos/folders between, GitHub-style — is future work; this invariant is locked now so no script ever needs rewriting for it.)

The validator checks every script against the SDM at **config-save time** — unknown record types, fields, or shape mismatches are errors before anything runs.

## The activity engine has multiple hosts

The activity pipeline — resolve attributes → evaluate show conditions → validate submissions against datasources → before hook (gate: validate only, `fail()` vetoes) → persist → after hook (effects: transactional record mutations, `queue`d service dispatch on commit) — is one UI-agnostic engine (`@fluxus/engine`, extracted from the then-`@fluxus/sdm` package July 2026) with three front doors.

Since 2026-08-09 that pipeline has a **read half**: a GET activity (`record_map: "GET"`) shares the availability gate and the before hook, then answers with its `returns` expression instead of persisting (`engine.runQuery`, `activities.query`, `client.query()` — [DATA_THROUGH_ACTIVITIES](DATA_THROUGH_ACTIVITIES.md) step 1). It matters because the query then lives **in the model**: an app names an activity, and `returns` never reaches the browser. Reads are not yet logged, which is the one part of "the pipeline is the log" still outstanding. The three doors below are the write half.

1. **SDM record workbench** — activity strip / CREATE launch on the grid. *(Live.)*
2. **Page builder apps** — a component's named callback wired to `run-activity`; the callback contract is the anchor record alone. UI activities open the standard capture form; attribute-less activities pass straight to the hooks. Values reach an activity as declared attributes, never as a free-form object off the wire ([DATA_THROUGH_ACTIVITIES §4](DATA_THROUGH_ACTIVITIES.md)). Same gate, hooks, history. *(Live — Extraction stage 2, side channel removed 2026-08-09.)*
3. **Headless invocation** — the activity's attribute list *is* its parameter signature; callers supply values in one payload; datasources double as validation. *(Live — `@fluxus/server`, backend stage 1, 2026-07-12: `activities.run` over tRPC; the server loads the scope's partition into an in-memory Store per request, runs the same sync engine, and writes back transactionally. Since backend stage 2 — same day — the browser hosts run through this same door via `@fluxus/client`: one model, many apps, literally.)*

## The ComponentContainer is the reuse seam

App components (in `@fluxus/page-runtime` since the extraction) are SDM-blind: a **manifest** declares ports (static config, dynamic data in, callbacks out, with item-shape contracts), and per-page **wiring** adapts them — dynamic props are DSL queries (aliasing `select` maps SDM fields to the component's shape), callbacks run activities. Reusing an app under a different SDM is a few lines of wiring, not a rewrite. The pattern is model-agnostic (a non-SDM backend can sit behind the wiring), but schema validation and the audit spine exist only with an SDM.

## Data architecture — two layers

Records live in two stores with different jobs (CQRS):

```
                     activities (the only write path)
                              │
                    ┌─────────▼──────────┐
                    │ TRANSACTIONAL      │  lean, SDM-partitioned,
                    │ (single-table      │  serves the platform runtime:
                    │  style)            │  pickers, hooks, grids
                    └─────────┬──────────┘
                              │ committed activity stream (outbox —
                              │ same machinery as `queue` dispatch)
                    ┌─────────▼──────────┐
                    │ REPORTING          │  real per-type relational tables,
                    │ (relational,       │  org-scoped, cross-SDM views,
                    │  projected)        │  BI/SQL tools
                    └────────────────────┘
```

- **The activity stream is the projection source, complete by construction** — no write path bypasses activities, so the reporting layer can never miss a change. The after-hook outbox (built for `queue`) simply gains a second consumer. The application never dual-writes.
- **Each layer gets the storage shape it wins with.** Transactional: generic/JSONB single-table shape — SDM edits never touch the physical schema. Reporting: *generated* per-type tables with real columns, FKs, and indexes — and no migration pain, because projections are **rebuilt by re-projection from the activity stream** when the SDM changes.
- **Reporting history is fully normalized, not JSONB (agreed 2026-07-12):** record → `activities` → `attributes` as related tables — one `activities` row per run (record, activity, author, timestamp; class derived from type class + author, never stored) and one `attributes` row per attribute (entry ref, `key`, `value`, `waive_desc`). `value` is a single text column — queries stay uniform (`key = 'crew' AND value = 'Crew A'`); typed queries cast on query, with expression indexes added per hot path if metrics demand. A waived attribute is the **same row** with `value` null and `waive_desc` carrying the reason — never a separate row. System-produced attributes (`system_log`, `system_warnings`) are ordinary rows. Row volume is accepted — queryability is this layer's contract, and re-projection makes the shape cheap to evolve.
- **Per-activity projected tables, opt-in (agreed 2026-07-12):** an activity may be flagged in the SDM to get its own generated table — one row per run, one real typed column per attribute (types from the attribute defs) — exactly analogous to per-record-type tables generated from custom fields; same generation, same rebuild-by-re-projection, so flagging an activity later backfills its full history from the stream. The generic `activities`/`attributes` pair remains the universal baseline; per-activity tables are typed conveniences for the hot ones. **Hooks stay out of the reporting layer**: reporting is derived and rebuilt, so hook-written rows would be lost on every rebuild. Rule of thumb — *report of what happened → declarative projection; new fact in the model → hook creates a record* (which then projects like everything else).
- **Scoping follows access patterns.** Runtime queries are always SDM-scoped (the DSL's scope-blind rule guarantees it), so the transactional store partitions per SDM (`org#sdm`). Cross-SDM views belong only to reporting, so the relational side is org-scoped (schema per org).
- **Leanness of the transactional layer is load-bearing, not cosmetic.** Runtime DSL queries there are partition-fetch + filter, viable only on small partitions. Retention enforces it: a record type may declare a `complete_when` condition (FluxScript) and window in the SDM; completed records archive out of the transactional store (the relational copy remains). Never-ending records (long-lived apps) tier their append-only history instead — hot tail transactional, full spine relational/cold — while the record stays alive.
- **Consistency rule:** runtime reads (hook validation, pickers) always hit the transactional store — read-your-writes required. Reporting reads may lag; that's their contract.

## Hosting options

| Layer | Options | Notes |
|---|---|---|
| Transactional | **Neon Postgres (JSONB tables)** — v1 choice | Serverless, HTTP driver suits Lambda, free tier; Postgres does single-table-style storage fine. `indexed` custom fields → JSONB expression indexes or stored generated columns. |
| | **DynamoDB single-table** — the scale option | On-demand pricing, effectively unbounded throughput, Streams as the built-in change feed. Key-based access only — depends on lean partitions (which retention guarantees). Swap-in later behind `RecordsHost`; no script or SDM changes. |
| Reporting | **Neon Postgres (relational schemas)** — v1 and likely long-term | Org-scoped schemas, projected per-type tables, standard SQL for BI tools. |
| | Column store (e.g. ClickHouse, BigQuery) — only if analytics outgrow Postgres | A third projection from the same activity stream; nothing upstream changes. |
| Compute | **Hono (local) / Vercel functions (prod — Lambda underneath)** — ruled 2026-07-16, see [DEPLOYMENT.md](DEPLOYMENT.md) | Same tRPC router both sides; the DSL interpreter is one TypeScript implementation running in browser and server. Raw AWS Lambda (`src/lambda.ts`) stays the kept-warm exit path. |

**v1 deployment: one Neon Postgres wearing both hats** — JSONB transactional tables plus projected relational schemas, projection synchronous in-transaction (no sync infrastructure while the platform is young). The two-layer *architecture* holds from day one; DynamoDB and async projection are deployment upgrades behind existing seams, not redesigns. In development (no `DATABASE_URL`) the same Drizzle schema runs on **PGlite** — Postgres compiled to WASM, in-process — so dev/test needs no installed database; Neon is a connection string away.

The engine package's `Store` contract and the DSL's `RecordsHost` are the seams all of this hides behind. Drizzle ORM over Postgres for schema and queries; tRPC for the function-call API surface (no GET/POST distinction — pages and headless callers just call functions by name). One consequence of keeping the Store synchronous (ruled at Phase 4): the server does not talk to Postgres *through* a Store — it snapshots the scope's partition into the engine's in-memory Store per request and writes the diff back in one transaction, which is the partition-fetch model above made literal and is exactly what transactional-layer leanness guarantees stays cheap.
