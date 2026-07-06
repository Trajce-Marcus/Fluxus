# Fluxus — Architecture

How the three parts connect. Package-level detail lives in each package's `docs/SPEC.md`; this document covers only what spans packages.

## The three parts

```
┌─────────────────────────────────────────────────────────────────┐
│                        @fluxus/dsl                              │
│  grammar · interpreter · schema-aware validator                 │
│  (expressions → queries → scripts; the one language)            │
└────────────┬───────────────────────┬────────────────────────────┘
             │ evaluated by          │ evaluated by
┌────────────▼────────────┐  ┌───────▼─────────────────────────────┐
│      @fluxus/sdm        │  │      @fluxus/page-builder           │
│  SDM config (types,     │  │  layout editor · ComponentContainer │
│  workflows, activities) │  │  wiring layer · reusable apps       │
│  activity engine        │◄─┤  (calls activities; binds dynamic   │
│  record store · history │  │   props via DSL queries)            │
│  record workbench UI    │  └─────────────────────────────────────┘
└─────────────────────────┘
```

## The SDM is the centre

One SDM per project defines: standalone **attributes**, **record types** (custom fields, FK refs), and **workflows** of **activities** (with before/after hooks). Records are never edited directly — all mutation flows through activities, producing the **activity history** (the audit spine).

## The DSL is the shared language

Every scripted surface uses the same language, in three tiers: **expressions** (show conditions, defaults), **queries** (attribute datasources, page bindings), **scripts** (hooks, headless workflows — expressions + queries plus `if` / `for each` / `let` / `fail()` / `queue`).

Every script is a function whose environment is dependency-injected by the host at call time, through exactly four roots:

| Root | Contents |
|---|---|
| `ctx` | user, anchor record, activity, workflow — populated by whichever host is executing |
| `attrs` | captured attribute values for the activity in flight (incl. previously captured attributes) |
| `records` | the project-scoped SDM data graph — query and mutation |
| `services` | global add-on modules (notify, geocode, published functions) — project-agnostic |

Scripts are **scope-blind**: they never name an organisation, operation, or project. Scope arrives via injection. (The org → operation → project hierarchy is future work; this invariant is locked now so no script ever needs rewriting for it.)

The validator checks every script against the SDM at **config-save time** — unknown record types, fields, or shape mismatches are errors before anything runs.

## The activity engine has multiple hosts

The activity pipeline — resolve attributes → evaluate show conditions → validate submissions against datasources → before hook (gate: validate only, `fail()` vetoes) → persist → after hook (effects: transactional record mutations, `queue`d service dispatch on commit) — is one UI-agnostic engine with three front doors:

1. **SDM record workbench** — activity strip / CREATE launch on the grid.
2. **Page builder apps** — a component callback wired to `run activity`; attribute capture, validation, hooks and history all identical.
3. **Headless invocation** — the activity's attribute list *is* its parameter signature; callers supply values in one payload; datasources double as validation.

## The ComponentContainer is the reuse seam

Page-builder app components are SDM-blind: a **manifest** declares ports (static config, dynamic data in, callbacks out, with item-shape contracts), and per-page **wiring** adapts them — dynamic props are DSL queries (aliasing `select` maps SDM fields to the component's shape), callbacks run activities. Reusing an app under a different SDM is a few lines of wiring, not a rewrite. The pattern is model-agnostic (a non-SDM backend can sit behind the wiring), but schema validation and the audit spine exist only with an SDM.

## Deployment shape (agreed direction)

tRPC + Hono locally, Lambda in production, Neon + Drizzle for storage. The DSL interpreter is one TypeScript implementation running in both browser (POC, attribute datasources, page bindings) and server (hooks, headless). The SDM package's `Store` interface is the seam for swapping localStorage for the real backend.
