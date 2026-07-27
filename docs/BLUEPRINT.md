# Fluxus — Blueprint

The authoritative short version of what the platform is and will do, in plain
language. Deeper detail: [VISION.md](VISION.md) (why), [ARCHITECTURE.md](ARCHITECTURE.md)
(how the parts connect), [GLOSSARY.md](GLOSSARY.md) (canonical terms — it wins on
definitions), [ROADMAP.md](ROADMAP.md) (build phases). Each section is marked
**Built** or **Direction** (agreed, not built).

## The idea

Organisations fragment because every app brings its own tables and its own API.
Fluxus is **model-first**: record types, workflows, and activities are defined
once in a **Shared Data Model (SDM)** — each solution carries its own — and
every app, page, and integration is a projection over that model, scripted in
one language. Apps come and go; the model accumulates.

## Who's involved

- **Fluxus (the platform)** — the multi-tenant infrastructure: the two apps, the
  server, the data stores.
- **Org** — a subscribing business (e.g. a water-maintenance company). Owns its
  users, data, and installed solutions.
- **Solution provider** — whoever authors a solution: the org itself, or a
  third-party vendor selling through the future Catalogue.
- **End user** — a person in an org doing daily work in the Runtime app.

## Architectural component matrix — *Built*

| Domain | Component | What it does | Runs as |
|---|---|---|---|
| **User interface** | **Console** | The builder's app: author the SDM, build pages, run the workbench (raw record/data tooling), administer operations, roles, publishing. | Browser app — `@fluxus/page-builder` |
| | **Runtime** | The end user's app: sign in, see your operation's menu, use its published pages. Shows the solution's identity, not the platform's. | Browser app — `@fluxus/sdm` |
| | **Page runtime** | Turns a stored page definition into working UI against live records; embedded by both apps. | Browser library — `@fluxus/page-runtime` |
| **Model** | **SDM** | A solution's definition of its data and behaviour: record types, workflows, activities, hooks. Validated at save; versioned in the database. | Stored config artifact |
| **Business logic** | **Activity engine** | The one pipeline every change goes through: availability gate → capture → validate → before hook → persist → after hook → history. Never reimplemented. | Shared library, browser + server — `@fluxus/engine` |
| | **FluxScript (DSL)** | The one scripting language — a SQL/JavaScript blend — for every expression, query, and hook. | One interpreter, browser + server — `@fluxus/dsl` |
| **API** | **Server** | Activities are the API: every caller (page, workbench, external system) changes data only by running an activity. | Serverless functions — `@fluxus/server` |
| | **Client** | The browser apps' door to the server: fetches the data snapshot at connect, sends activity runs. | Browser library — `@fluxus/client` |
| **Data** | **Transactional store** | Live records as flexible JSON, partitioned per operation — fast writes, serves the running apps. | Postgres (Neon) |
| | **Reporting store** | Relational tables projected from the activity stream — querying, BI, cross-operation views. | Postgres schemas (same Neon in v1) |

## The operating model

**Built:** A solution — one bundle of SDM + pages + roles + default menu — is
authored in the Console. An **operation** links to exactly one solution and
runs it for real: its own records, users, role assignments, and (optionally) a
menu override. Two operations can run the same solution with fully separate
data and people — **the operation is the data boundary, and separation is a
choice**: an org that wants one shared pool of jobs runs one operation, and
models internal structure (regions, teams) as fields inside the SDM rather
than as extra operations. End users sign into the Runtime app, which renders their
operation's published pages, filtered by their roles. The database — not the
repo — is the source of truth for a solution's config and pages.

**Direction:** an org gets solutions two ways — author them, or install them
from the **Catalogue**. Installed solutions carry provenance (the `origin`
columns exist today; the install path doesn't).

## Rules the platform never breaks — *Built*

1. **All change goes through activities.** Records are never edited directly;
   every mutation, from any surface, lands in the append-only activity history.
   That history is the audit trail, the only log, and the source the reporting
   layer is projected from — so reporting can never miss a change.
2. **One language everywhere.** A query written for a page binding is the same
   language as a hook or a headless call.
3. **Scripts are scope-blind.** A script never names its org or operation;
   scope is injected. No script ever needs rewriting when the hierarchy grows.
4. **History is never edited.** Mistakes are reversed by compensating
   activities; published versions are append-only, rollback = republish.
5. **Everything validates at save time.** Config and pages are checked against
   the model before anything runs — the guardrail that makes AI-authored
   artifacts safe.
6. **Pages are data, not code.** A page is a stored, validated definition
   interpreted at render time — no compile step, no arbitrary bundles.

## Versioning and upgrades — *Direction* (agreed 2026-07-27)

- A **release** is one numbered snapshot of a whole solution — the model plus a
  chosen set of page versions — cut by the solution owner when ready. (Per-page
  and per-model version history is Built; the bundling is not.)
- Operations **pin** a release: they stay on it until they choose to move.
  No forced upgrades — a provider with hundreds of orgs publishes a new release
  and each org migrates on its own clock. An unpinned operation follows latest
  (today's behaviour becomes the default case).
- **Components** (the platform-supplied UI blocks pages are built from) version
  and pin separately, since they sit outside solutions. Until they are loadable
  artifacts, the interim rule is discipline: component changes must be
  backwards-compatible; a breaking change means a new component name.
- The known hard problem, deliberately open: a release that changes the model
  needs a data-migration story before a live operation can move to it.

## Solutions working together — *Direction* (agreed 2026-07-27)

Solutions are sealed from each other by construction — a script in one can
never touch another's data. Two sanctioned ways across, one mechanism each:

- **Extension / composition** (one mechanism) — an org (or vendor) creates a
  thin solution of its own that *depends on* one or more base solutions,
  adding glue: extra record types, links into the bases' types, activities, a
  combined menu. The bases are never copied or modified — that's what makes
  provider upgrades possible at scale. Composition example: an org with a
  water business and a roads business, each fitting a different vendor
  solution, authors one thin org solution depending on both; **one operation
  runs the composed solution**, so water and roads data share one pool and can
  be linked and queried together.
- **Connection** — a **solution connector**: a hook in one solution that calls
  an activity in another. The target activity's attribute list *is* the
  contract ("give me these fields"); the committed source activity is the
  trigger; a small field mapping is the wiring. A vendor can pre-ship
  connectors between their own solutions.
- **External connection** — the same connector picture with one end outside the
  platform, a needed feature in both directions. **Inbound**: an external
  system calls a Fluxus activity — this is just the existing headless door,
  validated and logged like any caller; the missing piece is machine
  credentials (API keys with roles — today auth is user sign-in only).
  **Outbound**: a hook calls an external API through an HTTP service module —
  the service-module registry is the designed slot; the module isn't written.
  An org may put a thin **gateway solution** in front: its activities are the
  stable public contract, with internal connectors fanning out to the real
  operational solutions. Either way the Fluxus-side contract is always an
  activity, so every integration lands on the one audit spine.

Choosing between them follows the data boundary: want the businesses' data in
**one pool** → compose into one solution, run one operation. Want them
**walled** → keep separate operations and connect only the flows that must
cross; org-wide reporting doesn't force composition either way, because the
reporting layer is org-scoped and looks across operations by design. Known
hazard on record: two packages may define the same id (`rt_assets` twice) —
future package-qualified ids; nothing may assume ids unique across solutions.

The invariant behind both: **solutions exchange data only by calling each
other's activities, never by reading each other's records.**

## The commercial layer — *Direction*

Orgs subscribe to the platform (the org row, profile, and plan field are Built;
signup and billing are not). Providers publish solutions to the Catalogue; orgs
install them; **entitlement** — a record of who may run what — is the copy
protection, not DRM. Revenue share rides on entitlement. Nothing here is built
beyond the seams; it waits for a second party to exist.

## Core terms, in one line each

Canonical definitions live in [GLOSSARY.md](GLOSSARY.md); this is the working set.

| Term | Plain meaning |
|---|---|
| **SDM** | A solution's definition of its data and behaviour: record types, workflows, activities, hooks. |
| **Record type / record** | A collection definition (e.g. Assets) / one entry in it. |
| **Activity** | The unit of action and the only way data changes; headlessly, a callable function. |
| **Workflow** | The ordered set of activities available on a record type. |
| **Hook** | A FluxScript script on an activity: before = gate, after = effects. |
| **Activity history** | The append-only record of who did what, with what inputs. The audit spine. |
| **FluxScript** | The one scripting language (expressions → queries → scripts). |
| **Page** | A stored, validated screen definition rendered by the page runtime. |
| **Component** | A model-blind UI block wired to the SDM per page; reused, never rewritten. |
| **Solution** | The shippable design bundle: SDM + pages + roles + default menu. No data. |
| **Operation** | A running instance of a solution: its records, users, and roles. |
| **Org** | The subscribing business everything hangs under. |
| **Console / Runtime** | The builder's app / the end user's app. |
| **Release** *(direction)* | One numbered snapshot of a whole solution. |
| **Pinning** *(direction)* | An operation staying on a chosen release until it opts to upgrade. |
| **Solution connector** *(direction)* | A hook in one solution calling an activity in another. |
| **Catalogue / entitlement** *(direction)* | Where solutions are offered / the record of who may run what. |
