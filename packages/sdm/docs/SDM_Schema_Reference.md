# Simple Data Model (SDM) — Schema Reference

The **SDM** is the configuration schema for the platform engine — **A, the record platform**. It defines the small **base model** from which any **domain implementation (B)** is built. The engine contains no domain concepts; everything domain-specific is expressed as SDM configuration.

**Why "Record".** The central object is a **Record** — and a record here is not merely information. It is a piece of business data *together with the full history of activities and actions performed on it*. This framing is the product itself: the thin, out-of-the-box version of the platform is a **record management system** (records + activities + history), and the full platform is that same engine opened up to build apps and modules on top. The base model below is identical in both; only how much is exposed differs.

**App vs module.** Both are built from the same base objects (records + workflows), and defining either is the same act — there is no separate mechanism for modules. The only difference is intent:
- An **app** is a domain solution for end users (e.g. the maintenance app).
- A **module** is a reusable piece meant to be consumed by other apps (e.g. a scheduling tool).

This sameness is a deliberate, powerful property: a reusable module is not a special construct, just a record with a workflow like everything else.

This document defines the base model, then proves it by expressing a maintenance application in it (Section 3).

---

## 1. The Base Model

The SDM is made of the eight **base objects** below. Each is given as a shape (its fields). Fields marked *(deferred)* are intentionally left as placeholders — their detailed semantics are out of scope for this cut and noted in Section 4.

**Notation:** a `?` after a field's type means the field is **optional** (e.g. `before_hook : Hook?` — an activity may or may not have one).

### 1.1 Workflow
A standalone, named process definition. Records point at workflows; a workflow does not belong to a record.

| Field | Type | Notes |
| :--- | :--- | :--- |
| `id` | identifier | Unique. |
| `name` | text | |
| `description` | text | |
| `activities` | list of Activity | Ordered (see `sort_order` on Activity). |

### 1.2 Record
The central, universal object. Every piece of business data is a Record of some type. A Record references exactly one workflow, and that workflow runs **against** the Record. A Record is the data *plus* the accumulated history of activities performed on it.

| Field | Type | Notes |
| :--- | :--- | :--- |
| `id` | identifier | Unique. |
| `name` | text | |
| `description` | text | |
| `workflow_ref` | reference → Workflow | Exactly one. The Record's process. |
| `id_field` | identifier? | Optional. When set, the named custom field's value is used as the Record instance's id instead of an auto-generated one. The field should carry `required: true`, `unique: true`, and `immutable: true`. |
| `custom_fields` | list of CustomField | The Record's own data — typed key-values (see 1.4). |
| `states` | *(deferred)* | The set of states an instance can be in (e.g. Raised, Complete). Definition deferred. |

**The Record as anchor.** A Record instance is the *anchor* a workflow runs against. During execution a workflow's activities may read and act on *other* Records too — but every action is **recorded against the workflow's own Record instance**. So the rule *a workflow acts against exactly one Record* holds even when its actions touch many: the one Record is the anchor; the others are merely operated on.

This matters at runtime because there can be **many instances** of the same Record definition in use at once. Example: a scheduling-tool module has one Record definition and one workflow, but every active schedule is a separate instance, and each records its workflow's actions against *itself*.

> A Record points to exactly **one** workflow, but a workflow may act on any number of Records. Example: an *Inspection Job* references the *Inspection* workflow; a *Fix Hazard Job* references a different one.

> **Forward note (POC2):** scheduled/CRON-triggered workflows follow this same pattern — a Record with a workflow — but additionally need a *temporal trigger* to start without a user. The trigger primitive is deferred to POC2 (see Section 4).

### 1.3 Activity
A step within a workflow. Activities capture data and carry logic.

| Field | Type | Notes |
| :--- | :--- | :--- |
| `id` | identifier | Unique. |
| `name` | text | |
| `description` | text | |
| `sort_order` | number | Position within the workflow. |
| `attributes` | list of Attribute | The fields captured at this step (see 1.5). |
| `before_hook` | Hook? | At most one. Runs before commit. |
| `after_hook` | Hook? | At most one. Runs after commit. |
| `record_map` | `CREATE` \| `UPDATE` \| `DELETE` \| *(absent)* | Optional. Declares that the activity performs a structural Record operation on commit. **`CREATE`, `UPDATE`, and `DELETE` are all implemented (see §1.9).** Absent = ordinary capture activity. |
| `access_control` | *(placeholder)* | Role- and Record-state-based access. Definition deferred. |

### 1.4 CustomField (Record data)
A Record's own data: typed key-value pairs. Custom fields hold the live state of a Record instance (e.g. a Job's status, location, due date) and are **only ever updated through activities** — never edited directly. They carry no display logic.

| Field | Type | Notes |
| :--- | :--- | :--- |
| `key` | identifier | Unique within the Record type. |
| `type` | text | `text` for now; number, photo, date, etc. deferred. |
| `default` | (typed) | Initial value seeded when a new Record is created and this field is not captured by the CREATE activity. |
| `required` | boolean? | If true, the field must have a non-empty value. Enforced on CREATE and UPDATE. Default: false. |
| `unique` | boolean? | If true, no two Records of this type may share the same value for this field. Enforced on CREATE and UPDATE. Default: false. |
| `immutable` | boolean? | If true, the field may be set on CREATE but cannot be changed by any UPDATE activity. Default: false. |
| `indexed` | boolean? | Marks the field for optimised lookup. `unique: true` implies `indexed: true`. Default: false. |
| `fk_record_type` | identifier? | When set, this field stores the `id` of a Record of the named type. Enables display-label resolution at runtime — the raw id is shown as a human-readable value from the referenced Record. |
| `fk_display_field` | identifier? | The `key` of the custom field on the referenced Record type whose value is used as the display label (instead of the raw id). Requires `fk_record_type`. |

> **Custom fields vs attributes — a deliberate distinction.** Both are typed key-values, but they are different objects for good reason:
> - **Custom fields** (on a Record) are *mutable* live data, no show-logic.
> - **Attributes** (on an activity, see 1.5) are *immutable* form definitions and can carry a show-condition.
>
> They share the **type system** but not their shape or behaviour, so they are **not** a shared container. (An earlier draft shared one container; this split supersedes it.)

### 1.5 Attribute (activity capture field)
A single typed field captured by an activity. Attributes are the form a user fills in at a step. They are part of the activity *definition* and immutable at runtime (for now).

| Field | Type | Notes |
| :--- | :--- | :--- |
| `key` | identifier | Unique within the activity. |
| `label` | text | Display label. |
| `description` | text | |
| `type` | text | Defaults to `text` for now. Other types (number, photo, date, etc.) deferred. |
| `fk_record_type` | identifier? | When set, this attribute captures the `id` of a Record of the named type. The form renders a record picker instead of a plain text input. |
| `fk_display_field` | identifier? | The `key` of the custom field on the referenced Record type used as the display label in the picker. Requires `fk_record_type`. |
| `show_condition` | Expression? | *(deferred)* Conditional visibility, e.g. show B if A = "yes". |

### 1.6 Hook
Logic attached to an activity lifecycle moment. An activity has at most one `before` and one `after` hook.

| Field | Type | Notes |
| :--- | :--- | :--- |
| `timing` | `before` \| `after` | |
| `commands` | list of Command | *(semantics deferred)* |

- **`before`** — intended for validation (allow/reject commit).
- **`after`** — intended for action (e.g. update a field, create a Record).

### 1.7 Command
A unit of action or check inside a hook.

| Field | Type | Notes |
| :--- | :--- | :--- |
| `condition` | Expression? | *(deferred)* Evaluated to decide whether the command runs. |
| `action` | *(semantics deferred)* | What the command does, e.g. "set anchor Record status = Complete". |

### 1.8 Expression (generic, reusable syntax)
A generic, evaluatable expression — a small reusable syntax (TBC, deferred) used in several places across the base model rather than belonging to any one object. It appears wherever a condition or derived value is needed — an attribute's `show_condition`, a command's `condition`, and so on.

An expression may read:
- the **SDM** (the configuration itself),
- live **Record data** (the instance's current state, e.g. a status value),
- **context** *(deferred)* — current user, user roles, contract, etc.

### 1.9 `record_map` (activity → Record operation)

`record_map` is an optional field on an **Activity** (see §1.3) declaring that the activity performs a structural Record operation when it commits, rather than only capturing data against an existing anchor Record.

| Value | Meaning | Anchor Record required? | Surfaced in UI as |
| :--- | :--- | :--- | :--- |
| *(absent)* | Ordinary capture activity — runs against an existing anchor Record, appends to its history. | Yes | Record-level activity |
| `CREATE` | The activity's commit **creates a new Record** of the activity's target type. | **No** — there is no Record yet; this is the bootstrap. | Type-level launch (no instance selected) |
| `UPDATE` | The commit **merges captured attribute values into the anchor Record's custom fields** (exact-key match, same rule as CREATE §1.9.3). | Yes | Record-level activity |
| `DELETE` | The commit **permanently deletes the anchor Record**. A `confirm` attribute (user must type `DELETE` exactly) acts as a safety gate — any other value is a no-op. | Yes | Record-level activity |

`CREATE`, `UPDATE`, and `DELETE` are all implemented.

> **Provenance.** This realises a previously-deferred primitive because a real need pulls it: POC1 has no other sanctioned way to bring a Record into existence — custom fields update *only* via activities (§1.4), so creation itself must be an activity. This is the build-discipline rule applied, not a special-case.

#### 1.9.1 Routing rule (which activities need an anchor)

`record_map` **routes an activity to the right surface**, by whether it needs an anchor Record:

- `CREATE` → **type-level**. There is no anchor Record (the activity is what brings one into existence), so the target Record type cannot come from an instance. It is known from **context**: the user has selected a Record type, and the runtime discovers the CREATE activity by walking that type's referenced Workflow (§1.9.2).
- `UPDATE` / `DELETE` / *absent* → **instance-level**. These run against a selected anchor Record; the type is known from that instance's type reference.

> **Why CREATE is excluded from the record-level activity set:** a record-level activity by definition runs against an anchor Record and appends to its history. A CREATE activity has no anchor at the moment it runs. Folding CREATE into the record-level set would require a selected Record to create a Record — a contradiction. CREATE is therefore surfaced separately, at the type level.

#### 1.9.2 How the target Record type is known for CREATE

There is no anchor instance, so the type is resolved from **selection plus workflow walk**:

1. The user selects a Record type.
2. The runtime reads that type's `workflow_ref` and walks the Workflow's activities.
3. If an activity carries `record_map: CREATE`, its launch control is surfaced (type-level).
4. On submit, the new Record is created **of the selected type** — the same type whose workflow contained the CREATE activity.

The CREATE activity therefore lives **inside the type's own workflow** (discoverable by walking it), but its target type comes from the **selection context**, not from any anchor Record. This avoids the chicken-and-egg of "a workflow runs against a Record": for CREATE specifically, selection supplies the type, and running the activity is what produces the first anchor.

#### 1.9.3 Attribute → CustomField mapping (CREATE commit)

When an activity with `record_map: CREATE` is submitted, the platform creates a new Record of the target type and populates its custom fields:

1. **Match on exact key equality.** For each captured Attribute, if `attribute.key` equals a `custom_field.key` on the target Record type, the attribute's value is written to that custom field.
2. **Unmatched captured attributes are ignored** — not an error. Activities may capture more information than maps to custom fields; only the matching subset is written. This is intentional.
3. **Uncaptured custom fields** are seeded from the `default` value defined on the custom field in the Record type definition. Captured attribute values overlay these defaults — a captured value always wins.

> Mapping is **by key, exact** — never by label or position. A mistyped key in hand-edited config silently drops that value (rule 2) — acceptable for a hand-edited POC, flagged so it isn't surprising.

#### 1.9.4 Commit ordering and hook bracketing

An activity's commit is bracketed by its hooks. For a `record_map` activity, **the `record_map` operation _is_ the commit** the hooks bracket:

```
before_hook  →  commit  →  after_hook
                 │
                 └── record_map activity → "commit" = the CREATE / UPDATE / DELETE operation
                     ordinary capture    → "commit" = writing captured data against the anchor
```

This reconciles the two phrasings used across the project — the SDM's "`before_hook` runs before commit, `after_hook` runs after commit" (§1.3, §1.6) and the build phrasing "before → record_map → after". They are the same pipeline: the `record_map` operation is what "commit" denotes for a record_map activity.

> **POC1 cut:** hooks are **defined but stubbed**. The pipeline has all three slots — `before_hook`, commit, `after_hook` — from day one; only the commit (CREATE) carries a real body this cut. `before`/`after` are no-ops to be filled in a later stage, so staging hooks in later fills existing slots rather than re-architecting the call.

#### 1.9.5 UPDATE form pre-population

When an activity with `record_map: UPDATE` is opened against an anchor Record, the activity form is **pre-populated** with the current custom field values of that Record:

1. **Match on exact key equality.** For each Attribute on the UPDATE activity, if `attribute.key` equals a `custom_field.key` on the anchor Record, the form field is seeded with that field's current value.
2. **Unmatched attributes open blank** — no matching custom field means no seed value.
3. **Ordinary capture activities (no `record_map`) are never pre-populated** — they capture new observations against the anchor, not edits to its existing data.

> **POC1 cut:** Both pre-population and the UPDATE commit are implemented. The full round-trip — pre-populate with current values → user edits → write matched fields back to the anchor Record — is live.

---

## 2. Relationships at a Glance

```
Workflow ──< Activity (ordered by sort_order)
                 │
                 ├── Attribute(s)   (typed capture fields, may have show_condition)
                 ├── before_hook : Hook ──< Command
                 └── after_hook  : Hook ──< Command

Record ── workflow_ref ──> Workflow
   └── CustomField(s)   (mutable key-values, updated only via activities)

Expression  (generic syntax, used by Attribute.show_condition, Command.condition)
```

Reference integrity rules:
- Every `Record.workflow_ref` must resolve to a defined Workflow.
- Every `Attribute.key` is unique within its container.
- An Activity belongs to exactly one Workflow.

---

## 3. Cross-Check: Expressing Maintenance in the SDM

This section proves the schema by configuring a slice of a maintenance application using only the primitives above. If it expresses cleanly, the schema holds; anything that cannot be said is a gap (see Section 4).

### 3.1 Workflow: "Inspection"
```
Workflow {
  id: "wf_inspection"
  name: "Inspection"
  description: "Planned inspection of a road asset"
  activities: [
    Activity {
      id: "act_record_finding"
      name: "Record Finding"
      sort_order: 1
      attributes: [
        { key: "condition_rating", label: "Condition Rating", type: text }
        { key: "notes",            label: "Notes",            type: text }
        { key: "hazard_found",     label: "Hazard Found?",    type: text }
      ]
      after_hook: Hook {
        timing: after
        commands: [
          Command {
            condition: <expr> hazard_found = "yes"
            action:    <deferred> create Record "Hazard", linked to this Job
          }
        ]
      }
    }
    Activity {
      id: "act_close"
      name: "Close Inspection"
      sort_order: 2
      attributes: [
        { key: "completed_by", label: "Completed By", type: text }
      ]
      after_hook: Hook {
        timing: after
        commands: [
          Command {
            action: <deferred> set anchor Record status = "Complete"
          }
        ]
      }
    }
  ]
}
```

### 3.2 Record: "Inspection Job"
```
Record {
  id: "rec_inspection_job"
  name: "Inspection Job"
  description: "A planned inspection work item"
  workflow_ref: "wf_inspection"
  custom_fields: [          // typed data, updated only via activities
    { key: "location",   type: text, default: "",       required: true }
    { key: "due_date",   type: text, default: "",       required: true }
    { key: "work_group", type: text, default: "" }
    { key: "status",     type: text, default: "Raised", indexed: true }
  ]
  states: <deferred>  // e.g. Raised, Accepted, In Progress, Complete
}
```

### 3.3 What this proves
- **Record → one workflow** holds: the Inspection Job points to `wf_inspection`.
- **Ordered activities** hold: Record Finding (1) → Close Inspection (2).
- **Field/attribute split holds**: the Record carries mutable `custom_fields` (status, location…); each activity carries immutable typed `attributes` (the capture form). Two distinct shapes, as intended.
- **Record as anchor** holds: both activities record against the Inspection Job instance, even where an action (spawning a Hazard) touches another Record.
- **Hooks express the two key behaviours**: spawning a linked Hazard (after-hook, conditional) and setting the anchor Record's status (after-hook). Both rely on deferred command/expression semantics but *fit structurally* — the schema has a place for them.

### 3.4 What this exposes (feeds Section 4)
- **Record creation from a hook** needs command + expression semantics (deferred) — but the structure holds a slot for it.
- **Linking** — "Hazard linked to this Job" is a link *created from a hook* (a command action, still deferred — see item 1 above). This is distinct from the lightweight relationship primitive the SDM does have: `fk_record_type` / `fk_display_field` on CustomField (§1.4) and Attribute (§1.5), which let a field hold another Record's id with runtime display-label resolution and a picker UI — implemented, see §4.9. Neither carries database-enforced *referential integrity*; both are just fields holding Record ids, resolved by the platform. A first-class relationship primitive with enforced integrity is deliberately not required for now. *(See §4.9 — future consideration, not a gap.)*
- **States** are referenced (status = Complete) but not yet defined on the Record.

---

## 4. Deferred / Out of Scope (this cut)

Parked deliberately, with a noted home in the schema:

1. **Hook & Command semantics** — what commands exist, how actions execute.
2. **Expression mechanics** — syntax, evaluation, operators.
3. **Context** — current user, roles, contract, etc., readable by expressions.
4. **Record states** — defining the set of states an Record instance can occupy.
5. **Record-map shortcut** — `CREATE`, `UPDATE`, and `DELETE` are all implemented. Default custom-field seeding (§1.9.3 rule 3) and field constraints (`required`, `unique`, `immutable`, `indexed`) are implemented on `CustomField`.
6. **Access control** — role + state based, on activities.
7. **Attribute types** beyond `text`.
8. **Grouping / hierarchy** — for records and workflows (currently flat lists).
9. **Links / relationships** — lightweight FK references (`fk_record_type` / `fk_display_field` on CustomField and Attribute) are implemented: a CustomField storing a Record id gets display-label resolution at runtime; an Attribute with the same flags renders a record picker in the form. A **first-class relationship primitive** with referential integrity constraints is deliberately not required — data is managed entirely by the platform, so no DB-enforced referential constraints are needed. Links are simply fields holding Record ids. *Future consideration* if cross-record querying or integrity guarantees beyond the app layer are ever needed.
10. **Temporal trigger (POC2)** — a way to start a workflow on a schedule (CRON / countdown) without a user. Scheduled jobs are records with workflows like any other; they need only this trigger added. Scoped to POC2.

---

## 5. Naming

The model is referred to as the **SDM (Simple Data Model)**. The engine that interprets it contains no domain vocabulary; all domain terms (Job, Asset, Hazard, etc.) exist only in SDM configuration.

---

## 6. Storage / Runtime Layer (out of scope here)

The SDM is **configuration only** — it does not know or care how data is stored. The runtime storage architecture sits entirely below the SDM and is documented separately. In summary: transactional writes land in a high-throughput store (e.g. DynamoDB) and are mirrored asynchronously into per-tenant relational databases (Postgres) for reporting — a CQRS split. None of this affects the SDM schema above; the engine reads the SDM and operates regardless of the underlying store.
