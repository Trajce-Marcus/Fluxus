# Fluxus — Glossary

Canonical definitions. If a doc or discussion uses one of these terms differently, this file wins; if a new term earns repeated use, add it here.

## Model

- **SDM (Shared Data Model)** — the single project-scoped definition of record types, attributes, workflows, and activities. The canonical source of truth; everything else is a projection over it.
- **Record type** — a collection definition (e.g. `rt_assets`): custom fields, FK refs, and a reference to its workflow. Named plural — it names a collection.
- **Record** — one instance of a record type: `id`, `typeRef`, custom field values, and its activity history.
- **Custom field** — a typed field on a record type (`text`, `int`, `bool`, `date`, `fk_ref`, …) with optional constraints (`required`, `unique`, `immutable`, `indexed`).
- **Attribute** — a standalone, reusable definition of a capturable input (label, type, type_config). Activities reference attributes; attributes are shared across activities.
- **Workflow** — the ordered set of activities available for a record type. One workflow per record type.
- **Activity** — the unit of action and the only way data changes. Has attributes (its inputs), an optional `record_map` (CREATE/UPDATE/DELETE), and before/after hooks. In headless mode, an activity is a callable function whose attribute list is its parameter signature.
- **Activity history** — the append-only per-record log of executed activities and exactly what the user entered. The audit spine.
- **Hook** — DSL script on an activity. **Before hook** = gate: validation only, `fail("msg")` vetoes, nothing persists. **After hook** = effects: record mutations (transactional) and service calls.

## Language

- **DSL** — the one Fluxus scripting language (working name *FluxScript*): JS/SQL blend, no lambdas, case-insensitive, null-safe, no visible async. Three tiers: expressions → queries → scripts.
- **Four roots** — the entire environment a script can touch, dependency-injected by the host: `ctx` (user, record, activity, workflow), `attrs` (captured values), `records` (SDM data graph), `services` (add-on modules).
- **Datasource** — any DSL expression evaluating to a list; powers `List` attributes and page bindings. May be an inline literal, a `records` query, or a service call.
- **Show condition** — DSL expression deciding whether an attribute is presented (UI) or accepted (headless).
- **`queue`** — keyword marking a service call as fire-and-forget; dispatched only if the surrounding transaction commits (outbox pattern).
- **Scope-blind** — scripts never name org/operation/project; scope is injected. Locked invariant.
- **Schema-aware validation** — every script checked against the SDM at config-save time (unknown types/fields/shapes fail before runtime).

## Pages and apps

- **Page** — a layout of panels with slots, each slot wired to a component; defined declaratively, rendered by the page builder runtime.
- **Component manifest** — a component's contract: name, version, prop schema (static-config, dynamic-data with item shapes, callbacks).
- **ComponentContainer** — the runtime adapter between a slot's wiring config and the SDM-blind component; resolves dynamic props, wires callbacks.
- **Wiring (slot config)** — the per-page adapter binding a component's ports to a specific SDM: DSL queries for dynamic props, actions (incl. `run activity`) for callbacks.
- **App (module)** — a coarse-grained reusable component (e.g. calendar scheduler) shipped with a manifest; rewired per SDM through slot config, never rewritten.
- **Activity spine** — the property that data + behaviour + audit share one backbone because every surface mutates only via activities.

## Organisation (future)

- **Hierarchy** — organisation → operation → project. The SDM and its records are project-scoped; services are global modules. Not yet built; the scope-blind invariant exists so its arrival changes no scripts.
