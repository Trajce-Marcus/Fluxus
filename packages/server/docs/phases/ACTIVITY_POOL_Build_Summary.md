# Activity pool — build summary (2026-10-10)

Point-in-time record; not edited after this date. Design: [docs/APPS_AND_INSTANCES.md](../../../../docs/APPS_AND_INSTANCES.md) Part 1.
Living truth: this package's SPEC ("Model storage"), the engine SPEC ("The activity pool"),
the Console SPEC and `docs/QUERYING_THE_MODEL.md`.

## What changed

Activities moved out of their workflow into one list per solution, so one
activity can serve several record types. A workflow is now an ordered list of
`{ activity_ref }`. This reverses the 2026-08-08 ruling that activities stay
inside their workflow.

- **Storage:** new table `sdm_activities`; migration `0022_activity_pool`
  moves nested activities into it (ordered by `sort_order`, then position;
  identical duplicates become one; differing duplicates fail the migration
  naming the id) and leaves references in the workflow. `sort_order` is gone.
- **Engine:** `SolutionConfig.activities`; `ActivityUsage`; `MemoryAdapter`
  resolves workflows from the pool and gains `listActivities()`;
  `activityPool.ts` (`toActivityPool`, `recordTypesByActivity`,
  `includedActivityIds`, `workflowActivities`); `findActivity` sees only listed
  activities; a CREATE's type comes from the one record type that reaches it.
- **Save rules** (`validateConfig`): pool ids unique, references resolve, none
  listed twice, a CREATE reached through two record types refused, scripts
  checked once per record type (`(on <type>)` on type-specific problems),
  `invoke` of an unlisted activity refused.
- **Server:** assembly, `config.putActivity` / `deleteActivity`, import and
  rollback convert old-shape models (rollback stores the converted model), the
  client trim sends only pool activities a shipped workflow lists, each once.
  A pool activity still listed cannot be deleted; the refusal names every
  workflow listing it.
- **`model.*`:** `activities` drops `workflow_ref`, `record_type_ref`,
  `sort_order` and lists every pool activity; new `workflow_activities`.
- **Page runtime:** a shared activity's capture form takes its record type from
  the record it runs on; activity lists keep the workflow's order.
- **Console:** new Activities panel (the pool); the Workflows editor picks and
  orders, with a New activity shortcut; saves ordered so no step is invalid.

## Not built

- **The run check** (§1.5: refuse a run whose activity is not in the anchor
  type's workflow) — deferred by the user. Runs behave as before the pool.
- Renaming activity ids; per-workflow settings on a reference (§1.8).

## Dev database

Migration 0022 was applied to the Neon dev database on 2026-10-10 at 06:43 UTC
— by the running local dev server reloading onto the new migration during the
build, not by a deliberate step. Result checked read-only afterwards: 111
activities across `demo/sdm` (46) and `projects` (65), no conflicts, every
solution loads and validates with zero errors. Prod is untouched (it is still
at migration 0015 and is not merged).

## Verification

Typecheck clean in every package; workspace build clean; tests: engine 332,
server 402 (new `test/activityPool.test.ts`, 16 — including one fixture run
through both the migration SQL and `toActivityPool`), page-runtime 236, runtime
20, dsl 345, client 22. Not verified in a browser.
