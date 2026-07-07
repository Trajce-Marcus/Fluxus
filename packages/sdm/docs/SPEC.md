# @fluxus/sdm — Living Spec

Current design truth for the SDM runtime. Updated in the same commit as any behaviour/design change (see root CLAUDE.md). Point-in-time build history lives in [phases/](phases/). The canonical schema is [SDM_Schema_Reference.md](SDM_Schema_Reference.md) — it wins on any conflict.

## Model

Everything is driven by one logical config (typed by `src/types.ts`), stored split for hand-editing in `packages/sdm/config/` — `attributes.json` and `functions.json` (shared pools) plus `entities/<name>.json` (record type + its workflow, always a pair) — and merged into one `ConfigRaw` by `src/config.ts`. The split is POC-era convenience; the endgame is the SDM in a database edited through UI. Collections:

- **`attributes`** — standalone, reusable capturable inputs; activities reference them by `attribute_ref`.
- **`recordTypes`** — collections (`rt_<plural>`): custom fields (incl. `fk_ref` with `fk_record_type` / `fk_display_field`), optional constraints (`required`, `unique`, `immutable`, `indexed`), a `workflow_ref`.
- **`workflows`** — one per record type (`wf_<plural>`): ordered activities. One `record_map: CREATE` activity per workflow is the expected pattern; capture activities (no `record_map`) appear in the record-level activity strip.

Records are never edited directly. All mutation flows through activities; each run appends an `ActivityHistoryEntry` (exactly what the user entered). Attribute → custom field mapping is exact-key only; unmatched attributes are intentionally dropped (SDM §1.9.3 rule 2 — not a bug). Custom fields without a matching captured attribute seed from `default`.

Hooks (`before_hook` / `after_hook`) are no-op slots this cut. Fields like `status` change **only** via hooks — do not add a direct write path (SDM §7a). The slots fill with DSL scripts in DSL Phase 2.

## FluxScript wiring (DSL Phase 1)

The workbench executes FluxScript (see `packages/dsl`) for two attribute features:

- **`show_condition`** on an activity's attribute usage (e.g. `"attrs.city is not null"`): evaluated live in AttributesForm; hidden attributes are excluded from submission. Evaluation errors leave the attribute visible (a broken condition must never make an input unreachable).
- **`required`** on an activity's attribute usage: blocks submission until captured (inline banner + `*` on the label). Per-usage, not per-attribute — a shared attribute can be optional in one activity and mandatory in another. Hidden attributes are exempt by construction.
- **`List` attributes** (`type: "list"`): `type_config.datasource` is a FluxScript expression yielding a list; `key_field`/`display_field` map items to options. Current form values are injected as `attrs` (empty strings read as null), so dependent pickers (city → suburb) re-evaluate as values change; stale selections self-clear.

Plumbing (`src/dsl/`):
- `bridge.ts` — `buildDslSchema(config)` (validator schema; short type names, `rt_` stripped), `buildRecordsHost(adapter, config)` (evaluator store adapter incl. FK targets and reverse refs), `buildEvalHost(...)` (the four roots; `ctx.user` is a demo stub until auth).
- `validateConfig.ts` — validates every datasource and show_condition against the schema at app start ("config-save time" while the SDM is file-edited); diagnostics go to the console. Covered by `test/dsl-wiring.test.ts`, whose acceptance case is the city → suburb dependent datasource.

**Seeds:** an entity file may carry `seeds` (sample records); the adapter loads them only when the store has no records of that type. Cities/suburbs ship seeded so the location picker works out of the box.

## Architecture

```
config/{attributes,functions}.json + config/entities/*.json
  └── config.ts (merges to one typed ConfigRaw)
        └── store/LocalStorageAdapter (seeds defs; loads/persists records; pub/sub;
              enforces field constraints on CREATE/UPDATE; key 'fluxus:sdm:records')
              └── context/AppContext (singleton adapter; subscribe → tick → re-render;
                    selection state; runActivity pipeline with before/after slots)
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
