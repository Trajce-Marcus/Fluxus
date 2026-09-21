# The record behind every run — client trust boundary, model trimming, audit

**Status: designed 2026-08-08/09. Built so far:**

- **the storage split** (`sdm_configs` → six `sdm_*` tables), 2026-08-08/09 —
  [packages/server/docs/SPEC.md](../packages/server/docs/SPEC.md) "Model
  storage: the SDM config as tables";
- **§2, trim by role** (sequencing step 1), 2026-08-09 — `ClientSolutionConfig`,
  `projectConfig`, `config.getForOperation`, `config.get` tightened to sol
  admin. Specced in the same file under "What the client is given", in
  [packages/engine/docs/SPEC.md](../packages/engine/docs/SPEC.md) "Two grades of
  model", and in [packages/client/docs/SPEC.md](../packages/client/docs/SPEC.md).
  The per-**page** trim, the other half of §2, is still waiting on §7.

The rest of this document is design, not code.

**§3 gap 1 is superseded** by
[DATA_THROUGH_ACTIVITIES.md](DATA_THROUGH_ACTIVITIES.md) (2026-08-09), which
also carries the read path — GET activities — and the guarding rule that
replaces it. Everything else here stands.

This is the single doc for the whole design. It replaces the narrower
client-trust version of 2026-08-08 and folds in the live parts of
[docs/ideas/client-hardening-and-model-storage.md](ideas/client-hardening-and-model-storage.md),
which is now the historical discussion only. It spans engine, server, client
and the page builder, which is why it sits in root `docs/`.

**The filename is stale** — this is no longer only about the client trust
boundary. Rename needs endorsement; `GLOSSARY.md` links to it twice.

Two questions started it:

1. **What is the client given?** Today, the whole model. It should be a
   trimmed copy.
2. **What is the client allowed to say?** Today, its own operation, and an
   arbitrary JSON blob that reaches server-side script. Some of that should be
   held by the server, not accepted from the browser.

Answering the second properly turned out to need a third answer — **what is
every run actually about?** — and that is now section 1, because the rest
rests on it.

The plain-language versions of the two ideas the design keeps returning to:
**the client is a view, never a source of truth**, and **if the server can
work a value out for itself, it must never take that value from the client**.
Between them they close the classic mistakes: acting on someone else's record
by guessing its id, editing a value in transit, and smuggling extra fields
into a write.

---

## 1. Every run is about a record

**The rule, in full:**

> Everything the runtime does is an activity. Every activity sits in a
> workflow. Every workflow belongs to a record type. So every run is about
> exactly one record — there is no path through the system that touches
> nothing.

UI and non-UI workflows differ only in whether a person drives them. The
record, the history and the pipeline are identical. This is the one-pipeline
idea taken all the way down.

### Three shapes of record, one mechanism

| Shape | What it is | Created by |
|---|---|---|
| **Entity record** | a Job, an Asset, an Invoice | a person, running a create activity |
| **App record** | one instance of an app — "the dispatch board" | a create activity, run deliberately or on first page open (below) |
| **Run record** | one execution of a non-UI workflow — the nightly geocode run | the trigger, as a create |

**An app record is an ordinary record.** The record type is the app ("dispatch
board"); each instance is a row of it, exactly like two Jobs. Two groups in one
operation each running their own board are simply two records, and "which
instance did this relate to" is answered the same way it is for any record.
Nothing in the record type marks it as an app — see §7, where the only special
thing (how you arrive at the record) lives on the page instead.

**A run record is the act itself.** "Geocode all jobs" leaves a record of the
run, and that record's history is the run's story. An act that leaves no trace
would contradict the platform.

### The id comes out of a create, not into it

For a create, the record does not exist when the request is made, so the id is
produced by the run, not supplied to it. The rule is *every run is about
exactly one record*, not *every run is handed a record id*. This matters
directly to §3: the client can never be asked for an id on a create, and
today's hard error for supplying one stays.

### Two records in play at once is normal

On an app page there is the record the page is about, and whatever record an
individual activity acts on. Both are real. Which applies to a given run is
decided by the activity, exactly as it is today — an activity's workflow tells
you its record type. "Dispatch this work order" anchors on the work order;
"publish the board" anchors on the board.

So history lands in two places, and that is correct: the work order's history
says it was dispatched, the board's history says it was published. Neither is a
copy of the other. Where you want the two connected — which board a dispatch
came from — the dispatch activity captures the board id as an attribute, which
makes it a real field: validated, queryable, and present in reporting.

This closes the old "multiple record contexts on one page" question. There is
always exactly one record the *page* is about, and any number of records acted
on inside it.

### The way in is always an activity

> No client, no page, no API call may touch a record except by running an
> activity. What a hook does once inside — already authorised, already inside a
> transaction — is the workflow author's business.

So an after hook may update and create records of **other** record types,
directly and in bulk, with no registered activity on the target. This is not a
new exception; it is already how the code works
([validator.ts:696-706](../packages/dsl/src/validator.ts#L696-L706) — before
hooks, expressions and page callbacks all refuse mutations, after hooks allow
them). CLAUDE.md's "records are never edited directly" was written about the
outside surface only, and reads as broader than it is.

Two reasons not to require an activity on the target, the second stronger:

1. **Coupling.** The hook would have to name activity ids belonging to another
   workflow. Renames break it, and the wiring is tedious enough to be a bug
   source in its own right.
2. **Cascade.** Those target activities have hooks of their own, which could
   call further activities — a chain nobody declared and nothing bounds. Direct
   writes have no such chain.

The audit cost this creates is paid in §5.

### Triggering a workflow from a workflow

An after hook that wants to start a separate process — "invoice this customer"
— creates a record in the other type. That create is an ordinary activity, so
it goes through the pipeline like everything else and leaves history. A runner
picks the record up afterwards (§6).

Writing the intent as a record inside the first run's transaction, and doing
the work later, gives both properties you want: the second run happens only if
the first commits, and it can be retried without repeating the first.

---

## 2. What the client is given

**BUILT 2026-08-09**, except the per-page cut at the end of this section. What
follows is the design as written; where the build differs, a note says so.

**Before it.** `config.get` returned the entire `SolutionConfig`, unfiltered — no
role filter, no trimming. Records *are* filtered, by `computeReadable`. That
asymmetry is the finding: **the data is filtered, the model is not.** A runtime
user who can read one record type still receives every other type's
definition, every activity, **every hook body**, and the `access.read` rules
that exclude them.

### Two doors, not one filter

The design plane genuinely needs the whole model: a sol admin authoring in the
Console must see hooks, because writing them is the job. So this is not one
endpoint that filters harder — it is two endpoints with different audiences.

- **`config.get` `{ solutionId }` → `SolutionConfig`** — the design plane.
  Unchanged in shape, but **tightened to sol admin** (it is the authoring
  door; `config.put` already requires sol admin, and read and write of a model
  are the same privilege in a one-grade world). `FluxusClient.connectSolution`
  keeps using it.
- **`config.getForOperation` `{ operationId }` → `ClientSolutionConfig`** —
  the runtime plane. Keyed on the **operation**, not the solution, because what
  survives the trim is decided by the caller's roles *in that operation*.
  `FluxusClient.connect` switches to it.

### One pure function, and it names what goes in

The trim is **one pure server-side function** —
`projectConfig(config, { roles, enforced }) → ClientSolutionConfig` — so there
is a single place to audit and a single place to test.

It **builds its output by naming each field that goes in.** Removing fields
instead (`delete config.hooks`) leaks every field added to the model later,
until somebody remembers. Naming what goes in makes new fields invisible until
somebody deliberately exposes them. This is the rule the whole section rests
on.

| | Ships to the client | Stripped |
|---|---|---|
| attributes | `key`, `label`, `description`, `type`, display config, `validation` + `validation_message`, `show_condition`, `required`, `can_waive` | presign / storage gating config (`max_size_mb`, `max_count`) |
| record types | `id`, `name`, `id_field`, custom field keys + labels | `access.read`; **unreadable types entirely** |
| activities | `id`, `name`, `description`, `sort_order`, form definition, `show_condition` | **`before_hook` and `after_hook` entirely**; unrunnable activities |
| workflows | `id`, `name`, and the activities that survive | — |
| functions | those reachable from a shipped expression | the rest |
| roles | — | **the whole `access.roles` block**; the client gets its own roles from `me` |

Hooks are the prize: business logic and every effect never leave the server.

**Validation expressions are deliberately kept.** The client needs them for
inline validation, they are not secret (the user discovers the rule by hitting
it anyway), and the server revalidates regardless.

**Function reachability** is the fiddly part. First cut: ship every function
referenced by any shipped expression, with no further pruning. Tighten only if
it turns out to matter.

**As built (2026-08-09)**, four places where the code says more than the table
above did:

- **Record-type fields** ship as key + label + type + FK wiring
  (`fk_record_type`, `fk_display_field`). The design's "keys + labels" had no
  counterpart in the model — a custom field had no label — so **`label` was
  added to the field definition** (optional, key as the fallback, editable in
  the Console) rather than dropped from the design. Storage constraints
  (`required`, `unique`, `immutable`, `indexed`, `default`) are stripped:
  nothing client-side builds a record.
- **`max_count` ships after all.** The design listed both file ceilings as
  stripped; on review only `max_size_mb` is, because it gates the presign
  before bytes move. `max_count` is what the capture widget checks so the user
  is stopped at the add tile instead of at submit — client-side **validation**,
  never enforcement, exactly as validation expressions are (`validateSubmission`
  holds the real ceiling).
- **The attribute pool ships by reference**, not wholesale — an attribute
  reached only by a workflow that did not survive describes a form this caller
  can never open. Composite sub-usages are followed, so the walk is transitive.
- **Function reachability is transitive** through function bodies, because a
  shipped function may call another. Detection is a bare-name call scan,
  deliberately over-inclusive: shipping an uncalled function is harmless, and
  missing one breaks an expression.
- **`default_menu` rides through untouched.** The runtime cannot render its
  navigation without it, and the operation's own override — which usually wins —
  arrives untrimmed from `operations.get` anyway. It is not part of
  `ClientSolutionConfig`: the engine is menu-blind.

### Make the type system enforce it

Define `ClientSolutionConfig` first, then have `SolutionConfig` **extend** it.
Client-side code typed against the narrow one then *cannot compile* a
reference to `before_hook` — the trim becomes structurally unreachable rather
than merely filtered at runtime. Add one test asserting the output contains no
hook keys anywhere, and the guarantee survives model growth.

### Two cuts, not one

Trimming by **role** — this person's readable types and runnable activities —
is the security win, and it is what `projectConfig` above does.

Trimming by **page** is the payload win, and it is much the larger of the two.
A page is about one record type, so it needs that type, its workflow, and what
it reaches through relationships — not everything the user could touch anywhere
in the operation. It also shrinks as the model grows, where the role cut grows
with it.

Both are the same function: `projectConfig(model, { roles, page })` rather than
`{ roles }`. The page cut is blocked on §7 and is the only part of this
document that is.

### What this costs the client

`MemoryAdapter` is constructed from the config on every host. Under the trim
the runtime plane hands it a `ClientSolutionConfig`, so its parameter type
widens to the narrow one. Hooks arrive absent, which is already a legal state
(`before_hook: null`), and safe: **the client never executes hooks** — scripts
and persistence are server-side by ruling, and the client evaluates
expressions only (`show_condition`, `validation`, datasources). The Console is
unaffected: it still receives the full model through `config.get`.

**The storage split helps.** Now that the model is rows rather than one blob,
the trim selects the columns and rows it wants, and "unreadable types" and
"unrunnable activities" become `WHERE` clauses rather than a filter pass.

**As built:** in memory, over the model `getSolutionConfig` already assembles —
one round trip either way, and a pure function is testable without a database.
Pushing the row cuts into SQL stays available as an optimisation.

### The whitelist fails closed, so it is locked to the types

`clientUsage` and `clientAttribute` build a fresh object naming each field to
keep. That is the right posture — a field nobody has thought about stays on the
server — but it fails *silently*: a field added to the model and not added
there is dropped, and whatever depends on it works on the server and not in the
browser. Both halves of the same commit (2026-09-15) were exactly that:
`source` went missing, so an attribute filled from `context.page.record`
reached the form with no source and the WBS create form asked for the project
whose page the button was on; and `field` went missing from `clientTypeConfig`,
so a reference attribute that names the field it fills had no target type in
the browser and its picker refused to open. Both were found on 2026-09-18, the
second only because the first prompted a look.

Three tests in `packages/server/test/projection.test.ts` close it (2026-09-18):
each builds a `Required<AttributeUsageDef>` / `Required<ClientAttributeTypeConfig>`
/ `Required<ClientAttributeDef>` literal and asserts every key either survives
the projection or appears in that test's withheld list. A new field breaks compilation until it is in the literal,
and then fails the assertion until someone decides which side of the boundary it
is on. Only `sub_attributes` is withheld today, and not for secrecy: it is
resolution output the adapter rebuilds from the composite's sub-usages, which do
ship.

---

## 3. What the client may say

Every input to `activities.run` falls into one of three classes, decided by a
single question: **does this value vary per request?**

| Class | Values | Treatment |
|---|---|---|
| **Held by the server** | org, solution, operation, user, roles | never accepted from the client |
| **Chosen by the user** | `activityId`, `recordId`, `attributes`, `waived` | must be accepted; authorised on every use |
| **Worked out by the server** | record type, `record_map`, create-vs-anchored, field mapping | never accepted (already true) |

**Hold what's constant, authorise what varies, work out the rest.**

A record id **cannot** be held server-side. The user picks it from a list at
the moment of acting, so it varies per request by definition and there is
nothing to hold it against. Its protection is authorisation on every use —
which already exists.

### Already correct today (verified in code)

- **Record type is worked out from the activity**, never accepted:
  `record_map` decides create vs anchored; supplying a `recordId` to a create
  is a hard error, omitting it on an anchored activity likewise
  ([router.ts:831-848](../packages/server/src/router.ts#L831-L848)).
- **User and roles come from the JWT**, resolved per operation before the
  engine exists.
- **`waived` is validated** against `can_waive` and applicability; forged
  waivers are rejected.
- **Unknown attribute keys are dropped** by exact-key mapping — the defence
  against smuggling extra fields into a write, already in place.
- **Anchor readability is checked before the gate**, and denied as *not-found*
  so a hidden record is indistinguishable from a missing one.

### Gap 1 — `callbackData: z.unknown()` (the sharpest)

> **CLOSED 2026-08-09 — the gap no longer exists.** Superseded by
> [DATA_THROUGH_ACTIVITIES.md](DATA_THROUGH_ACTIVITIES.md) and then **built**
> (its step 0): the resolution below is **withdrawn** — `callbackData`'s `data`
> half is **removed**, not declared. A declaration strong enough to authorise
> turned out to be the attribute-and-producer mechanism under another name, so
> there was no third thing to design. The `z.unknown()` input, the hook root
> and the third callback argument are gone; the demo dispatch captures its crew
> as a list attribute, exactly as part 2 below predicted. Part 2's authority
> rule survives intact and is restated there. The analysis below is kept as the
> record of how the gap was found — read it in the past tense.

Arbitrary client JSON handed straight to hooks as the `callbackData` root
(then `router.ts`'s `callbackData: z.unknown()`) — an unvalidated channel into
server-side script execution.

**What it is for**, precisely, because the name is used twice: in a *page
callback script* `callbackData` is the packed component payload
`{ value, data }` and never leaves the browser; in a *hook* it is the one data
object of an app-triggered run, arriving over the wire when a page callback
calls `services.activities.run(activityId, record, data)`. It is a real
capability of app pages — the channel by which a component supplies a value
that is not a captured attribute — not scaffolding. The demo dispatch page is
its only current user, but removing it would remove the capability.

**The hole is authority, not shape.** The demo passes `{ crew: 'Crew A' }`; the
before hook checks the crew is *present*, and nothing checks it is a **real**
crew, or one this user may dispatch to. A schema check would not fix that —
`GLOSSARY` already concedes the root is untyped, "the solution builder's
contract with their component", and a contract the client can rewrite is not a
contract.

**Resolution, in two parts:**

1. **Declare it.** An activity that accepts app-triggered data declares its
   shape, and the server validates the incoming `callbackData` against that
   declaration before any hook sees it — the same posture `validateSubmission`
   already applies to attributes. An activity that declares nothing accepts
   nothing.
2. **State the authority rule, and hold to it.** `callbackData` is client
   input exactly like `attributes`: it may inform a hook, and it may **never**
   be the basis of an authorisation decision. Anything authorisation-bearing is
   either worked out server-side or captured as an attribute — where it also
   gains type validation, waiver handling and a row in the reporting
   projection. The demo's crew is the worked example: as a list attribute with
   a datasource it becomes validated *and* queryable, which the blob never was.

The declaration format is not specified here — it is an SDM change and belongs
with the attribute-type work.

### Gap 2 — `operationId` on every call

The client names its own scope on every request. It *is* checked
(`resolveUser` → `requireOpUser`), so this is not a hole — it is the prime
candidate for being held server-side instead. **Direction: fix it at connect,
hand back a key, stop accepting it** (§4). Same for `solutionId` on the design
plane.

### Gap 3 — `acknowledgedWarnings: boolean`

The client asserts that the user saw the warnings
([router.ts:815](../packages/server/src/router.ts#L815)). **Resolution:** the
`needs-confirmation` result carries a **confirmation token** — the warnings the
server actually issued, signed — and the re-run must return it. The
acknowledgement then refers to warnings that exist, instead of asserting a
state of mind.

---

## 4. Signed handles

**The choice, and why.** If the client is handed less, something has to
remember on the server side. Two ways: keep it in a real session (server holds
the facts, client holds a key — costs storage, and either sticky sessions or a
shared store), or put the facts in a small signed blob and let the client carry
it back. **We take the second.** Nothing is stored, nothing is sticky.

A **handle** is that blob: a small piece of signed JSON the server issues and
the client returns — HMAC-SHA256, a **key id** so signing keys rotate without
invalidating everything, and a short expiry.

**Signed, not encrypted.** Signing gives integrity; encryption gives
confidentiality, and there is nothing here to conceal — everything in a handle
is already visible in the user's own UI. The design rule that keeps it that
way: **never put anything in a handle the user is not already entitled to
see**, and the question never arises. (Historical support: ViewState was
signed by default and *not* encrypted by default, and the famous 2010 break was
against the encryption path. Encryption done wrong is worse than signing done
right.)

**Integrity, never authority.** A handle can be replayed after the user's roles
change, so **every run re-authorises exactly as it does today**. Anything that
skips a check because "the handle says so" is the bug this design exists to
prevent.

### Operation handle (gap 2)

Issued at `connect`, carrying `{ org, solution, operation, kid, exp }`.
Subsequent calls present it instead of naming an `operationId`, and the server
reads the operation off the handle. The user and their roles still come from
the JWT, not the handle.

### Page handle

When a page opens on a record, the server returns — alongside the record and
the activities available on it — a handle attesting
`{ operation, record, version, activities offered, kid, exp }`. The client
returns it with every run fired from that page. `version` is the record's
`updated_at`; there is no version column on `records` today and this does not
add one.

**The gain is mostly coherence, not security.** If a client swaps record X for
Y between "show activities" and "run", the run re-authorises Y anyway; the
attacker gains nothing they could not get by opening Y directly. The real win
is that the activity list was worked out against the record as it stood at that
moment, and between render and click the record may have moved. Nothing
currently connects the offer to the execution. So the handle buys two things:
*changed since you were shown it*, and *this is something the server actually
advertised*.

**Plural by construction.** One handle per open page, so tabs, related-record
pivots and multi-record pages each carry their own. This is why a session-held
"current record" is **rejected**: a browser is not one linear conversation, and
a single slot collapses contexts that legitimately coexist.

### The issuing rule

> **Handle when a page is open on a record. No handle for a row acted on from
> a collection — authorise per run.**

Overhead is why the rule exists: ~200–250 bytes of JSON plus a 32-byte
signature ≈ **350–450 bytes base64**, negligible beside a Postgres round trip —
*unless* one is minted per grid row, where 500 rows × ~400 bytes ≈ 200KB
reproduces precisely the ViewState mistake.

Applied today: **workbench column 3 mints one**; `RecordsGrid` (column 2) mints
nothing, and the runs it fires are creates with no anchor anyway, so there is
nothing to attest to.

**Rejected:** a per-session map of fake ids to real record ids. It hides
*enumeration* only; it does not stop unauthorised access, which
deny-as-not-found already handles. Real cost in every read path, marginal gain.

### Expiry and refresh

Short expiry is what makes a handle safe, but an app page — a dispatch board —
may stay open all day and will fail on the next activity once its handle
lapses. So a refresh path is part of the design, not an afterthought: an
expired-but-valid handle can be exchanged for a fresh one, subject to the same
authorisation as issuing it in the first place.

---

## 5. Audit: the stamp and the hook history

Because a hook may write other records directly (§1), those records would
otherwise change with nothing on them saying why. Two things fix that, and
between them they stay small.

### The stamp — the quick answer

Every record written by a hook is stamped with **who, when, and which
activity**. It rides the `UPDATE` that is already happening, so it costs no
extra rows and no extra queries, and it shows on any record view without a
join. It is destructive by nature — each write overwrites the last.

Needs new columns on `records`; **column names to endorse.**

### Hook history — the trail

A separate append-only table, one row per record written by a hook, **holding
pointers rather than values**:

| Column | |
|---|---|
| affected record type | |
| affected record id | |
| initiating record id | which run — without this you know *an* activity touched the record, not *which execution* |
| activity id | the activity whose hook did the write |
| user | |
| timestamp | |

**Creates are included**, not just modifications. There is deliberately **no
created-vs-modified flag**: a record whose earliest entry across both logs is a
hook row was created by that hook, so the flag is derivable and derivable data
is not stored.

**One row per record per run** — a hook that writes the same record twice does
not produce two rows.

**Why a table and not the existing history.** Activity history is a jsonb array
on the record itself, plus a row in `rpt_activities`. Folding hook writes into
it would mean growing 500 arrays a night for one geocode workflow, without
bound, on records that are also hot. A separate table with pointer-sized rows
is roughly 200k rows a year for that workflow — an ordinary Postgres table.

**Why now and not later.** The stamp is destructive, so a table added in six
months starts empty and the intervening history is gone for good. Everything
else in this design is append-only; a gap here would be permanent.

**What it does not give you.** "This activity run touched this record then",
not "this field went from A to B". If a hook writes different values to
different records, the trail tells you which records, not what each one got.
Where the full series matters on a target, use a real activity on that target.

**Retention:** noted as a class that can carry its own policy later. Not built
now.

**Held in reserve:** the same table could carry a pointer for *every* activity
that modifies a record, not just hook writes — one format for everything, and
"what touched this record" becomes an indexed query instead of reading a jsonb
array per record. Deferred deliberately: both logs are pointers, so filling it
from existing activity history later is a straight copy.

Table and column names **to endorse**; "hook history" names the mechanism
rather than the thing (what distinguishes these entries is that the change was
a side effect of an activity on a *different* record), so the name should be
picked deliberately when the table is built.

---

## 6. The runner (later work)

A runner wakes on a schedule and runs a workflow. That run gets its own record,
like any other. The first activity is a query, and there are two shapes:

1. **Upstream marks the work.** Earlier workflows leave records flagged ready;
   the scheduled workflow queries for them and proceeds. Scales better —
   "ready" is a field, and a field is indexable.
2. **The workflow finds its own work.** No invoice records exist; the invoice
   workflow scans jobs, decides which are ready, and creates the records as it
   goes. Simpler to start with.

Both are legitimate; the difference is only who decides readiness.

**Nothing new in the model is required.** An earlier draft of this design
claimed the runner would need the model to express "what happens next". With a
schedule as the trigger and a query as the selector, it does not — there is no
waiting state anywhere. That only returns if a workflow must stop half way and
resume later, which is not this.

Not built. Picked up after the sections above.

---

## 7. How a page reaches its record — **BUILT 2026-08-11**

The design below is built, as step 3 of
[DATA_THROUGH_ACTIVITIES.md](DATA_THROUGH_ACTIVITIES.md): `PageDef.record`
names the record type and whether it has one instance or many, a one-instance
page finds or creates its record at open through the type's create activity,
and a many-instance page takes the id from the URL. The URL shape — the piece
this section left open — is `?page=<pageId>&record=<recordId>` beside the
existing `?operation=`, chosen as query params because the Runtime host is a
static deploy with no SPA rewrite and a page id already contains a slash; it is
revisitable, since nothing stored depends on it.

**What still waits on this is the per-page trim (§2) and the page handle**, both
of which now have the record they needed.

**Today** pages are a path plus a jsonb blob
([schema.ts:419-426](../packages/server/src/db/schema.ts#L419-L426)) —
nothing says what record type a page is about, and the record is passed per
component, call by call.

**Direction.** The declaration goes on the **page**, not the record type: a
page names the record type it is about, and whether that type has one instance
or many.

- **One instance** (a board that is simply "the board" for an operation) —
  find-or-create when the page opens. Creating it at page open rather than at
  the first activity is deliberate: the page's handle and its trimmed slice of
  the model are keyed on the record, so if the record only appeared at the
  first activity, the page would render with nothing to sign and the first run
  would be the one case that could not ride the normal path. The create still
  runs as a create activity on the user's behalf, so the record's history
  starts with "created" like every other record.
- **Many instances** (two groups, two boards) — the id arrives in the URL and
  nothing is created.

**Record types stay ordinary.** No marker says "this is an app". The only
special thing is how you arrive at the record, and that lives on the page.

**Rejected:** copying the app id and the page id onto the record as fields. The
record's type already *is* the app, and a record can be shown by more than one
page, so a single page id on the record would be wrong as soon as there is a
second view of it.

**Settled 2026-08-11:** the **URL shape** is query params —
`?page=<pageId>&record=<recordId>` — on the Runtime app's existing flat URL.

Workbench column 3 is the built-in instance of the same concept — the record UI
every SDM gets free; an authored record page is the customisable version. One
concept, two implementations.

---

## Sequencing

1. ~~**Trim by role**~~ — **DONE 2026-08-09.** Biggest security win per unit of
   work, and independent of everything else once `ClientSolutionConfig` exists.
2. ~~**Gap 1, `callbackData`**~~ — **DONE 2026-08-09**, as step 0 of
   [DATA_THROUGH_ACTIVITIES.md](DATA_THROUGH_ACTIVITIES.md): removed rather
   than declared.
3. **The signing seam** — then the operation handle (gap 2) and the
   confirmation token (gap 3), which are mechanical once one signer exists.
4. **The stamp and hook history** — independent of the client work; do it
   before much data accumulates.
5. **Page handles and the per-page trim** — the page declaration half landed
   2026-08-11 (§7), so both now have the record they key on.
6. **The runner** — last.

## Names

**Endorsed 2026-08-08:** `ClientSolutionConfig` · `config.getForOperation` ·
**projection** · **handle** · **operation handle** · **record handle** (now
*page handle*, since it is issued per open page) · **confirmation token**.

**Endorsed 2026-08-11:** the page record declaration (`record: { type,
instances }`) and the reserved read-entry keys `system_outcome` /
`system_duration_ms`.

**Used in this document, not yet endorsed:** *app record* · *run record* ·
*hook history* (and its table and column names) · the stamp columns on
`records` · *runner*.

**Introduced by the build, awaiting endorsement:** the per-entity narrow types
(`ClientAttributeDef`, `ClientAttributeTypeConfig`, `ClientCustomFieldDef`,
`ClientRecordTypeDef`, `ClientActivityRawDef`, `ClientWorkflowRawDef`) —
mechanical derivations of the endorsed `ClientSolutionConfig`, renameable
together if the prefix is not wanted.

GLOSSARY carries the endorsed set; the rest go in when they are settled.
