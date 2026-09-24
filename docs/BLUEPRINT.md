# Fluxus — Blueprint

The authoritative short version of what the platform is and will do, in plain
language. Deeper detail: [VISION.md](VISION.md) (why), [ARCHITECTURE.md](ARCHITECTURE.md)
(how the parts connect), [GLOSSARY.md](GLOSSARY.md) (canonical terms — it wins on
definitions), [ROADMAP.md](ROADMAP.md) (build phases). Each section is marked
**Built** or **Direction** (agreed, not built).

## The idea

Organisations fragment because every app brings its own tables and its own API.
Fluxus is **model-first**: record types, workflows, and activities are defined
once in a **Shared Data Model (SDM)** — each solution carries its own — and
every app, page, and integration is a projection over that model, scripted in
one language. Apps come and go; the model accumulates.

## Who's involved

- **Fluxus (the platform)** — the multi-tenant infrastructure: the two apps, the
  server, the data stores.
- **Org** — a subscribing business (e.g. a water-maintenance company). Owns its
  users, data, and installed solutions.
- **Solution provider** — whoever authors a solution: the org itself, or a
  third-party vendor selling through the future Catalogue.
- **End user** — a person in an org doing daily work in the Runtime app.

## Architectural component matrix — *Built*

| Domain | Component | What it does | Runs as |
|---|---|---|---|
| **User interface** | **Console** | The builder's app: author the SDM, build pages, run the workbench (raw record/data tooling), administer operations, roles, publishing. | Browser app — `@fluxus/console` |
| | **Runtime** | The end user's app: sign in, see your operation's menu, use its published pages. Shows the solution's identity, not the platform's. | Browser app — `@fluxus/runtime` |
| | **Platform** | Our own app, above every org: register an organisation and its owner. The tier that answers who creates an org and who sees across orgs; usage, billing and cross-org entitlement land here. | Browser app — `@fluxus/platform` |
| | **Page runtime** | Turns a stored page definition into working UI against live records; embedded by both apps. | Browser library — `@fluxus/page-runtime` |
| **Model** | **SDM** | A solution's definition of its data and behaviour: record types, workflows, activities, hooks. Validated at save; versioned in the database. | Stored config artifact |
| **Business logic** | **Activity engine** | The one pipeline every change goes through: availability gate → capture → validate → before hook → persist → after hook → history. Never reimplemented. | Shared library, browser + server — `@fluxus/engine` |
| | **FluxScript (DSL)** | The one scripting language — a SQL/JavaScript blend — for every expression, query, and hook. | One interpreter, browser + server — `@fluxus/dsl` |
| **API** | **Server** | Activities are the API: every caller (page, workbench, external system) changes data only by running an activity. | Serverless functions — `@fluxus/server` |
| | **Client** | The browser apps' door to the server: fetches the data snapshot at connect, sends activity runs. | Browser library — `@fluxus/client` |
| **Data** | **Transactional store** | Live records as flexible JSON, partitioned per operation — fast writes, serves the running apps. | Postgres (Neon) |
| | **Reporting store** | Relational tables projected from the activity stream — querying, BI, cross-operation views. | Postgres schemas (same Neon in v1) |

## The operating model

**Built:** A solution — one bundle of SDM + pages + roles + default menu — is
authored in the Console. An **operation** links to exactly one solution and
runs it for real: its own records, users, role assignments, and (optionally) a
menu override. Two operations can run the same solution with fully separate
data and people — **the operation is the data boundary, and separation is a
choice**: an org that wants one shared pool of jobs runs one operation, and
models internal structure (regions, teams) as fields inside the SDM rather
than as extra operations. End users sign into the Runtime app, which renders their
operation's published pages, filtered by their roles. The database — not the
repo — is the source of truth for a solution's config and pages.

**Direction:** an org gets solutions two ways — author them, or install them
from the **Catalogue**. Installed solutions carry provenance (the `origin`
columns exist today; the install path doesn't).

## Rules the platform never breaks — *Built*

1. **All change goes through activities.** Records are never edited directly;
   every mutation, from any surface, lands in the append-only activity history.
   That history is the audit trail, the only log, and the source the reporting
   layer is projected from — so reporting can never miss a change.
2. **One language everywhere.** A query written for a page binding is the same
   language as a hook or a headless call.
3. **Scripts are scope-blind.** A script never names its org or operation;
   scope is injected. No script ever needs rewriting when the hierarchy grows.
4. **History is never edited.** Mistakes are reversed by compensating
   activities; published versions are append-only, rollback = republish.
5. **Everything validates at save time.** Config and pages are checked against
   the model before anything runs — the guardrail that makes AI-authored
   artifacts safe.
6. **Pages are data, not code.** A page is a stored, validated definition
   interpreted at render time — no compile step, no arbitrary bundles.

## Deleting — *Built and Direction* (ruled 2026-09-21)

**Built.** The DSL has `delete()` — `r.delete()`, or
`records.<type>.where(...).delete()` in bulk — and it destroys the record **and
its history**. That is deliberate: a delete is for a record that should never
have existed. Keeping a record while taking it out of circulation is a
different act, done by marking a field the author declares and their queries
filter on, the way the projects solution uses `expired`. **The platform does not
own that flag** — whether a removal is real or a mark is the implementer's
decision, made per solution.

Rejected on the way here: a parallel DELETED record type per type (a record type
defines shape and behaviour, not a place to put things — and nothing retypes a
record), one DELETED type for everything (custom fields are per type, so a
heterogeneous bucket has no schema to read back through), and a platform-owned
live/deleted state with automatic filtering.

The audit of a deletion lives on the record the **deleting activity** was
anchored to — the ids it named, and the reason if the author captured one —
never on the record destroyed. So a delete activity must be anchored on
something that outlives the run.

**Reversed 2026-09-21 (same day): "no deletes in production" is dropped.** The
ruling was that deleting is a setup-only capability, gated by an operation
lifecycle state — in development vs live, one-way, delete refused after the
flip. It was reversed on reflection the same day: **publishing governs the SDM
and pages; data needs no dev/prod split.** A solution is expected to ship the
tools to manage its own data, and removing a duplicate stock item is ordinary
operational work, not something only an implementer may do before go-live.

So no operation lifecycle state is planned, and delete is guarded the way every
other change is: it runs inside an activity, so the availability gate, roles and
hooks all apply, and the referential check refuses it while anything still
points at the record.

**A delete is refused while something still points at the record** — the error
names what is holding the reference, so records are removed from the bottom up.
A subtree deleted in one run is fine: the check runs over the whole staged set,
so a child on its way out does not count as a reference holding its parent.

**Two things left open.** Reporting rows projected from a deleted record's
history are not purged with it (deferred, and pinned by a test). And **erasure**
— removing one person's data from records and history entries that themselves
stay — is not this, and is not a platform capability: an implementer builds the
tool, selects the records, and the hooks do the work.

## Record identity — *Built* (ruled 2026-09-18)

**Every record gets its own id, issued by the platform** — a UUIDv7, unique
across every record type in the operation. Nothing in the model names it, and
nothing may set it.

A record type could nominate one of its own fields to key on (`id_field`), and
the projects solution keyed its WBS and CBS on their codes. That made a business
value load-bearing in three ways nobody had asked for: deleting a node reserved
its code forever, because the reporting rows that outlive the record still
address it; renaming one left the id saying the old code while the field said
the new one; and two record types numbering something `1.0` collided outright,
as would a second project reusing the first's codes. **A code is a value;
identity is the platform's.** `id_field` is retired from the model — no future
solution can opt in.

What follows from it:

- **Uniqueness is now stated, not inherited.** A natural key was unique because
  it *was* the id. A type that needs a value unique declares it on the field.
- **Uniqueness scoped to a parent is an open gap** — a WBS code unique within
  its project rather than across the operation has no expression in the model.
  Global uniqueness was an accident of the old scheme, not a decision.
- **Existing records keep the ids they have.** Nothing parses an id, so old
  value-shaped ids and new UUIDs coexist; no re-keying migration was run.

## Versioning and upgrades — *Direction* (agreed 2026-07-27)

- A **release** is one numbered snapshot of a whole solution — the model plus a
  chosen set of page versions — cut by the solution owner when ready. (Per-page
  and per-model version history is Built; the bundling is not.)
- Operations **pin** a release: they stay on it until they choose to move.
  No forced upgrades — a provider with hundreds of orgs publishes a new release
  and each org migrates on its own clock. An unpinned operation follows latest
  (today's behaviour becomes the default case).
- **Components** (the platform-supplied UI blocks pages are built from) version
  and pin separately, since they sit outside solutions. Until they are loadable
  artifacts, the interim rule is discipline: component changes must be
  backwards-compatible; a breaking change means a new component name.
- The known hard problem, deliberately open: a release that changes the model
  needs a data-migration story before a live operation can move to it.

## Data retention — *Direction* (agreed 2026-09-13)

Retention is set **per operation, per record type** — not per solution. The
solution defines what a record is and when it is *finished* (`complete_when` in
the SDM — a business rule, the author's job). The operation decides **how long
to keep it**, because retention obligations are legal and jurisdictional and
belong to the business unit holding the data, not to whoever authored the
model. Two operations running one solution will differ, legitimately.

An operation admin sets it through an **admin tool in the workbench**: the
operation's record types listed, a retention window against each, and what
happens when it expires.

Three things it must not break:

- **History is never edited** (rule 4). Retention **archives**; it never
  rewrites. Completed records leave the transactional store and the relational
  copy remains — the archival design already in
  [ARCHITECTURE.md](ARCHITECTURE.md).
- **Direct class is never trimmed.** Business truth stays. What a policy may
  age out is `system` class — apps, notifications, engine-authored entries.
  Class is the guard rail on which record types may carry an aggressive policy
  at all.
- **Leanness of the transactional layer depends on it.** Retention is not only
  a compliance feature: partition-fetch queries are viable only on small
  partitions, so this is what keeps the runtime fast.

Not built — no window, no policy storage, no admin tool.

## Solutions working together — *Direction*

Solutions are sealed from each other by construction — a script in one can
never touch another's data.

**Solutions are never combined with solutions** (ruled 2026-09-13, reversing
the composition direction of 2026-07-27). An operation runs one solution and
one model. There is no dependency between solutions, no assembled
multi-solution SDM, and no shared base solution.

Why it was dropped: composition only works if overlapping types *agree*. Two
solutions that each define Assets mean the same real-world thing, so combining
them requires one canonical Assets — a standards problem across independent
publishers, not a technical one, and it does not get solved. Factoring the
shared types down into a base solution only moves it: a hierarchy needs one
publisher, and different orgs author different solutions. The machinery it
would have cost is a package manager sitting in the middle of the data path —
qualified ids inside `records.type_ref`, a dependency resolver, version ranges,
cross-solution migration — built before any customer needs it. Meanwhile
whole-solution reuse (a vendor publishes one solution, many orgs run it) is the
actual business and needs none of it.

### Modules — how reuse actually happens — *Direction* (agreed 2026-09-13)

The real cost of that ruling is duplication between similar solutions: roads
maintenance and water maintenance both need dispatch, subcontractor work
orders, claims. That is answered by **modules**, not by combining solutions.

A **module** is self-contained — its own model, workflow, activities and
records — owned by its designer and installed into a solution.

- **It owns its model, and the solution cannot see or change it.** This is a
  design-plane ownership rule and the commercial protection for whoever built
  it, *not* a security boundary: the records sit in the same operation, the
  same pool, the same backup and the same audit history. Copy protection stays
  runtime entitlement, not DRM.
- **It never knows the host's types.** No foreign keys into the solution's
  model, no required bindings. Where a module needs something outside itself —
  asset details, which crew — it raises a **callback** and the solution's own
  logic decides and answers. A module never dispatches; it asks. Which
  references it stores internally is the module designer's choice (if one is
  meant to stay joinable in reporting, it should be the host's real record id).
- **It exposes callbacks the solution hooks into** (`wo_approved`,
  `assetDetailsNeeded`). The named extension point is the contract: a module
  activity declares it, the solution registers a script against it. That is
  publish/subscribe over the existing hook and `queue` machinery — never
  editing the module's internals.
- **It ships its own pages** *(2026-09-22)*. A module with no UI of its own
  would force the host to build every screen against a model it cannot see,
  which contradicts the ownership rule — and a module component dropped onto a
  host page still needs somewhere to send the user for its own settings or
  detail views. The addressing already works: `services.page.open(page,
  record)` called inside a module script resolves in the module's vocabulary,
  so the host never learns the page or the record. Module pages are invisible
  to the host's page editor and menu builder the same way its record types
  are. This narrows the standing rule that *a new page is always a solution* —
  written when solutions were the only authored thing.
- **Why this works where composition did not:** a module never has to work with
  another module, only with the host it was installed into. Modules need
  *distinct* ids, not *agreed* meanings — uniqueness is easy, agreement is
  impossible. N modules is N one-way contracts, not every pair.
- **Upgrades follow the component rule** — no automatic updates; the solution
  designer propagates deliberately. Because a module owns all of its own data
  it can migrate itself by internal scripting; what it cannot fix, such as
  changed or deprecated callback signatures, it publishes as a list for the
  designer to address. Exact mechanics are deferred until a real module needs a
  real upgrade.

This splits two trades: people who build solutions, and people who build
modules for them.

None of it is built — there is no module mechanism, no install path, and no
dependency of any kind between solutions.

**Sequencing — ruled 2026-09-22: modules wait.** Until a solution can do
everything it needs to do on its own, there is no module authoring, no install
path, and no third-party components. A solution that needs bespoke UI gets a
component built in the repo registry as today. The unification — how modules,
components and solutions compose — is expected to fall out of finishing
solutions, not to be designed ahead of it.

**The component supply chain is the unaddressed half.** Components are repo
code in the platform's registry, shipped by us; nothing says how a component
is built by someone else, distributed, versioned, or made available to a
module or another org's solution. Only the posture exists — no automatic
updates, the designer propagates deliberately (the component rule the upgrade
bullet above refers to), and **pinning** as a term. Mechanism: unaddressed.

### Connection

- **Connection** — a **solution connector**: a hook in one solution that calls
  an activity in another. The target activity's attribute list *is* the
  contract ("give me these fields"); the committed source activity is the
  trigger; a small field mapping is the wiring. A vendor can pre-ship
  connectors between their own solutions.
- **External connection** — the same connector picture with one end outside the
  platform, a needed feature in both directions. **Inbound**: an external
  system calls a Fluxus activity — this is just the existing headless door,
  validated and logged like any caller; the missing piece is machine
  credentials (API keys with roles — today auth is user sign-in only).
  **Outbound**: a hook calls an external API through an HTTP service module —
  the service-module registry is the designed slot; the module isn't written.
  An org may put a thin **gateway solution** in front: its activities are the
  stable public contract, with internal connectors fanning out to the real
  operational solutions. Either way the Fluxus-side contract is always an
  activity, so every integration lands on the one audit spine.

Separate operations stay walled, and connect only the flows that must cross.
Org-wide reporting never forces them together, because the reporting layer is
org-scoped and looks across operations by design — which is what absorbs most
of the demand that used to be answered with composition.

On record: **nothing may assume record type ids are unique across solutions**,
and modules installed into one solution will need distinct ids within it.

The invariant behind all of it: **solutions exchange data only by calling each
other's activities, never by reading each other's records.**

## The page header — *Built and Direction* (agreed 2026-09-23)

**Built:** `PageHeader`, a component an author places — a back arrow (the
host's history; in the Runtime, the browser's Back), a title and a subtitle.

**Direction: header, actions and tabs are placed components, and a new page
starts with them already laid out** (agreed 2026-09-24; spec
[AUTO_PAGE_COMPONENTS](../packages/page-runtime/docs/AUTO_PAGE_COMPONENTS.md)).
`PageHeader` gains a **status** label whose **colour follows its value** (the
platform's one set of colour words); `RecordActivities` is the actions,
unchanged; a new tab strip lists the slots that carry a `tabName`,
shows when more than one does, and scrolls to them (SAP's object page anchor
bar). A new page's layout is a top panel holding those three and a scrolling
bottom panel for content. **Errors are a page feature**, drawn at the foot of
every page and never placed or removed, reworded for end users: a refused
action is always shown in full. The page's own control over its actions is
deferred, to be specified separately. **Progressively, 2026-09-24:** the spec is parked and the pieces are built one at a time — the `Tabs` strip first (built); the header's status, and a new page starting with the standard top, are not yet built.

**Reversed 2026-09-24: the page drawing these itself.** Agreed the day before
(the page draws header, actions and tabs above its layout, from title/status
fields on the page definition, with no switch to turn the header off). Dropped
after the spec's cold review: a component drawn outside a slot loses what its
container gives every placed component (action runs, `{{ }}` filling, refresh,
error reporting), and each would have had to be rebuilt. Placed components plus
a standard starting layout give the same consistency for a fraction of the
work, and if the page ever draws them automatically, it draws these same
components.

## Components over their own backend — *Direction* (agreed 2026-08-04)

A component is model-blind UI wired per page. Today it reaches data one way:
`dynamic-data` props bound to FluxScript over the record roots, callbacks that
run activities. That covers everything the SDM models — and nothing else.

**The direction is a second door: a component may be wired to named server
functions instead of records**, through the existing **service registry** (the
DSL Phase 3 mechanism behind `notify` and `geo`, with its manifests and its
read-versus-effect purity). A service module whose implementation is a server
call, plus a component manifest declaring which services it needs, is the whole
of it. No new storage, no new transport, no bypass of the activity pipeline:
records still change only through activities, and this is for the things that
are deliberately **not** records.

Why it matters: the platform's own administration surfaces — users, admins,
orgs, billing — must live in real tables with real constraints, because
authorization data cannot sit inside the system that authorization gates (see
*Users and administration*, and RBAC_DESIGN §2a, ruled 2026-07-20). Without this
door those surfaces can only ever be hand-written app code. With it, they are
composed the same way a customer composes theirs, and the platform is built out
of its own parts without pretending everything is a record.

Two audiences, only one served at first. **Our apps reusing components:**
immediate. **Customers authoring or installing them:** needs registration,
versioning and sandboxing — that is the Catalogue and packaging story, and this
is a step toward it, not it.

Sequencing, deliberately: prove the seam on a **low-stakes** surface (org profile
or billing — list plus form, no security consequence) before bringing the
administration screens onto it. A bug in a users screen is a lockout, and the
recovery path is a script run against production. The known cleanup this work
should absorb: component registration is duplicated across three un-derived
registries (`componentManifests`, `SESSION_COMPONENTS`, `componentSchemas`) and
should be derived from the manifest.

Considered and rejected on the same day: **modelling users and administration in
the SDM itself** to get change history for free. It reverses the §2a ruling,
trades the database's structural enforcement (foreign keys, composite keys, a
grant that cannot exist without its target) for hook-enforced equivalents, and
makes the request path recursive — the resolver would read records to decide
whether you may read records. The audit benefit is separable and is being taken
directly, as an append-only change ledger over the admin tables. The SDM stays
the right home for the platform's own *business* objects — orgs, billing,
catalogue, approvals — none of which sit in the authorization path.

## Building by AI assistance — *Direction* (agreed 2026-09-13)

Hand-crafting a solution — model, activities, pages, roles — takes too long to
be the way solutions get made. **The end goal is that a designer describes a
process to an AI assistant and the platform is built from that description.**
Everything below is direction; none of it is built.

Why the platform is unusually suited to it: the assistant generates over a
closed, validated vocabulary — a fixed component catalogue, one language, one
pipeline — and it emits stored, validated definitions rather than code. Rule 5
(*everything validates at save time*) and rule 6 (*pages are data, not code*)
are what make AI-authored artifacts safe, and they are already Built. The
assistant saves through the same activities a person does, so it gets no
privileged write path and lands in the same audit history.

**Shape:** a server-side agent in the Console with a small tool set — read the
model, list components, validate, save, run an activity — and context assembled
from the solution's SDM plus the component manifest. Two constraints:
it needs a scratch operation to try things in without touching live data, and
every save is put to the designer for approval, never committed straight to a
solution people are running.

### Spec first — no spec, no build

The SDM is already a spec that executes, but it holds what the model *is*, not
what the business *needs*. That intent — the process, the people, the rules —
is a **separate stored artifact, versioned per solution** alongside pages and
the model. It is what the assistant generates from, and regenerates from when
the business changes.

The gain is on the second and third pass, not the first. Initial authoring is
only somewhat faster; the win is six months later, when a change to the spec
lets the assistant re-derive what it touches and report what it cannot resolve,
instead of a hunt through pages, activities, hooks and roles. This only holds
while the spec stays the source of truth: once pages are hand-edited or an
operation holds live records, re-derivation becomes a diff put up for approval,
and beyond that it is the release/migration problem already flagged above.

### Scoring a spec

The assistant reports whether a spec is ready to build from. The number is
mechanical, not the model rating its own confidence, and it always decomposes
into a named list of gaps — a headline figure that does not is decoration.
Three parts:

- **Coverage** — the slots a working solution needs, filled or not: what one
  record of each type means, its fields, its lifecycle and when it is finished
  (`complete_when`), the activities on it and who may run them, roles, screens,
  retention.
- **Consistency** — defects derived *between* slots, which is where the real
  leverage is: an activity capturing an attribute with no matching custom field
  (silently dropped today), a status no activity ever sets, a required field no
  activity captures, a record type no page shows, a role with no activities.
  Each is computable, and each is a question to put to the designer rather than
  a guess to make.
- **Endorsement** — how much of the model a human confirmed versus the
  assistant inferred. The honest answer to "does it know enough": it never
  does, it has assumptions, and what matters is how many have been signed off.

**Scenarios beat the score.** A spec that names walkthroughs — tech logs
reading, supervisor approves, job closes — lets the assistant *run* them
against sample data in a scratch operation. That is pass/fail rather than an
estimate, and it catches the model that is structurally clean and
business-wrong, which no score will.

**The interview is inverted.** Nobody answers forty questions. From a thin
brief the assistant proposes a complete draft and the designer corrects it —
people react far better than they specify — and endorsement measures how much
of that draft has been accepted.

**Where the gate belongs:** publishing, not building. Try anything at any
score; do not cut a release with unresolved consistency defects.

### What this makes load-bearing

Work that reads as housekeeping today becomes the foundation of the assistant,
and should be done with that in mind:

- **The component manifest is the assistant's prompt.** Single-sourcing the
  three un-derived registries (`componentManifests`, `SESSION_COMPONENTS`,
  `componentSchemas`), already noted above as cleanup, is a precondition.
- **Validator errors must be structured** — path and reason, machine-readable.
  A model corrects from a rejection it can parse, not from a message meant for
  a person.
- **Docs are prompt material.** The static guidance an assistant needs is the
  same guidance a repo skill gives Claude working in this codebase — the
  cheapest dry run available, and the test of whether the SPECs are sufficient
  grounding at all.

Open, not settled: what the spec artifact is called and where it is stored, the
weighting behind the score, and how sample data is generated.

## The commercial layer — *Direction*

Orgs subscribe to the platform (the org row, profile, and plan field are Built;
signup and billing are not). Providers publish solutions to the Catalogue; orgs
install them; **entitlement** — a record of who may run what — is the copy
protection, not DRM. Revenue share rides on entitlement. Nothing here is built
beyond the seams; it waits for a second party to exist.

## Core terms, in one line each

Canonical definitions live in [GLOSSARY.md](GLOSSARY.md); this is the working set.

| Term | Plain meaning |
|---|---|
| **SDM** | A solution's definition of its data and behaviour: record types, workflows, activities, hooks. |
| **Record type / record** | A collection definition (e.g. Assets) / one entry in it. |
| **Activity** | The unit of action and the only way data changes; headlessly, a callable function. |
| **Workflow** | The ordered set of activities available on a record type. |
| **Hook** | A FluxScript script on an activity: before = gate, after = effects. |
| **Module** | A self-contained, reusable unit installed into a solution — its own model, workflow and records, hidden from the solution, reached only through callbacks. Direction. |
| **Activity history** | The append-only record of who did what, with what inputs. The audit spine. |
| **FluxScript** | The one scripting language (expressions → queries → scripts). |
| **Page** | A stored, validated screen definition rendered by the page runtime. |
| **Component** | A model-blind UI block wired to the SDM per page; reused, never rewritten. |
| **Solution** | The shippable design bundle: SDM + pages + roles + default menu. No data. |
| **Operation** | A running instance of a solution: its records, users, and roles. |
| **Org** | The subscribing business everything hangs under. |
| **Console / Runtime** | The builder's app / the end user's app. |
| **Release** *(direction)* | One numbered snapshot of a whole solution. |
| **Pinning** *(direction)* | An operation staying on a chosen release until it opts to upgrade. |
| **Solution connector** *(direction)* | A hook in one solution calling an activity in another. |
| **Catalogue / entitlement** *(direction)* | Where solutions are offered / the record of who may run what. |
