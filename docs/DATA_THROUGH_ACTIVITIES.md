# Data through activities — the read path, and guarding what comes back

**Status: designed 2026-08-09; step 0 built 2026-08-09.** The build sequence is
at the end — §4's removal is done, steps 1–5 have not started.

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

**Where the code diverges today.** A page's `dynamicProps` entry is a FluxScript
expression stored on the page, evaluated in the browser against records the
client was handed at connect ([pageHost.ts](../packages/page-runtime/src/pageHost.ts)).
So reads bypass the pipeline entirely: no server-side act, no authorisation at
read time, no log entry, and the query itself lives in the page rather than the
model. Closing that is what this document is about.

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

## 2. GET activities

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
| 1 | GET in the engine — `record_map: "GET"`, `returns` evaluated read-only with attributes as params, validator purity, a server endpoint, and `invoke(name, params)` for hooks. No logging yet | the prerequisite for everything else |
| 2 | A page names a GET for a dynamic prop instead of writing an inline expression | **the goal**: data requirements move out of the page and into the model |
| 3 | Log GETs light; app record created or opened on first page open, as the anchor | observability, and the pipeline-is-the-log promise held for reads |
| 4 | An input names its producer; the engine re-invokes it at submission | the guarding payoff — tier 1 absorbs tier 2 |
| 5 | Reconcile the connect-time snapshot: refresh-after-run by re-invoke, and whether connect stays one big GET or pages fetch their own | production shape; decide on evidence |

Steps 0–2 are the spine. 3–5 are what make it production-shaped.

---

## 6. Open

- **The syntax by which an input names a GET activity as its producer** (step
  4). Not settled — the existing `datasource` string is the obvious place to
  extend, but nothing is decided.
- **A route for a component to supply an attribute value directly** — the
  ticked-ids case, where the component already knows the value and a blank form
  would be absurd. Deferred until a real case needs it; not required by any
  step above. Whether such a value is a prefill, locked, or skips the form is
  part of that question.
- **Volume**: one bootstrap GET versus per-page GETs. A scaling decision, to be
  made on evidence, not up front.
- **Whether the query language is expressive enough** for what components
  actually need. Unknown until step 2 is used in anger.
- **Read service calls are not logged individually** (datasource-evaluation
  volume) — proposed 2026-07-10, still never confirmed.

---

## Decision log

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
