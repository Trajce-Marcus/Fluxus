# Backend stage 3 — pages repoint (build summary, 2026-07-16)

Point-in-time record; the living truth is each package's SPEC.

## What

Page definitions moved from browser localStorage (`fluxus:page:*`) to
`@fluxus/server`, completing the storage cutover backend stage 2 started for
records and config. localStorage now holds only per-device UI preferences
(UAT labels toggle, notification last-seen) by ruling.

## Rulings (session 2026-07-16)

- **Pages ride the config pipeline** — server is runtime truth, repo files
  are the deploy input. The user's condition: deploying pages must be
  equivalent to deploying files; satisfied by the seed script upserting every
  `*.json` under `page-builder/pages/` (file path minus extension = page
  path). Deploys overwrite live edits by design — files win; unlike record
  seeds, pages are never user data.
- **Sibling `pages` table, not a field in the config blob** (user chose the
  recommended option): `(scope, path)` PK, opaque jsonb `def`, `updated_at`.
  One row per page — the editor saves one page without a read-modify-write
  race on `sdm_configs.config`, and SDM validation stays separate from page
  validation.
- **Defs are opaque to the server** — `PageDef` and `validatePage` live in
  the page builder, and the server never depends on a peer host, so unlike
  `config.put` there is no server-side save-time validation.
- **`LocalStorageAdapter` deleted** from the engine — no live host after the
  hard cutover; the only conceivable revivals (zero-server sandbox, offline)
  wouldn't use it (offline's noted design is PGlite-in-browser + sync). Git
  history keeps it.
- **PGlite stays** as the dev/test driver — prod ignores it (`DATABASE_URL`
  wins), removing it would force a running Postgres on every test run, and
  it's the building block for the open offline question.

## Shipped

- server: `pages` table (migration `0001_clumsy_mother_askani.sql`), host
  `listPages`/`putPage`/`deletePage`, tRPC `pages.list/put/delete`; seed
  script pushes page files; `closeDb()` for orderly script shutdown on both
  drivers; 2 new acceptance tests (15 total).
- client: `connect()` fetches config + partition + pages in parallel;
  `pages` map (path → def) snapshot; `savePage`/`deletePage` mutate the map
  optimistically then round-trip — hosts keep synchronous reads.
- page-builder: `persistence.ts` keeps its synchronous API over the client
  snapshot (background write-through, loud console error on failure; every
  save still runs `validatePage`). The pre-wiring-redesign localStorage
  normalizer deleted — the server never held old-format pages. The demo page
  became the first repo page file (`pages/work-orders-demo.json`);
  `demoPage.ts` client-side seeding removed.
- engine: `localStorageAdapter.ts` deleted; `MemoryAdapter` is THE Store.
  sdm's `dsl-wiring.test.ts` runs on `MemoryAdapter({seed: true})`;
  `store-migration.test.ts` (localStorage-key migration) deleted as moot.

## Known consequences

- Pages previously authored in a browser's localStorage do not migrate —
  hard cutover, same ruling as stage 2. The shipped demo page reseeds from
  its file; personal test pages are re-authored.
- Page saves are optimistic: a failed round-trip leaves the local snapshot
  ahead of the server until reload (console error is the signal). Acceptable
  for the authoring tool at MVP; revisit with the authoring flow proper.

## Verified

engine/dsl/client/server/sdm/page-builder tsc clean; dsl 187, sdm 20,
server 15 tests green; page-builder vite build green; seed + pages
put/list/delete round-trip exercised against PGlite cross-process and the
demo page confirmed present in the Neon dev database.
