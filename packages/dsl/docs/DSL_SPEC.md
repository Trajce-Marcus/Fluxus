# @fluxus/dsl — Language Specification

The one Fluxus scripting language (working name **FluxScript**). This is the founding spec, capturing the design settled in July 2026; it is the living truth and is updated as decisions change. Why the platform needs exactly one language is argued in [docs/VISION.md](../../../docs/VISION.md); how the language sits between the SDM and the page builder is in [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md).

## 1. Goals and non-goals

**Goals**

- As easy to learn as SQL. Business users who write SQL procs and functions today are the audience.
- A blend of JS and SQL readability — JS-like statements, SQL-like queries — without sacrificing loops and conditional logic.
- One language across every scripted surface: attribute show conditions and datasources, before/after hooks, page-builder bindings, headless workflows.
- Statically checkable against the SDM at config-save time.

**Non-goals**

- Not raw or sandboxed JavaScript (no lambdas, no async surface, no truthiness traps). This was decided decisively: the first language ships and gets locked in by user-authored scripts, so there is no cheap-start option.
- Not a UI/low-code expression builder. Text is the medium; tooling (validation, autocomplete, errors) is what makes text friendly.

## 2. One language, three tiers

| Tier | Contents | Used by |
|---|---|---|
| **Expressions** | values, comparisons, `and/or/not`, field access, function calls | show conditions, defaults, config values |
| **Queries** | expressions + `records.<type>.where(...).orderBy(...).select(...)` | attribute datasources, page bindings, lookups in scripts |
| **Scripts** | queries + `if/else`, `for each`, `let`, `fail()`, `queue`, mutations | hooks, headless workflows, named functions |

Each embedding point admits a tier: a show condition is an expression, a datasource is an expression that yields a list, a hook is a script. A user who can write a show condition already knows most of what a hook needs.

## 3. The four roots

The entire environment a script can touch, dependency-injected by the host at call time:

| Root | Contents |
|---|---|
| `ctx` | execution context: `ctx.user`, `ctx.record` (anchor record), `ctx.activity`, `ctx.workflow` |
| `attrs` | captured attribute values for the activity in flight, including attributes captured earlier in the same activity (basis of dependent attributes) |
| `records` | the project-scoped SDM data graph: `records.<record_type>` for query and mutation |
| `services` | global add-on modules: `services.notify.email(...)`, `services.geo.geocode(...)`, published functions |

Additional roots may be injected per embedding point (e.g. `event` — the callback payload — in page-builder callback wiring).

**Every script is a function.** Inline scripts (hooks, conditions, datasources) receive the four roots implicitly. Named functions (see §8) may declare explicit parameters and still receive the roots implicitly. Scripts never construct their environment; the host always hands it in — which is why the same script runs unchanged in the browser, in Lambda, and inside the page builder.

**Scripts are scope-blind.** They never name an organisation, operation, or project. Scope arrives via injection. This invariant is locked now so that the future org → operation → project hierarchy changes no scripts.

## 4. Syntax

Formal grammar: [GRAMMAR.md](GRAMMAR.md) (EBNF, precedence, lexical rules, and the ⚑-flagged micro-decisions pending sign-off).

### 4.1 Expressions

```
ctx.record.status != 'Closed'
attrs.qty > 0 and attrs.qty <= 100
ctx.record.contract_id.contact_email      ← FK auto-dereference
```

- **Comparison is SQL-style `=`** (and `!=`; `==` and `<>` accepted as aliases). In statement position `=` is assignment (`let x = 5`, `x = 5`); in expression position it is comparison — context-resolved, as SQL users already expect from `SET x = 5` vs `WHERE x = 5`.
- **`and` / `or` / `not`** — words, not symbols. `in` and `between` supported.
- **Case-insensitive throughout**: keywords, identifiers/field names, and string comparison (`status = 'open'` matches `"Open"`), SQL-collation style. An `exact(a, b)` function covers the rare case-sensitive comparison. FK resolution and record identity are engine-internal and always exact.
- **Null-safe navigation by default**: a dotted path through a null yields null rather than an error.
- **FK auto-dereference**: the SDM knows a field is `fk_ref`, so dotting past it (`contract_id.contact_email`) transparently fetches the target record.
- **No visible async**: calls that wait (e.g. `services.geo.geocode(addr)`) look synchronous; the interpreter awaits internally.

### 4.2 Queries

```
records.resources
  .where(rest_type = 'Labour' and status = 'Active')
  .orderBy(name)
  .select(id, name, rate)
```

- Inside `where(...)`, **bare field names are scoped to the queried record type** — the SQL trick that removes the need for lambdas. Roots (`ctx`, `attrs`, …) remain visible for the other side of comparisons: `where(city_id = attrs.city)`.
- `select(...)` projects and **aliases**: `select(id, title: code, start: due_date)`. Aliasing is the adapter that maps SDM fields onto a consumer's expected shape (page-builder ports, service payloads).
- Chain set (initial): `where`, `orderBy`, `select`, `first`, `count`. Extended (later, as needed): `top/limit`, `sum/min/max`, grouping.

### 4.3 Statements (scripts tier)

```
if attrs.wo_resources.count = 0 {
  fail("Select at least one resource")
}

for each r in attrs.wo_resources {
  records.wo_resources.create({
    work_order_id: ctx.record.id,
    resource_id: r.id,
    qty: 1
  })
  queue services.notify.sms(r.contact, "Assigned to " + ctx.record.code)
}
```

- `let x = ...`, `if/else`, `for each x in <list>`. No `while` initially — scripts provably terminate.
- `fail("message")` — abort with a user-facing message (see hook semantics, §6).
- `warn("message")` — non-blocking message to the invoking surface.
- `queue <service call>` — fire-and-forget; see §7. The validator rejects any use of a `queue`d call's return value.
- Mutations: `records.<type>.create({...})`, `records.<type>.update(<id or record>, {...})`. (Delete deferred until the SDM defines its delete semantics.)

## 5. Attributes and datasources

The `List` attribute type (replaces separate valueList / record-lookup variants): its **datasource is any expression that yields a list** —

```
["Sydney", "Melbourne", "Brisbane"]                            ← inline literal
records.resources.where(rest_type = 'Labour').orderBy(name)    ← query
services.geo.suburbs(attrs.city)                                ← service-backed
```

Scalars render as a simple picker; records/objects as a grid picker driven by `type_config` (`selection: single|multi`, `columns`, `key_field`). A datasource referencing `attrs.<earlier key>` creates a dependent attribute (city → suburb) and re-evaluates when that value changes.

`show_condition` (expression tier) decides whether an attribute is presented (UI) or applicable (headless). In headless mode the datasource doubles as validation: a submitted value must be in the datasource's result set.

Storage is unchanged from the SDM runtime: captured attributes persist to activity history as primitives or JSON — exactly what the user entered, untouched by any script.

## 6. Hooks

**Before hook = gate.** Runs on activity submission, before anything persists. May read anything (`ctx`, `attrs`, any `records` query, read-only service calls). May `fail("msg")` — the activity is rejected, nothing persists — or `warn("msg")`. **Validate only**: before hooks never modify `attrs` or records. Derived/prepped values are the after hook's job, which keeps activity history a truthful record of user input.

**After hook = effects.** Runs after the activity persists. Contains the data logic: loops, conditional mutations, service calls, invoice-style derivations.

## 7. Transactions and `queue`

After-hook record mutations are **staged and committed atomically** when the hook completes. If the hook fails midway, no mutations apply.

`queue`d service calls are held in the same staging area and **dispatched only if the commit succeeds** (outbox pattern) — eventually to a separate queue/process. Hook fails → no records changed, no messages sent. Business users get transactional behaviour without learning the word.

Waiting service calls with side effects inside after hooks are the documented non-transactional exception — prefer `queue` for anything with effects.

## 8. Named functions

Scripts can be named, stored in the SDM as a first-class collection (like `attributes`), and reused by attributes, workflows, and apps:

```
function calcInvoiceTotal(resources, rate) {
  let total = 0
  for each r in resources {
    total = total + r.hours * rate
  }
  return total
}
```

Named functions declare explicit parameters and still receive the four roots implicitly. Creation is open to users (SQL proc/function users adapt readily); constraints that keep openness from decaying into sprawl — mandatory description, flat namespace, schema validation, possibly versioning/permissions — are deliberate enablers, to be specified when Phase 2 lands.

## 9. Validation and safety

- **Schema-aware static validation at config-save time** — the defining feature. Every script parses and checks against the SDM: unknown record types/fields, type mismatches in comparisons, `queue` return-value misuse, and (once manifests carry shape contracts) query projections checked against page-builder port shapes. Errors surface when the config is saved, not when a user runs the activity.
- **Runaway protection from day one**: max loop iterations, max rows per query, execution timeout — quotas enforced by the interpreter.

## 10. Implementation

Own grammar, hand-rolled or Chevrotain-based parser, **tree-walking interpreter in TypeScript** — one implementation running in the browser (datasources, show conditions, page bindings, POC hooks) and on the server (hooks, headless) once the backend lands. All host functions are async under the hood; the interpreter awaits internally so the language surface stays synchronous.

Hosts integrate by implementing the root providers (record store adapter, context, service registry) and calling `evaluate(script, roots)` / `validate(script, sdm)`.

## 11. Phases

1. **Phase 1 — expressions + queries.** Grammar, interpreter, validator. Proven in the sdm workbench: `show_condition` and `List` datasources with `attrs.` dependencies (city → suburb is the acceptance test). Entirely client-side.
2. **Phase 2 — scripts.** Statements, `fail`/`warn`, `records` mutations, transactional after hooks, `queue`. Fills the sdm hook slots; `run activity` callback action in the page builder (payload as `event` root).
3. **Phase 3 — services registry** with one or two real modules (notify, geocode).
4. **Phase 4 — headless invocation**: activities as the API surface over the agreed backend stack.

## 12. Open items

- Named-function governance constraints (naming rules, permissions, versioning) — with Phase 2.
- Delete semantics (`record_map: DELETE`, `records.x.delete`) — needs SDM-level decisions first.
- Aggregations/grouping in queries — add when a real case demands them.
- Multi-line script storage in the SDM JSON (string arrays vs a `scripts` section vs sidecar files) — decide at Phase 1 implementation; leaning `scripts` section referenced by id for anything longer than one line.
- ~~Formal grammar (EBNF)~~ — written: [GRAMMAR.md](GRAMMAR.md); its ⚑ decisions (D1–D10) await sign-off.
