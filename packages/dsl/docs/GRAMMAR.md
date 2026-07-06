# FluxScript — Grammar

Formal grammar for the Fluxus DSL. First artefact of Phase 1 (see [DSL_SPEC.md](DSL_SPEC.md) for semantics and rationale). Expressions and queries (§3–§4) are Phase 1 and normative once the ⚑-flagged decisions below are signed off; statements (§5) are Phase 2 and provisional.

Notation: EBNF. `{ x }` = zero or more, `[ x ]` = optional, `|` = alternatives, `( )` = grouping, quoted strings are literal tokens. `⚑ Dn` marks a decision listed in §7.

---

## 1. Lexical structure

### 1.1 Case

The language is **case-insensitive throughout**: keywords (`WHERE` = `where`), identifiers (`Status` = `status`), and string comparison at runtime (SQL-collation style; `exact(a, b)` for the rare sensitive compare). Canonical style: lowercase keywords, snake_case identifiers (matching SDM field keys).

### 1.2 Tokens

```ebnf
identifier  = ( letter | "_" ) { letter | digit | "_" } ;
number      = digit { digit } [ "." digit { digit } ] ;
string      = "'" { char } "'"  |  '"' { char } '"' ;      (* ⚑ D1 escaping *)
```

- Strings: single quotes canonical (SQL habit), double quotes accepted (JS habit).
- No date/time literal — dates are built with functions: `date('2026-07-01')`, `now()`. ⚑ D2
- Comments: `//` to end of line (canonical); SQL's `--` accepted as alias. ⚑ D3

### 1.3 Keywords (reserved)

```
and or not in between like is null true false
let if else for each queue return function asc desc
```

Reserved words cannot be bare identifiers, but **are valid member names after `.`** — an SDM field named `like` is still reachable as `ctx.record.like`. ⚑ D7

### 1.4 Statements and lines

No semicolons required: a statement ends at end of line, except that a line **continues** when it ends with an operator, comma, or unclosed bracket, or when the next line begins with `.` (supporting the idiomatic multi-line query chain). `;` is accepted and ignored. ⚑ D9

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
                          | [ "not" ] "in" additive
                          | [ "not" ] "between" additive "and" additive
                          | [ "not" ] "like" additive                      (* ⚑ D4 *)
                          | "is" [ "not" ] "null" ] ;
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
- **`+` concatenates when either operand is a string** (numbers/dates formatted); other type mismatches in arithmetic are validation errors when statically known, runtime errors otherwise — no JS-style silent coercion.
- **`in`** accepts a list literal, a query result, or any list value. **`between`** is inclusive. **`like`** uses `%` (any run) and `_` (one char), case-insensitive like all string comparison. ⚑ D4
- **Conditional expression** is the builtin `iif(cond, then, else)` — no `? :` operator, no `case` yet. ⚑ D6
- **List properties:** `.count`, `.first` are terminal properties (no parens): `attrs.wo_resources.count`.

### 3.4 Examples

```
ctx.record.status != 'Closed'
attrs.qty > 0 and attrs.qty <= 100
ctx.record.due_date between date('2026-07-01') and date('2026-07-31')
ctx.record.work_group in ['WG1', 'WG2']
ctx.record.contract_id is not null
name like 'pump%'
iif(attrs.urgent, 'P1', 'P3')
"Job " + ctx.record.code + " assigned"
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
| `.select(field, alias: expr, ...)` | project; aliasing maps SDM fields onto a consumer's shape |
| `.first` | first record or null (terminal property) |
| `.count` | number of records (terminal property) |

`select` always yields a list of records (objects), preserving `key_field`/`columns` behaviour in `List` attributes. A scalar-list projection (`.values(field)`) is deferred until a real case needs it. ⚑ D10 Aggregations (`sum`, grouping) are deferred (SPEC §12).

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

### Example (after hook)

```
for each r in attrs.wo_resources {
  records.wo_resources.create({
    work_order_id: ctx.record.id,
    resource_id: r.id,
    qty: 1
  })
  queue services.notify.sms(r.contact, "Assigned to " + ctx.record.code)
}
if ctx.record.contract_id is not null {
  queue services.notify.email(ctx.record.contract_id.contact_email,
    "Resources assigned to " + ctx.record.code)
}
```

---

## 6. Builtin functions (Phase 1 set)

Small by design; grows only on demonstrated need.

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

---

## 7. ⚑ Decisions surfaced by formalisation

Micro-decisions that only appeared when writing the grammar. Each has a recommendation baked into the text above; none is locked until signed off.

| # | Decision | Recommendation |
|---|---|---|
| D1 | String escaping | Backslash escapes (`\'`, `\"`, `\\`, `\n`, `\t`) — JS style. Alternative: SQL doubled-quote (`''`). Backslash is what most examples online use and works in both quote styles. |
| D2 | Date literals | No literal syntax; `date('2026-07-01')` and `now()` builtins. Avoids new lexer rules; reads plainly. |
| D3 | Comments | `//` canonical; also accept SQL `--`. Both are line comments; no block comments initially. |
| D4 | `like` operator | Include, with `%` / `_` wildcards, case-insensitive. SQL users will reach for it immediately. |
| D5 | Null comparison semantics | JS-style total comparisons: `x = null` works, no three-valued logic; `is null` accepted as alias. Removes SQL's biggest beginner trap. The deliberate divergence from SQL — worth a conscious yes. |
| D6 | Conditional expression | `iif(cond, a, b)` builtin. No `? :` (cryptic), no `case` yet (add if demanded). |
| D7 | Keyword/field collisions | Keywords reserved as bare identifiers but valid after `.` — an SDM field named `like` or `in` stays reachable. |
| D8 | Bare-field shadowing | Inside query chains, fields shadow roots; validator warns on any SDM field named `ctx`/`attrs`/`records`/`services`. |
| D9 | Statement termination | Newline-terminated; `;` accepted and ignored; continuation on trailing operator/comma/open bracket or leading `.`. |
| D10 | Scalar projection | `select` always yields records; defer `.values(field)` for scalar lists until needed. |
