# @fluxus/sdm — Living Spec

Current design truth for the SDM runtime. Updated in the same commit as any behaviour/design change (see root CLAUDE.md). Point-in-time build history lives in [phases/](phases/). The canonical schema is [SDM_Schema_Reference.md](SDM_Schema_Reference.md) — it wins on any conflict.

## Model

Everything is driven by one config file, [poc_SDM.json](poc_SDM.json) (typed by `src/types.ts`, imported via `src/config.ts`):

- **`attributes`** — standalone, reusable capturable inputs; activities reference them by `attribute_ref`.
- **`recordTypes`** — collections (`rt_<plural>`): custom fields (incl. `fk_ref` with `fk_record_type` / `fk_display_field`), optional constraints (`required`, `unique`, `immutable`, `indexed`), a `workflow_ref`.
- **`workflows`** — one per record type (`wf_<plural>`): ordered activities. One `record_map: CREATE` activity per workflow is the expected pattern; capture activities (no `record_map`) appear in the record-level activity strip.

Records are never edited directly. All mutation flows through activities; each run appends an `ActivityHistoryEntry` (exactly what the user entered). Attribute → custom field mapping is exact-key only; unmatched attributes are intentionally dropped (SDM §1.9.3 rule 2 — not a bug). Custom fields without a matching captured attribute seed from `default`.

Hooks (`before_hook` / `after_hook`) are no-op slots this cut. Fields like `status` change **only** via hooks — do not add a direct write path (SDM §7a). The slots fill with DSL scripts in DSL Phase 2.

## Architecture

```
docs/poc_SDM.json
  └── config.ts (typed import)
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
