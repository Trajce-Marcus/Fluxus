# @fluxus/sdm — Living Spec

Current design truth for the SDM runtime. Updated in the same commit as any behaviour/design change (see root CLAUDE.md). Point-in-time build history lives in [phases/](phases/). The canonical schema is [SDM_Schema_Reference.md](SDM_Schema_Reference.md) — it wins on any conflict.

## Model

Everything is driven by one logical config (typed by `src/types.ts`), stored split for hand-editing in `packages/sdm/config/` — `attributes.json` and `functions.json` (shared pools) plus `entities/<name>.json` (record type + its workflow, always a pair) — and merged into one `ConfigRaw` by `src/config.ts`. The split is POC-era convenience; the endgame is the SDM in a database edited through UI. Collections:

- **`attributes`** — standalone, reusable capturable inputs; activities reference them by `attribute_ref`.
- **`recordTypes`** — collections (`rt_<plural>`): custom fields (incl. `fk_ref` with `fk_record_type` / `fk_display_field`), optional constraints (`required`, `unique`, `immutable`, `indexed`), a `workflow_ref`.
- **`workflows`** — one per record type (`wf_<plural>`): ordered activities. One `record_map: CREATE` activity per workflow is the expected pattern; capture activities (no `record_map` — log-only unless hooks act) appear in the record-level activity strip. `record_map: "GET"` (query activities: attributes = parameters, `returns` expression = response, never mutates, logged with duration/outcome) is specified in the DSL spec §5a and lands with Phase 2+.

Records are never edited directly. All mutation flows through activities; each run appends an `ActivityHistoryEntry` (exactly what the user entered). Attribute → custom field mapping is exact-key only; unmatched attributes are intentionally dropped (SDM §1.9.3 rule 2 — not a bug). Custom fields without a matching captured attribute seed from `default`.

Hooks (`before_hook` / `after_hook`) are FluxScript scripts (DSL Phase 2; string or array-of-lines in the JSON, joined on load). Fields like `status` change **only** via hooks — do not add a direct write path (SDM §7a); `act_complete_work_orders` is the pattern: no `record_map`, the after hook moves the status.

## FluxScript wiring (DSL Phase 1)

The workbench executes FluxScript (see `packages/dsl`) for two attribute features:

- **`show_condition`** on an activity's attribute usage (e.g. `"attributes.city is not null"`): evaluated live in AttributesForm; hidden attributes are excluded from submission. Evaluation errors leave the attribute visible (a broken condition must never make an input unreachable).
- **`required`** on an activity's attribute usage: blocks submission until captured (inline banner + `*` on the label). Per-usage, not per-attribute — a shared attribute can be optional in one activity and mandatory in another. Hidden attributes are exempt by construction.
- **`validation`** (+ optional `validation_message`) on a usage or attribute def (usage wins): a FluxScript rule that must evaluate `true` for the captured value, with the value injected as the extra root `value` — e.g. `"value <= now()"` on completed_date. Runs on submit for visible, non-empty attributes (empties are `required`'s job). Captured strings are **type-coerced** first (`date`/`int`/`bool` per the attribute's type; `coerceCaptured` in bridge.ts), which also types `attributes.*` in show conditions and datasources. Date attributes render as native date inputs.
- **`can_waive`** on an activity's attribute usage: the user may declare the value unavailable — a **"Can't provide"** toggle replaces the input with a mandatory reason box. No fake data is entered to satisfy `required`. The waiver is stored on the history entry as `waived: { <key>: <reason> }` (presence of the key is the flag; only waived attributes appear), kept out of `capturedAttributes`. Waived attributes never write to record fields: on CREATE the field seeds from its default, on UPDATE the existing value is untouched ("can't provide it now" must never blank last month's value). Scripts see the attribute as null. Show conditions and hooks handle *predictable* branching; waivers absorb the unpredictable physical realities of data entry — and being recorded data (not silence or garbage), they can later power a data-gaps worklist. Sample: `serial_no` on `act_create_assets`.
- **`List` attributes** (`type: "list"`): `type_config.datasource` is a FluxScript expression yielding a list; `key_field`/`display_field` map items to options. Current form values are injected as `attributes` (empty strings read as null), so dependent pickers (city → suburb) re-evaluate as values change; stale selections self-clear.

## Hooks (DSL Phase 2)

`runActivity` (AppContext) is the pipeline: **before hook → record_map mapping → activity history append → after hook**.

- **Before hook** — the gate. Runs with the captured attributes (type-coerced) before anything persists, in read-only mode: mutations and `queue` are rejected statically and at run time. `fail('msg')` rejects the submission with that message in the form; a runtime error in the hook also blocks (a broken gate must not wave submissions through). `warn('msg')` is a **soft stop**: `runActivity` returns `needs-confirmation` with the messages and persists nothing; the form locks its fields, shows the warnings with **Continue anyway / Cancel**, and Continue re-submits the *frozen snapshot* that was validated (edited values can never ride through on an acknowledged submit). CSV bulk import acknowledges warnings up front; `fail` still rejects rows. **Acknowledged gate warnings are recorded on the activity history entry** (`warnings` field — "warned X, continued anyway" is audit), kept separate from `capturedAttributes`, which stays exactly what the user entered. When the backend lands, the same gate re-runs server-side authoritatively with the same protocol.
- **After hook** — the effects. Runs after the activity persists, with `context.record` refreshed to the target record (the created record for CREATE). Mutations stage during the run and commit atomically via the adapter; `queue`d service calls dispatch only after the commit (services registry itself is Phase 3). A failing after hook applies no changes; the thrown message says the activity was recorded but nothing applied. After-hook `warn`ings are informational (the commit already happened): console only, until the workbench grows a toast slot. DELETE activities run only the before hook.
- **Staging seam** — the adapter splits its writes for the transaction: `buildRecord`/`insertRecord` (createRecord ≡ both) and `validateUpdate`/`updateRecord`, so hooks validate constraints at staging time and persist on commit. Script `Date` values serialize to `YYYY-MM-DD` (local midnight) or full ISO strings.
- **Named functions** — `config/functions.json`, bodies as array-of-lines (joined on load); callable from every scripted surface. Config validation enforces the governance floor: mandatory description, flat namespace, declared name matches the entry.

Acceptance (in `test/dsl-wiring.test.ts`): `act_complete_work_orders` — before hook fails when already Completed and warns when never started; after hook sets `status`/`completed_date` via the staged commit.

Plumbing (`src/dsl/`):
- `bridge.ts` — `buildDslSchema(config)` (validator schema; short type names, `rt_` stripped), `buildRecordsHost(adapter, config)` (evaluator store adapter incl. FK targets, reverse refs, and the `mutate` staging surface), `buildEvalHost(...)` (the four roots + named functions; `context.user` is a demo stub until auth), `joinScript`/`resolveFunctions` (array-of-lines → source).
- `validateConfig.ts` — validates every datasource, show_condition, validation rule, hook (before hooks in gate mode), and named function against the schema at app start ("config-save time" while the SDM is file-edited); diagnostics go to the console. Covered by `test/dsl-wiring.test.ts`.

**Seeds:** an entity file may carry `seeds` (sample records); the adapter loads them only when the store has no records of that type. Cities/suburbs ship seeded so the location picker works out of the box.

## Architecture

```
config/{attributes,functions}.json + config/entities/*.json
  └── config.ts (merges to one typed ConfigRaw)
        └── store/LocalStorageAdapter (seeds defs; loads/persists records; pub/sub;
              enforces field constraints on CREATE/UPDATE; key 'fluxus:sdm:records')
              └── context/AppContext (singleton adapter; subscribe → tick → re-render;
                    selection state; runActivity pipeline:
                    before hook → record_map → history → after hook)
                    └── components read via useAppContext()
```

- `store/interface.ts` is the seam: swapping localStorage for the real backend (tRPC + Neon per root ARCHITECTURE.md) is a one-file adapter change.
- Two separate gets on type selection, kept separate for the future CQRS split: `getRecordTypeDef(typeId)` (def + workflow → grid columns, CREATE discovery, activity strip) and `getRecordTypeData(typeId)` (instances → grid rows).
- `runActivity` is the embryo of the shared activity engine (see root ARCHITECTURE.md) — it will be extracted once the page builder also drives activities.

## UI

```
Header ("Fluxus SDM / Aber sample")
├── Side panel — RecordTypeList
└── Content
    ├── RecordsGrid — sort, search, count, CSV import/export, FK links, CREATE launch
    └── RecordView — owns back/forward nav state (viewedTypeId derived from record.typeRef)
        ├── AvailableActivities (record-level; CREATE excluded — it has no anchor record)
        ├── RecordDetails (read-only custom fields; FKs via FkDisplay asLink)
        ├── RelatedRecords (reverse-FK index)
        └── ActivityHistoryList
```

Schema Navigator: org-chart-style record-type relationship viewer — focal type centred, FK targets one side, reverse FKs the other, click to recentre; launched from the RecordView header.

## Naming conventions

Collections are plural: `rt_<plural>` / `wf_<plural>` / plural display names. Activity IDs `act_<verb>_<plural>`; activity display names singular (they act on one record). Rationale: types and workflows name collections; an activity acts on an instance.

## Adding a record type

Add a workflow (with one CREATE activity) and a record type (`workflow_ref` pointing at it) to the config. Rules: attribute keys matching custom field keys are written on create; unmatched dropped; unmatched fields seed from `default`; constraints enforced by the adapter.
