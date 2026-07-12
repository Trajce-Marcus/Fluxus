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
| `context` | execution context: `context.user`, `context.record` (anchor record), `context.activity`, `context.workflow` |
| `attributes` | captured attribute values for the activity in flight, including attributes captured earlier in the same activity (basis of dependent attributes) |
| `records` | the project-scoped SDM data graph: `records.<record_type>` for query and mutation |
| `services` | global add-on modules: `services.notify.email(...)`, `services.geo.geocode(...)`, published functions |

Additional roots may be injected per embedding point (e.g. `callbackData` — the callback payload — in page-builder callback wiring and the hooks of callback-triggered activity runs). The converse also holds: an embedding point may **withhold** a standard root when it cannot exist there — activity availability conditions run before capture begins, so `attributes` is banned and the validator rejects a reference at config-save time; page embedding points ban `attributes` for the same reason (no activity in flight).

**Every script is a function.** Inline scripts (hooks, conditions, datasources) receive the four roots implicitly. Named functions (see §8) may declare explicit parameters and still receive the roots implicitly. Scripts never construct their environment; the host always hands it in — which is why the same script runs unchanged in the browser, in Lambda, and inside the page builder.

**Scripts are scope-blind.** They never name an organisation, operation, or project. Scope arrives via injection. This invariant is locked now so that the future org → operation → project hierarchy changes no scripts.

## 4. Syntax

Formal grammar: [GRAMMAR.md](GRAMMAR.md) (EBNF, precedence, lexical rules, and the ⚑-flagged micro-decisions pending sign-off).

### 4.1 Expressions

```
context.record.status != 'Closed'
attributes.qty > 0 and attributes.qty <= 100
context.record.contract_id.contact_email      ← FK auto-dereference
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

- Inside `where(...)`, **bare field names are scoped to the queried record type** — the SQL trick that removes the need for lambdas. Roots (`context`, `attributes`, …) remain visible for the other side of comparisons: `where(city_id = attributes.city)`.
- `select(...)` projects and **aliases**: `select(id, title: code, start: due_date)`. Aliasing is the adapter that maps SDM fields onto a consumer's expected shape (page-builder ports, service payloads).
- Chain set (initial): `where`, `orderBy`, `select`, `first`, `count`. Extended (later, as needed): `top/limit`, `sum/min/max`, grouping.

### 4.3 Statements (scripts tier)

```
if attributes.wo_resources.count = 0 {
  fail('Select at least one resource')
}

for each r in attributes.wo_resources {
  records.wo_resources.create({
    work_order_id: context.record.id,
    resource_id: r.id,
    qty: 1
  })
  queue services.notify.sms(r.contact, 'Assigned to ' + context.record.code)
}
```

- `let x = ...`, `if/else`, `for each x in <list>`. No `while` initially — scripts provably terminate.
- `fail('message')` — abort with a user-facing message (see hook semantics, §6).
- `warn('message')` — non-blocking message to the invoking surface.
- `queue <service call>` — fire-and-forget; see §7. The validator rejects any use of a `queue`d call's return value.
- Mutations: `r.update({...})` on the record itself; `records.<type>.create({...})` at collection level; bulk `.where(...).update({...})` as a chain terminal. Records are read-only values — field assignment errors, pointing to `.update`. (Delete deferred until the SDM defines its delete semantics; see GRAMMAR §5 D13/D14.)

## 5. Attributes and datasources

The `List` attribute type (replaces separate valueList / record-lookup variants): its **datasource is any expression that yields a list** —

```
['Sydney', 'Melbourne', 'Brisbane']                            ← inline literal
records.resources.where(rest_type = 'Labour').orderBy(name)    ← query
services.geo.suburbs(attributes.city)                                ← service-backed
```

Scalars render as a simple picker; records/objects as a grid picker driven by `type_config` (`selection: single|multi`, `columns`, `key_field`). A datasource referencing `attributes.<earlier key>` creates a dependent attribute (city → suburb) and re-evaluates when that value changes.

`show_condition` (expression tier) decides whether an attribute is presented (UI) or applicable (headless). In headless mode the datasource doubles as validation: a submitted value must be in the datasource's result set.

Per-usage settings on an activity's attribute list: `show_condition`, `required` (hidden attributes are exempt), and `validation` — an expression that must evaluate `true` for the captured value, injected as the extra root **`value`** (e.g. `value <= now()`), with an optional `validation_message`. Captured values are coerced to their attribute's declared type before scripts see them. Attribute validation is per-field; cross-record rules belong to before hooks (§6). In headless mode the same three settings define the parameter contract. A fourth setting, `can_waive`, lets the user declare a required value unavailable with a recorded reason instead of entering fake data — an SDM-level concern (see the sdm SPEC); scripts simply see the attribute as null.

`show_condition` also exists one level up, **on the activity itself** — the availability condition: whether the activity is offered (UI) or invocable at all (headless / pipeline gate), e.g. `context.record.status <> 'Completed'`. It is evaluated before capture begins, so `attributes` is withheld (§3) and `context.record` is the anchor — null for CREATE activities, whose conditions can only use the other context members. Two deliberate contrasts with the attribute-level setting: evaluation errors **fail closed** (an access rule must not wave the activity through; a broken attribute condition instead leaves the input visible), and hiding the button is courtesy while the host's pipeline gate — re-running the same expression as the first step before the before hook — is the enforcement. Division of labour: whether the activity applies to this record right now is the availability condition's job; validating the captured payload is the before hook's job. Enforcement details live in the sdm SPEC ("Hooks").

Storage is unchanged from the SDM runtime: captured attributes persist to activity history as primitives or JSON — exactly what the user entered, untouched by any script.

## 5a. Query activities — `record_map: "GET"`

The read path (settled July 2026). Alongside CREATE/UPDATE/DELETE, a **GET** activity answers a question: its attributes are its parameters (validated by the trio), and a `returns` expression produces the response:

```json
{
  "id": "act_get_top_invoices",
  "name": "Get Top Invoices",
  "record_map": "GET",
  "attributes": [
    { "attribute_ref": "how_many", "required": true, "validation": "value between 1 and 100" }
  ],
  "returns": "records.invoices.orderBy(amount desc).top(attributes.how_many).select(id, code, amount, customer)"
}
```

- **Everything is an activity** — user capture, commands, and data gets share one authoring concept, one pipeline, and one invoke surface (`invoke(name, params)`). Apps call GET activities instead of ad-hoc APIs.
- **GET never mutates**: the validator enforces purity (no mutations, no `queue`). Responses are cacheable.
- **GET is logged like every activity** — parameters, caller, duration, outcome — giving out-of-the-box observability and an AI-legible uniform stream. The log append is asynchronous (a read never waits on its paperwork); volume is managed by a per-activity logging level and the customer's retention/archiving module, which moves history but never edits it.
- Null `record_map` remains "log only": the activity and its captured attributes are recorded; any behaviour comes from hooks.
- Named functions (§8) are script-level helpers for reuse inside expressions and hooks — they are **not** an app-facing surface; GET activities are.

## 6. Hooks

**Before hook = gate.** Runs on activity submission, before anything persists. May read anything (`context`, `attributes`, any `records` query, read-only service calls). May `fail('msg')` — the activity is rejected, nothing persists — or `warn('msg')`. **Validate only**: before hooks never modify `attributes` or records. Derived/prepped values are the after hook's job, which keeps activity history a truthful record of user input.

**After hook = effects.** Runs after the activity persists. Contains the data logic: loops, conditional mutations, service calls, invoice-style derivations.

Failure semantics: a runtime error in a before hook blocks the activity exactly like `fail` (a broken gate must never wave submissions through). A failing after hook applies none of its mutations (§7) but does not un-record the activity — history stays truthful; the surface reports that the activity was recorded and no changes applied.

## 7. Transactions and `queue`

After-hook record mutations are **staged and committed atomically** when the hook completes. If the hook fails midway, no mutations apply. Constraint checks (`required`, `unique`, `immutable`) run at staging time, so a violating mutation fails at its statement — before anything has persisted.

Within the running script, **reads see staged writes**: a query, `context.record`, or FK deref reflects the script's own uncommitted mutations; snapshots taken earlier keep their values (D11). A record returned by `create` carries its final committed id, usable immediately for FKs.

`queue`d service calls are held in the same staging area and **dispatched only if the commit succeeds** (outbox pattern) — eventually to a separate queue/process; arguments are evaluated at the `queue` statement (snapshot), the call itself runs after commit. Hook fails → no records changed, no messages sent. Business users get transactional behaviour without learning the word. A queued call that itself fails at dispatch becomes a warning, never an error (the commit already happened).

Waiting service calls with side effects inside after hooks are the documented non-transactional exception — prefer `queue` for anything with effects.

## 7a. Services registry (Phase 3)

The `services` root is backed by a **registry of modules**, not an untyped bag. A module carries a manifest alongside its implementation (`ServiceModuleDef` in `host.ts`): name, description, and functions, each declaring `params`, a mandatory `description`, and a **`kind`**:

- **`read`** — a pure query (`services.geo.suburbsOf(city)`). Callable from every tier: datasources, show conditions, before hooks, after hooks.
- **`effect`** — does something to the world (`services.notify.email(…)`). After hooks only, and preferably `queue`d. A *waiting* effect call in an after hook is the §7 non-transactional exception — the validator lets it through with a **warning**; anywhere else it is an **error**, statically and at run time. One carve-out: the validator's **`callback` mode** (page-builder callback scripts, 2026-07-12) accepts waiting effect calls silently — UI effects like `services.page.setContext(…)` are the norm there — while record mutations stay errors: mutations flow only through activities. At run time callback hosts get the same posture by running `mutate` mode against a records host with no mutation surface.

The manifest feeds the validator: `DslSchema.services` (derived via `servicesSchema(modules)`) makes unknown modules, unknown functions, and wrong arity **config-save-time errors**, and enforces the purity rules above. A schema without a registry keeps the old behaviour — `services.*` passes through untyped (for hosts that haven't adopted the registry).

**Async posture (decided July 2026, deferred implementation):** service functions may return Promises — the registry API is async-shaped from day one. The current sync evaluator handles that only on `queue` dispatch (fire-and-forget; a rejection lands on the host's `onQueuedFailure` hook, since the script has already returned). A *waiting* call that returns a Promise is a runtime error pointing at `queue`. The "interpreter awaits internally" promise (§4) is honoured when the evaluator goes async with the backend phase — no script, manifest, or module signature changes then; only evaluator internals.

First two modules live in the sdm workbench (see its SPEC): `notify` (effect — in-app notification centre, stub email) and `geo` (read — suburbs lookup backing the suburb datasource).

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

Named functions declare explicit parameters and still receive the four roots implicitly. Function calls are **lexically isolated**: a body sees its parameters and the roots, never the caller's variables. Creation is open to users (SQL proc/function users adapt readily); the governance floor shipped with Phase 2 — **mandatory description, flat namespace (duplicate names rejected), declared name must match the collection entry, bodies schema-validated at config-save time**; versioning/permissions remain future enablers. Bodies are validated permissively (as if in an after hook) because the same function may be called from any surface; the evaluator enforces the calling surface's rules at run time (a function that mutates fails when called from a before hook or datasource).

Functions live in a top-level `functions` collection in the SDM, sibling of `attributes` / `recordTypes` / `workflows`:

```json
{
  "id": "fn_assignable_resources",
  "name": "assignableResources",
  "description": "Active resources assignable to a WO …",  // mandatory
  "body": ["function assignableResources(wo) {", "  …", "}"]
}
```

Canonically `body` is a **single string**; the JSON serialization also accepts an array of lines (joined on load) as a hand-editing convenience while the SDM is still edited as a raw file. The distinction is invisible above the loader: authoring happens in a code editor UI (Monaco, language id `fluxscript`), and once the SDM moves behind the backend the body is simply a text column. Scripts and config reference functions by `name`; `id` exists for stable references across renames. Bodies are parsed and schema-validated at config-save time like every other script. This collection is also the answer to multi-line script storage: hooks beyond a line or two use the same string/array-of-lines form inline or delegate to a named function.

The division of labour with the expressions tier: **expressions ask, functions think.** Show conditions and datasources are single expressions; the moment one needs intermediate variables, it is promoted to a named function and the config becomes a one-line call.

## 9. Validation and safety

- **Schema-aware static validation at config-save time** — the defining feature. Every script parses and checks against the SDM: unknown record types/fields, type mismatches in comparisons, `queue` return-value misuse, service module/function existence + arity + purity (§7a), and (once manifests carry shape contracts) query projections checked against page-builder port shapes. Errors surface when the config is saved, not when a user runs the activity.
- **Runaway protection from day one**: max loop iterations, max rows per query, execution timeout — quotas enforced by the interpreter.

### Scale strategy (large result sets)

Fetch-all-then-filter does not survive production data volumes. The measures, layered:

1. **Quotas are the fuse, not the fix** — a query over the row cap fails fast with a clear error rather than silently grinding.
2. **`.top(n)` in the chain set** — scripts can and should bound their result sets; datasources feeding pickers should always end in a `top`.
3. **Query pushdown is the designed fix**: because chains are lambda-free AST, `where/orderBy/select/top/count/first` are statically compilable to SQL. Internally, chains become a *query plan* the host executes — the in-memory host by filtering, the Postgres host by SQL with indexes (the `indexed` custom-field flag exists for this), so `.count` is `COUNT(*)` and `.first` is `LIMIT 1` at any scale. FK derefs in projections (an N+1 trap in naive execution) compile to joins. Translation caveats: JS-way nulls map to `IS NULL` forms; case-insensitive comparison maps to collation/`ILIKE`. The semantics test suite referees both hosts — identical behaviour or the pushdown is wrong.
4. **Today's eager materialize-then-filter is a POC simplification** behind the `RecordsHost` seam; the plan-based refactor changes no language surface and no scripts.

## 10. Implementation

Own grammar, hand-rolled or Chevrotain-based parser, **tree-walking interpreter in TypeScript** — one implementation running in the browser (datasources, show conditions, page bindings, POC hooks) and on the server (hooks, headless) once the backend lands. All host functions are async under the hood; the interpreter awaits internally so the language surface stays synchronous.

Hosts integrate by implementing the root providers (record store adapter, context, service registry) and calling `evaluate(script, roots)` / `validate(script, sdm)`.

## 11. Phases

1. **Phase 1 — expressions + queries.** ✅ Done. Grammar, interpreter, validator. Proven in the sdm workbench: `show_condition` and `List` datasources with `attributes.` dependencies (city → suburb is the acceptance test). Entirely client-side.
2. **Phase 2 — scripts.** ✅ Done (July 2026). Statements, `fail`/`warn`, `records` mutations, transactional after hooks, `queue`, named functions — built and wired into the sdm hook slots (Complete Work Order is the acceptance case: before gate + after-hook status move). The `run activity` page-builder callback (payload as `event` root) was re-scoped out to the **Extraction** milestone (root ROADMAP): it is blocked on the page builder hosting the SDM store, not on any language work.
3. **Phase 3 — services registry.** ✅ Done (July 2026). Module manifests (`params`/`description`/`kind`) behind the `services` root, read/effect purity enforced statically and at run time, registry-strict validation (existence, arity), async-shaped API with the sync-evaluator posture of §7a. Two live modules in the sdm workbench: `notify` (queued from Complete Work Order into the notification centre) and `geo` (service-backed suburb datasource). Async evaluator deliberately deferred to the backend phase.
4. **Phase 4 — headless invocation.** ✅ Done (2026-07-12), with **zero language change**: activities as the API surface live in `@fluxus/server` (tRPC → engine `validateSubmission` → the one pipeline → Postgres). The deferred async evaluator turned out unnecessary — the backend snapshots the scope's lean partition into an in-memory Store per request and runs the sync evaluator against it; the §7a async-shaped API remains the seam if a remote-Store host ever appears. GET activities (§5a) are deliberately not in this cut (their logging posture awaits the unified-log design).

## 12. Open items

- Page-builder `run activity` callback — with the **Extraction** milestone (root ROADMAP): needs the page builder to host the SDM store; no language work involved.
- Delete semantics (`record_map: DELETE`, `records.x.delete`) — needs SDM-level decisions first.
- Aggregations/grouping in queries — add when a real case demands them.
- `warn(...)` surfacing: before-hook warnings are a **soft stop** (Continue/Cancel in the form — see sdm SPEC "Hooks"); after-hook warnings are informational and still console-only, pending a toast/banner slot.
- ~~Named-function governance constraints~~ — floor shipped with Phase 2 (§8); versioning/permissions later.
- ~~Multi-line script storage in the SDM JSON~~ — settled: the `functions` collection with array-of-lines bodies (§8); inline hooks use the same array form.
- ~~Formal grammar (EBNF)~~ — written: [GRAMMAR.md](GRAMMAR.md); D1–D14 all resolved.
