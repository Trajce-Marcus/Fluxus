# SDM Change: Attribute & CustomField Type System Redesign

> **Status:** design decided, not yet applied to `SDM_Schema_Reference.md`.
> **Scope:** this document is self-contained — it describes only the delta from the current SDM (as of the version with `fk_record_type`/`fk_display_field` on both CustomField §1.4 and Attribute §1.5). Apply against that baseline.
> **Why this change:** two real, current needs (a WO Type field that must be a filtered lookup, and a Job Type field that's a hardcoded list) proved the existing flat/optional-field approach to typed values doesn't generalise. This is a "second real case" generalisation per the build-discipline rule (`Platform_Model_Specification.md` §2), not speculative.

---

## 1. CustomField.type — becomes a small, closed, primitive type

**Before:** `type: text` (only value), plus optional `fk_record_type`/`fk_display_field` side-fields implying a reference.

**After:** `type` is one of a small closed set describing *storage shape only*:
- `string`, `int`, `bool`, `date`, …
- `fk_ref` — when set, requires sibling fields `fk_record_type` (identifier of the target Record type) and `fk_display_field` (retained, decision pending further review — needed for read-only display resolution on CustomField, e.g. `RecordDetails`, independent of any attribute/form being active).

CustomField's job is: what shape does this field store, and (if `fk_ref`) what Record type does the id belong to and how should it be displayed at rest.

## 2. Attribute.type — becomes open-ended, vertical (`type` + `type_config`)

**Before:** `type: text` (only value in practice), plus optional `fk_record_type`/`fk_display_field` side-fields.

**After:** Attribute goes **vertical**: two fields, `type` and `type_config`, where `type_config`'s shape depends on `type`. This replaces named optional side-fields because the set of attribute types is open-ended and can't be predicted as fixed columns (build-discipline rule: generalise once a second case proves the shape — `reference` + `valueList` + `listExpression` are that proof).

Known attribute types at this point (a **type registry**, documented separately from the SDM table, should list these and their `type_config` shapes — this is new required scaffolding, since hand-edited config can no longer self-document via table columns):

| type | type_config shape | Behaviour |
| :--- | :--- | :--- |
| `text` | *(none)* | Plain text input. |
| `reference` | `{ fk_record_type }` | Picker over **all** instances of the target Record type. No `fk_display_field` on the attribute — see open question below on how the picker resolves a display label. |
| `valueList` | `{ values: [...] }` | Picker over a hardcoded inline list. |
| `listExpression` | `{ expression: ... }` | Picker over a list **filtered by an expression** (e.g. WO Types filtered by the anchor Job's `job_type`). Needs `Expression` to support filtering-a-collection-by-predicate — this is new required scope beyond what `Expression` (§1.8) currently claims, and is **schema-only / execution-deferred** until Expression semantics are built out (same status as hooks today). |

## 3. No type-matching/compatibility rule between Attribute.type and CustomField.type

Rejected: an earlier idea to validate that an attribute's type "matches" its target custom field's type at CREATE/UPDATE commit.

**Decided instead:** no matching rule needed. Whatever value an attribute produces is simply **cast/checked against the target CustomField's own constraints at commit** — the same way `required`/`unique`/`immutable` are already enforced today (§1.9.3, §1.4). For `fk_ref` specifically, this means the CustomField's `fk_record_type` is what validates the id belongs to the right Record type — a constraint owned entirely by the CustomField, independent of which attribute or activity produced the value. Attribute.type and CustomField.type are allowed to diverge in vocabulary; only the resulting value + CustomField's own constraints matter.

## 4. `default` becomes an Expression, not a literal

CustomField's `default` (currently a bare typed literal) becomes an `Expression` (§1.8) — a literal is just the trivial case (`{"Active"}` evaluates to itself). This unifies static and computed defaults into one primitive instead of two. **Dependency:** like `listExpression`, this makes even simple literal defaults nominally depend on Expression semantics existing — acceptable, but worth being explicit that "syntax TBC" (§4.2) now blocks something that used to be free.

## 5. Attributes become standalone, referenceable objects (like Workflow)

**Before:** Attributes are defined inline, per-activity. The same logical attribute (e.g. `wo_type`) used across multiple activities/workflows had to be redefined — and re-authored — every time, with drift risk.

**After:** Attributes are defined in their own standalone collection, each with a **globally unique `key`** across the entire collection (not just unique-within-activity as today). Activities reference attributes by id rather than embedding full definitions.

- `label`/`description` are **not** overridable per usage — they stay fixed on the shared Attribute definition. (Considered and rejected an override wrapper: low expected frequency of divergence, and where it does diverge, that's a signal to define a separate attribute, not to fork display text per usage.)
- `show_condition` **is** per-usage — it depends on an activity's specific other attributes, so it cannot live on the shared Attribute. It moves to a small wrapper at the point of reference.

**Resulting shape** — `Activity.attributes` changes from a flat list of inline Attribute definitions to a list of usage wrappers:

```
Activity.attributes: [
  { attribute_ref: "attr_wo_type", show_condition: <expr>? },
  { attribute_ref: "attr_completed_by" },
  ...
]
```

## 6. Where display-field resolution happens: get operation, not UI

**Decided:** display-field resolution (turning a stored `fk_ref` id into a human-readable label) happens in the **Store's get operation** — the seam already established (`POC1a_Build_Summary.md`: "components call the hook, never the adapter directly") — not duplicated per-UI-surface (`FkDisplay.tsx`, grid rendering, etc. each re-resolving independently).

**Explicitly out of scope for this change:** the reporting mirror. `SaaS_Platform_Specification_v2.md` §1.5 mirrors the raw `Data` payload flat, with no joins at write time. Resolving display fields in the Store's get operation does **not** reach the reporting DB — Power BI / external reporting will still see raw ids unless resolution is separately baked into the `Data` payload before mirroring. That's a distinct, later decision (and reintroduces staleness risk if a target's display field is ever renamed after mirroring) — not addressed here. For POC1, resolve fresh in the get operation only.

## 7. Open / not yet resolved

- **`reference` attribute picker resolves its display field by key-matching, not its own `fk_display_field`.** With `fk_display_field` living only on CustomField, a `reference`-typed Attribute's `type_config` (`{ fk_record_type }` only) has no display-field of its own. Resolution rule: match `attribute.key` against the relevant Record type's CustomFields — the **target type** for `record_map: CREATE`/`UPDATE` activities (§1.9.2/§1.9.3), or the **anchor Record's type** for ordinary capture activities (no commit required — this is a lookup, not a write). If a matching CustomField exists and has `type: fk_ref`, borrow its `fk_display_field`. This generalises the existing exact-key matching mechanism (§1.9.3) to a new purpose (display resolution) rather than adding a new mechanism.
  - **Remaining gap, not resolvable by this rule:** an attribute with `type: reference` whose `key` matches **no** CustomField on the relevant type has nothing to borrow from. Falls back to raw-id display. This is an inherent limitation of deriving the display field by matching rather than specifying it explicitly — not something a smarter rule can close.
- **Expression scope for `listExpression` and `show_condition`.** Both need to read the anchor Record's committed custom field values (already implied by §1.8). Whether they can also read **sibling attribute values captured in the same in-flight form submission** (not yet committed) is not settled — needs a decision before `listExpression` can be implemented for cases like WO Type filtering by a Job Type captured in the same step.
- **Type registry** — needs to actually be written as a companion doc/section (not just referenced here), since `type_config` shapes are no longer self-documenting via fixed table columns.
- **Reporting-side display resolution** — deferred, see §6.

## 8. Migration impact

- `sample_inspection_type.json`: `assets.asset_type_id` currently uses flat `fk_record_type`/`fk_display_field` on a `type: text` field — needs updating to the new vertical shape (`type: "reference"`, `type_config: { fk_record_type }`) for the attribute, and `type: "fk_ref"` + `fk_record_type` + `fk_display_field` for the custom field.
- Any code reading `attribute.fk_record_type` / `attribute.fk_display_field` directly (e.g. `AttributesForm.tsx`, `RecordPickerDialog.tsx` per `POC1a_Build_Summary.md`) needs to read from `attribute.type_config.fk_record_type`, and resolve display via the key-matching rule (§7) instead of a stored `fk_display_field` on the attribute.
- `FkDisplay.tsx` / custom-field FK resolution logic reads `customfield.type === "fk_ref"` + `customfield.fk_record_type` + `customfield.fk_display_field` (unchanged from today, now under the `fk_ref` type rather than implied by `type: text` + side-fields).
- Activity attribute definitions across the sample workflows move from inline to `attribute_ref` + optional `show_condition`, backed by a new standalone attributes collection.
- Store interface (`interface.ts`) gains responsibility for resolving `fk_ref` display labels on get operations, per §6 — this is new logic, not just a field-shape change.
