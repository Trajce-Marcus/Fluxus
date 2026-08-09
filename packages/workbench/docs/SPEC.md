# @fluxus/workbench — Living Spec

Current design truth for the workbench UI. Updated in the same commit as any behaviour/design change (see root CLAUDE.md).

This package is UI over two contracts it does not own: the **SDM schema** ([`@fluxus/runtime` docs/SDM_Schema_Reference.md](../../runtime/docs/SDM_Schema_Reference.md) — canonical, wins on any conflict) and the **activity pipeline** ([`@fluxus/engine` docs/SPEC.md](../../engine/docs/SPEC.md)). Hook/pipeline doctrine, the pipeline-as-log direction and the compensating-activity ruling live in the [Runtime app's SPEC](../../runtime/docs/SPEC.md) and the engine SPEC, not here.

**History:** the workbench lived inside the SDM package (`@fluxus/sdm`, now `@fluxus/runtime`) through M15, which collapsed the cluster into a mountable `<Workbench>` component and moved it to the Console. It became its own package at the 2026-08-01 restructure — a file move plus a name, no behaviour change. Point-in-time build history for the pre-extraction phases is in [`@fluxus/runtime` docs/phases/](../../runtime/docs/phases/).

## The component contract

```tsx
<Workbench
  client                 // connected @fluxus/client — the scope, injected
  user?                  // ContextUser for ctx.user parity in expressions
  operationId?           // null = none picked
  operations?            // the pickable list
  onSelectOperation?     // omit and the picker hides (host binds the operation itself)
  operationError?        // why the last switch failed — rendered under the control
/>
```

- **The component builds its own engine** from the client it is handed: `createEngine` over `client.adapter` + `client.config`, notify + geo modules, optional `user` for `ctx.user` parity. Rebuilt when the host re-scopes the client.
- **Nothing above `<Workbench>` knows the record state exists.** `WorkbenchContext` holds selected type, selected record, `runActivity` and the adapter reads; the host's shell state stays the host's. That mixing *was* the coupling M15 broke.
- `runActivity` is async: it round-trips `client.runActivity` → server `activities.run` → partition re-fetch, then applies the workbench's UI reactions (deselect a deleted record via the result's `recordId`, console the returned after-hook warnings).
- Two separate gets on type selection, kept separate for the future CQRS split: `getRecordTypeDef(typeId)` (def + workflow → grid columns, CREATE discovery, activity strip) and `getRecordTypeData(typeId)` (instances → grid rows).

**Styling travels in the tree, not in a stylesheet import.** `Workbench.tsx` exports its css as a string and renders `<style>{css}</style>` inside its own subtree (also exported as `workbenchCss` for a host with its own injection channel). A `.css` file import was the first cut and was **wrong**: the Console mounts its shell in a **shadow root**, which a bundler-injected document-level stylesheet never reaches. The failure mode was quiet — the workbench rendered its data as near-black text (`#0f172a`) on the Console's `#1e1e1e` shell with no background of its own, so it read as "no data". Same reasoning as `PageView`'s `<style>{pageRendererCss}</style>`; a `<style>` element applies in both a shadow root and the light DOM. All rules are scoped under `.workbench`. Known cosmetic: the workbench is light and the Console is dark — a themed workbench waits on the branding config (CONSOLE_RUNTIME_SPEC §10).

## UI tree

```
<Workbench client user? operationId? operations? onSelectOperation? /> — src/Workbench.tsx
├── OperationPicker (side menu, above the types — whose data am I looking at)
├── RecordTypeList (its own nav pane — retired from the Runtime shell at M15)
├── RecordsGrid — sort, search, count, CSV import/export, FK links, CREATE launch
└── RecordView — owns back/forward nav state (viewedTypeId derived from record.typeRef)
    ├── AvailableActivities (record-level; CREATE excluded — it has no anchor
    │   record; GET excluded — a query answers an app, not a button on a record)
    ├── RecordDetails (read-only custom fields; FKs via FkDisplay asLink)
    ├── RelatedRecords (reverse-FK index)
    └── ActivityHistoryList
```

**The workbench picks its own operation (ruled 2026-07-31):** the workbench's *model* — record types, workflows, activities — is the solution's; its *records* are one operation's partition, and two operations running the same solution hold entirely different data. That split was invisible while the choice lived in the Console header, so the picker moved into the workbench's side menu, above the record types, and the header's **Data** picker is gone. `operationError` is not optional in practice: the `<select>` is controlled by the *committed* choice, so a re-scope that fails snaps it back to the previous operation and reads as a picker that does nothing — the host catches and passes the reason, which renders under the control. **Nothing is auto-selected** — with no operation the record types still list (they are the model), while the grid and the record pane say *"No operation selected — pick one above"* and no activity can run, because every activity writes into a partition. The choice stays **solution-wide**: the Console remembers it at `fluxus:page-builder:workbench-operation:<solutionId>` and the page preview reads the same one, so Console and Runtime never disagree about what exists (the M9 ruling, CONSOLE_RUNTIME_SPEC §3).

**Schema Navigator:** org-chart-style record-type relationship viewer — focal type centred, FK targets one side, reverse FKs the other, click to recentre; launched from the RecordView header.

**Panel layout** (July 2026 UX pass): each content panel is a fixed `panel-header` strip over a scrolling `panel-body`, so the grid toolbar and the record header stay pinned; the grid's column headers are additionally `position: sticky` inside the scrolling body (which requires `border-collapse: separate` — collapsed borders don't stick). The picker dialog reuses RecordsGrid without this structure (`pickerMode`).

**CREATE selects its record:** after a successful Insert-row CREATE, the grid selects the new record via `RunActivityResult.recordId` (clearing any search filter that would hide it) and scrolls its row into view; the detail view follows the selection. CSV import deliberately leaves selection alone.

**CSV/JSON export** (`src/export.ts`): flattens record instances against their custom field defs.

## FluxScript wiring (DSL Phase 1)

The workbench executes FluxScript (see `packages/dsl`) for the attribute features below. Evaluation plumbing — `buildDslSchema` / `buildRecordsHost` / `buildEvalHost` / `coerceCaptured` / `joinScript` — lives in `@fluxus/engine`.

- **`show_condition`** on an activity's attribute usage (e.g. `"attributes.city is not null"`): evaluated live in AttributesForm; hidden attributes are excluded from submission. Evaluation errors leave the attribute visible (a broken condition must never make an input unreachable — the activity-level availability gate deliberately does the opposite and fails closed).
- **`required`** on an activity's attribute usage: blocks submission until captured (inline banner + `*` on the label). Per-usage, not per-attribute — a shared attribute can be optional in one activity and mandatory in another. Hidden attributes are exempt by construction.
- **`validation`** (+ optional `validation_message`) on a usage or attribute def (usage wins): a FluxScript rule that must evaluate `true` for the captured value, with the value injected as the extra root `value` — e.g. `"value <= now()"` on completed_date. Runs on submit for visible, non-empty attributes (empties are `required`'s job). Captured strings are **type-coerced** first (`date`/`int`/`bool` per the attribute's type; `coerceCaptured` in the engine's bridge), which also types `attributes.*` in show conditions and datasources. Date attributes render as native date inputs.
- **`can_waive`** on an activity's attribute usage: the user may declare the value unavailable — a **"Can't provide"** toggle replaces the input with a mandatory reason box. No fake data is entered to satisfy `required`. The waiver is stored on the history entry as `waived: { <key>: <reason> }` (presence of the key is the flag; only waived attributes appear), kept out of `capturedAttributes`. Waived attributes never write to record fields: on CREATE the field seeds from its default, on UPDATE the existing value is untouched ("can't provide it now" must never blank last month's value). Scripts see the attribute as null. Show conditions and hooks handle *predictable* branching; waivers absorb the unpredictable physical realities of data entry — and being recorded data (not silence or garbage), they can later power a data-gaps worklist. Sample: `serial_no` on `act_create_assets`.
- **`List` attributes** (`type: "list"`): `type_config.datasource` is a FluxScript expression yielding a list; `key_field`/`display_field` map items to options. Current form values are injected as `attributes` (empty strings read as null), so dependent pickers (city → suburb) re-evaluate as values change; stale selections self-clear.
- **Composite attributes and sections** (2026-07-18): a composite renders as its question label with sub-attribute inputs stacked beneath (per-cell required/waive/show_condition); section markers render as headings with their description. Cell state is flat in the form (`attr.sub` keys); the engine owns nesting (see engine SPEC and SDM_Schema_Reference §1.5). **ActivityCard displays entry attributes in activity-definition order** — the stored entry is jsonb (key order not preserved), so the definition is the ordering truth; composite values display one row per cell under the dotted `attr.sub` key, unknown keys (system_log, hook extras) after.

## Attribute widgets: files, photos & scalars (2026-07-18)

`components/attributeWidgets.tsx` holds the capture + display widgets for the
file/photo/scalar types (ATTRIBUTE_TYPES_FILES_SCALARS §10). Every widget is a
**pure controlled component**: value in, `onChange` out, config as props, the
upload service injected — **zero imports from this package's stores/context**.
That is deliberate: when the page builder becomes the second consumer they lift
to `@fluxus/attribute-widgets` unchanged (restructure step 2 — not yet done;
page-runtime currently carries a hand-cut subset copy). `AttributesForm` is the
composer that pulls `uploads` from context and passes it down; the widgets stay
context-blind.

- **Capture**: `PhotoInput` (messenger-style thumb grid + add tile, per-thumb
  remove, single or multi), `FileInput` (paperclip rows + add), `TextAreaInput`
  (`multiline` text), `DateTimeInput` (native picker; stamps the local offset,
  §1), `TimeInput`, `NumberInput` (int step 1 / decimal step from
  `decimal_places`). `ScalarInput` routes an attribute/cell to the right one;
  `reference`/`list` keep their existing picker/datasource widgets.
- **Display**: `PhotoThumbs`, `FileChips` (history + record details),
  `PhotoCountCell` (grid cell: first thumbnail + count badge). All resolve
  presigned GET URLs lazily through the injected service.
- **Form state** is `Record<string, unknown>`: scalars stay strings, but
  file/photo attributes hold descriptor objects (arrays when `multi`). The
  `isBlank` engine helper is the shared emptiness test (required / validation).
- **Upload service** is `client.uploads` (the `@fluxus/client` UploadService),
  memoised once in `WorkbenchContext` and injected via context; scope is pre-bound so
  widgets stay scope-blind. The full hash → EXIF → thumbnail → presign →
  direct-to-R2 PUT flow lives in `@fluxus/client` (client SPEC), not here.
- **Descriptor rendering** on records/history keys off the value shape
  (`isDescriptorValue`): a bag with a `storage_key` renders as thumbs/chips
  instead of `[object Object]`. Custom fields stay dumb storage — a photo maps
  to a field only by exact-key, else it lives in history alone.

## Services (DSL Phase 3)

`WorkbenchContext` composes two service modules (DSL_SPEC §7a) into its engine, registered with both the evaluator and the validator:

- **`notify`** (effect) — `user(message)` and `email(to, subject, body)`, landing in this package's `NotificationLog` (`src/store/NotificationLog.ts`, localStorage-backed, capped at 200, subscribe pattern).
- **`geo`** (read) — `suburbsOf(city)`: suburb records for a city id, ordered by name, over whatever city/suburb records the operation holds (nothing until they are created — the SDM ships no records since seeds were removed 2026-08-05). Backs the suburb `List` datasource (`services.geo.suburbsOf(attributes.city)`), so the city → suburb dependent picker exercises a service call end to end. The implementation lives in `@fluxus/engine` (Store-backed and host-agnostic — the workbench imports `buildGeoModule`).

**The workbench's notify sink is dormant, deliberately.** Hooks (and their `queue services.notify.*`) execute server-side since backend stage 2, where the sink is the process console — nothing reaches this log, and no workbench surface lists notifications. It stays wired so the manifest validates and the DSL keeps type-checking. The Runtime app has its **own** copy of `NotificationLog` + `notify` behind its shell bell, which *is* read; the two were one file while the workbench lived inside that package and split at the extraction because they are different things — a dormant stub here, a live shell feature there. The unified-log design (pipeline-as-log, see the Runtime SPEC) replaces both with a server-side log; neither is worth sharing until then. The `fluxus:sdm:notifications` storage key is unchanged from the pre-extraction file on purpose — renaming it is a storage change, not a package move.

`validateConfig` passes the registry, so the shipped config is checked strictly: unknown service modules/functions, wrong arity, and effect calls outside after hooks are startup errors.

## Next

1. Activity run/test console — a UI to invoke *any* activity type headlessly (pick activity → enter parameters → see gate/warnings/result/history), independent of the record view; becomes the natural home for GET activities when they land.
2. Toast/banner slot for after-hook `warn()`s (currently console-only; before-hook warnings already prompt Continue/Cancel).
3. Data-gaps worklist — records with waived (`can_waive`) attributes and their reasons, so known-missing values get chased.
4. A themed workbench (branding config, CONSOLE_RUNTIME_SPEC §10) — today it is light chrome inside the Console's dark shell.
