# Server data loading — spec

**Status:** 2026-09-25 — revised twice after two cold reviews; every decision
the reviews raised is answered (§2). **Steps 1 and 2 built** the same day
(`packages/server/test/writeBack.test.ts`, `packages/server/test/databaseStore.test.ts`,
`packages/dsl/test/waiting.test.ts`; the DSL evaluator and script suites run
through both drivers). **Step 3 built** the same day
(`packages/server/test/recordQuery.test.ts`, `packages/dsl/test/query.test.ts`);
the save check ran clean over the dev database; prod is not checked — it is to be reset (§13). What the
builds chose is in §12 (step 2) and §13 (step 3). Direction:
[BLUEPRINT.md](BLUEPRINT.md) § Loading only what a request needs. Spans
`@fluxus/dsl`, `@fluxus/engine` and `@fluxus/server`, so it lives in root
`docs/`.

## 1. What this is

**The rule (the user's "absolute no. 1"):** every client gets only the data it
needs, whether it is a GET, an activity or anything else, and so does the
server: it reads from the database only what the request touches. It has to
hold at millions of records per operation.

**What the server does today** (checked against the code, §10):

- Every `activities.run`, `activities.query` (GET) and `scripts.query` (DSL
  Editor) calls `loadOperationHost`. It reads the model, then **every record in
  the operation with its full history** into an in-memory `MemoryAdapter`,
  builds an engine over it, runs, and throws it all away. Nothing is kept
  between requests.
- After the run, `writeBack` compares every loaded record against its
  load-time copy (JSON) to find what changed, then rewrites each changed
  record **whole**, history included.
- projects-dev holds 1,429 records. A project page with ~8 GET-backed lists does
  all of this 8 times.

**Why:** the engine's `Store` and the DSL's `RecordsHost` answer immediately
(synchronously). A script reads `records.shift_reports.where(...)` as "every
shift report, then filter", so everything has to be in memory before a script
runs.

**What this spec does:** the server stops building a copy of the operation. The
engine runs against a store that asks the database for each thing when a
script needs it — one record by id, or one query run as SQL — and writes each
change to the database as it happens, inside one transaction per request.
Three steps, each shippable on its own (§3–§5).

## 2. Rulings

The user's (2026-09-25):

1. **Load only what a request touches.** Vital and urgent.
2. **No caching between requests.** Keeping a loaded operation in memory across
   requests was offered and rejected. Later, definitions and the model are the
   caching candidates (they rarely change); data is not.
3. **This reverses the Phase 4 ruling** that the Store stays synchronous, and
   the "partition-fetch + filter" runtime model. Recorded as a reversal in the
   blueprint and ARCHITECTURE.
4. **A record-query filter may not call a service or one of the implementer's
   DSL functions on the record's fields** — anything that would run once per
   record and cannot become SQL. Banned for now; exceptions may come later. A
   call that does not touch the record (`now()`, a service call with no field
   argument) is worked out once and used as a value.
5. **Chained `where`s are one SQL statement.**
6. **Indexes are deferred** until record types show the need. Ids are already
   indexed.

Recommended by Claude and approved by the user — the design as a whole ("ok
write spec"), the first review's decisions ("ok go with that") and the second
review's ("yes recommendations work for me"):

7. **One evaluator that runs two ways** — immediately against memory (browser
   hosts, unchanged) or waiting on the database (server).
8. **Rows held in a variable are filtered in memory.** Keeping the query that
   fetched them narrow is the implementer's responsibility; the row quota
   (§5.5) stops a runaway one. The ban (rule 4) does not cover them, nor chain
   steps that run in memory after a query.
9. **Within one request, records already read are held in memory** so a second
   read of the same record is not another query. Discarded when the request
   ends. This is not ruling 2's caching.
10. **A run writes its changes to the database as it goes, inside one
    transaction**, committed at the end. The database therefore shows the run
    its own creates, changes and deletes in every later read and query. A hook
    runs inside a savepoint, so a failing hook undoes only its own writes. The
    trade: the transaction stays open while scripts and services run, and rows
    the run has written stay locked until it ends.
11. **A record query means what the database does** (§5.3). Filtering done in
    memory — rows held in a variable, the browser's `MemoryAdapter` — follows
    the same rules as closely as is practical, and the known differences are
    listed (§5.4) rather than promised away.
12. **Fields in a query compare by their declared type** in the model. A blank
    value (`''`, the default every field starts with) reads as null. A value
    compared with a field is converted to the field's type (text against a date
    field becomes a date). A stored value that does not fit its type reads as
    null.
13. **A bare name inside a query means the record type's declared field**, as
    [GRAMMAR.md §4.1](../packages/dsl/docs/GRAMMAR.md) states. A record missing
    that key reads it as null; outer variables are reached only by names that
    are not declared fields.
14. **A filter that cannot become SQL is refused when it runs**, with an error
    naming why — the DSL Editor and filters saved before the check included.
    The server never reads a whole type to filter it.
15. **Built-ins, `iif`, arithmetic, date methods and `date()` on fields are
    allowed** in a filter, with Postgres's behaviour (§5.3). What rule 4 bans
    is a service, a named DSL function or `invoke` taking a record field.
16. **The row quota counts a query's result**, not the whole type as today;
    `.count` has no row limit.
17. **A run that changes a record another request has just deleted fails** —
    "record … was deleted meanwhile" — and nothing of the run is written.
18. **Dates and times are read in UTC**, fixed.
19. **Ties are ordered by id**, so a query's order is always the same.
20. **The time budget counts evaluation only**, not time waiting on the
    database — it exists to stop runaway scripts, not slow databases.
21. **`select` still fetches whole rows**; narrowing the SQL to the selected
    fields comes after step 3.
22. **The forms in §5.2's refused list stay refused** until a solution needs
    one; each is then its own small addition.
23. **`host_load`'s `records` count is dropped at step 2**; counting records
    read per run is a performance-logging follow-up, with its own name to sign
    off.

## 3. Step 1 — history is never loaded; writes are patches and appends

No evaluator or engine change. Step 2 replaces this write path; step 1 is the
relief that ships first.

**Why it is safe:** nothing in the engine, the DSL or the server reads a
record's history during a run or a GET. Scripts see records without it
(`toDslRecord`), results flatten without it (`toComponentValue`), and
`records.get` / `records.partition` read the database directly. Confirmed by
both cold reviews.

Done:

- `loadOperationHost` ([host.ts](../packages/server/src/host.ts)) selects `id`,
  `type_ref` and `custom_fields` only. Records enter the `MemoryAdapter` with an
  empty `activityHistory`.
- The write-back baseline keeps each record's `custom_fields` only.
- `writeBack` writes per record, in one transaction:
  - **Created** (not in the baseline): `INSERT` with its fields and the entries
    appended this run.
  - **Changed**: `UPDATE … SET custom_fields = custom_fields || $changed,
    activity_history = activity_history || $newEntries, updated_at = now()`,
    where `$changed` holds only the keys whose value differs from the baseline,
    and each part is included only when it has something in it. A record whose
    only change is a new entry (a GET's log entry, a plain capture) updates
    `activity_history` alone.
  - An `UPDATE` that changes no row means another request deleted the record:
    the transaction rolls back and the request fails (ruling 17), a GET whose
    log entry lands on a deleted anchor included.
  - The engine never removes a field key. If a key present in the baseline is
    missing after a run, write-back throws rather than guess.
  - **Deleted**, reporting rows, attachment ledger: as today, in the same
    transaction.
- The perf counts on `write_back` (`created`, `changed`, `deleted`) are
  unchanged.

Result: far less read per request (history is most of it — not measured), and
two runs at the same time no longer overwrite each other's history entries or
each other's untouched fields (§11).

## 4. Step 2 — the evaluator and engine can wait; the server reads and writes on demand

### 4.1 The evaluator

- Its internals are rewritten as generator functions. Every read of the records
  host, every mutation, every service call and every `invoke` passes its result
  through a `yield`; a small driver resumes the evaluator:
  - the **immediate** driver requires a plain value and fails if handed a
    promise (today's behaviour);
  - the **waiting** driver awaits it.
  Babel's `gensync` runs one implementation both ways with the same technique;
  no dependency is added.
- `evaluateExpression`, `evaluateAst` and `executeScript` keep their signatures
  and use the immediate driver. Waiting forms of each are added, returning a
  promise. Names are the builder's choice.
- `RecordsHost.getAll` / `getById`, the `mutate` methods and `EvalHost.invoke`
  may return a promise. `hasType`, `fkTarget` and `reverseRef` stay immediate —
  they read the model.
- **The records host tells the evaluator each type's declared fields and their
  types** — a new immediate method, needed for rulings 12 and 13.
  `withModelTypes` answers it for model collections from
  `COLLECTIONS[].columns` ([modelProjection.ts](../packages/engine/src/modelProjection.ts)).
- A service function may return a promise under the waiting driver. This
  retires the rule in `ServiceFunctionDef` that a waiting call returning a
  promise is a runtime error; the immediate driver keeps it.
- **Mutations write through (ruling 10).** A host may declare that it writes
  each mutation at once and undoes a failed script itself. The server's store
  does: `create`, `update` and `delete` go to the database as they happen,
  inside the hook's savepoint, and the evaluator keeps no staging overlays for
  that host — its reads see its writes because the database does. A host that
  does not declare it (`MemoryAdapter`, and so every browser and engine test)
  keeps today's staging, overlays and commit, unchanged.
- **Deletes check references at the end of the script**, not per delete — the
  rule today (checked across the whole set, so deleting a subtree is allowed).
  With writes going through, every delete is applied as it happens and, at the
  end of the script, anything still pointing at a deleted record fails the
  script and its savepoint is rolled back.
- **`queue`d calls dispatch after the request's transaction commits** — later
  than today, where they fire when the hook script finishes, before anything
  reaches the database.
- **Quotas.** `maxSteps` unchanged; `maxRows` §5.5; `timeoutMs` counts
  evaluation time only (ruling 20).

### 4.2 The engine

- The `Store` contract splits:
  - **model, immediate:** `listRecordTypes`, `getRecordTypeDef`,
    `listWorkflows`, `resolveAttributeDisplayField`, `resolveAttributeTarget`,
    `getReverseRefs`;
  - **records, may wait:** `getRecordTypeData`, `getRecord`,
    `getRecordsByField`, `buildRecord`, `insertRecord`, `createRecord`,
    `validateUpdate`, `updateRecord`, `deleteRecord`, `appendActivity`,
    `resolveDisplayLabel`;
  - **browser only:** `subscribe` (the workbench re-renders on it,
    [WorkbenchContext.tsx:114](../packages/workbench/src/WorkbenchContext.tsx#L114));
    the database store does not have it.
  Browser code keeps an immediate `Store` type, so nothing in the browser has
  to handle a promise. `MemoryAdapter` satisfies both.
- **Server-only and waiting:** `runActivity`, `runQuery`, `invoke`,
  `validateSubmission`, `blockingReferences`. Only the server, its scripts and
  tests call them (§10).
- **Both ways:** `evaluate`, `activityAvailability` / `isActivityAvailable` —
  the browser keeps the immediate forms; the server's gate uses the waiting
  ones.
- The `geo` service's `suburbsOf` chains `.map().sort()` straight onto
  `getRecordsByField` ([geo.ts:22-26](../packages/engine/src/services/geo.ts#L22-L26)),
  so it gets a form that works both ways.
- **One engine per request, never shared.** The engine holds per-run state
  (`runLog`, the `invoke` in-flight set) that relies on runs not interleaving.
- **What a failure undoes** — each outcome as today:
  - the gate or before hook refuses, or the run needs confirmation (including a
    DELETE record map before it is confirmed): nothing has been written; the
    transaction is rolled back;
  - the after hook fails: its savepoint is rolled back; the record map's change
    and the history entry stay, and commit ("recorded, but no changes applied");
  - a GET's `returns` throws: its `error` entry is appended and committed;
  - anything else fails (ruling 17, a database error): the whole transaction is
    rolled back.

### 4.3 The server's database store

Replaces the whole-operation `MemoryAdapter` in `loadOperationHost`, which then
loads the model only. Built per request; holds no records at the start.

**The transaction.** An activity run opens the request's transaction before its
first read and commits it at the end, where `writeBack` is called today. Every
read and write of the run goes through it, so the run always sees its own
writes. A GET writes only its log entry: it reads outside a transaction and
appends the entry in one statement at the end. `scripts.query` writes only what
an `invoke`d GET logs, the same way.

**Reads** (always `id, type_ref, custom_fields`; never `activity_history`):

| Asked for | SQL (all scoped by `operation_id`) |
|---|---|
| A record by id — the anchor, a reference followed | `WHERE id = $1` |
| The records of a type (step 2; step 3 narrows it) | `WHERE type_ref = $1` |
| Records by field value — `geo`, delete checks | `WHERE type_ref = $1 AND custom_fields->>$2 = $3` |
| "Does another record already have this unique value?" | `SELECT 1 … WHERE type_ref = $1 AND custom_fields->>$2 = $3 AND id <> $4 LIMIT 1` |

Values and field keys always go in as parameters, never spliced into the SQL
text. `getRecordsByField` and the unique check compare as text, as today (a
missing key reads `''` in memory today and NULL from `->>`; no caller passes
`''`).

**Writes, as they happen** (ruling 10):
- **create:** `INSERT` (the primary key refuses a clashing id — ids are UUIDv7,
  so the store does not read to check);
- **update:** `UPDATE … SET custom_fields = custom_fields || $changed` — no row
  changed means the record was deleted meanwhile (ruling 17);
- **delete:** `DELETE`;
- **history entry:** `activity_history = activity_history || $entry`, plus its
  reporting rows and the ledger flip, in the same transaction.
- `updated_at` is set on every write.

**Held for the request.** Every record read is kept by id, and the store hands
back **the same object** for the same id every time, changing it in place on
every write — as `MemoryAdapter` does. The router's `anchorRecord` and the
`invoke` closure `runActivity` builds rely on seeing the anchor change in
place. A query's rows that are already held come back as the held objects.

**Callers.**
- The three procedures read their anchor through the store (waiting) instead of
  `host.adapter.getRecord`; `writeBack` goes. `findActivity` reads the model
  and is unchanged. `scripts.query` keeps its raised quotas.
- `packages/server/scripts/` — `load-pipeline-project`, `load-projects-sample`,
  `load-cbs-detail`, `project-page-location`, `project-page`,
  `shift-reports-pages`, `verify-wbs-lifecycle`, `verify-shift-reports` — and
  `packages/server/test/hookDelete.test.ts` use `host.adapter`,
  `host.engine.runActivity` / `runQuery` and `writeBack` directly;
  `verify-shift-reports.ts:60` reaches into `adapter.records`. Each moves to
  the waiting API or is retired if it has served its purpose — listed for the
  user at build.

After step 2, no request reads the whole operation. A GET over a large record
type still reads that whole type until step 3.

## 5. Step 3 — record queries run in the database

### 5.1 What becomes one SQL statement

The evaluator hands a record-query chain to the host as one description
instead of reading the type and filtering:

- it starts at `records.<type>`, or at a reverse reference reached from a
  record (`context.record.wo_resources`, which is the source type filtered on
  its reference field);
- followed by any number of `where`, then optionally `orderby`, then
  optionally `top`;
- or ended directly by `.count` (→ `COUNT`) or `.first` (→ `LIMIT 1`).

Anything after that point — `select`, `values`, a `where` after `top`,
`.top(n).count` — runs in memory over the result.

The records host gains an optional method taking that description. The
server's store answers it with SQL, inside the request's transaction, so the
run's own writes are included (ruling 10). The browser's `MemoryAdapter`
answers it in memory by §5.4. A host without it gets today's behaviour (read
the type, filter).

**The model is not in the database.** `withModelTypes`
([modelProjection.ts:448-471](../packages/engine/src/modelProjection.ts#L448-L471))
spreads the base host, so it would pass the new method straight through and
`model.record_types.where(...)` would query `records`. It must answer
descriptions for model collections itself, in memory, and pass only record
types through.

### 5.2 How a filter becomes SQL

- Every part of a `where` condition that does not depend on the row is worked
  out first and used as a value: variables, `attributes`, `context`, `now()`,
  `date('…')` of a constant, a service or function call with no field argument,
  and an `in` list or subquery that does not refer to the outer row
  (`id in records.wo_assets.where(work_order_id = context.record.id).values(asset_id)`
  runs once and becomes `= ANY($n)`).
- What remains refers only to the row: its declared fields (ruling 13) and
  fields reached through a reference (`work_group.region` → a join on the
  referenced record).
- **Supported:** `=` `!=` `<` `<=` `>` `>=`, `and` / `or` / `not`, `is null` /
  `is not null`, `in`, `between`, `like`, `iif` (both branches of one type),
  arithmetic `+ - * / %`, unary `-`, the built-ins `len`, `lower`, `upper`,
  `trim`, `abs`, `round`, `exact` and `date()` on a field, the date methods
  (`addDays`, `addMonths`, `addYears`) on a field, `orderby` on any supported
  expression, `top`.
- **Refused for now** (ruling 14 at run time, the save check at save; ruling
  22):
  - a service call, named DSL function or `invoke` taking a row field (rules 4
    and 15);
  - indexing into a list field (`tags[0]`), reading inside a composite, file,
    photo or geopoint value (`photo.taken_at`), `x in` a list field, `len` /
    `.count` / `.first` on a list field;
  - a reverse reference inside a filter (`work_order.wo_resources.count > 0`),
    and any nested `records.<type>` query that refers to the outer row;
  - comparing a `photo`, `file`, `geopoint` or composite field with anything but
    `is null`;
  - `iif` whose branches have different types.

### 5.3 What a query means (rulings 11, 12, 18, 19)

Postgres executes it; these are the rules the SQL is written to.

- **Blank and unfit values read as null.** `''` — the default a field starts
  with — and a stored value that does not fit the field's declared type are
  null, so `is null` finds them.
- **Text** (text types, reference ids): compared case-insensitively (`lower()`
  on both sides), ordered by the lower-cased value. Case folding and ordering of
  non-ASCII text are whatever the database's locale does.
- **`int` / `decimal`**: numbers, as `float8`. A compared value is converted to
  a number; one that does not convert is an error in the query.
- **`date`** (`YYYY-MM-DD`), **`datetime`** (ISO, with or without offset, or
  date-only): instants, read in UTC — a date or a datetime without an offset is
  UTC. A compared value (`now()`, `date('…')`, text such as `'2026-09-01'`) is
  converted to an instant; text that does not convert is an error in the query.
  So `due_date < now()` and `report_date = context.record.report_date` both
  work.
- **`time`** (`HH:MM`): compared as text, as today.
- **`bool`**: the text `'true'` / `'false'` (what the capture form stores) or a
  JSON boolean; `where(active)` works.
- **Nulls:** `=`, `in`, `like` and ordering comparisons never match null; `!=`,
  `not in` and `not like` are true for null; `not` of a comparison that met a
  null is true. SQL wraps each comparison so its three-valued logic never shows
  (`COALESCE(…, false)`, `IS DISTINCT FROM`).
- **`orderby`**: nulls last whichever the direction; **ties by id** (ruling 19).
- **`like`**: case-insensitive; `%` any run, `_` one character, no escape
  character (`ILIKE … ESCAPE ''`).
- **Built-ins and date methods** behave as Postgres's own (`lower`, `upper`,
  `trim`, `length`, `round`, `abs`; month arithmetic clamps to the month's last
  day).
- **Errors**: division by zero in a query is the DSL's "Division by zero" error.
  SQL does not promise the order `and` / `or` are evaluated in, so a guard like
  `qty != 0 and total / qty > 5` does not protect the division — write it with
  `iif`.
- **Without `orderby`**, the order is by id.

### 5.4 The same query in memory

Where a query runs in memory — rows held in a variable (ruling 8), chain steps
after the SQL part, the browser's `MemoryAdapter` — the evaluator follows §5.3:
declared types from the host, blanks and unfit values as null, UTC dates,
converted comparison values, the null rules, nulls last and ties by id.

Known differences from the database, accepted (ruling 11):
- non-ASCII case folding and ordering (JavaScript's rules, not the locale's);
- `trim` removes all whitespace in JavaScript, spaces only in Postgres;
- `len` counts UTF-16 units in JavaScript, characters in Postgres;
- `round` of an exact half, and month arithmetic past a month's end;
- the text form of a number joined to text with `+`;
- `and` / `or` short-circuit in memory, not in SQL.

Rows produced by `select` have no record type; filtering them keeps today's
rules.

### 5.5 The row quota (ruling 16)

Every query asks the database for at most `maxRows + 1` rows; getting the extra
one raises today's "Query exceeded the row quota" error without reading the
rest. Defaults unchanged: 10,000 for hooks and bindings, 100,000 in the DSL
Editor. This is what stops `records.jobs.where(true)` over a million jobs.
`.count` is not limited.

### 5.6 The save check

The validator refuses every form §5.2 refuses, at every save that validates
FluxScript: model save (`validateConfig`, which blocks the save) and page save
(`validatePage`, whose findings are shown but never block,
[persistence.ts:37](../packages/console/src/platform-components/page-builder/persistence.ts#L37)).
The guarantee is ruling 14: whatever reaches the server — a page saved with
findings, the DSL Editor, a model saved before the check — is refused when it
runs. The browser does not refuse; it has no SQL to protect.

Before step 3 ships, the check is run over every stored model and page in dev
and prod, and the offenders are listed for the user. None are expected; not
verified.

### 5.7 Bulk writes

`records.x.where(...).update({...})` / `.delete()` find their records through
the same SQL, then write per record as §4.1 describes.

### 5.8 Indexes

None added (ruling 6). The primary key `(operation_id, id)` serves reads by id;
`records_operation_type` `(operation_id, type_ref)` narrows every query to one
type ([schema.ts:453-454](../packages/server/src/db/schema.ts#L453-L454)).
Filters on other fields slow down only on a very large type — the decision is
needed before an operation grows that big, not before the build.

## 6. Not in this work

- **The browser apps.** The Console workbench still takes the whole operation at
  connect (`records.partition`) and after every run — a breach of rule no. 1,
  fixed separately. The Runtime app already connects with no records.
- **Queries across several record types** beyond references — the user's new
  requirement; waiting on an example.
- **The growth of an anchor record's history** from GET log entries (§11).
- **Data outside Postgres** (S3, other endpoints) and **opaque strings** — the
  user's wider picture, recorded in the blueprint.
- **Caching between requests** (ruling 2).
- **Concurrency beyond write-as-you-go and ruling 17:** two runs changing the
  same field end last-write-wins (the second waits for the first's lock, then
  overwrites); two creates with the same unique value both pass. Closing them
  needs a version check or a database constraint — later, the user's call.
- **Expressions outside record queries** — `context.record.due_date < now()` in
  a show condition — keep today's rules; bringing them onto §5.3 is a separate
  decision.

## 7. Tests

Step 1:
- Two GETs on the same anchor, at the same time, both leave their entries.
- A run keeps the anchor's earlier history.
- A changed record gets only its changed keys written; its other fields stay as
  another writer left them.
- A run updating a record deleted meanwhile fails and writes nothing — no
  record, no reporting rows.
- Existing server tests (`headless`, `query`, `files`, `perf`, …) pass.

Step 2:
- Every existing DSL evaluator and script test runs through both drivers — the
  waiting one against a host that answers with promises — with identical
  results. Includes `invoke` and a waiting service call.
- Engine tests `await` the waiting functions; results unchanged.
- A run on the server reads only the records it touches: seed several types,
  run an activity that reads one, and check the others were never queried.
- Write-through: a hook creates, updates and deletes, then reads each back and
  sees its own writes, deletes included; a failing hook leaves none of its
  writes and keeps the record map's change and the entry; deleting a subtree in
  one hook works, deleting a referenced parent alone fails and undoes the
  hook.
- The anchor object the router holds sees the record map's change.
- Commit cases: `needs-confirmation` writes nothing; a DELETE record map; a GET
  whose `returns` throws writes its `error` entry; a database error rolls back
  everything.
- `queue`d calls fire only after the commit, and not at all on a rollback.

Step 3:
- **Query meaning** (§5.3), against PGlite: blanks and unfit values as null;
  mixed-case text; numbers as `float8`; date and datetime fields (with and
  without offset, date-only) against `now()`, `date('…')` and date text; `time`
  as text; `bool` stored as text and as JSON; each null rule; nulls last and
  ties by id; `like` with a line break and a backslash; references; `in` with a
  list and a subquery; `between`, `iif`, arithmetic, unary `-`, the built-ins
  and date methods; `top`, `.count`, `.first`, chained `where`s; a record
  lacking a declared key while an outer variable has the same name; division
  by zero.
- **Memory agrees on ordinary cases:** the same table run through the
  `MemoryAdapter` gives the same rows, except the differences §5.4 lists, which
  are left out.
- A hook's writes are seen by its later queries — directly, through a
  reference, with `orderby … top`, `.count` and `.first`.
- `model.*` chains still answer from the model.
- The row quota fires without reading past `maxRows + 1`; `.count` over more
  rows than the quota works.
- Validator: each refused form is refused; the same call with no field argument
  is accepted; a refused filter reaching the server through `scripts.query`
  fails with ruling 14's error.

## 8. Docs to update (at build, same commit as the code)

- [BLUEPRINT.md](BLUEPRINT.md): the direction and the reversal — **done with
  this spec**.
- [ARCHITECTURE.md](ARCHITECTURE.md): the "partition-fetch + filter" bullet, the
  Store paragraph under *Hosting options* and the headless-invocation bullet,
  rewritten when step 2 ships. Reversal notes are in now.
- `packages/dsl/docs/DSL_SPEC.md` and `GRAMMAR.md`: the waiting evaluator,
  write-through mutations, `queue` after commit, the refused forms, what a query
  means (§5.3), bare names by declared field, the quota counting results, the
  time budget.
- The engine's and server's `docs/SPEC.md`; [ROADMAP.md](ROADMAP.md).
- [PERFORMANCE_LOGGING.md](PERFORMANCE_LOGGING.md): `host_load` no longer counts
  records (ruling 23).
- No new terms, tables or columns. No GLOSSARY entry.

## 9. Open points

None. Every decision both reviews raised is answered in §2.

## 10. Checked against the code (2026-09-25, and by two cold reviews)

- `loadOperationHost` reads every record of the operation, histories included
  ([host.ts:125-150](../packages/server/src/host.ts#L125-L150)); it is called
  by `activities.run`, `activities.query` and `scripts.query`
  ([router.ts](../packages/server/src/router.ts): 833, 920, 1011 in the working
  tree of that date).
- `writeBack` compares every record's JSON with its baseline and upserts
  changed records whole, `activity_history` included
  ([host.ts:275-345](../packages/server/src/host.ts#L275-L345)).
- Nothing in the engine, the DSL or the server reads `activityHistory` during a
  run or GET.
- `records.<type>` materializes the whole type the moment it is named
  (`member` → `readAll`, [evaluator.ts:635](../packages/dsl/src/evaluator.ts#L635));
  `where`, `orderby`, `select`, `values`, `top` then work on that list
  (`chainMethod`). A reverse reference reads the whole source type and filters
  (671). The row quota is checked against the whole type before filtering
  (1110).
- Staged hook writes live in the evaluator (`stagedCreates`, `stagedPatches`)
  and are laid over reads in `readAll` / `readById` (1099-1128); a staged delete
  is not hidden from later reads in the same script (1203-1231).
- Equality and ordering: text is lower-cased on both sides; `null` equals only
  `null`; ordering against `null` is false; `orderby` sorts nulls last,
  stable. `compare` throws on mixed types; `toBool` throws on a non-boolean
  condition; `date()` parses a date-only string as local midnight; `and` / `or`
  short-circuit.
- Bare names in a query resolve by the record's own keys, then the outer scope
  (`itemScope`, 1065-1084); a bare reverse-reference name is not resolved there.
- Every field starts as `''` (`buildRecord`, [memoryAdapter.ts:203](../packages/engine/src/memoryAdapter.ts#L203));
  numbers are stored as numbers, blanks stay `''`.
- Field types in real models include `time`, `photo`, `geopoint` and
  `datetime`; `report_date` is a `datetime` holding date-only text
  (`packages/server/scripts/shift-reports-*`).
- `runActivity`, `runQuery`, `invoke` and `validateSubmission` have no browser
  caller; the browser apps use `createEngine`, `MemoryAdapter`,
  `buildEvalHost`, `evaluateWithGets`, `engine.evaluate` and
  `engine.isActivityAvailable`.
- The records table: primary key `(operation_id, id)`, index
  `records_operation_type` on `(operation_id, type_ref)`
  ([schema.ts:445-455](../packages/server/src/db/schema.ts#L445-L455)).
- The server driver is node-postgres (`pg.Pool`) on Neon and PGlite in
  dev/test; both support a transaction held across awaits and savepoints.
- `DEFAULT_QUOTAS`: `maxSteps` 100,000, `maxRows` 10,000, `timeoutMs` 1,000
  ([dsl host.ts](../packages/dsl/src/host.ts)).
- Not verified: the database locales of Neon and PGlite.

## 11. Things to know

- **Parallel GETs lost their log entries before step 1.** Each GET wrote back
  the anchor's whole history as it loaded it plus its own entry, so the last to
  finish overwrote the rest. Confirmed 2026-09-25: the step 1 test run against
  the old write-back kept one entry of two, and a second run's whole-record
  write undid the first run's change. Step 1 fixes both (appends and patches).
- **An anchor's history grows with every GET.** Each project page open adds
  ~8 entries to the project record, and Postgres rewrites the whole
  `activity_history` value on each append. Unbounded; outside this work — it is
  the unified-log question.
- **A run holds its transaction open while scripts and services run** (ruling
  10). A second run writing a row the first has written waits for it; two runs
  writing the same rows in opposite order can deadlock, and Postgres then fails
  one of them. Rare at today's volumes; watch the performance log.
- **Behaviour changes in queries, deliberate:** blanks and unfit values are
  null; date and bool fields compare where they failed before; a record lacking
  a declared key no longer reads an outer variable; the row quota counts
  results; row-independent parts of a filter are worked out once, up front, so
  an error in one (an invalid `date(attributes.x)`) now surfaces even over an
  empty type; order without `orderby` is by id; a hook's own deletes are hidden
  from its later reads; `queue`d calls fire after the commit.
- **The DynamoDB option weakens.** DynamoDB looks records up by key only, so it
  cannot run these filters; the store seam survives, but a DynamoDB store would
  answer less than Postgres does.
- **Generator overhead** on in-memory evaluation (the browser path) is not
  measured. The build measures a large in-memory `where` before and after; if
  it slows noticeably, it comes back to the user.
- **Before and after:** the performance log's `host_load` and `write_back`
  spans (built 2026-09-25) are the measure.

## 12. As built — step 2 (2026-09-25)

What the build chose where §4 left it open, or did differently. Package detail
is in the DSL SPEC (§7, §10), the engine SPEC (*The Engine object*, *The Store
contract*) and the server SPEC (*The request model*).

- **Names.** Waiting forms: `evaluateExpressionAsync`, `evaluateAstAsync`,
  `executeScriptAsync`; on the engine `evaluateAsync`,
  `activityAvailabilityAsync`, `isActivityAvailableAsync`. The store contracts:
  `ModelStore`, `Store` (the browser's, immediate) and `WaitingStore`. The
  declared-fields method is `RecordsHost.declaredFields(type)` (optional on the
  interface); nothing reads it yet — rulings 12 and 13 are step 3's.
- **How a host declares write-through.** On the DSL side, a mutation host with
  `writesThrough: true` and `begin` / `create` / `update` / `delete` / `finish`
  / `undo` / `afterCommit`. On the engine side, a `WaitingStore` with
  `savepoint()` and `afterCommit(fn)`; the bridge builds the first from the
  second. The savepoint opens at the hook's **first write**, so a hook that
  writes nothing costs no round trip.
- **Plain answers are not yielded.** Only a promise goes to the driver, and
  literals, names, member access and operators over them are evaluated without
  a generator (in the immediate driver, member access reads the host directly).
  Measured before and after, over memory: a 50,000-row `where` with operators
  at parity (20 → 19 ms), with calls at parity (63 → 64 ms), with a reference
  followed per row faster (16 → 13 ms); a 20,000-iteration script loop slower
  (8 → 9.5 ms, ~15%).
- **`AfterHookFailedError`** (engine) marks the one failure that commits, so the
  router can tell it from every other; the message is unchanged.
- **`store.fault`.** A database error, or a record deleted meanwhile, is kept on
  the store; `commit()` refuses while one is set. That is how a database error
  inside a hook fails the whole run (§4.2) even though the hook's savepoint has
  already rolled back and the engine has appended the entry.
- **The entry append is one statement** — the append, the reporting rows and the
  ledger flip, as data-modifying CTEs — for a GET (no transaction) and inside a
  run alike.
- **`write_back` stays the span name for the commit**, with the same counts,
  now counted as the store writes. A GET and `scripts.query` have no
  `write_back`.
- **A type's records are read `ORDER BY id`**, so step 2's order is already the
  one §5.3 promises without `orderby`.
- **PGlite serialises transactions**: a query waits for an open one. In dev a
  run holds other requests until it ends; the step-1 test of two overlapping
  runs now overlaps them by reading first and writing after the other request
  commits.
- **Scripts.** Of the eight in §4.3, six were one-offs that had served their
  purpose and were **deleted** (the user's call, 2026-09-25; git history keeps
  them): the loaders `load-projects-sample`, `load-pipeline-project`,
  `load-cbs-detail` — which also addressed records by code, ended by the
  2026-09-18 id ruling — and the page writers `project-page`,
  `project-page-location`, `shift-reports-pages`. The two verifiers moved to the
  waiting API and hold their checks in a transaction they roll back, since
  every run now writes as it happens. Neither was run against a database at
  the build.
- **A create failing two checks at once** — one field required and blank,
  another unique and clashing — now reports the required one first, whatever
  the field order (shaping and uniqueness were split so both stores share the
  shaping).

## 13. As built — step 3 (2026-09-25)

What the build chose where §5 left it open, or did differently. Package detail
is in the DSL GRAMMAR §4.5 and DSL_SPEC §9–§10, the engine SPEC (*The Store
contract*, *Per-call quotas*, *The model projected as record types*) and the
server SPEC (*The request model*).

- **Names.** The description is `RecordQuery`, its parts `QueryExpr`
  (`@fluxus/dsl` host.ts); the host method `RecordsHost.query`; the store method
  `WaitingStore.queryRecords` (store type ids, which the bridge's `storeQuery`
  rewrites from the short names); the SQL in `packages/server/src/recordQuery.ts`.
  One static walk, `packages/dsl/src/queryFilter.ts`, says which parts of a
  filter read the row and which cannot become SQL — the save check and the run
  both use it, so their messages are the same words. The §5.3 value rules in
  memory are `queryValues.ts`; the number and date patterns there are shared with
  the SQL.
- **Where the in-memory answer lives.** `MemoryAdapter` has no `queryRecords`;
  over it the evaluator answers the description itself, after laying the
  script's staged writes over the type's records — a host answering on its own
  could not see those. For the same reason a host's `query` is not used while a
  script holds staged writes (no such host exists; the database store writes
  through). `withModelTypes` answers model collections with the exported
  `answerQuery`, the same code.
- **A host that declares no fields keeps the old behaviour** for that type:
  whole type read, filtered by the ordinary rules, quota on the type. Only the
  DSL's own test hosts are like this; every SDM host declares its fields.
- **In memory, only the part that cannot become SQL runs as plain DSL**, per
  row; what encloses it still follows §5.3. (A first cut ran the whole
  enclosing condition as plain DSL, which lost §5.3 for the rest of it; the
  tests caught it.)
- **`date('…')` and the date methods read in UTC inside a filter's worked-out
  parts.** §5.3 says `date('…')` compares as an instant in UTC; the ordinary
  `date()` reads date-only text as local midnight, which on a machine not on
  UTC compared a day's boundary wrongly. Outside a filter they keep today's
  rules (§6).
- **A division by zero inside a run is the DSL's error, not a fault.** Postgres
  aborts a transaction on a failed statement, which would have failed the whole
  run where memory fails only the hook. So inside a run's transaction a
  statement that divides runs under its own savepoint; failing, it rolls back to
  it and answers "Division by zero". Other database errors are faults as before.
- **Where a chain splits.** The database takes `where*`, then one `orderby`,
  then `top`; `.count` / `.first` only when nothing else followed and there was
  no `top`. A second `orderby`, a `where` after `orderby` or `top`, and
  `.top(n).count` run in memory over the answer.
- **Type mismatches are errors in the query**, not refusals: two row parts of
  different types compared (`Cannot compare a text value with a date value`),
  and a date joined to text with `+`. An `iif` whose branches have different
  types is refused at run time as the save check refuses it, even when one
  branch is a worked-out value.
- **Field types.** `photo`, `file`, `geopoint`, `composite` take only `is null`
  (blank: missing, null, `''`, an empty list). A field declared `list` is the
  "list field" of §5.2; no stored model declares one (dev holds text, fk_ref,
  decimal, datetime, photo, time, geopoint). Any other declared type reads as
  text.
- **Collation.** Neon (Postgres 18, `C.UTF-8`) and PGlite (Postgres 17, `C`)
  both order text by code point, as memory does — so ASCII text and ids agree,
  and §5.3's "whatever the locale does" is code-point order on both.
- **Order by id without `orderby` applies in memory too**, model collections
  included: seven engine tests that expected config order, or the old quota
  counted on the whole type, were updated to the rules (six orders, one quota).
- **`24:00` is the next midnight** in memory as in Postgres. The build first
  read it as unfit in memory; the cold test caught the difference, which §5.4
  did not list, and memory was brought into line.
- **Refusal messages name a service in lower case** (`services.time.hoursbetween`)
  — the parser lower-cases identifiers and the walk has no registry to recover
  the declared spelling.
- **The save check over stored models and pages** —
  `packages/server/scripts/check-query-filters.ts`, read-only, migrations off:
  dev (ep-quiet-dust) clean — 4 models, 10 page drafts, 10 published pages, no
  filter refused. **Prod not checked** — the user's call, 2026-09-26: prod is so
  far out of date that it is to be reset, so nothing stored there will survive
  to be refused.
- **Speed in memory**, 50,000 rows, old rules → §5.3 rules: an `and` of two
  comparisons counted 11.3 → 10.2 ms; the same returned as a list 9.3 → 11.9 ms
  (the id sort); a reference followed 13.4 → 11.3 ms; `lower(name) like` 26.0 →
  10.6 ms; `orderby … top(10)` 17.7 → 20.1 ms; a date comparison, an error
  under the old rules, 27.2 ms.
- **Tests at the build:** dsl 345, engine 319, server 384, page-runtime 231,
  runtime 20.
