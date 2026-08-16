# Data through activities — the read path, and guarding what comes back

**Status: designed 2026-08-09; steps 0–4 built (0 and 1 on 2026-08-09, 2 on
2026-08-10, 3 on 2026-08-11, 4 on 2026-08-16).** The build sequence is at the
end — the spine (§4's removal, GET-in-the-engine, a page that names a GET) is
complete, step 3 has closed the log promise for reads and given a page a record
to anchor on, and step 4 has an input naming its producer, re-run at
submission. Step 5 remains, and it is now the live question: the connect-time
snapshot ships every record in the operation, which is going.

It spans engine, dsl, server, client and page-runtime, which is why it sits in
root `docs/`. It follows on from
[docs/CLIENT_TRUST_BOUNDARY.md](CLIENT_TRUST_BOUNDARY.md), and **supersedes
that document's §3 gap 1** — the resolution written there ("declare the shape of
`callbackData` and validate it") is withdrawn, for the reason in §4 below.

The goal, in the user's words: **an app's data requirements are managed via the
SDM.** Today a page carries its own queries. Under this design it names
activities, and the model answers.

---

## 1. The rule

> All data operations happen via activities. Activities in — CREATE, UPDATE,
> DELETE. **GET activities out.** Every activity sits in a workflow, and every
> workflow belongs to a record type, so every run anchors on a record.

Both halves are built: writes through `runActivity`, reads through `runQuery`
and `invoke` ([DSL_SPEC §5a](../packages/dsl/docs/DSL_SPEC.md)), each recorded
on the record it anchors on.

**Where the code diverged.** A page's `dynamicProps` entry was a FluxScript
expression stored on the page, evaluated in the browser against records the
client was handed at connect ([pageHost.ts](../packages/page-runtime/src/pageHost.ts)).
So reads bypassed the pipeline entirely: no server-side act, no authorisation at
read time, no log entry, and the query itself lived in the page rather than the
model. Closing that is what this document is about. Since step 2 a prop **may**
name a GET instead; carrying its own query is still permitted, and reads that
do still bypass everything above. Whether that stays a choice is step 5's
question, not this one's.

### The anchor is where the entry lands, not what the query is about

A write is naturally about one record. A query often is not — "invoices
awaiting my approval" is about a set. These are not in tension once the two
roles are separated:

- **the anchor** — the record the run's history entry belongs to;
- **the parameters** — what is being asked.

They need not be the same record. A GET fired from an app page anchors on the
page's own record (an **app record**, an ordinary record type — see
[CLIENT_TRUST_BOUNDARY §1](CLIENT_TRUST_BOUNDARY.md)), takes its filters as
attributes, and may reference any record ids in play through `ctx`.

**The bootstrap case.** At connect the client holds nothing, so there is no
record in play. This is not an exception: opening the app creates or opens the
app's own record, which is an ordinary create — and on a create the id comes
*out* of the run rather than into it. The bootstrap GET anchors there. **Built
at step 3**: a page declares the record it is about, and a one-instance page
finds or creates it at open.

---

## 2. GET activities — **BUILT 2026-08-09**

The shape is already specified in [DSL_SPEC §5a](../packages/dsl/docs/DSL_SPEC.md)
and is not restated here. What that section already settles: attributes are the
**parameters**, a `returns` expression produces the response, GET never mutates
(validator-enforced), and apps call GET activities instead of ad-hoc APIs via
`invoke(name, params)`.

Three points this document adds.

**Parameters are attributes, deliberately.** They are not a second concept.
Modelling them as attributes gives types, `required`, `validation`,
`show_condition` and `can_waive` for free, and one capture form. A separate
"params" concept would duplicate every one of them. The GET's log calls them
parameters; that is the same thing named at the other end.

**The result is not an attribute and is not stored.** `returns` produces the
response. GET is **logged light** — parameters, caller, outcome, duration,
never the returned data ([runtime SPEC](../packages/runtime/docs/SPEC.md), "the
pipeline is the log"); `watch` escalates a particular read when you need to see
what someone actually saw. Built at step 3, below.

**Hooks may invoke a GET.** `invoke(name, params)` is read-only, so it does not
carry the cascade risk that keeps hooks from starting other workflows
([CLIENT_TRUST_BOUNDARY §1](CLIENT_TRUST_BOUNDARY.md) — a workflow triggers
another by creating a record, never by calling an activity). This is what makes
§3's fallback tier possible.

### As built (step 1)

Two decisions were taken during the build and are recorded here rather than
left implicit:

- **A second engine method, not a second branch.** `runQuery` sits beside
  `runActivity` and shares the front of the pipeline (availability gate,
  before hook) through extracted helpers. One pipeline in the sense that
  matters — one set of checks — while the two results stay honestly different:
  a write answers `{ status, warnings, recordId? }`, a read answers
  `{ data, warnings }`. Folding a read into `RunActivityResult` would have left
  every existing caller holding fields that mean nothing. The server followed:
  `activities.query` is a tRPC **query**, not a mutation.
- **The gate is the whole of the access control.** A GET returns what its
  author declared it to return; there is no second read filter over the answer.
  This matches how a write already works (an UPDATE may touch a record type
  the caller cannot read) and follows from the platform's own thesis — the
  activity is the unit of access. Worth revisiting if a GET is ever authored
  by someone with less authority than the people who run it.

Purity came free: `returns` is validated as an *expression*, and expression
mode already rejected `create()`/`update()` and unqueued service effects. No
new rule was written to say a read cannot write. `validateConfig` adds the
shape rules — a GET needs a `returns`, may not have an after hook, and
`returns` is rejected on anything else — plus literal-id resolution for
`invoke`.

### A page names one — **BUILT 2026-08-10 (step 2)**

**There was no syntax to design.** The open question was how a prop names its
producer; the answer is that it already could. `invoke` is a *DSL built-in*,
declared globally and explicitly legal in expressions, resolved through
`EvalHost.invoke` — and a host that runs no activities leaves that absent so
`invoke` fails loudly. The page host was exactly such a host. Supplying the
function is the whole of "the page names its producer":

```
workOrders: invoke('act_get_work_orders', { status: context.page.status })
```

The prop's stored shape is unchanged — still one expression string — so there
is no second binding format to validate, migrate or teach, and the page carries
the activity's *name* where it used to carry the query. It also means the same
text runs unchanged on the server, where `invoke` is already native; §3's tier-1
direction (a declared producer the engine re-runs at submission) inherits that
for free rather than needing a shape of its own.

**The rejected alternative** was a structured binding — `dynamicProps[prop]`
becoming `string | { activity, params }`. It would have made async trivial and a
page's data requirements readable without parsing FluxScript. It was declined as
a second wiring language beside FluxScript: the same dropdown-built union
[PAGE_WIRING_DESIGN](../packages/console/docs/PAGE_WIRING_DESIGN.md) decision 2
removed once already, and a shape the server would have to learn to interpret
where `invoke` already works.

**The real problem was time, not syntax.** The evaluator is synchronous; a GET
is a round trip. Rather than making the language async, evaluation runs in
**rounds** — a round evaluates with an `invoke` that records requests and
returns a placeholder, the round's requests are fetched together, the next round
evaluates again with the answers. A round that asks for nothing new is the
answer. This is sound only because reads are pure: datasource posture already
guarantees the expression has nothing to repeat. Two consequences worth stating:

- **It sees more than an AST walk would.** An expression may reach `invoke`
  through a named function (DSL_SPEC §8); no walk of the expression alone finds
  that. Running it does.
- **The placeholder is a symbol, not null.** The evaluator reads an unknown
  object's members as nulls, so a null placeholder made
  `invoke(…).first.status` silently null and sent the *next* GET a question
  nobody meant — which the server correctly rejected for a missing required
  parameter. Reaching into a symbol throws instead, the round is abandoned, and
  the round holding the answer asks the real question. A GET fed by a GET
  therefore converges rather than being a special case. (Found by the test, not
  by reasoning.)

**A gap the first real use exposed.** The Console's SDM editor could not author a
GET at all — its record-map select offered CREATE/UPDATE/DELETE and there was no
`returns` field anywhere, because it shipped (M8, 2026-07-21) three weeks before
GET activities existed. A page could name a producer nobody could write. Closed
the same day: the select offers GET, which swaps the after-hook field for
`returns`, and switching maps clears whichever of the two the new one forbids —
the rules `validateConfig` already enforced, now visible before save rather than
after. The symptom was a page saving clean against `validatePage` (which
correctly said `Unknown activity`) while the server answered
`Activity not found`, because the activity was only ever in the bootstrap
fixture and never in anyone's database.

One thing is deliberately *not* here: `invoke` is unavailable in a **callback**
— a callback script is synchronous and returns nothing, so there is no round to
wait in; `validatePage` rejects it at save. The other gap this step left — a
page's GET carrying no anchor — is what step 3 filled.

### Logged, and anchored — **BUILT 2026-08-11 (step 3)**

The two halves interlocked as expected: an entry needs somewhere to land, and a
page had nowhere to put one. Both are now in place, and neither needed a new
mechanism.

**A GET is recorded like every other activity.** `runQuery` appends one entry to
the anchor record: the parameters (which are attributes, so they land exactly as
a write's captured values do — the entry-building code is now literally shared
between the two pipelines), the caller as `author`, gate warnings, and two
reserved keys of its own, `system_outcome` and `system_duration_ms`. The answer
appears nowhere. `activities.query` write-backs like a run does, so the entry
reaches the record and the reporting projection through the path that already
existed — a GET row in `rpt_activities` is a GET row like any other, which is
what makes "what did this person read" an ordinary query rather than a feature.

Three calls the build made, each following from a rule already written:

- **A rejected read leaves no trace, a failed one does.** A gate `fail` records
  nothing (rejected submissions leave no trace — the doctrine the write path
  already follows), while a `returns` that throws records the attempt with
  `system_outcome: 'error'` and the message on the system log, then rethrows.
  That is the same shape as a failing after hook: recorded, nothing applied.
- **A GET invoked from a hook is not a run of its own.** Its lines join the
  triggering run's system log and no second entry appears — the runtime SPEC's
  existing rule that reads are subsumed by the activity that triggered them,
  applied to the read that happens to be an activity. It also stops a read from
  persisting inside a write whose gate went on to reject it, which the shared
  write-back would otherwise have done.
- **The nested-read bug the build surfaced.** `runQuery` cleared the engine's
  per-run log; a hook that logged, then invoked a GET, lost the lines it had
  already written. The nested call now leaves the caller's log alone. It was
  latent since step 1 and had no test — one exists now.

**A page's record is a declaration on the page.** `PageDef.record` names the
record type and whether it has one instance or many; `resolvePageAnchor` finds
or creates it before the first frame renders. One instance ⇒ found, or created
**through the type's create activity**, so a board's history starts with
"created" like anything else; many ⇒ the id comes off the URL; absent ⇒ a pure
view whose reads land nowhere. The record type stays ordinary — nothing marks it
as an app.

The resolved record becomes `context.record` for every expression and callback
the page runs, and its id is the anchor sent with each GET. Rendering waits for
it deliberately: a component that read first would fire an untraceable GET and
then have to fire it again.

**The URL now addresses what is open** — `?page=<pageId>&record=<recordId>`
beside the existing `?operation=`. Query params over path segments because the
Runtime host is a static deploy with no SPA rewrite and a page id already
contains a slash; the shape is revisitable, since nothing stored depends on it.
`?operation=` stays what it was, session establishment rather than addressing,
and it is the operation handle ([CLIENT_TRUST_BOUNDARY §4](CLIENT_TRUST_BOUNDARY.md))
that retires it, not this.

**And the Console can author both**, which is the step-2 lesson applied in
advance rather than after the fact: a Page Record section beside Page Access
picks the record type and the number of instances, and `validatePage` catches
the two ways a page can be stranded (no such type, no create activity) plus two
warnings — a create that needs values nobody can supply at page open, and a page
that names a GET while being about nothing.

**What step 3 could not do for pages already stored — 2026-08-11.** `validatePage`
gained the two record checks above, and they worked: a real page in a real
database named a GET while declaring no record, and the warning fired exactly as
written. It fired into the browser's devtools console, which is not where anyone
authoring a page is looking, so the page sat that way — reading, answering, and
logging nothing, which is the one thing this step exists to prevent.

Nothing about the checking was missing; only its audience was. The findings now
render in the Console's own bottom panel, over **every page in the open
solution** rather than only the one being edited, so pages that drifted before a
check existed surface without anyone opening them. Saving a broken page is still
allowed — the panel is what makes it impossible to do so unknowingly.

Worth recording because it was nearly built the other way: the first proposal
was to validate pages **on the server**, at `pages.put`, the way the model is
validated at `config.put`. That would have made the server import the page
validator, and with it the component registry and React, to police an artifact
it deliberately keeps opaque — coupling the server's idea of a valid page to a
library of UI components. The reason it looked necessary was an assumption that
nothing checked pages at save. Something did.

**Publishing still checks nothing** — `pages.publish` snapshots the draft, errors
and all. Saving a broken page and publishing one are different acts and only the
first has a reason to be permissive. Open.

**On §6's question of whether the query language is expressive enough** — the
only honest answer this step produced is that nothing was missing for the case
built. It is one GET over one record type, so it is weak evidence; the question
stays open until a real page needs a real set.

---

## 3. Guarding what comes back

**The problem.** A user is shown a set, picks from it, and submits their
picks. Nothing about the submission proves the picked values were ever in the
set, or are still in it.

**The mechanism: a declared set-producer.** An expression in the model that
turns parameters into a set. Two forms of one thing:

| Level | Form | Exists today |
|---|---|---|
| field | `datasource` on a list attribute | yes |
| activity | `returns` on a GET activity | no |

Because the producer is **declared**, the server can evaluate it again at
submission time and check what arrived against what it yields. That is not
duplicated logic — it is one declaration used twice: once to produce the
choices, once to validate them.

### Re-running beats storing or signing

Two alternatives were considered and rejected:

- **store the GET's result** and check membership against it — contradicts
  "never the returned data", and costs storage on every read that opts in;
- **sign the result** and have the client hand the signature back — no
  storage, and it is the mechanism
  [CLIENT_TRUST_BOUNDARY §4](CLIENT_TRUST_BOUNDARY.md) already chose for
  handles.

Both prove only that the values **were offered**. Re-running the producer
re-derives against the data **as it is now**, so it catches tampering *and*
staleness — a value legitimately offered but since consumed by someone else
fails too. The cost is running the query a second time. That is the trade taken.

### Two tiers

1. **The input names its producer → the engine checks.** Automatic, no author
   action. This is what a list attribute's `datasource` already does:
   `validateSubmission` re-evaluates it server-side as that user and **fails
   closed**, deliberately — "the datasource IS the validation here, so an
   evaluation error must not wave values through"
   ([validateSubmission.ts](../packages/engine/src/validateSubmission.ts)).
2. **The input does not → the before hook re-invokes and fails closed.** The
   author writes `invoke('act_get_…', params)` and compares. Same evaluation,
   triggered by hand.

**The direction is that tier 1 absorbs tier 2**: an input names its producer,
which is either an inline expression (today's `datasource`) or a GET activity.
Then it does not matter how many GETs a page runs — each input points at its
own producer, and no author has to remember which set a value came from. Tier 2
remains for genuinely custom checks.

**Same parameters.** The re-run must use the parameters the original query used,
or it validates against a different set than the user saw. The parameters
should therefore be the submitting activity's own attributes or come from
`ctx`, so the server supplies them. A parameter that arrives from the client
must be one whose value cannot widen the set beyond what that user may see.

**What is not automatic.** Where the set has no declared producer, nothing can
be. That is the argument for the tier-1 direction rather than a documentation
note telling authors to be careful.

### As built — the server half (step 4, 2026-08-16)

There was less to build than the table above suggests, which is the sign the
earlier steps were shaped right. A list attribute's `datasource` was already
re-evaluated at submission and already failed closed; the only thing it could
not do was name a GET, because `validateSubmission` built a script context
without `invoke` in it. Supplying it is the whole change:

```
"type_config": { "datasource": "invoke('act_get_crews', { region: attributes.region })" }
```

Two things follow, neither of them new rules. The GET's **own gate** decides
the set, so a caller the GET rejects cannot submit a value from it — the
"failed closed" posture that was already there now reaches authorisation, not
just evaluation errors. And the **parameters** are the submitting activity's
own attributes, which is what §3 asked for: the server supplies them, so the
re-run asks the same question the user was answering rather than a question the
client chose.

`Engine.invoke` is now on the engine's interface for this. It evaluates locally,
in the engine it belongs to — which is exactly what a browser must not do with
a read, so only the server passes it into an expression. Nothing changed for
hooks or `returns`; they were always given it.

**The browser half is BUILT (2026-08-16).** A datasource is now evaluated
through the engine's rounds
([AttributesForm.tsx](../packages/page-runtime/src/capture/AttributesForm.tsx)),
so the producer above fills the dropdown it guards: the round asks the GET, the
answer becomes the options, and the same expression is what the server re-runs
at submission. A datasource that names no GET resolves on the first round
without touching the network, so the loading state appears only when something
is genuinely being fetched. Show conditions and validation rules stay
synchronous and local — they re-run on every keystroke, and they read what the
host already holds.

The form itself moved to do it. It was the workbench's, and pages had a 60-line
imitation that drew every attribute as a text box; sharing the rounds meant
sharing the form, so **one capture form now lives in `@fluxus/page-runtime` and
both hosts supply what it asks for** (`CaptureHost`: evaluate an expression,
reach a GET, upload a file, resolve a reference's label). The one thing that
did not travel is the record picker — browsing records to choose one needs
records, which a page does not hold, so a host may inject a picker and a page,
having none, shows a reference as a typed id, exactly as its old form did.

---

## 4. `callbackData` is removed — **BUILT 2026-08-09**

**Only the `data` half.** The name means two things at its two ends, which is
what made this hard to discuss:

- in a **page callback script**, `callbackData` is `{ value, data }`, packed in
  the browser. `value` is the record the component emitted — how the callback
  knows which row was clicked. **`value` stays.** It is the anchor, and an
  anchor is authorised on every run.
- in a **hook**, `callbackData` is the free-form `data` object of an
  app-triggered run, arriving over the wire. **This goes**, along with the
  `data` argument to `services.activities.run` and the root in hooks.

**Why it goes.** Everything else in the design gets its guarantees from being a
declared part of an activity — validated, stored, logged. `callbackData` is by
definition the part that is not declared, so it gets none of them, and the hook
author must supply by hand what the pipeline supplies for free everywhere else.
Once values arrive as attributes, it covers no ground the model does not cover
better.

**Why not a declaration format** (the withdrawn §3 gap 1 resolution): a
declaration strong enough to *authorise* — "these values must come from this
producer" — is the attribute-and-producer mechanism under another name. There
was never a third thing to design.

**The one live user is small.** `act_dispatch_work_orders`
([work_orders.json](../packages/runtime/config/entities/work_orders.json))
declares `"attributes": []`, so it runs straight through, and its before hook
checks only that `callbackData.crew` is not null. Give it a `crew` list
attribute with a datasource: the capture form opens (it already does for any
activity with attributes), `validateSubmission` checks the choice against the
datasource, and the hooks read `attributes.crew`. No new mechanism is needed —
which is why this step can be taken first, before any of the rest.

### Removal surface — all done

| Where | What |
|---|---|
| config | `act_dispatch_work_orders` — `crew` becomes a captured list attribute; hooks read `attributes.crew` |
| engine | `RunActivityOptions.callbackData`, the `extras` root, `extraRoots: ['callbackData']` in `validateConfig` |
| server | the `z.unknown()` run input and its pass-through; regenerate `api/index.mjs` |
| client | `callbackData` on the run input |
| page-runtime | the third argument through `services.activities.run` → `runActivity` → `ComponentContainer`; `packCallbackData` keeps `value` only; `WorkOrderList.onDispatch` emits the record alone, and its manifest text with it |
| docs | GLOSSARY (`callbackData`, "Callback (page)"), engine / server / page-runtime SPECs, DSL_SPEC, PAGE_WIRING_DESIGN, CLIENT_TRUST_BOUNDARY §3 gap 1 |

**As built.** The crew attribute is a `list` with the literal datasource
`['Crew A', 'Crew B', 'Crew C']` — a declared producer, so `validateSubmission`
already checks the submitted crew against it server-side (§3 tier 1, the
mechanism that exists today). `required: true` replaced the before hook's null
guard entirely, so the hook is gone: what the gate hand-checked, the pipeline
now checks. Dispatch is no longer attribute-less, so it opens the standard
capture form — from a page and from the workbench alike, which is the point.
`extras` itself stays on `ScriptContext`: validation rules still inject `value`
through it, and page callbacks still inject `callbackData`.

---

## 5. Build sequence

Ordered so each step stands on its own and nothing needs unpicking later.

| # | Step | Delivers |
|---|---|---|
| 0 | ✅ **BUILT 2026-08-09** — remove the `data` half of `callbackData`; rewrite the dispatch crew as a captured attribute | the rule that values arrive as attributes; independent of everything below |
| 1 | ✅ **BUILT 2026-08-09** — GET in the engine: `record_map: "GET"`, `returns` evaluated read-only with attributes as params, validator purity, a server endpoint, and `invoke(name, params)` for hooks. No logging yet | the prerequisite for everything else |
| 2 | ✅ **BUILT 2026-08-10** — a page names a GET for a dynamic prop instead of writing an inline expression: `invoke` supplied to the page host, evaluated in rounds, checked by `validatePage` | **the goal**: data requirements move out of the page and into the model |
| 3 | ✅ **BUILT 2026-08-11** — GETs logged light on the anchor; a page declares its record, found or created at page open | observability, and the pipeline-is-the-log promise held for reads |
| 4 | ✅ **BUILT 2026-08-16** — a `datasource` may name a GET: `validateSubmission` re-runs it at submission (server half), and the capture form fills its dropdown from it through the engine's rounds (browser half, which also made the form one shared form) | the guarding payoff — tier 1 absorbs tier 2 |
| 5 | Reconcile the connect-time snapshot: refresh-after-run by re-invoke, and whether connect stays one big GET or pages fetch their own | production shape; decide on evidence |

Steps 0–2 are the spine, complete as of 2026-08-10; step 3 followed on
2026-08-11. 4–5 are what remain to make it production-shaped.

---

## 6. Open

- ~~**The syntax by which an input names a GET activity as its producer**~~ —
  **answered by step 2 (2026-08-10): it is `invoke`.** A producer names a GET
  inside the expression it already is, so a `datasource` reading
  `invoke('act_get_crews', { region: attributes.region })` needs no new syntax
  and already evaluates server-side. What step 4 still has to build is the
  *re-run at submission*, not a way to say it.
- **A route for a component to supply an attribute value directly** — the
  ticked-ids case, where the component already knows the value and a blank form
  would be absurd. Deferred until a real case needs it; not required by any
  step above. Whether such a value is a prefill, locked, or skips the form is
  part of that question.
- **Volume**: one bootstrap GET versus per-page GETs. A scaling decision, to be
  made on evidence, not up front. Step 3 sharpened it rather than answering it:
  reads now leave rows, and a page's reads all anchor on one record, so an app
  record's history is the first thing in the platform whose growth is driven by
  browsing rather than by doing. Entry **class** and retention are declared in
  the runtime SPEC and unbuilt, so nothing trims it yet.
- **Whether the query language is expressive enough** for what components
  actually need. Step 2 is built but has been used on one GET over one record
  type, which proves little — still open, now for want of a real page rather
  than for want of a caller.
- **Whether a prop may keep carrying its own query.** Step 2 added naming a GET
  without removing the inline alternative, so both are legal and only the named
  one is authorised at read time. Deliberate for now; it belongs with step 5.
- **Read service calls are not logged individually** (datasource-evaluation
  volume) — proposed 2026-07-10, still never confirmed.

---

## Decision log

**2026-08-16** — **One capture form, and the host supplies what it asks for.**
A page opening the real form meant the form had to stop being the workbench's,
so it moved to `@fluxus/page-runtime` behind a `CaptureHost` seam and the
workbench imports it. The alternative — page-runtime importing the workbench —
would have made the page runtime depend on the whole record UI to draw one
dialog. Keeping two forms was rejected outright: it is why pages had no
dropdowns for four weeks.

**2026-08-16** — **The record picker is injected, not moved.** It is the only
part of the form that needs a record snapshot, so a host that has one supplies
it and a page falls back to the typed id its own form always showed. Moving it
would have shipped a picker that opens empty.

**2026-08-16** — **Only a datasource may round-trip.** Show conditions and
validation rules re-run on every keystroke, so making them asynchronous would
put the network between a person and their typing. They read `attributes` and
the anchor record, which the browser already holds.

**2026-08-11** — **A page is validated where it is authored, not at the server
door.** The Console already ran `validatePage` on every save; its findings went
to a console nobody reads, so they were moved onto the screen. The rejected
alternative — validating at `pages.put` — would have made the server depend on
the page validator, the component registry and React, to check an artifact it
stores as opaque data on purpose.

**2026-08-11** — A read is recorded the same way a write is: **one ordinary
history entry on the anchor record**, projection included. No second treatment
for reads, no read-only log store — the alternative (rows in the reporting
tables only) was declined as a second source of truth.

**2026-08-11** — **A GET reached from a hook is not logged separately.** It
belongs to the run that asked, extending the existing rule for read service
calls; the alternative also let a read persist inside a rejected write.

**2026-08-11** — A page's record is declared **on the page**, and a
one-instance page's record is **created through the create activity** at open.
There is one way a record comes into being, and a page opening its board uses
it.

**2026-08-10** — A prop names its producer with **`invoke` inside the expression
it already is**, not with a structured binding beside it. One stored shape, one
language, and the same text is what the server will re-run at step 4. The
alternative was rejected as a second wiring language.

**2026-08-10** — A synchronous evaluator reaches an asynchronous GET by
**re-evaluating in rounds**, not by making the language async. Legitimate only
because reads are pure — which datasource posture already enforced.

**2026-08-09** — `callbackData`'s `data` half is removed rather than declared.
A declaration strong enough to authorise is the attribute-and-producer
mechanism renamed. Withdraws CLIENT_TRUST_BOUNDARY §3 gap 1's resolution.

**2026-08-09** — Guarding is by **re-running the declared producer**, not by
storing or signing the result. Re-running catches staleness as well as
tampering; storing and signing catch only "was offered".

**2026-08-09** — GET parameters are modelled as attributes, not as a separate
concept, so they inherit types, validation, conditions and waivers.

**2026-08-09** — The anchor of a run is where its history entry lands, not the
subject of its query. This removes the apparent conflict between "every run is
about one record" and queries that are about sets.

**2026-08-09** — The connect-time record snapshot is one large GET, not a
bypass. Client-side re-filtering of data the user has already been given is not
a read event; the audit unit is the **disclosure**.
