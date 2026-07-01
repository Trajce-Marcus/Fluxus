# POC1 Runtime UI — Build Spec

> **Status:** build brief for the runtime (end-user) UI of POC1. The admin/config builder is deferred; config is hand-edited JSON.
> **Canonical model:** `SDM_Schema_Reference.md` wins on all model semantics. `record_map` semantics are defined in the SDM update (`SDM_record_map_section.md` — fold into the SDM doc). Where this build spec and the SDM differ on the *model*, the SDM wins; this doc owns only the *UI and runtime wiring*.

---

## 1. What this cut proves (and what it doesn't)

POC1's full loop (Platform spec §6) is: define a Record type → create a Record → run its workflow stepping through activities capturing attributes → **fire a hook**. We are **staging** that loop, not building it all at once.

**This cut (call it POC1·a):**
- List Record types from hand-edited JSON config.
- View a type's Record instances in a grid (custom fields as columns).
- Create a Record via a `record_map: CREATE` activity (attribute → custom-field mapping; see SDM update §1.9.3).
- Run ordinary capture activities against a selected Record, appending to its activity history.
- View a Record's details (custom fields) and its activity history (cards).

**Explicitly still on the POC1 ledger, not dropped — later stages:**
- **Hooks fire** (`before` validation, `after` actions). The pipeline slot exists from day one (see §5.3); bodies are stubbed this cut. *POC1 is not "done" until at least one hook fires* — keep this on the ledger so "POC1·a done" is not mistaken for "POC1 done."
- Hooks actually firing (slots exist, bodies are no-ops).

**Out of scope entirely (deferred list — do not build):** admin/config builder; conditional attribute visibility (`show_condition`); attribute types beyond `text` (no date/photo/number widgets — single text input only, structured for expansion); formal states / state-machine UI (status is just a custom field); access-control-gated screens; link/relationship browsing; temporal/CRON triggers (POC2); reporting/dashboards (external); org-hierarchy navigation; real persistence (in-memory/localStorage adapter is fine — see §6).

---

## 2. Layout

```
┌───────────────────────────────────────────────────────────────┐
│  HEADER — POC name only                                          │
├───────────────┬───────────────────────────────────────────────┤
│               │  CONTENT (two panels, flexbox)                   │
│  SIDE PANEL   │  ┌──────────────────┬──────────────────────────┐│
│               │  │ LEFT             │ RIGHT                     ││
│  Record type  │  │ Records grid     │ Record view              ││
│  list         │  │ (+ CREATE launch │  - Record details        ││
│               │  │  if type has a   │  - Activity history list  ││
│               │  │  CREATE activity)│  - Available activities   ││
│               │  │                  │    (record-level)         ││
│               │  └──────────────────┴──────────────────────────┘│
└───────────────┴───────────────────────────────────────────────┘
```

- **Header** — displays the POC name. Nothing else.
- **Side panel** — the Record type list.
- **Content** — two flexbox panels. Left = Records grid (scoped to selected type). Right = Record view (scoped to selected Record).

---

## 3. Components (tsx)

| Component | Reads from | Renders | Notes |
| :--- | :--- | :--- | :--- |
| **RecordTypeList** | config (type defs) | list of Record types in the side panel | Selecting a type sets `selectedRecordType` + eagerly resolves `selectedRecordTypeWF` (§5.2). |
| **RecordsGrid** | `selectedRecordType` + that type's instance data | grid; **custom fields are the columns**, one row per instance | Hosts the **CREATE launch control** when the type's workflow has a `record_map: CREATE` activity (§4). Selecting a row sets `selectedRecord`. |
| **RecordView** | `selectedRecord` | container: RecordDetails + ActivityHistoryList + AvailableActivities | Right panel. Empty/placeholder when no Record selected. |
| **RecordDetails** | `selectedRecord` | key/value table of the Record's custom fields | **Read-only** — custom fields change only via activities. |
| **ActivityHistoryList** | `selectedRecord` | list of ActivityCard, one per activity run against this Record | The append-only log. This *is* the product ("record = data + history"). |
| **ActivityCard** | one history entry | card: activity name + list of the attribute data captured at that step | Card style. Read-only record of what was captured. |
| **AvailableActivities** | `selectedRecordTypeWF` (filtered) | strip of clickable activity buttons at the **record level** | Lists activities that need an anchor (`UPDATE`/`DELETE`/unflagged). **CREATE is excluded here** — it lives in the grid (§4). Click → opens AttributesForm. |
| **AttributesForm** | the clicked activity's `attributes` | stacked inputs, one per attribute, by attribute `type` | This cut: all types render a single text input. Structure for later type expansion. Submit → runs the activity pipeline (§5.3). |

> **Note — two activity surfaces, routed by `record_map`.** The same workflow walk feeds two places, split by the routing rule (SDM update §1.9.1): `CREATE` → grid-level launch (no anchor); `UPDATE`/`DELETE`/unflagged → record-level `AvailableActivities` strip (needs anchor). Don't merge them into one strip that assumes a selected Record — CREATE would break.

---

## 4. The CREATE control (record creation)

Creation is **not** a generic "+ New" the UI invents. It is a real activity in the type's workflow carrying `record_map: CREATE`, surfaced because of that flag:

1. User selects a Record type (side panel) → `selectedRecordType` set, `selectedRecordTypeWF` resolved.
2. RecordsGrid loads that type's instances **and** checks the workflow for an activity with `record_map: CREATE`.
3. If found, the grid renders that activity's launch control (e.g. a "+ New [type]" button above the grid).
4. Click → AttributesForm for the CREATE activity → submit → new Record created of the selected type, custom fields populated by attribute→custom-field key matching (SDM update §1.9.3).

Target type for the created Record = the **selected type** (the one whose workflow held the CREATE activity). No anchor Record involved.

---

## 5. App architecture

### 5.1 App context

A single app-level React context, so components read shared selection state without prop drilling:

```ts
interface AppContext {
  selectedRecordType:   RecordTypeDef | null;   // from side-panel selection
  selectedRecordTypeWF: WorkflowDef   | null;   // resolved eagerly on type selection
  selectedRecord:       RecordInstance | null;  // from grid row selection
  // setters / actions as needed
}
```

- `RecordsGrid` reads `selectedRecordType` (+ its data) and `selectedRecordTypeWF` (for the CREATE control).
- `AvailableActivities` reads `selectedRecordTypeWF` (filtered to record-level activities).
- `RecordDetails` / `ActivityHistoryList` read `selectedRecord`.

### 5.2 Selection → two gets (kept separate)

On Record-type selection, two **separate** storage operations fire (split now because they diverge later — def is config/Postgres-core; data is instances/DynamoDB, per the architecture doc's CQRS split):

1. `getRecordTypeDef(typeId)` → the type definition **+ its workflow** (resolves `selectedRecordType` and `selectedRecordTypeWF`). Eager: resolved once on selection and cached in context, not lazy-loaded per component.
2. `getRecordTypeData(typeId)` → the Record instances for the grid.

### 5.3 The activity pipeline (storage hook)

A storage hook (`useStore()` or similar) exposes the model operations; **components call the hook, never the adapter directly.** Activity submission runs a single pipeline with all three slots present from day one:

```
runActivity(activity, capturedAttributes, anchorRecord?):
    before_hook   → (stubbed no-op this cut)
    commit        → record_map CREATE / UPDATE / DELETE
                    | append captured data to anchor (ordinary capture)
    after_hook    → (stubbed no-op this cut)
    then: append an entry to the Record's activity history
```

The `before`/`after` slots exist but are no-ops this cut — staging hooks later fills the slots, it does not re-architect the call. Commit = the `record_map` operation for record_map activities, = the capture write for ordinary activities (SDM update §1.9.4).

---

## 6. Storage layer

Define a storage **interface**; back it with a swappable adapter. The interface keeps storage *below* the model (SDM is store-agnostic) and makes the eventual CQRS swap a one-adapter change.

```ts
interface Store {
  // config / definitions
  getRecordTypeDef(typeId: string): RecordTypeDef & { workflow: WorkflowDef };
  listRecordTypes(): RecordTypeDef[];
  // instance data
  getRecordTypeData(typeId: string): RecordInstance[];
  getRecord(recordId: string): RecordInstance;
  createRecord(typeId: string, customFields: Record<string, unknown>): RecordInstance;
  appendActivity(recordId: string, entry: ActivityHistoryEntry): void;
  updateRecord(recordId: string, fields: Record<string, unknown>): void;
  deleteRecord(recordId: string): void;
}
```

**Adapters:**
- **LocalStorageAdapter** — current implementation; records persist across page refreshes.
- **(later)** CQRS adapter — DynamoDB transactional + Postgres reporting, per `SaaS_Platform_Specification_v2.md`.

Same interface throughout; components and the runtime never know which adapter is behind it.

### 6.1 Instance shape (runtime, not SDM config)

The SDM defines the type *def*; the *instance* is runtime state the store reads/writes. History is **not** an SDM field (Record §1.2 has no `history`) — "record = data + history" is conceptual; the runtime maintains the log.

```ts
interface RecordInstance {
  id: string;
  typeRef: string;                       // → RecordTypeDef.id
  customFields: Record<string, unknown>; // live values, keyed by custom_field.key
  activityHistory: ActivityHistoryEntry[];
}

interface ActivityHistoryEntry {
  activityId: string;
  capturedAttributes: Record<string, unknown>; // keyed by attribute.key
  timestamp: string;
}
```

- `RecordsGrid` columns ← `customFields` keys (from the type def's custom fields).
- `ActivityHistoryList` cards ← `activityHistory`.

---

## 7. Decisions carried into this spec (with reasons, for the build session)

The build session will not have the conversation that produced these. Reasons are load-bearing — without them the session may re-solve differently.

1. **CREATE is discovered by walking the selected type's workflow; its target type comes from selection, not an anchor.** *Reason:* there is no Record yet at creation, so the type cannot come from an instance; selection supplies it. (SDM update §1.9.2.)
2. **CREATE is excluded from the record-level activity strip; it lives in the grid.** *Reason:* record-level activities need an anchor Record; CREATE has none. (SDM update §1.9.1.)
3. **Attribute→custom-field mapping is exact-key; unmatched attributes are ignored, not errors.** *Reason:* activities may capture more than maps to fields; only the matching subset is written. (SDM update §1.9.3.)
4. **The `record_map` operation is the "commit" the hooks bracket** (`before → commit → after`). *Reason:* reconciles SDM "before/after commit" with build "before/record_map/after" — same pipeline. (SDM update §1.9.4.)
5. **Hook pipeline slots exist now; bodies stubbed.** *Reason:* staging hooks later fills slots rather than re-architecting the call.
6. **Two separate gets on selection (def+WF, then data).** *Reason:* they diverge later across the CQRS split; the seam belongs in the right place now.
7. **Custom fields are read-only in the UI; updated only via activities.** *Reason:* SDM rule (CustomField §1.4).

---

## 7a. Expected behaviours — DO NOT "fix" these

These are **intended and correct** for this cut. A fresh session may mistake them for bugs and try to patch them. Do not. Each follows from a rule; patching it breaks the model.

1. **A CREATE attribute with no matching custom field is captured then silently dropped.** In the sample, the Raise activity captures `notes`, but the Inspection Job type has no `notes` custom field — so on create, `notes` goes nowhere. This is SDM update §1.9.3 rule 2 (unmatched attributes ignored, not errored) working as designed: an activity form may capture more than the Record stores. **Do not** add a `notes` field, raise an error, or warn. If a demo shouldn't show a value vanishing, the *config* is edited (remove `notes` from the attributes) — the runtime behaviour stays.

2. **`status` is created as `"Raised"` and never changes in this cut.** No attribute maps to `status`, so create leaves it at its def value. The only sanctioned way a custom field changes is via an activity's hook (SDM §1.4) — and hooks are **stubbed this cut** (§5.3). The Close activity's after-hook that *would* set status = "Complete" exists in the sample as shape only, not executed. So every row shows "Raised", permanently, until hooks are staged in. **Do not** add direct custom-field editing, a status dropdown, or any non-activity write path to make status move — that violates "custom fields update only via activities." The correct way to make status move is to **stage in the after-hook** (a later cut), not to bypass the rule.

> These two are the same fact from opposite ends: an **attribute with no field** is captured-then-dropped; a **field with no attribute** is never written. Only keys present on *both* the activity's attributes and the type's custom fields move data. That is exactly what exact-key matching means, and it is correct.

---

## 8. Suggested build order

1. Sample config JSON (type def + workflow with a CREATE activity) — see `sample_inspection_type.json`.
2. Storage interface + LocalStorageAdapter; seed from sample config.
3. App context + layout shell (header / side panel / two panels).
4. RecordTypeList → selection wiring → the two gets.
5. RecordsGrid (columns from custom fields) + CREATE launch control.
6. AttributesForm + `runActivity` pipeline (commit = CREATE; before/after stubbed).
7. RecordView → RecordDetails + ActivityHistoryList + ActivityCard.
8. AvailableActivities (record-level, CREATE excluded) → ordinary capture activity appending history.
