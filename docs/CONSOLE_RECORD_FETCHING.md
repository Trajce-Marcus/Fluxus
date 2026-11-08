# The Console fetches records the way the Runtime does — spec

**Status: BUILT 2026-11-09.** Written 2026-11-08, cold-reviewed the same day,
revised 2026-11-09 with the review's findings and the user's rulings
(*Rulings*, at the end), built the same day. Not yet cold-tested.

## What this changes, in one paragraph

Today the Console's workbench fetches **every record in the operation** when it
connects (`records.partition`), and fetches them all again after every activity
run. The Runtime stopped doing this on 2026-08-16: it connects with no records
and fetches each record it needs by id, with what that record points at. This
work moves the Console onto the same approach. Each screen fetches only what it
shows, holds it while the screen is open, and lets go when it closes.
`records.partition` is removed from the server. Nothing anywhere then fetches a
whole operation.

## Rulings this spec rests on

- **The whole-operation fetch should never happen** (the user, 2026-10-17;
  SERVER_DATA_LOADING §6, APPS_AND_INSTANCES §2.12 #2). Removing it from the
  Console was a to-do for a later session; this is that session.
- **The Console follows the Runtime's approach to fetching records** (the user,
  2026-11-08).
- **"The browser holds no records" and "the browser evaluates the model
  locally" cannot both be true** (DATA_THROUGH_ACTIVITIES step 5). The Runtime
  already lives with the first; this work brings the Console to it. §5 is what
  that costs.

## 1. What reads the client's local copy today

Measured in code, 2026-11-08, and completed by the cold review. Everything
below reads the client's local copy (`MemoryAdapter`), which in the Console
holds the whole operation.

| Where | What it reads | File |
| --- | --- | --- |
| Workbench record list, and the record picker in a form | every record of one type | `RecordsGrid.tsx:113` (`getRecordTypeData`); the picker is a `RecordsGrid` with a `typeId` prop (`RecordPickerDialog.tsx`) |
| Workbench record view | the selected record, then whichever record the user moved to (a reference, a related row, back, forward) | `WorkbenchContext.tsx:243-245`; `RecordView.tsx:58-97,129-133` |
| Reference labels | the record a reference points at, for its display field | `FkDisplay.tsx:14`, `RecordsGrid.tsx:436-440`, `RecordDetails.tsx:42-47`, `RelatedRecords.tsx:122-124`, capture form `AttributesForm.tsx:156-163` |
| Related records panel | records of another type whose reference field holds this record's id | `RelatedRecords.tsx:20` (`getRecordsByField`) |
| DSL Editor | the record a test script runs against, for display | `DslEditorView.tsx:283-288` |
| After every activity run | the whole operation again | `client/src/index.ts:1033-1037` (`refresh`) |
| Browser-evaluated expressions | `records.*` in field show conditions, field `source` and `validation`, inline datasources, page props in the page editor's preview | engine `buildRecordsHost` over the local copy |
| The suburbs lookup | `services.geo.suburbsOf` | `WorkbenchContext.tsx:117` → `engine/src/services/geo.ts:26` |

Not affected: which record types reference a type (`getReverseRefs`) comes from
the model. The DSL Editor runs scripts on the server (`scripts.query`). Which
activities a record offers is decided by the server (`page.activities`).
Composite cells cannot hold references (`validateModel.ts:221`), so labels need
not cover them.

## 2. What the server sends

- **`records.partition` is deleted.** The tests that use it only to probe a
  gate that stays (`opusers.test.ts`, `admintiers.test.ts`, `rbac.test.ts`,
  `apps.test.ts`, `query.test.ts`) are pointed at `records.list` or
  `records.get`, not deleted.
- **`records.list`** keeps its gate (a call with no app, by an operation admin;
  never the operation's apps) and changes in three ways:
  - **No activity history on its rows.** Each row's `activityHistory` is `[]`.
    The list does not show history; the record view fetches by id, which
    brings it.
  - **An optional filter, `fieldKey` and `value`:** only the rows whose custom
    field `fieldKey` equals `value`, compared as text
    (`custom_fields->>fieldKey = value`, the style of `databaseStore.ts:301`).
    `fieldKey` must be a reference field (`fk_ref`) of `typeId`; any other is
    refused. It serves the related records panel.
  - **Labels beside its rows.** For each reference field of the type
    (`fk_ref` with `fk_record_type` and `fk_display_field`), and each row
    holding an id in it, the label is the referenced record's
    `fk_display_field`. One query over all the referenced ids, in the
    `inArray` style of `referencedRecords`. No label is sent for a reference
    to a missing record, to a record of another type than the field names,
    or to an operation's app (never handed out as a record, `router.ts:229-231`).
    The answer becomes `{ rows, labels }`, a label being
    `{ id, typeRef, field, label }`.
- **`records.get`** is unchanged: the record, its history, what it points at
  two levels deep, and what it points at that may not be read.

## 3. What the client holds

- **The `records` connect option is removed.** There is one behaviour,
  today's `'none'`: connect fetches no records. `connectSolution` stops
  fetching the partition; the Runtime stops passing the option.
- **The client keeps what it fetched, entry by entry:**
  - each record fetched by id, with the references and withheld ids that came
    with it;
  - each list fetched (type, plus `fieldKey` and `value` for a filtered one),
    with its rows and labels.
- **The local copy is rebuilt from those entries** whenever one changes: a
  fetch, a refresh, a release. It is the union of every entry, through
  `MemoryAdapter.replaceRecords`. A fetch that lands while a refresh is running
  updates its own entry, so the refresh cannot wipe it.
- **Holding and letting go.** `fetchRecord(id)` and `fetchRecords(typeId,
  filter?)` hold what they fetch. `releaseRecord(id)` and
  `releaseRecords(typeId, filter?)` let go. Each entry counts its holders and
  is dropped when the count reaches none. The Runtime never releases (its
  pages hold their records for the session, as today); the workbench releases
  when a screen closes or moves on.
- **`isRecordFetched(id)`** says whether a record is held by id, in full, as
  opposed to only as a list row or a reference. The record view waits on it.
- **`refresh`** after an activity run fetches every entry again, in parallel:
  one `records.get` per record held by id, one `records.list` per list held.
  A record the server answers is gone or not readable leaves the local copy
  but keeps its holders; any other failure keeps the last copy; a record still
  on its first fetch is left to it. *Cold test 2026-11-09: the first build
  dropped the entry on any failure, a lost connection included, and could drop
  a fetch still in flight; a release now lets go of its own entry only.*
- **`fetchRecords` is the Console's.** `records.list` is for operation admins
  with no app, so it cannot serve Runtime users; the client SPEC and
  `index.ts:113` stop saying the Runtime fills through it.

## 4. The engine and the workbench

- **Labels live in `MemoryAdapter`.** `replaceRecords` takes the labels with
  the records and withheld ids, and replaces them too.
  `resolveDisplayLabel(fkRecordType, fkDisplayField, rawId)` answers from a
  held record first (as today), then from a held label whose `typeRef` and
  `field` match the ones asked for, then the raw id. The components do not
  change.
- **The record list** (`RecordsGrid`) fetches the type it shows, whether that
  came from selecting a type or from the picker's `typeId` prop, and releases
  it when it closes or the type changes. It tells *loading*, *failed* and
  *loaded* apart; an unfetched type and an empty one no longer look the same.
  Its search keeps filtering in the browser over the rows fetched.
- **The record view fetches by id whenever the record it shows changes:**
  selecting from the list, selecting after a create (`selectRecordById`),
  following a reference, clicking a related row, back and forward. It releases
  the record it moves away from. Until `isRecordFetched` is true it shows a
  loading state, and **no form opens** until then: a list row brings labels,
  not the records its references point at, and a form's expressions may follow
  them (`context.record.project_id.wbs_status`). The silent fall-back to the
  selected record on a miss (`RecordView.tsx:132-133`) goes; a record that
  cannot be fetched says so.
- **The related records panel** fetches, for each reverse reference the model
  lists, `fetchRecords(sourceTypeId, { fieldKey, value: recordId })` for the
  record on screen, and releases them when it moves on.
- **The DSL Editor's test record** is fetched by id once the author stops
  typing (a short pause), replacing the one held before. A record not found
  says so beside the field.
- **After a model save** the Console builds a new client
  (`reloadSolution` → `connectSolution`); the screens fetch again into it, as
  they would on first opening.

## 5. Browser expressions that read records

A browser expression that reads `records.*` reads the local copy. Without the
partition, it sees only what the open screens hold, so its answer depends on
what the user has open. The Runtime already behaves this way; the Console
starts to.

Measured on the dev database, 2026-11-08:

- **Activity show conditions:** decided by the server, so unaffected (four in
  the projects solution read records).
- **Field show conditions:** six, all in the projects solution's
  `act_modify_wbs_nodes` (attributes 4–9), for example
  `records.wbs_nodes.where(parent_id = context.record.id and expired <> 'true').count = 0`.
  They show or hide fields according to whichever WBS nodes happen to be held.
  **Deferred (the user, 2026-11-09):** a known issue in the projects solution,
  already wrong in the Runtime. A field show condition cannot call `invoke`
  (`AttributesForm.tsx:212-215`; the evaluator refuses it), so rewriting them
  over a GET is not possible. The fix discussed — a "leaf" field on the WBS
  node kept by the Create, Move and Delete hooks — is parked with it.
- **Inline datasources:** two, both in `demo/sdm` (`city`, `demo_city_list`),
  and the `demo/sdm` suburbs lookup. Left as they are.
- **Field `source` and `validation`:** none read `records.*` (measured
  2026-11-09).
- **Page props:** `validatePage` already warns on one that reads records
  directly. The page editor's preview now shows such a prop as the Runtime
  does — empty.

## 6. Not in this work

- **Paging the list.** A type's list is still every record of that type.
  Measured: the largest dev operation holds 1,437 records across all types.
- **Server-side search** for the list.
- **A model-save warning** for browser-run expressions that read `records.*`,
  as `validatePage` gives for page props. Raised 2026-11-09, not taken up.
- **The DSL Editor's raised limits.** The comment at engine
  `bridge.ts:427-433` ("its host has already loaded the whole partition") is
  corrected; the limits themselves are not changed.

## 7. Docs updated with the build

SERVER_DATA_LOADING §6 (the to-do closed); DATA_THROUGH_ACTIVITIES step 5
(complete) and §6 (the admin-inspection note); APPS_AND_INSTANCES `:915` and
§2.12 #2; BLUEPRINT "Loading only what a request needs" (the "Not built"
line); ARCHITECTURE; ROADMAP `:16`; RECORD_READ_CONDITIONS §4 (the
`records.partition` row goes, the `records.list` row gains labels) and its
cost note; the client, engine, workbench, page-runtime, runtime, server and
console SPECs where they describe the partition, and DSL_EDITOR_SPEC
`:427-431`; the client, runtime and server READMEs; the `scripts.query`
comment at `router.ts:1416-1422`.

## 8. Tests

- **Server:** `records.partition` is gone; `records.list` rows carry no
  history; its labels (present, missing target, wrong type, an app record);
  the filter returns only matching rows and refuses a field that is not a
  reference of the type; the gate refuses an app caller and a non-admin. The
  gate tests that used `records.partition` keep their checks through
  `records.list` / `records.get`.
- **Engine:** `resolveDisplayLabel` answers from a held label only when type
  and field match; `replaceRecords` replaces labels.
- **Client:** connect fetches no records; fetch and release count holders;
  `refresh` fetches each entry once and drops what no longer comes back; a
  fetch landing during a refresh survives it; `isRecordFetched`.
- **Workbench:** no test harness exists for it and none is added. Its
  fetching goes through the client, which is where it is tested.

## Rulings (2026-11-08/09)

- **Labels only** for references in a list, not whole referenced records (the
  user, on Claude's recommendation).
- **The six WBS field show conditions are deferred** (the user).
- **What a screen fetched is let go when the screen closes; the filter is
  `fieldKey`/`value`, limited to reference fields; list rows carry no history;
  the fetching is tested in the client package** — Claude's recommendations,
  the user's "do everything else".
