# Record read conditions — spec

**Status:** spec, not built. Agreed 2026-10-11 from the inspections solution,
where inspectors must see only their own jobs. It is the per-record read access
that RBAC_DESIGN §9 deferred "when a real modelling need appears" (RBAC_COMPACT,
*MVP exclusions*). Three of the choices below are Claude's proposals awaiting
the user's confirmation (*Decisions to confirm*, at the end).

## What this changes, in one paragraph

Today a role reads every record of a type or none: the record type's read list.
A **read condition** narrows one role's read of one record type to the records
for which an expression is true. The server checks it on every record it hands
out directly: a page opening its record, a list or partition fetch, and the
record an action runs on. A record that fails reads as not found. GETs and hooks
are unchanged: they read every record, as today, and a GET's author filters what
it returns.

## Rulings this spec rests on (user, 2026-10-11)

- **A condition on the record type, not on the page.** A condition on opening a
  page (the user's idea, for ad hoc page rules) is parked for apps Part 2, when
  the server learns which page a call comes from.
- **Hidden reads as not found**, exactly like a record that does not exist —
  what `records.get` already answers for an unreadable type.
- **GETs stay outside access control.** A GET that returns protected records
  filters them itself.
- **Built together with its first user**: the inspections Inspectors record type
  and the assigned-inspector checks, specced in the inspections SPEC.

## 1. The rule

- A record type's read list names the roles that may read it. Unchanged.
- A role in that list may also have a **read condition**: an expression that
  must be true of a record for that role to read it.
- A user reads a record if **any** role they hold reads its type either without
  a condition or with a condition that is true for that record. Roles add up,
  as grants always have (RBAC_COMPACT: union, no deny rules).
- Unchanged: a role not in the read list reads nothing of that type; a solution
  with no roles reads nothing; with sign-in not configured everything is open
  and no condition is evaluated.

Example — inspections, once a job names an inspector record:

| Record type | Role | Read condition |
| --- | --- | --- |
| Jobs | Admin | — |
| Jobs | Inspector | `context.record.inspector.email = context.user.email` |
| Findings | Admin | — |
| Findings | Inspector | `context.record.job.inspector.email = context.user.email` |

Someone holding both roles reads every job, through Admin.

**Why per role and not one condition per record type** (proposal): one
condition per type would have to name roles inside the expression
(`'role_admin' in context.user.roles or …`), and every new role meant to read
everything would mean editing it. Per role, Admin simply has none, and the
Console already edits the read list role by role.

## 2. Where it is stored

On the record type, beside the read list. The key name is a proposal:

```jsonc
"access": {
  "read": ["role_admin", "role_inspector"],
  "read_conditions": {
    "role_inspector": "context.record.inspector.email = context.user.email"
  }
}
```

- `read` keeps its shape, so nothing that reads it today changes.
- Record type definitions are stored as JSON (`sdm_record_types.def`): no
  migration.
- `access` never reaches the browser — it is not part of the client's record
  type (`ClientRecordTypeDef`, CLIENT_TRUST_BOUNDARY) — so conditions do not
  either.

## 3. What a condition can say

- **`context.record`** — the record being read. Its references can be followed
  (`context.record.job.inspector.email`), as availability conditions do today
  (`context.record.job.status`). A reference followed here is read whatever the
  user may read: the platform is checking, not the user reading.
- **`context.user`** — `id`, `name`, `email`, `roles`.
- **Refused when the model is saved:** `attributes` (no activity is running),
  `records`, `services` and `invoke(...)`. A query inside a condition would run
  once per record of every list. This is a proposal; it can be lifted when a real
  case needs it.
- **Strictly true.** Only `true` lets the record through. False, blank or an
  error hides it. An error is logged as a warning naming the record type and
  role, as a failing availability condition is today: it fails closed.

## 4. Where the server applies it

Every place the server hands records to a caller directly:

| Where | Today | With read conditions |
| --- | --- | --- |
| `records.get` — a page opening its record, a page following a reference | not found if the type is unreadable | also not found if no held role lets the record through |
| `records.list` — one type's records | empty if the type is unreadable | only the records let through |
| `records.partition` — the Console workbench | readable types only | and, within them, only the records let through |
| `activities.run` with a record | not found if unreadable, checked before the availability gate | also not found if the record is not let through |
| `activities.query` (a GET) with a record | the same | the same |

One function answers for all five, beside `computeReadable`
(`server/src/projection.ts`): for the caller's roles and each record type,
**every record**, **none**, or **these conditions, any one of which lets a
record through**. The five places ask it instead of the readable-types set.

`records.*` today reads the database directly, without the engine. When a
condition applies, they build the same per-request engine the activities use
(`loadOperationHost`) to evaluate it; when none applies, nothing changes.

## 5. What it does not cover

- **GETs and hooks** read every record, as today. A GET returning protected
  records filters them itself. In inspections: the Jobs list, the findings list
  and the summary counts. A solution's spec says which of its GETs repeat a
  condition.
- **Records named in an action's answers.** An action checks only that a
  referenced record exists (`validateSubmission`), not that the user may read
  it. Add Finding naming another inspector's job is stopped by the inspections
  hook, not by this.
- **`scripts.query`** — the Console's DSL editor. Designers only; reads
  everything, by design.
- **`files.presignGet`** — gives a link for any file key with no record check.
  An existing gap, unchanged here; the keys cannot be guessed.
- **Changing records.** Activities stay the only way; who may run one is its
  availability condition.

## 6. The Console

The Record Types editor's *Readable by roles* (`RecordTypesEditor.tsx`):

- Under each ticked role, a text box: **Only records where (FluxScript)**. Blank
  means the role reads every record of the type.
- Unticking a role removes its condition.
- Today the editor writes `access` whole (`edit({ access: { read } })`), which
  would drop the conditions. It must keep them.
- The hint under the list says a condition narrows that role to the matching
  records.

No other screen changes.

## 7. Checked when the model is saved

`validateConfig`, for each read condition:

- the expression is checked with `context.record` typed as that record type,
  refusing `attributes`, `records`, `services` and `invoke`;
- a condition for a role the read list does not name is refused (it could never
  apply);
- a condition for a role the solution does not declare is refused.

The validator already refuses roots by name (`bannedRoots`). Refusing `invoke`
needs a small addition.

## 8. Cost

- A role that reads a type without a condition costs nothing new: no expression
  runs.
- Otherwise the condition runs once per record handed out: once for `get`, once
  per record for `list` and `partition`. A referenced record is read once per
  request and then held (`DatabaseStore`), so fifty jobs shared by three
  inspectors read three inspector records.
- The Runtime does not fetch partitions (`records: 'none'`), and its lists come
  from GETs, which run no condition. The per-record cost falls mainly on the
  Console workbench and on direct fetches.

## 9. Build list

1. **Engine types:** `access.read_conditions` on `RecordTypeDef`, documented.
   Correct the comment beside it that still says a solution with no roles reads
   open (strict since 2026-10-11).
2. **Validator:** the three save checks in §7, and refusing `invoke`.
3. **Server:** the one read check of §4, used by all five places. Not-found
   answers keep their present shape and wording.
4. **Console:** the condition box, and keeping `access` whole when the read list
   is edited.
5. **Tests:** §10.
6. **Docs:** server SPEC (*Record-type read enforcement*), RBAC_COMPACT (the
   surfaces table, the config example, *MVP exclusions*), BLUEPRINT *Access*
   (from direction to built), GLOSSARY (*Read condition*).

## 10. Tests

- A role without a condition reads every record; with one, only the matching
  records — for `get`, `list` and `partition`.
- Two held roles, one with a condition and one without: every record.
- A record not let through: `get` answers exactly as for a missing id;
  `activities.run` and `activities.query` with it answer not found, before the
  availability gate.
- A condition following references (finding → job → inspector).
- A condition that errors hides the record and logs a warning; one that
  answers anything but `true` hides it.
- Saving refuses: `records`, `attributes`, `services`, `invoke`; a role not in
  the read list; an undeclared role; an unknown field name.
- Sign-in not configured: conditions are not evaluated.
- A GET still returns records a condition would hide.
- Console: ticking and unticking roles keeps the other roles' conditions.

## Decisions to confirm

Claude's proposals; none is ruled yet.

- **A condition belongs to one role's read of one record type**, not to the
  record type as a whole (§1).
- **The key name `read_conditions`** (§2).
- **Conditions cannot query**: `records`, `services` and `invoke` are refused
  (§3).
