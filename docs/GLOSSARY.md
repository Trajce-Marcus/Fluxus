# Fluxus — Glossary

Canonical definitions. If a doc or discussion uses one of these terms differently, this file wins; if a new term earns repeated use, add it here.

## Model

- **SDM (Shared Data Model)** — the single definition of record types, attributes, workflows, and activities; the platform's unit of scope (records, scripts, and the DSL all bind to one SDM). The canonical source of truth; everything else is a projection over it.
- **Record type** — a collection definition (e.g. `rt_assets`): custom fields, FK refs, and a reference to its workflow. Named plural — it names a collection.
- **Record** — one instance of a record type: `id`, `typeRef`, custom field values, and its activity history.
- **Custom field** — a typed field on a record type (`text`, `int`, `bool`, `date`, `fk_ref`, …) with optional constraints (`required`, `unique`, `immutable`, `indexed`).
- **Attribute** — a standalone, reusable definition of a capturable input (label, type, type_config). Activities reference attributes; attributes are shared across activities.
- **Workflow** — the ordered set of activities available for a record type. One workflow per record type.
- **Activity** — the unit of action and the only way data changes. Has attributes (its inputs), an optional `record_map` (CREATE/UPDATE/DELETE/GET; null = log-only), and before/after hooks. In headless mode, an activity is a callable function whose attribute list is its parameter signature.
- **GET activity** — `record_map: "GET"`: a query activity; attributes are parameters, a `returns` expression produces the response. Never mutates (validator-enforced); logged like every activity (async, retention-managed). The platform's read path — apps call GET activities instead of ad-hoc APIs.
- **Activity history** — the append-only per-record log of executed activities and exactly what the user entered. The audit spine.
- **Hook** — DSL script on an activity. **Before hook** = gate: validation only, `fail("msg")` vetoes, `warn("msg")` soft-stops (user confirms or cancels), nothing persists. **After hook** = effects: record mutations (transactional) and service calls.
- **Anchor record** — the record an activity is run against; what `context.record` points to inside its hooks. CREATE activities have no anchor until the record exists (the after hook sees the created record).
- **Waiver (`can_waive`)** — a per-usage escape hatch on a required attribute: the user declares the value unavailable ("can't provide") with a mandatory reason instead of entering fake data. Recorded on the history entry (`waived: { key: reason }`); the record field is never written. Known-missing beats plausible-wrong.
- **Compensating activity** — the only way to undo. History is never edited, so a post-commit mistake is reversed by a modeled activity (`act_cancel_…`) that posts the correction, accounting-reversal style. There is no generic platform undo (after-hook effects and queued service calls are not invertible), and no admin surface may edit or remove history.
- **Workbench** — the out-of-the-box vanilla UI every SDM gets for free (record type list → records grid → record view with activities). The generic runtime face of whatever model the config carries: a usable tool with zero app-building, and the proving ground for DSL features. The page builder is the optional bespoke layer on top — apps come and go, the workbench comes with the model. (Decided July 2026: name kept, positioning explicit.)

## Language

- **DSL** — the one Fluxus scripting language (working name *FluxScript*): JS/SQL blend, no lambdas, case-insensitive, null-safe, no visible async. Three tiers: expressions → queries → scripts.
- **Four roots** — the entire environment a script can touch, dependency-injected by the host: `context` (user, record, activity, workflow), `attributes` (captured values), `records` (SDM data graph), `services` (add-on modules).
- **Datasource** — any DSL expression evaluating to a list; powers `List` attributes and page bindings. May be an inline literal, a `records` query, or a service call.
- **Show condition** — DSL expression deciding applicability. On an attribute usage: whether the attribute is presented (UI) or accepted (headless); errors leave it visible. On an activity: whether the activity is offered/invocable at all — the **availability gate**, re-checked as the first step of the activity pipeline; `attributes` is unavailable (runs before capture) and errors fail closed.
- **`queue`** — keyword marking a service call as fire-and-forget; dispatched only if the surrounding transaction commits (outbox pattern).
- **Service module** — the unit behind the `services` root: manifest (name, description, functions with params + `kind`) plus implementation. `kind: read` = pure query, callable anywhere; `kind: effect` = changes the world, after hooks only, prefer `queue`. Manifests make service calls schema-validatable (existence, arity, purity) at config-save time.
- **Scope-blind** — scripts never name their org, repo, or SDM; scope is injected. Locked invariant.
- **Schema-aware validation** — every script checked against the SDM at config-save time (unknown types/fields/shapes fail before runtime).

## Pages and apps

- **Page** — a layout of panels with slots, each slot wired to a component; defined declaratively, rendered by the page builder runtime.
- **Component manifest** — a component's contract: name, version, prop schema (static-config, dynamic-data with item shapes, callbacks).
- **ComponentContainer** — the runtime adapter between a slot's wiring config and the SDM-blind component; resolves dynamic props, wires callbacks.
- **Wiring (slot config)** — the per-page adapter binding a component's ports to a specific SDM: DSL queries for dynamic props, actions (incl. `run activity`) for callbacks.
- **App (module)** — a coarse-grained reusable component (e.g. calendar scheduler) shipped with a manifest; rewired per SDM through slot config, never rewritten.
- **Activity spine** — the property that data + behaviour + audit share one backbone because every surface mutates only via activities.

## Organisation (future)

- **Hierarchy** — **org + SDM only**, GitHub-style. Org = tenant (users, auth, billing, org-scoped reporting). **Repos** (org-defined) hold SDMs and are the unit of sharing/import and permissions; **folders** inside repos are pure navigation with no semantics. Domain structure (divisions, projects, contracts) is the org's own repo/folder naming plus record types inside SDMs. SDM ids are stable; paths are display-only. Not yet built; the scope-blind invariant exists so its arrival changes no scripts.
