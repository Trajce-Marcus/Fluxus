# Querying the model

**Status: BUILT 2026-09-22.** Agreed 2026-09-21/22. Rewritten 2026-09-22 after an
independent review found the first approach — a fifth root with its own type
system — both expensive and leaky. This version reuses the machinery that
already exists.

Makes the SDM itself queryable — record types, their fields, attributes,
workflows, activities, functions, roles — in the same language, the same chain,
and now the same *mechanism* that queries records.

Spans `dsl`, `engine`, `server` and `console`, so it lives here.

---

## 1. Why

The DSL Editor queries data but not design. Two questions came up within minutes
of first using it and the tool could not answer either: *what fields does this
record type have*, and *what is this type's name exactly*. Both are one query
away if the model is queryable.

The Console already reads the model by hand for its own panels — "which
attributes does nothing use" is a built screen (`AttributesEditor.tsx`). A
queryable model generalises that.

## 2. The approach: model collections are record types

**There is no new root.** The model's collections are declared as **record
types in the ordinary type table**, and answered by a records host that reads
the `SolutionConfig` instead of the record store.

The insight is the one .NET rests on: a type is a name with members, and the
metadata is described the same way as everything else. The validator already
has that shape — `TypeSchema` is `{ fields: Record<string, FieldSchema> }`
([validator.ts](../packages/dsl/src/validator.ts)) and `records` resolves
through it.

What this buys, all of it load-bearing:

- **No new validator machinery.** `recordsRoot`, chain shapes, `select`
  flattening, bare-field scope, the record/row rule — every one works
  unchanged, because these are types like any other.
- **Dereference comes free.** `RecordsHost.fkTarget(type, field)` is what drives
  FK auto-dereference. Declaring `workflow_ref` as pointing at the workflow type
  makes drilling work with no new mechanism.
- **Exposure is opt-in, not opt-out.** The first draft added a root to `ROOTS`,
  which made it available everywhere by default and required ~15 embedding
  points to each opt out — with hooks and named-function bodies unable to, since
  neither passes `bannedRoots`. Here the types are simply absent from the schema
  and the host unless a caller asks for them. A hook's schema never contains
  them, so `records.sdm_record_types` fails to validate exactly as a misspelt
  type does.
- **`RecordsHost` is an interface** — `hasType`, `getAll`, `getById`,
  `fkTarget`, `reverseRef`. Nothing requires it to read the record store.

Cost of the approach, stated: model types share the `records` namespace with
the solution's own types, so they need a reserved naming rule (§3).

## 3. The `model` root, over internally prefixed types

Addressed as **`model.<collection>`** (ruled 2026-09-22, the user's preference
over `records.sdm_*`).

This is not the expensive root the first draft proposed. `model` resolves
against the **same type table** as `records`, with an internal `sdm_` prefix:
`model.record_types` looks up `sdm_record_types` in `schema.types` and returns
the same `recordList` shape `records` returns. About six lines in the validator
beside the `recordsRoot` case, mirrored in the evaluator. No new shape family,
no second type table, and the four-roots statement in DSL_SPEC and GLOSSARY is
untouched — `model` is a lookup alias, not a new environment.

```
model.record_types
model.fields
model.attributes
model.workflows
model.activities
model.activity_attributes
model.functions
model.roles
```

The `sdm_` prefix never appears in a script, and that is **enforced, not
assumed**: `records.sdm_record_types` is refused with a message naming the
`model.` spelling, in the evaluator and the validator alike. Without that the
prefix was a second way in, and one that skipped the read-only guard.

It exists so model types cannot collide with a solution's own: record type ids are written `rt_*` and stripped
for scripts, so only a solution declaring `rt_sdm_…` could clash. **The
save-time check must reject that**, in `validateConfig.ts` beside the existing
key checks — `validateConfigGraph` runs `validateConfig()` on every write, whole
config and per-entity alike, so one check covers both paths.

## 4. What is projected, not the raw config

These types expose a **chosen vocabulary** mapped from the stored config, not
the config's own field names — because exposing `custom_fields`,
`fk_record_type`, `type_config`, `access.read` and `indexed` would make every
internal key a name scripts depend on, and would leak RBAC internals and
storage hints.

This is not a new idea: **records are already projected.** A stored record is
`{ id, typeRef, customFields, activityHistory }`; a script sees
`{ id, type, fields }`, with history dropped entirely (`toDslRecord`,
`bridge.ts`). Platform names are projected, author names pass through.

### Two rules the projection must obey

1. **Every declared field is materialized, including nulls.** `lookupKey` tests
   `name in obj`, so a key that is merely *absent* falls through to the outer
   scope and raises `Unknown name '<x>'` inside `where`/`select`. Config objects
   come from JSON where optionals are simply missing — `description`,
   `required`, `show_condition`, `record_map`, `default`. Each must be emitted
   as an explicit null. This is the same class as the known gap in DSL_SPEC §12
   and is the single most likely thing to break in the first build.
2. **Names must be the ones scripts use.** `records.<type>` takes the *short*
   name (`shortName` strips `rt_`), so a projection that answers
   `rt_projects` hands back a string that cannot be pasted after `records.`.
   Both are exposed, and they are named for what they are (§5).

## 5. The collections

Corrected 2026-09-22 against the real types after review; the notes below record
what is **stored**, what is **derived**, and what is **synthesised**, because
three of these collections have no identity of their own.

### `model.record_types`

`id` (`rt_projects`, as stored) · `query_name` (`projects` — **what you type
after `records.`**, derived by stripping `rt_`) · `name` · `description` ·
`workflow_ref` → `model.workflows`

`access.read` is **not** exposed — RBAC internals the engine keeps out of the
script environment, and stripped from the client grade for the same reason.

### `model.fields`

A separate collection rather than a nested list, so fields can be queried across
types ("every reference field in the solution").

`id` **synthesised** as `<record_type>.<key>` — a custom field has no id of its
own; identity is the pair · `record_type_ref` → `model.record_types` · `key` ·
`label` · `type` · `target` · `target_ref` → `model.record_types` ·
`target_display_field` · `required` · `unique` · `immutable` · `default`

- `label` falls back to the key when absent **or blank**, which is `fieldLabel`'s
  rule and therefore what every display surface shows.
- **`target` and `target_ref` are two columns because one value cannot answer
  both questions.** `target` is the **query name** (`sites`) — what you paste
  after `records.`. `target_ref` is the stored id (`rt_sites`) and is the one
  that dereferences into `model.record_types`. A single column holding the query
  name could not dereference, since the collection is keyed by the stored id.
- `target_display_field` is `fk_display_field` — what display surfaces render an
  FK with.
- `indexed` is not exposed: a query-pushdown hint, not model.

### `model.attributes`

The solution's pool. `id` is the `key` — the table is keyed
`(solutionId, key)` and carries no id column.

`key` · `label` · `description` · `type` · `config` · `sub_attributes` ·
`source` · `show_condition` · `required` · `validation` ·
`validation_message` · `can_waive`

- `config` is `type_config` passed through raw, with `max_size_mb` **stripped**
  — a server-only presign gate deliberately absent from the client grade.
- `sub_attributes` is projected from `type_config.attributes`. The field of that
  name on the stored definition is populated only at resolution time and is
  always absent on pool definitions, so projecting it directly would answer null
  for every composite.
- The pool-level `source`/`show_condition`/`validation`/`validation_message`/
  `can_waive` **are** the defaults a usage falls back to. `required` is **not** —
  see the defect recorded in `packages/engine/docs/SPEC.md`. It is projected
  because it is stored, and it means "the pool's value", not "the effective
  value".

### `model.workflows`

`id` · `name` · `description`. Activities are their own collection.

### `model.activities`

`id` · `name` · `description` · `workflow_ref` → `model.workflows` ·
`record_type_ref` → `model.record_types` · `sort_order` · `record_map` ·
`show_condition` · `before_hook` · `after_hook` · `returns`

- `workflow_ref` is **derived from nesting** — activities are stored inside
  their workflow, not with a pointer to it.
- `record_type_ref` is **derived by reverse lookup**, workflow → record type.
  An activity carries no record type, and **nothing enforces one record type per
  workflow**: `validateConfig.ts` already builds a last-wins map of
  `workflow_ref → record type`, and `findActivity` can never see an activity in
  a workflow no record type points at. This projection answers **null** when no
  record type points at the workflow, and the **first** by config order when
  more than one does, rather than pretending the relationship is single.
- `record_map` is null for log-only activities.
- Hook and `returns` source text is included (§7).

### `model.activity_attributes`

One row per entry in an activity's ordered capture list.

Every activity has its list, **including those in a workflow no record type
points at** — `model.activities` lists them, so a count over this collection
would otherwise be silently short. That needs `Store.listWorkflows`, added for
this, since the record-type route cannot reach an orphan workflow.

**Projected from the resolved list.** An activity's stored list is
heterogeneous — attribute usages *and* section markers, the latter carrying no
`attribute_ref` at all — so projecting it raw means every query over it fails on
the first activity with a heading. `MemoryAdapter` already resolves the list
into uniform definitions, merging usage overrides and turning markers into
pseudo-definitions of `type: 'section'`.

`id` **synthesised** as `<activity>.<position>` · `activity_ref` →
`model.activities` · `position` · `kind` (`'attribute'` | `'section'`) · `key` ·
`label` · `type` · `required` · `source` · `show_condition` · `validation` ·
`validation_message` · `can_waive`

- `kind` is **derived** from the resolved `type === 'section'`, so a heading is a
  row you filter out rather than a shape that breaks the query.
- There is no `attribute_ref` field after resolution: the resolved entry *is*
  the pool definition, so `key` is the link back to `model.attributes`.
- A section's text is in `label`. Resolution keys markers `_section_N` off a
  counter that increments across every workflow in the solution, so those keys
  shift when an earlier workflow gains a heading — **never treat them as
  stable**, which is why `position` is projected.

### `model.functions`

`id` · `name` · `description` · `body` · `params`

`description` is mandatory on a named function and is projected. `params` is **derived with the real parser** (`parseFunction`), not a pattern
match: a body the DSL accepts must never be reported as unparseable. A body that
genuinely does not parse yields null rather than an empty list — the two are
different answers and must not look alike, which is exactly why a regex was not
good enough (a leading comment defeated it, and it then answered null).

### `model.roles`

`id` · `name` · `description`. Definitions only — assignments live in the
governance tables and are not model.

**An empty result is ambiguous, and stays so in v1.** Roles live at
`config.access?.roles`, and *absent* means RBAC is dormant — every record type
reads open — while *empty* means roles exist and none are declared. The stored
config preserves that distinction deliberately; this projection cannot express
it. Documented, not solved: exposing an `rbac_enabled` flag is a model change,
and this spec does not make one.

## 6. Shape and chain

Unchanged from data, because these are records:

- **no `select`** → a record: `{ id, type, fields: { … } }`
- **`select(...)`** → a flat row

Chain methods are `where`, `orderBy`, `select`, `values`, `top`; `first` and
`count` are properties, not methods — `.count()` is an error. Chains work on any
array, so nested lists remain chainable.

## 7. Who may read it

**The Console is the gate** (ruled 2026-09-22, the user, consistent with the
same ruling on the editor itself). The DSL Editor is a Console surface and
operation users have no Console access, so no further check is applied and
**hook and `returns` source is included** in the projection.

Recorded so a later session does not mistake it for an oversight: `config.get`
requires sol admin for this same content, and `scripts.query` requires only
`requireOpUser`, so the endpoint is a wider door than the Console implies —
anyone holding an operation user's token can call it directly. This is the same
exposure already recorded in DSL_EDITOR_SPEC §10 and accepted there. Revisit it
with the operation-lifecycle work, not here.

A gate was designed and dropped: it cannot be implemented where it was written.
The schema is built in the **browser** (`DslEditorView.tsx`) while the host is
built on the **server**, and `scripts.query` runs no validator at all — so the
browser has no way to know whether the caller passed a server-side check, and
`me` reports org and operation admin tiers but no sol-admin bit. Declaring the
types client-side regardless would enable Run and fail server-side; not
declaring them would disable Run for the people the tool is for.

## 8. Where it is supplied

`scripts.query` already loads the `SolutionConfig` (`loadOperationHost`). When
the caller passes §7's check, it builds the model types into the schema and
wraps the records host so those types are answered from the config. No new
storage, no new endpoint, no extra round trip.

Nothing else supplies them: not hooks, not page bindings, not datasources, not
GET activities, not the page builder's expression dialog. Adding them elsewhere
is a deliberate act, which is the point of §2's opt-in.

**Known cost, not introduced here:** `scripts.query` loads the operation's whole
record partition on every call, so a pure metadata question still pays for it.

**Known limit:** the model is solution-scoped but `scripts.query` is
operation-scoped, so a solution with no operation cannot be introspected. Worth
fixing later by letting the endpoint take a solution with no operation.

## 9. Costs, stated plainly

- **A second view of the SDM to keep in sync.** Every new model concept
  (modules, releases, retention) must be projected or deliberately left out.
  This is the recurring price of §4.
- **`config` on an attribute is a raw passthrough**, so attribute type-config
  internals are exposed. The alternative is projecting a narrower subset and
  losing the open-endedness that makes attribute types extensible.
- **`sdm_activity_attributes` depends on the adapter's resolution**, so the
  projection is coupled to resolution behaviour rather than to storage alone.

## 10. Decisions taken

1. **`model.<collection>`**, over an internally `sdm_`-prefixed type table
   (§3) — the user, 2026-09-22.
2. **No permission gate; hook source included** (§7) — the user, 2026-09-22:
   the Console is the gate and operation users have no Console access.
3. **`model.roles` cannot distinguish dormant RBAC from no roles** (§5).
   Documented rather than solved.
4. **`config` stays a passthrough** with `max_size_mb` stripped (§5, §9).

## 11. What this replaces

The first draft of this document proposed a fifth root, `model`, with its own
shape family in the validator. Recorded as a reversal rather than deleted:

- It needed new machinery in `DslSchema`, which has slots for record types and
  services only.
- The cheap alternative (`extraRoots`) validates to `UNKNOWN`, which makes
  `where(id = …)` report "Unknown name 'id'" and **disables Run** — so the root
  could not ship half-typed.
- `bannedRoots` only fires for names already in `ROOTS`, making exposure
  opt-out across ~15 sites, two of which (hooks, named-function bodies) pass no
  `bannedRoots` at all.
- It would have falsified GLOSSARY's and DSL_SPEC's "four roots", which this
  approach leaves true.

Also withdrawn from that draft: the claim that exposing the model to runtime
rules would be novel. It is not — Apex triggers call `Schema.getGlobalDescribe()`
and ServiceNow business rules query `sys_dictionary`, both inside business
logic. The reason to keep this out of hooks is not novelty; it is that a stored
query becomes a contract, and the case for it is currently thin.

## 12. Docs on build

Same commit: `packages/dsl/docs/DSL_SPEC.md` (the `model` root as a lookup
alias — the four roots statement stands), `packages/engine/docs/SPEC.md` (the
projection and the config-backed records host), `packages/server/docs/SPEC.md`
(what `scripts.query` supplies), `packages/console/docs/DSL_EDITOR_SPEC.md`,
`docs/GLOSSARY.md` (the collections), and `docs/CLIENT_TRUST_BOUNDARY.md` §2,
whose table codifies what the design plane may see and which this touches
directly.

**Authorship is out of scope and worth saying so:** every `sdm_*` table carries
`created_at`/`created_by`/`updated_at`/`updated_by`, and `sdm_config_versions`
holds the model's history, but `getSolutionConfig` reads only `def`. So "who
last changed this activity" is unanswerable through this design. Adding it means
reading more than the config, which this does not do.
