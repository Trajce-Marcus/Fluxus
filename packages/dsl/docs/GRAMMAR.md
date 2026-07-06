# FluxScript — Grammar

Formal grammar for the Fluxus DSL. First artefact of Phase 1 (see [DSL_SPEC.md](DSL_SPEC.md) for semantics and rationale). Expressions and queries (§3–§4) are Phase 1; statements (§5) are Phase 2 and provisional.

Notation: EBNF. `{ x }` = zero or more, `[ x ]` = optional, `|` = alternatives, `( )` = grouping, quoted strings are literal tokens. `⚑ Dn` marks a decision listed in §7 (with status).

> **How to read the EBNF:** you don't need to — §3.2 and the examples are the human view; the EBNF is the contract the parser implements. If you do: each rule reads "a ___ consists of …". So `or-expr = and-expr { "or" and-expr }` says "an or-expression is one or more and-expressions joined by `or`" — and that layering is how operator precedence is encoded (`and` binds tighter than `or` because it sits deeper in the cascade).

---

## 1. Lexical structure

### 1.1 Case

The language is **case-insensitive throughout**: keywords (`WHERE` = `where`), identifiers (`Status` = `status`), and string comparison at runtime (SQL-collation style; `exact(a, b)` for the rare sensitive compare). Canonical style: lowercase keywords, snake_case identifiers (matching SDM field keys).

### 1.2 Tokens

```ebnf
identifier  = ( letter | "_" ) { letter | digit | "_" } ;
number      = digit { digit } [ "." digit { digit } ] ;
string      = "'" { char | "''" } "'" ;
```

- Strings are **single-quoted only**; escape a quote by doubling it, SQL style: `'O''Brien'`. ⚑ D1 (resolved)
- No date/time literal — dates are built with functions and extended with methods: `date('2026-07-01')`, `now().addDays(1)`. ⚑ D2 (resolved)
- Comments: `//` to end of line — the only comment form. ⚑ D3 (resolved)

### 1.3 Keywords (reserved)

```
and or not in between like is null true false
let if else for each queue return function asc desc
```

Reserved words cannot be bare identifiers, but **are valid member names after `.`** — an SDM field named `like` is still reachable as `ctx.record.like`. ⚑ D7

### 1.4 Statements and lines

**No semicolons.** A statement ends at end of line; `;` is a syntax error (with a friendly message). A line **continues** when it ends with an operator, comma, or unclosed bracket, or when the next line begins with `.` (supporting the idiomatic multi-line query chain). ⚑ D9 (resolved)

```
records.resources
  .where(rest_type = 'Labour')
  .orderBy(name)
```

---

## 2. Entry points

Each embedding point admits one of two grammars:

```ebnf
expression-entry = expression ;              (* show conditions, datasources,
                                                page bindings, defaults *)
script-entry     = { statement } ;           (* hooks, headless workflows *)
function-entry   = function-decl ;           (* named functions in the SDM *)
```

---

## 3. Expressions

### 3.1 Grammar

```ebnf
expression     = or-expr ;
or-expr        = and-expr { "or" and-expr } ;
and-expr       = not-expr { "and" not-expr } ;
not-expr       = [ "not" ] comparison ;
comparison     = additive [ comp-op additive
                          | [ "not" ] "in" in-operand
                          | [ "not" ] "between" additive "and" additive
                          | [ "not" ] "like" additive                      (* ⚑ D4 *)
                          | "is" [ "not" ] "null" ] ;
in-operand     = additive
               | "(" expression { "," expression } ")" ;   (* SQL-style list *)
comp-op        = "=" | "==" | "!=" | "<>" | "<" | "<=" | ">" | ">=" ;
additive       = multiplicative { ( "+" | "-" ) multiplicative } ;
multiplicative = unary { ( "*" | "/" | "%" ) unary } ;
unary          = [ "-" ] postfix ;
postfix        = primary { "." member [ call-args ]
                         | call-args
                         | "[" expression "]" } ;
member         = identifier | keyword ;                    (* keywords ok after "." *)
call-args      = "(" [ argument { "," argument } ] ")" ;
argument       = identifier ":" expression                 (* alias, in select/object *)
               | expression [ "asc" | "desc" ] ;           (* direction, in orderBy *)
primary        = literal | identifier | "(" expression ")"
               | list-literal | object-literal ;
list-literal   = "[" [ expression { "," expression } ] "]" ;
object-literal = "{" [ object-entry { "," object-entry } ] "}" ;
object-entry   = ( identifier | string ) ":" expression ;
literal        = number | string | "true" | "false" | "null" ;
```

The right side of `in` accepts a list value (`['a', 'b']`, a variable, a query result) **or** a SQL-style parenthesised list: `rest_type in ('a', 'b')`. A single-element paren (`x in (expr)`) evaluates the expression: if it yields a list (e.g. a parenthesised subquery, the SQL habit), membership is in that list; otherwise it's treated as a one-element list.

### 3.2 Precedence (low → high)

| Level | Operators |
|---|---|
| 1 | `or` |
| 2 | `and` |
| 3 | `not` (prefix) |
| 4 | `=` `!=` `<` `<=` `>` `>=` `in` `between` `like` `is null` |
| 5 | `+` `-` |
| 6 | `*` `/` `%` |
| 7 | unary `-` |
| 8 | `.` member, `(...)` call, `[...]` index |

`between`'s bounds bind at additive level, so `x between a and b or y` parses as `(x between a and b) or y` — the `and` inside `between` is part of the construct, never logical.

### 3.3 Semantics bound to the grammar

- **`=` is comparison in expression position** (assignment exists only in statement position, §5). `==`, `<>` are silent aliases; canonical form `=` / `!=`.
- **Null-safe navigation:** a dotted path through null yields null: `ctx.record.contract_id.contact_email` is null when contract_id is. Arithmetic with null yields null.
- **Comparisons are total — no SQL three-valued logic.** `x = null` is a genuine null check (true/false), `null = null` → true, ordering comparisons against null → false. `is null` / `is not null` accepted as readable aliases. This deliberately removes SQL's `= NULL` trap. ⚑ D5
- **FK auto-dereference:** dotting past an `fk_ref` field transparently fetches the target record (the SDM tells the engine which fields are FKs).
- **`+` concatenates when either operand is a string**, formatting the other operand — no cast needed: `attrs.qty + ' attributes'` → `'5 attributes'`. Other type mismatches in arithmetic are validation errors when statically known, runtime errors otherwise — no JS-style silent coercion.
- **`in`** accepts a list literal, parenthesised list, query result, or any list value. **`between`** is inclusive. **`like`** uses `%` (any run) and `_` (one char), case-insensitive like all string comparison. ⚑ D4
- **Conditional expression** is the builtin `iif(cond, then, else)` — no `? :` operator, no `case` yet. ⚑ D6
- **List properties:** `.count`, `.first` are terminal properties (no parens): `attrs.wo_resources.count`.

### 3.4 Examples

```
ctx.record.status != 'Closed'
attrs.qty > 0 and attrs.qty <= 100
ctx.record.due_date between date('2026-07-01') and date('2026-07-31')
ctx.record.due_date <= now().addDays(7)
ctx.record.work_group in ('WG1', 'WG2')
ctx.record.contract_id is not null
name like 'pump%'
iif(attrs.urgent, 'P1', 'P3')
'Job ' + ctx.record.code + ' assigned'
attrs.qty + ' attributes'
```

---

## 4. Queries

Syntactically, queries are ordinary postfix chains on `records.<record_type>` — the grammar above already covers them. What makes them queries is **semantic**:

### 4.1 Bare-field scope

Inside the arguments of `where`, `orderBy`, and `select`, bare identifiers resolve **first to fields of the queried record type**, then to the roots (`ctx`, `attrs`, `records`, `services`) and enclosing `let` bindings. This is the SQL implicit-table-scope rule and the reason the language needs no lambdas:

```
records.resources.where(rest_type = 'Labour' and status = 'Active')
records.suburbs.where(city_id = attrs.city)
```

If an SDM field name shadows a root name, the field wins inside the chain and the validator emits a warning at config-save time. ⚑ D8

### 4.2 Chain methods (Phase 1 set)

| Method | Meaning |
|---|---|
| `.where(expr)` | filter; expr evaluated per record in bare-field scope |
| `.orderBy(field [asc\|desc], ...)` | sort; default `asc` |
| `.select(field, alias: expr, ...)` | project; any number of entries; aliases may be full expressions incl. FK paths (`group: work_group.name`) |
| `.values(field)` | project to a scalar list — for subquery membership and scalar datasources ⚑ D10 (resolved: in) |
| `.first` | first record or null (terminal property) |
| `.count` | number of records (terminal property) |

`select` always yields a list of records (objects), preserving `key_field`/`columns` behaviour in `List` attributes; `.values` is the scalar escape. Aggregations (`sum`, grouping) are deferred (SPEC §12).

### 4.3 Examples

```
records.resources
  .where(rest_type = 'Labour' and status = 'Active')
  .orderBy(name)
  .select(id, name, rate)

records.jobs
  .where(work_group in ctx.page.selectedGroups
         and due_date between ctx.page.rangeStart and ctx.page.rangeEnd)
  .select(id, title: code, start: due_date, laneId: work_group)

records.assets.where(asset_no = attrs.asset).first
records.work_orders.where(status = 'Open').count
```

### 4.4 Relationships — navigations, not JOIN

There is deliberately **no JOIN construct**. Relationships live in the SDM as FKs, so every join use-case is a navigation:

```
// N:1 — forward FK dereference, in filters and projections
records.work_orders.where(work_group.region = 'North')
records.work_orders.select(id, group: work_group.name)

// 1:N — reverse-FK navigation: incoming FKs appear as list properties,
// named by the source type (the SDM's reverse-FK index powers this)   ⚑ D12
ctx.record.wo_resources
for each line in ctx.record.wo_resources { ... }

// M:N — membership via a join type and a scalar subquery
records.assets.where(id in
  records.wo_assets.where(work_order_id = ctx.record.id).values(asset_id))
```

If two FKs from one source type point at the same target, reverse navigation needs disambiguation — `wo_resources(by: alt_wo_id)` — rare, and the validator names the options. Relating types on non-FK fields is expressible via `in` + subquery, but the first-class answer is: **if two types need relating, put the FK in the SDM** — relationships belong in the model, not ad-hoc inside queries.

---

## 5. Statements (scripts tier — Phase 2, provisional)

```ebnf
statement     = let-stmt | assign-stmt | if-stmt | for-stmt
              | queue-stmt | return-stmt | expr-stmt ;
let-stmt      = "let" identifier "=" expression ;
assign-stmt   = lvalue "=" expression ;                (* statement position only *)
lvalue        = identifier { "." member } ;
if-stmt       = "if" expression block [ "else" ( if-stmt | block ) ] ;
for-stmt      = "for" "each" identifier "in" expression block ;
queue-stmt    = "queue" postfix ;                      (* validator: must be a service
                                                          call; return value unusable *)
return-stmt   = "return" [ expression ] ;
expr-stmt     = expression ;                           (* fail(...), warn(...),
                                                          records.x.create(...) *)
block         = "{" { statement } "}" ;
function-decl = "function" identifier "(" [ identifier { "," identifier } ] ")" block ;
```

- No parentheses required around `if`/`for each` conditions; braces are **mandatory** (no single-statement bodies).
- No `while` — scripts provably terminate; interpreter quotas cap `for each` regardless.
- `fail`/`warn` are builtin functions, not keywords.

### Variables and scope

- `let` declares a variable, **block-scoped** to its enclosing `{ }` (or the whole script at top level). `for each x in ...` binds `x` for its block. Reassignment is `x = expr` — legal only in statement position, which is what keeps `=` unambiguous as comparison inside expressions.
- **Variables hold snapshot copies.** ⚑ D11 Assigning a query materializes it: `let pool = records.resources.where(status = 'Active')` runs the query and `pool` holds the results as copies. Later changes to the store do not ripple into `pool`, and writing to a field of a record held in a variable **never writes to the store** — data changes only via `records.<type>.update(...)` / `.create(...)`. Chaining on a variable (`pool = pool.where(...)`) filters the snapshot in memory.
- **No globals, no cross-run persistence** — variables exist for one execution; durable state lives in records.
- **Roots are not shadowable**: `let ctx = ...` is a validation error, as is redeclaring a name in the same block or using a variable before declaration (all caught at config-save time).
- **The expressions tier is variable-free** by design: a show condition or datasource is a single expression. When one needs intermediates, promote it to a named function — complexity graduates to the reusable tier rather than accumulating in config strings.

### Mutations   ⚑ D14

The rule: **mutations live where their target lives** — instance, collection, or set.

```
// single record — method on the record itself
ctx.record.update({ status: 'Scheduled', scheduled_date: attrs.date })

let job = records.jobs.where(code = attrs.job_code).first
job.update({ status: 'Assigned' })

// works on any record value, incl. FK-deref targets
ctx.record.work_group.update({ last_assigned: now() })

// create — collection level (no instance exists yet)
records.wo_resources.create({ work_order_id: ctx.record.id, resource_id: r.id, qty: 1 })

// bulk, SQL-set-based — chain terminal   ⚑ D13
records.work_orders
  .where(status = 'Open' and due_date < now())
  .update({ status: 'Overdue' })
```

- **Records are read-only values**: `r.status = 'Overdue'` is a validation error whose message points to `r.update({ status: 'Overdue' })`. No silent-local vs persisted-write confusion can exist.
- **Projected rows are not records**: results of `.select(...)` carry no identity; `.update()` on them is a validation error.
- **Bulk update requires a `where`**: `records.assets.update({...})` with no preceding `.where(...)` is a validation error (SQL's UPDATE-without-WHERE disaster, made impossible). Updating genuinely every record must be explicit: `.where(true).update({...})`. The same rule will apply to bulk delete when delete semantics arrive.
- Update-by-raw-id is `records.jobs.where(id = x).first.update({...})`; a `.get(id)` sugar is deferred until that chafes.
- All mutations run only in after hooks, are staged in the hook's transaction, and respect field constraints (`immutable`, `required`, `unique`) enforced by the store; bulk updates are subject to row quotas. Delete is deferred pending SDM delete semantics.

### Example (after hook)

```
for each r in attrs.wo_resources {
  records.wo_resources.create({
    work_order_id: ctx.record.id,
    resource_id: r.id,
    qty: 1
  })
  queue services.notify.sms(r.contact, 'Assigned to ' + ctx.record.code)
}
if ctx.record.contract_id is not null {
  queue services.notify.email(ctx.record.contract_id.contact_email,
    'Resources assigned to ' + ctx.record.code)
}
```

---

## 6. Builtins (Phase 1 set)

Small by design; grows only on demonstrated need.

**Functions**

| Function | Meaning |
|---|---|
| `iif(cond, a, b)` | conditional expression |
| `date(str)` | ISO string → date |
| `now()` | current timestamp (host-injected, so hooks are testable) |
| `exact(a, b)` | case-sensitive string equality |
| `len(x)` | string length / list length |
| `lower(s)`, `upper(s)`, `trim(s)` | string utilities |
| `abs(n)`, `round(n, places)` | numeric utilities |
| `fail(msg)`, `warn(msg)` | scripts tier only (§5) |

**Value methods** (postfix, extendable per type)

| Method | Meaning |
|---|---|
| `d.addDays(n)`, `d.addMonths(n)`, `d.addYears(n)` | date arithmetic: `now().addDays(1)` |
| `list.count`, `list.first` | terminal properties (§3.3) |

Method-style may extend to strings/numbers (`s.upper()`, `n.round(2)`) for consistency later; the function forms above remain either way.

---

## 7. ⚑ Decisions

| # | Decision | Status | Resolution / recommendation |
|---|---|---|---|
| D1 | String escaping | **Resolved** | Single quotes only; escape by doubling, SQL style: `'O''Brien'`. |
| D2 | Date literals | **Resolved** | No literal syntax; `date(str)` / `now()` builtins plus method extensions (`.addDays(n)`, `.addMonths(n)`, `.addYears(n)`). |
| D3 | Comments | **Resolved** | `//` only — one comment form. |
| D4 | `like` operator | **Resolved** | Included, `%` / `_` wildcards, case-insensitive. |
| D5 | Null comparison semantics | **Resolved** | The JS way (user): total comparisons, `x = null` works, no three-valued logic; `is null` accepted as alias. The deliberate divergence from SQL. |
| D6 | Conditional expression | **Resolved** | `iif(cond, a, b)` builtin. No `? :`; `case` only if demanded. |
| D7 | Keyword/field collisions | **Resolved** | Keywords reserved as bare identifiers but valid after `.`. |
| D8 | Bare-field shadowing | **Resolved** | Fields shadow roots inside query chains; validator warns on SDM fields named `ctx`/`attrs`/`records`/`services`. |
| D9 | Statement termination | **Resolved** | Newline-terminated; **no semicolons** (`;` is a syntax error); continuation on trailing operator/comma/open bracket or leading `.`. |
| D10 | Scalar projection | **Resolved** | `.values(field)` included in Phase 1 — required for M:N subquery membership (§4.4), also serves scalar datasources. |
| D11 | Variable semantics | Open (building per rec) | Variables hold **snapshot copies**, materialized at assignment; store changes don't ripple in; field writes on variables never hit the store; chaining filters in memory. Zero parser impact; revisitable until Phase 2 lands. |
| D12 | Reverse-FK navigation | **Resolved** | Incoming FKs exposed as list properties named by source type (`wo.wo_resources`); disambiguation `name(by: field)` when a source type has two FKs to the target; powered by the SDM's existing reverse-FK index. |
| D13 | Bulk update | **Resolved** | `.where(...).update({...})` chain terminal; transactional, row-quota'd, after hooks only (Phase 2). **A `where` is mandatory** — update without one is a validation error; "all records" must be explicit via `.where(true)`. |
| D14 | Mutation shape | **Resolved** | `r.update({fields})` on the record itself (user-proposed); records are read-only values (`r.field = x` errors, pointing to `.update`); `create` collection-level; projections not updatable. Case coverage confirmed during Phase 2 build. |
