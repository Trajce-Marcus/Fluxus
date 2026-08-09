# Data through activities — the read path, and guarding what comes back

**Status: designed 2026-08-09; steps 0–2 built (0 and 1 on 2026-08-09, 2 on
2026-08-10).** The build sequence is at the end — **the spine is complete**:
§4's removal, GET-in-the-engine, and a page that names a GET are done. Steps
3–5, which make it production-shaped, have not started.

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

The write half is built and holds. The read half is specified
([DSL_SPEC §5a](../packages/dsl/docs/DSL_SPEC.md)) and is not built — which is
why the rule is currently true of writes only.

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
*out* of the run rather than into it. The bootstrap GET anchors there.

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
what someone actually saw.

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

Two things are deliberately *not* here. `invoke` is unavailable in a **callback**
— a callback script is synchronous and returns nothing, so there is no round to
wait in; `validatePage` rejects it at save. And a page's GET carries **no anchor
record**: a page has none of its own until step 3, so the run is anchorless, which
is exactly the hole step 3 fills.

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
| 3 | Log GETs light; app record created or opened on first page open, as the anchor | observability, and the pipeline-is-the-log promise held for reads |
| 4 | An input names its producer; the engine re-invokes it at submission | the guarding payoff — tier 1 absorbs tier 2 |
| 5 | Reconcile the connect-time snapshot: refresh-after-run by re-invoke, and whether connect stays one big GET or pages fetch their own | production shape; decide on evidence |

Steps 0–2 are the spine, and it is **complete as of 2026-08-10**. 3–5 are what
make it production-shaped.

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
  made on evidence, not up front.
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
