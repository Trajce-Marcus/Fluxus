# DSL Phase 4 + Backend — Stage 1 Build Summary (2026-07-12)

Point-in-time record; the living design is [../SPEC.md](../SPEC.md).

## What shipped

`@fluxus/server` — the third host of the shared activity engine, making
headless invocation (ROADMAP item 6, DSL_SPEC §11 Phase 4) real over the
agreed stack: tRPC on Hono (Node locally, Lambda entry written but not
deployed), Postgres via Drizzle (PGlite in dev/tests; Neon by
`DATABASE_URL`), the two-layer data architecture with the reporting
projection written synchronously in-transaction.

- **API**: `activities.run` (the headless front door), `records.list/get`
  (platform data channel), `config.get/put` (SDM config becomes a stored,
  save-time-validated artifact).
- **Engine additions**: `MemoryAdapter` extracted from LocalStorageAdapter
  (protected `persist()` hook + `allRecords()`); `validateSubmission` — the
  attribute trio + datasource membership + reference existence as one payload
  check mirroring AttributesForm semantics; `geo` moved in from sdm
  (Store-backed, host-agnostic).
- **Reporting**: normalized `rpt_activities`/`rpt_attributes` per the
  2026-07-12 data-architecture agreement — one row per run, one row per
  attribute (single text value; waived = same row, value null + waive_desc;
  `system_warnings`/`system_log` as ordinary rows).
- **Acceptance** (13 tests, in-memory PGlite): headless create → complete
  Work Order with warn soft-stop → acknowledge → hook-driven status move →
  notify queue dispatch to the server sink → projection rows; every
  rejection class (unknown key, hidden-attribute value, dangling FK,
  validation rule, datasource miss, availability gate); config.put rejecting
  an invalid SDM; seeds loading only into empty types.

## Rulings made at kickoff (recorded in ROADMAP/ARCHITECTURE/SPECs)

1. **The Store contract stays synchronous.** The server loads the scope's
   partition into a `MemoryAdapter` per request, runs the sync engine, diffs
   against the load-time baseline, and writes back in one transaction. No
   async evaluator rewrite; DSL Phase 4 shipped with zero language change.
   Transactional-layer leanness (retention doctrine) is what keeps this
   cheap.
2. **PGlite is the dev/test driver** (this machine has no Docker/Postgres):
   real Postgres-in-process behind the same Drizzle schema; Neon is a
   connection string. Boot-time idempotent DDL until drizzle-kit migrations
   arrive with real Neon deployments.
3. **Scope is an opaque path string** (`demo/sdm`): repo/folder hierarchy
   levels arrive later as data, not schema.
4. **After-hook failure persists by doctrine** — the router writes the diff
   back even when runActivity throws ("recorded, but no changes applied").
5. **No notifications storage** (One Pipeline Invariant): the server notify
   sink is pluggable, console by default, pending the unified-log design.
   GET activities deferred on the same design. Auth absent: author is the
   demo stub.

## Left open for stage 2+

Browser hosts repoint (fetch partitions, run activities server-side);
Lambda/Neon exercised for real; optimistic concurrency in writeBack;
config distribution proper; GET activities; the workbench form folding onto
`validateSubmission`.
