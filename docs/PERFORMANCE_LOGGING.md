# Performance logging — MVP spec

**Status:** ready to build, 2026-09-24 (names endorsed; checked against the code, §10a). Not built. Direction:
[BLUEPRINT.md](BLUEPRINT.md) § Performance logging.

## 1. What this is

The platform records how long the things it does take, so they can be
interrogated. **Entirely disconnected from working data**: never in a record's
history, never audit, never projected to reporting. Its own table, deleted
after 30 days, and could be wiped at any time without loss.

This MVP is: timing into one table, switches down to the operation, and a
simple dashboard in the Platform app usable straight away. Budgets, publish
checks and fuller screens come after the numbers have been seen.

## 2. The row: one span per thing done

A **span** is one timed thing; a **trace** is every span belonging to one
action of the user's (opening a page, pressing Submit). The OpenTelemetry
vocabulary, so the data could later move to an established tool.

| Column | What |
|---|---|
| `trace_id` | The action it belongs to. |
| `span_id` | This span. |
| `parent_id` | The span it is part of; null for the top one. |
| `side` | `server` or `browser`. |
| `kind` | What sort of thing (§3). |
| `name` | Which one: the activity id, page path, tRPC procedure. |
| `org_id`, `operation_id`, `user_email` | Who and where; null where it doesn't apply. |
| `started_at` | When it started. |
| `duration_ms` | How long it took. |
| `outcome` | `ok`, `refused` or `error`. |
| `message` | The error message, when there is one. |
| `counts` | What it touched, as JSON — only the counts that apply (§4). |

Indexes: `started_at`; `(kind, name, started_at)`; `trace_id`.

## 3. What is timed (the kinds)

**Server:**

| kind | name | Covers |
|---|---|---|
| `request` | the tRPC procedure, e.g. `activities.run` | The whole request, from arrival to reply. Every procedure except the `perf.*` ones (logging about logging is noise), so config loads, the snapshot, page lists and user admin are all covered. |
| `host_load` | the operation id | Loading the operation's config and records into memory — done at the start of every run and GET today (`loadOperationHost`). |
| `validate` | the activity id | `validateSubmission`. |
| `engine` | the activity id | The engine's run: gate, hooks, mapping. One span for now; the steps inside the engine are a later addition (§9). |
| `write_back` | the activity id | Writing the run's changes to the database. |
| `db_connect` | — | A new database connection being opened. This is what shows the database waking up, as its own row. |

**Browser:**

| kind | name | Covers |
|---|---|---|
| `page_open` | the page path | From the page being asked for until every component on it has finished loading ("ready"). |
| `call` | the tRPC procedure + activity id | One call to the server as the browser saw it, network included. |

## 4. What each counts

Counts are recorded where the code already knows them; nothing is counted by
extra queries.

- `request`: `db_queries`, `db_ms` — the number of database queries the
  request made, and the time spent in them in total.
- `host_load`: `records` — how many records were loaded into memory.
- `write_back`: `created`, `changed`, `deleted`.
- `engine` on a GET: `rows` — how many rows it returned.
- `page_open`: `components`, `calls`.

## 5. How spans join up

- **On the server**, Node's built-in `AsyncLocalStorage` holds the current
  trace and span, so code deeper in a request opens a child span without
  passing anything through. A request's spans are collected in memory and
  written in one insert when the request finishes.
- **From the browser**, each request carries a header with the trace id (and
  the browser span it belongs to), so the server's spans join the browser's
  trace. While a page is opening, every call it makes carries that page's
  trace.
- **The browser** collects its spans and sends them in batches: every 10
  seconds, and when the tab is hidden.
- **Database queries** are counted and timed by wrapping the connection
  pool's `query`; a new physical connection is recorded as a `db_connect`
  span.

## 6. Switches

- **Platform-wide on/off**, and a **per-operation override**: on, off, or
  follow the platform.
- **In parts:** server spans, browser spans, database counts. Each can be
  turned off on its own.
- **Default:** on, platform-wide.
- The server reads the switches with a 30-second cache, so turning logging
  off takes effect within half a minute. The browser learns its operation's
  switches when it connects.
- Stored in a small settings table, one row per scope (the platform, or an
  operation id).

## 7. Retention

Spans older than 30 days are deleted, checked at most once an hour when spans
are written. No archive: this data is disposable.

## 8. The dashboard (Platform app)

Platform admins only, like the rest of the Platform app. One new screen:

- **Switches** — platform-wide, then each operation with its parts.
- **Time range** — last hour, 24 hours, 7 days.
- **Slowest things** — per kind and name: how many, typical (median), slow
  end (95th percentile), and worst. Sortable. This is where "which activity
  is slow" is answered.
- **Page opens** — per page: how many, median and 95th percentile to ready.
- **Database wake-ups** — `db_connect` spans: how many, and how long they
  took. This is where "the first page is slow" is answered.
- **Recent slow actions** — traces over 2 seconds, newest first. Clicking one
  shows its spans as an indented tree with their times: the page open, its
  calls, and the server's steps under each.

Plain tables, no charts, for this MVP.

## 9. Not in this build

- Steps inside the engine (the availability gate, before hook, mapping, after
  hook separately). This needs timing added inside `@fluxus/engine`.
- A span per database query. Counts and total time per request only, to keep
  volume down.
- Budgets and publish checks (static and measured).
- Charts, trends across releases, alerts.
- Sampling. Everything is logged when on.

## 10. Names needing sign-off

Tables `perf_spans` and `perf_settings`; the columns in §2; the kinds in §3;
the tRPC routes `perf.record` (the browser sending spans), `perf.settings`,
`perf.setSettings` and `perf.report` (the dashboard's queries); the header
`x-fluxus-trace`.

## 10a. Checked against the code (2026-09-24)

The cold review stalled twice, so these points were checked by hand:

- **Where to hook in:** every request goes through `createApp`'s tRPC
  `fetchRequestHandler` (`server/src/app.ts`), on every entry: local, Vercel
  and Lambda. So a tRPC middleware on the one procedure builder (`t` in
  `trpc.ts`) covers them all. The browser client uses `httpBatchLink`
  (`client/src/index.ts:43`), so one HTTP request can carry several
  procedures. The middleware runs once per procedure, so each still gets its
  own `request` span. The trace header is per HTTP request, which is fine,
  because a batch comes from one page. The link already builds its headers in
  an async function (`:48`), which is where the trace header goes.
- **Serverless:** the span insert is awaited inside the middleware, before the
  reply, so Vercel cannot freeze the function with it unwritten.
  `AsyncLocalStorage` is plain Node and works on both.
- **Database counts only on real Postgres.** The pool wrapper is
  node-postgres's (`db/client.ts`). Under PGlite (tests, no `DATABASE_URL`),
  `db_queries`/`db_ms` and `db_connect` are simply absent.
- **Write-back counts come free.** `writeBack` (`host.ts:270`) already works
  out the changed records, split into those with no baseline (created) and
  those with one (changed), plus `deletes`. It returns the three counts.
- **"Ready" does not exist yet.** Each `ComponentContainer` has its own
  `loading` state; `PageRenderer` gains a count of containers still loading
  and records `page_open` when it reaches zero after the anchor has resolved.
- **Migrations are hand-written** SQL plus a `meta/_journal.json` entry (as
  0019/0020 were; drizzle snapshots stop at 0005). The tables also go in
  `schema.ts`.
- **A likely finding before anything is measured:** every run and GET loads
  the **whole operation**, all records with their histories, into memory
  (`loadOperationHost`), and `writeBack` compares each one afterwards.
  `projects-dev` holds 1,429 records, and a page with eight GETs loads them
  eight times. `host_load` and `write_back` are timed separately for exactly
  this reason.

## 11. Things to know

- **A new migration.** It adds to the migrations prod doesn't have yet (the
  known gap before merging to main). This one is a pure addition, with no
  drops, so it doesn't make the gap worse.
- **Overhead.** One extra insert per request, done after the work, and a small
  wrapper round each database query. The switches exist for when it's not
  wanted.
