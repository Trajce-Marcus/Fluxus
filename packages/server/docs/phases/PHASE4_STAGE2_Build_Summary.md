# DSL Phase 4 / Backend — Stage 2 Build Summary (hosts repoint)

Point-in-time record, closed 2026-07-12. Stage 1 record:
[PHASE4_BACKEND_Build_Summary.md](PHASE4_BACKEND_Build_Summary.md). Current
truth lives in the SPECs (server, client, sdm, page-builder, engine) — this
file is append-only history.

## What stage 2 is

The workbench and the page builder swapped localStorage for the backend:
partitions fetched from the server, activity runs through `activities.run`
(hooks + persistence server-side only), both hosts on one shared scope —
"one model, many apps" made literal. Closes ROADMAP sequence item 7 and the
DSL Phase 4 interlock.

## Rulings (all four presented as forks, user approved the recommendations)

1. **Bootstrap snapshot + refetch** — at app start fetch config + the full
   scope partition into the engine's `MemoryAdapter`; UI reads and FluxScript
   evaluation stay synchronous and local; after every run, re-fetch the
   partition. Mirrors the server's own per-request snapshot model. No async
   Store, no per-read laziness (revisit when partitions outgrow it).
2. **Server config, one shared scope** — both hosts fetch config via
   `config.get` and point at `demo/sdm`. The page builder's private sample
   config was deleted; the sdm package's `config.ts` demoted to the seed
   script's input. Config distribution proper stays open.
3. **Shared `@fluxus/client` package** — tRPC client + snapshot host both
   hosts import; `@fluxus/server` is a type-only dev dependency (`AppRouter`).
4. **Hard cutover** — no localStorage fallback; server unreachable → boot
   error screen pointing at `npm run dev:server` / `npm run seed:server`.
   Existing local records are not migrated. Pages/templates stay in
   localStorage (page-builder artifacts, not SDM records).

## What was built

- **`@fluxus/client`** (new package): `FluxusClient.connect()` →
  `config.get` + new `records.partition` into a `MemoryAdapter`;
  `runActivity()` → `activities.run` then partition re-fetch (refetch also on
  throw — a failing after hook persists the entry by doctrine); `refresh()`
  keeps adapter identity stable.
- **Engine**: `MemoryAdapter.replaceRecords()` — whole-snapshot swap in
  place, subscribers notified.
- **Server**: `records.partition` (one-round-trip scope fetch); `AppRouter`
  type export on the package entry.
- **sdm workbench**: new `src/host.ts` (client + engine singletons,
  `initHost()` awaited by `main.tsx` before render); `AppContext.runActivity`
  is async via the client (captured payload typed `Record<string, string>`);
  `AttributesForm`/`AvailableActivities`/`RecordsGrid` await it; CSV import
  runs rows sequentially. Local engine keeps notify (dormant bell — see
  consequences) + geo for expression evaluation; `reportConfigFindings()`
  kept as a drift safety net.
- **page builder**: `sdm-runtime/engine.ts` rewritten around
  `initSdmRuntime()` (live bindings — `pageHost.ts` imports unchanged),
  awaited in `api.ts` — the real entry (index.html mounts Shell via
  `MyComponents.mount`; `src/main.tsx` is a dead POC leftover — found the
  hard way when the first smoke bootstrapped nothing). Demo-page seeding
  moved from Shell module load to post-init (savePage validates against the
  fetched config). Private `config.ts` deleted; `ComponentContainer.runNow`
  async via the client (soft-stop confirm preserved); non-UI launch failures
  route to the host error channel; `ActivityFormModal.onSubmit` async.
- **sdm demo SDM**: the page-builder sample's activities merged in —
  `act_dispatch_work_orders` (non-UI, `callbackData.crew`, hook-written entry
  attributes, `services.logger`; new before-hook guard `if callbackData.crew
  is null { fail(...) }` so a direct workbench run fails cleanly instead of
  dispatching with no crew) and `act_reschedule_work_orders` (UPDATE,
  `due_date`); `crew` custom field added to `rt_work_orders`. Also fixed in
  the same pass: `act_raise_inspection_jobs` now captures `id` + new
  `job_type` attribute (both required) — the pre-existing stage 1 quirk that
  made Jobs uncreatable; and the engine-owned `services.logger` manifest
  moved to `services/logger.ts` so the standalone `validateConfig` registers
  it too (configs using it validate identically everywhere — caught by the
  sdm wiring tests).
- **Dev ergonomics**: root `npm run dev` now runs server + both hosts via
  concurrently; page builder pinned to port 5174.

## Known consequences / still open

- **Workbench notification bell is dormant**: hooks (and their
  `queue services.notify.*`) execute server-side where the sink is the
  process console. Bell + `NotificationLog` stay wired; returns with the
  unified-log design.
- The page-builder demo page starts empty until work orders exist in the
  shared scope — create one in the workbench and it appears (the point,
  observably).
- Still open after stage 2: Neon account + first Lambda deploy, drizzle-kit
  migrations, GET activities (unified-log design), auth (`author` demo
  stub), optimistic concurrency in `writeBack`, config authoring flow.
