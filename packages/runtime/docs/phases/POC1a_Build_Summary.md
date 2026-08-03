# POC1·a — What was built, how, and why

> Hand this to a new session alongside `SDM_Schema_Reference.md` and `sample_inspection_type.json`.  
> The canonical model is the SDM — it wins on any conflict.

---

## 1. Status

POC1·a is **complete and running** (`npm run dev` in `packages/aber-poc/`).  
It proves: list record types → create via CREATE activity → run capture activities → view history.

**Still on the POC1 ledger (not dropped, not done):**
- Hooks actually firing (slots exist, bodies are no-ops)

---

## 2. What was built

### Layout
```
Header ("Aber / POC1·a")
├── Side panel     — RecordTypeList
└── Content
    ├── Left panel — RecordsGrid + CREATE launch control
    └── Right panel — RecordView
                       ├── AvailableActivities (activity buttons → modal form)
                       ├── RecordDetails (read-only custom fields)
                       └── ActivityHistoryList (ActivityCard per entry)
```

### File structure
```
src/
  types.ts                       SDM config types + runtime types
  config.ts                      Imports docs/sample_inspection_type.json
  utils/
    export.ts                    Generic CSV / JSON export (reusable)
  store/
    interface.ts                 Store interface (the seam for adapter swaps)
    LocalStorageAdapter.ts       localStorage implementation; pub/sub for React
  context/
    AppContext.tsx                Adapter singleton, selection state, runActivity pipeline
  components/
    RecordTypeList.tsx
    RecordsGrid.tsx              Sort, search, count, export, FK links, CREATE launch control
    AttributesForm.tsx           Form fields; FK attributes use RecordPickerDialog
    RecordPickerDialog.tsx       Modal wrapper around RecordsGrid for FK selection
    FkDisplay.tsx                Reusable FK display — resolves display label; asLink prop enables navigation
    Modal.tsx                    Generic modal — title + children + onClose + Escape
    RecordView.tsx               Owns back/forward navigation state; passes viewed record to children
    RecordDetails.tsx            Read-only custom fields; FK fields rendered via FkDisplay (asLink)
    ActivityHistoryList.tsx
    ActivityCard.tsx
    AvailableActivities.tsx      Record-level only; CREATE excluded
```

---

## 3. How data flows

```
docs/sample_inspection_type.json
  └── config.ts (typed import)
        └── LocalStorageAdapter (constructor seeds recordTypes + workflows; loads records from localStorage)
              └── AppContext (module-level singleton adapter)
                    ├── adapter.subscribe() → setTick → forces re-render on mutations
                    ├── selectRecordType() → setSelectedTypeId + clears record selection
                    ├── selectRecord()     → setSelectedRecordId
                    └── runActivity()      → CREATE / UPDATE / appendActivity → notify() → saveRecords()
                          └── Components read via useAppContext()

RecordView owns local nav state (viewedTypeId / viewedRecordId / backStack / forwardStack).
viewedTypeId is derived from selectedRecord.typeRef — RecordView always shows the correct type
regardless of which type is selected in the sidebar.
```

**Two separate gets on type selection** (§5.2 — kept separate because they diverge later across the CQRS split):
1. `getRecordTypeDef(typeId)` → type def + its workflow (drives grid columns + CREATE discovery + activity strip)
2. `getRecordTypeData(typeId)` → record instances (drives grid rows)

---

## 4. Key design decisions and why

| Decision | Why |
|---|---|
| CREATE discovered by walking the selected type's workflow | No anchor record exists yet — selection supplies the target type |
| CREATE lives in the grid, not the activity strip | Record-level activities need an anchor; CREATE has none — mixing them would require a selected record to create a record |
| Attribute → custom field mapping is exact-key only; unmatched attributes silently dropped | Activities may capture more than maps to fields (e.g. `notes` on Raise). SDM §1.9.3 rule 2. **Do not treat as a bug.** |
| `status` stays "Raised" permanently this cut | Only hooks update custom fields; hooks are stubbed. **Do not add a direct write path.** SDM §7a. |
| `runActivity` pipeline has before/after slots as no-ops | Staging hooks later fills slots rather than re-architecting the call |
| `Store` interface + swappable adapter | One-file swap when moving to tRPC/DynamoDB |
| `LocalStorageAdapter` pub/sub + `setTick` in AppContext | Adapter mutations notify React; AppProvider re-renders and re-derives all context values from the adapter — no stale data. Records persist across page refreshes; clear with `localStorage.removeItem('aber-poc-v1-records')`. |
| `Modal.tsx` is generic | Takes `title`, `onClose`, `children` — reusable for any form or confirmation dialog |

---

## 5. Adding new record types and workflows

Everything is driven by `docs/sample_inspection_type.json`. To add a new type:

1. **Add a workflow** to the `"workflows"` array:
```json
{
  "id": "wf_your_things",
  "name": "Your Things",
  "description": "...",
  "activities": [
    {
      "id": "act_create_your_things",
      "name": "Create Your Thing",
      "description": "...",
      "sort_order": 0,
      "record_map": "CREATE",
      "attributes": [
        { "key": "field_a", "label": "Field A", "description": "...", "type": "text" }
      ],
      "before_hook": null,
      "after_hook": null
    },
    {
      "id": "act_some_capture_your_things",
      "name": "Some Capture Step",
      "description": "...",
      "sort_order": 1,
      "attributes": [
        { "key": "captured_field", "label": "Captured Field", "description": "...", "type": "text" }
      ],
      "before_hook": null,
      "after_hook": null
    }
  ]
}
```

2. **Add a record type** to the `"recordTypes"` array:
```json
{
  "id": "rt_your_things",
  "name": "Your Things",
  "description": "...",
  "workflow_ref": "wf_your_things",
  "custom_fields": [
    { "key": "field_a", "type": "text", "default": "" },
    { "key": "status",  "type": "text", "default": "Open" }
  ]
}
```

**Rules to observe:**
- `workflow_ref` must match a `workflow.id` in the same file
- `record_map: CREATE` activity attribute keys that match `custom_field` keys are written on create; unmatched are silently dropped
- Custom fields with no matching captured attribute are seeded from `default` — this is how `status` gets its initial value
- Field constraints (`required`, `unique`, `immutable`, `indexed`) are optional booleans on each custom field and are enforced by the adapter on CREATE and UPDATE
- One `record_map: CREATE` activity per workflow is the expected pattern; the UI surfaces the first one it finds
- Ordinary capture activities (no `record_map`) appear in the record-level activity strip after a record is selected
- `before_hook`/`after_hook` can be `null` or a shape object — both are treated as no-ops this cut

---

## 6. Running locally

```bash
cd packages/aber-poc
npm run dev
# → http://localhost:5173 (or next available port)
```

No build step needed for development. No external services. Data persists in `localStorage` across refreshes.

> **After renaming record type IDs** (e.g. `rt_asset` → `rt_assets`), existing localStorage data will no longer match the new IDs. Clear it once:  
> `localStorage.removeItem('aber-poc-v1-records')` in the browser console, then reload.

---

## 7. Naming conventions

All entity IDs and display names use **plural** form — they represent collections, not individual instances.

| Entity | Convention | Examples |
|---|---|---|
| Record type IDs | `rt_<plural>` | `rt_asset_types`, `rt_assets`, `rt_inspection_jobs` |
| Workflow IDs | `wf_<plural>` | `wf_asset_types`, `wf_assets`, `wf_inspection_jobs` |
| Record type names | Plural | `"Asset Types"`, `"Assets"`, `"Inspection Jobs"` |
| Workflow names | Plural (match record type name) | `"Asset Types"`, `"Assets"`, `"Inspection Jobs"` |
| Activity IDs | `act_<verb>_<plural>` | `act_create_asset_types`, `act_close_inspection_jobs` |
| Activity names | Singular (describes acting on one record) | `"Create Asset Type"`, `"Close Inspection"` |

**Rationale:** record types and workflows name *collections* — "I am working with Assets"; the plural makes that clear. Activity names are the exception: "Create Asset Type" means "create one asset type instance", so the action label stays singular.
