# Fluxus — Architecture

How the parts connect. Package-level detail lives in each package's `docs/SPEC.md`; this document covers only what spans packages.

## The four parts

```
┌─────────────────────────────────────────────────────────────────┐
│                        @fluxus/dsl                              │
│  grammar · interpreter · schema-aware validator                 │
│  (expressions → queries → scripts; the one language)            │
└────────────────────────────┬────────────────────────────────────┘
                             │ evaluated through
┌────────────────────────────▼────────────────────────────────────┐
│                       @fluxus/engine                            │
│  the activity pipeline (runActivity) · Store contract ·         │
│  DSL bridge · config validation · core SDM types                │
└────────────┬───────────────────────┬────────────────────────────┘
             │ hosted by             │ hosted by
┌────────────▼────────────┐  ┌───────▼─────────────────────────────┐
│      @fluxus/sdm        │  │      @fluxus/page-builder           │
│  SDM config (types,     │  │  layout editor · ComponentContainer │
│  workflows, activities) │  │  wiring layer · reusable apps       │
│  record workbench UI    │  │  (calls activities; binds dynamic   │
│  notification centre    │  │   props via DSL queries)            │
└─────────────────────────┘  └─────────────────────────────────────┘
```

Dependency direction is strict: `dsl` ← `engine` ← hosts. The language knows nothing about records or workflows (scope-blindness is load-bearing); peer hosts never depend on each other — the pipeline they share is a package they both import. Each host supplies the engine a `Store` implementation, the SDM config, and its service modules.

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

The activity pipeline — resolve attributes → evaluate show conditions → validate submissions against datasources → before hook (gate: validate only, `fail()` vetoes) → persist → after hook (effects: transactional record mutations, `queue`d service dispatch on commit) — is one UI-agnostic engine (`@fluxus/engine`, extracted from the sdm package July 2026) with three front doors:

1. **SDM record workbench** — activity strip / CREATE launch on the grid. *(Live.)*
2. **Page builder apps** — a component's named callback wired to `run-activity`; the callback contract is (record, one data object). UI activities open the standard capture form; non-UI activities pass straight to the hooks, which read the data object via the `callbackData` root. Same gate, hooks, history. *(Live — Extraction stage 2.)*
3. **Headless invocation** — the activity's attribute list *is* its parameter signature; callers supply values in one payload; datasources double as validation. *(DSL Phase 4 + backend.)*

## The ComponentContainer is the reuse seam

Page-builder app components are SDM-blind: a **manifest** declares ports (static config, dynamic data in, callbacks out, with item-shape contracts), and per-page **wiring** adapts them — dynamic props are DSL queries (aliasing `select` maps SDM fields to the component's shape), callbacks run activities. Reusing an app under a different SDM is a few lines of wiring, not a rewrite. The pattern is model-agnostic (a non-SDM backend can sit behind the wiring), but schema validation and the audit spine exist only with an SDM.

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
| Compute | **Hono (local) / AWS Lambda (prod)** — agreed | Same tRPC router both sides; the DSL interpreter is one TypeScript implementation running in browser and server. |

**v1 deployment: one Neon Postgres wearing both hats** — JSONB transactional tables plus projected relational schemas, projection synchronous in-transaction (no sync infrastructure while the platform is young). The two-layer *architecture* holds from day one; DynamoDB and async projection are deployment upgrades behind existing seams, not redesigns.

The engine package's `Store` contract and the DSL's `RecordsHost` are the seams all of this hides behind. Drizzle ORM over Neon for schema and queries; tRPC for the function-call API surface (no GET/POST distinction — pages and headless callers just call functions by name).
