# Idea: model storage split, client projection, and tamper-resistant runtime binding

**Status:** design discussion 2026-08-08. **Nothing built.** Five interlocking threads that came out of one conversation.

**Threads 1–3 are now specced** (2026-08-08), storage kept separate from security:

- **1** → [packages/server/docs/SPEC.md](../../packages/server/docs/SPEC.md) "Model storage: the SDM config as tables". Table and column names endorsed; **activities stay inside their workflow** — the sixth table proposed here was rejected, since the change unit is the workflow and nesting also preserves activity order.
- **2–3** → [docs/CLIENT_TRUST_BOUNDARY.md](../CLIENT_TRUST_BOUNDARY.md).

**Threads 4–5 remain open discussion** — 5 in particular still needs the requirement tested against its three no-change resolutions before it is spec-able. Names marked *(unendorsed)* below still need the user's OK before they enter code or schema.

**Why it hangs together:** all five are the same question asked at different layers — *what does the client actually need, and what must never be taken from it?*

---

## 1. Split `sdm_configs` into tables

**Today.** One jsonb blob, `sdm_configs.solution_id` as PK, holding attributes + recordTypes + workflows + functions + `access.roles` for a whole solution.

**The problem.** The **consistency unit is the whole graph** (a workflow references attributes, so validation is always global) but the **change unit is one entity** (an author edits one attribute). Storing the graph as one blob makes the *write* unit the whole graph too. Consequences:

- `config.put` is last-write-wins across the entire model. Two sol admins editing different record types have no logical conflict, yet one silently loses their work.
- No per-entity history — you cannot ask who changed this attribute.
- No "what uses attribute X", which is a prerequisite for any safe delete or rename.
- Every diff is a whole-config diff.

**Direction: tables are the source of truth; the assembled config is derived.**

- One table per collection (attributes, record types, workflows/activities, functions, roles), keyed by solution. Row-level writes, real FKs, per-entity authorship.
- Validation still runs on the **assembled graph** at write. Global validation is unchanged — only the storage shape moves.
- `sdm_config_versions` stays exactly as it is: publish assembles the graph into one immutable jsonb. That is already the right artifact for install / share / version, and it does not change.
- `sdm_configs.config` stops being truth and becomes a **derived draft snapshot**, refreshed on write, so the read path stays a single fetch.

**Considered and rejected:** keep the blob and add optimistic concurrency (etag/version on `config.put`). Claude recommended this first on MVP-first grounds; the user pushed back that concurrency is a first-order concern, and on reconsideration the split is the correct design — the etag protects against loss but still forces authors to serialise on the whole model.

**Rule scope, clarified by the user this session:** the one-pipeline invariant governs **solutions** (records, activities, hooks, history), not the Console. The Console is a conceded custom app that already owns its own tables (`users`, `org_admins`, `op_admins`, `sol_admins`, `user_roles`, `pages`, `page_versions`). Design-plane authoring storage is not a second pipeline, so the invariant does not block this.

**Open:** all table and column names need endorsement.

**Related, already done this session:** `ConfigRaw` → `SolutionConfig` (type-only rename, 30 files, no stored data touched). One of these *is* one solution's model, and the `Raw` suffix paired with nothing — there is no cooked top-level config. The inner `WorkflowRawDef` / `ActivityRawDef` keep their suffix because those do pair with resolved forms.

---

## 2. Client / server projection

**Today.** `config.get` returns the **entire** config, unfiltered — no role filter, no trimming. Records *are* filtered by `computeReadable`. That asymmetry is the finding: **data is filtered, the model is not.** A user who can read one record type still receives every other type's definition, every activity, every hook body, and the `access.read` rules that exclude them.

**Direction.** A genuinely different, smaller client-facing type *(name unendorsed)* — not the same type with fewer entries — produced by **one pure server-side function**, so there is a single place to audit.

**The critical rule: whitelist, not blacklist.** Build the output by naming each field that goes in. A blacklist (`delete config.hooks`) leaks every field added to the model later, until someone remembers. Whitelist means new fields are invisible until deliberately exposed.

| | Ships to client | Stripped |
|---|---|---|
| attributes | key, label, type, display config, validation expressions | presign / storage gating config |
| record types | id, name, field keys + labels, `id_field` | `access.read`; unreadable types entirely |
| activities | id, name, form definition, `show_condition` | **`before_hook`, `after_hook` entirely**; unrunnable activities |
| functions | those reachable from shipped expressions | the rest |
| roles | — | the whole `access.roles` block (client gets its own roles from `me`) |

Hooks are the main prize: business logic and every effect never leave the server. Validation expressions are deliberately **kept** — the client needs them for inline validation, they are not secret (the user discovers the rule by hitting it anyway), and the server revalidates regardless.

**Make the type system enforce it.** Define the narrow model, then have `SolutionConfig` extend it. Client-side code typed against the narrow one then *cannot compile* a reference to `before_hook` — the projection becomes structurally unreachable, not merely filtered at runtime. Add one test asserting the projection output contains no hook keys, and the guarantee survives model growth.

**Function reachability** is the fiddly part. MVP: ship every function referenced by any shipped expression, no transitive pruning. Tighten later if it matters.

**Interlock:** the table split (1) makes this natural — you select the rows and columns you need instead of trimming a blob, and "unrunnable activities" becomes a `WHERE` clause. And per-page projection (4) makes the payload far smaller than role-filtering alone.

---

## 3. Session binding and record handles

The user's framing: a full server-side app (ASP.NET was the example) gives this protection more readily. The concepts have names —

- **Server-authoritative state** — the client is a view, never a source of truth.
- **"Derive, don't accept"** — if the server can compute a value from what it already knows, it must never accept that value as input.
- Attack classes closed: **IDOR**, **parameter tampering**, **mass assignment**.

**On the ASP.NET comparison — half true, worth recording.** WebForms gave **Session** (state server-side, cookie-keyed) and **ViewState** (round-trip state, MAC-signed). Real, free protection. But it never protected *authorization* — `?id=5` was as forgeable there as anywhere, and IDOR was rampant in exactly those apps. Session also cost memory and sticky sessions, which is why the industry moved to stateless tokens. It gave *state* integrity for free, not *authority*. The transferable idea is Session, not ViewState: keep the ids server-side, hand out a key.

### The three-way split of every input

Decided by whether a value **varies per request**:

| Class | Values | Treatment |
|---|---|---|
| **Bound to session** | org, solution, operation, user, roles | never accepted from the client |
| **User selections** | `activityId`, `recordId`, `attributes` | must be accepted; authorized on every use |
| **Derived** | record type, workflow, CREATE-vs-anchored, field mapping | never accepted (already true) |

A record id **cannot** be session-bound — the user picks it from a list at the moment of acting, so it varies per request by definition and there is nothing to bind it to. Its protection is authorization on every use, which already exists (readable filter → denied as not-found → gate).

Summary rule: **bind what's constant, authorize what varies, derive everything else.**

### Already correct today (verified in code)

- Record type is **derived from the activity**, never accepted — `record_map` decides CREATE vs anchored; supplying a `recordId` to a CREATE is a hard error, omitting it on an anchored one likewise.
- User + roles come from the JWT.
- `waived` is validated against `can_waive` and applicability; forged waivers are rejected.
- Unknown attribute keys are dropped by exact-key mapping — mass-assignment defence, already there.
- Anchor readability is checked **before** the gate, denied as not-found.

### Gaps found

1. **`callbackData: z.unknown()`** — arbitrary client JSON handed straight to hooks as the `callbackData` root. It exists for service callbacks, but on a direct run the client forges it freely. *(Corrected while speccing: it exists for **app-triggered runs** — a page callback calling `services.activities.run(id, record, data)` — not service callbacks. See CLIENT_TRUST_BOUNDARY.md gap 1.)* **Sharpest of the three**: an unvalidated channel into server-side script execution. Concrete example: the demo dispatch passes `{ crew: 'Crew A' }`; the before hook checks the crew is *present* but nothing checks it is a **real** crew, or one this user may dispatch to. Closing it properly means giving service callbacks their own authenticated channel rather than sharing the run endpoint — a design task, not a patch.
2. **`operationId` on every call** — the client names its own scope each time. It is checked, so not a hole, but it is the prime candidate for the Session move: bind at connect, hand back a key, stop accepting it. Same for `solutionId` on the design plane.
3. **`acknowledgedWarnings: boolean`** — the client asserts the user saw the warnings. Cheap fix: the server returns a confirmation token with the warnings and requires it back, so the acknowledgement references warnings the server actually issued.

### Record handles

**What they are:** when the server serves a record for column-3-style work, it returns — alongside details and available activities — a **signed handle** attesting `{ operation, record, version, activities offered }`. The client returns it with the run.

This is ViewState applied correctly, and at a completely different scale: ViewState serialised the entire control tree (100KB+ hidden fields were routine); a handle carries about six identifiers. The closer modern comparison is a JWT — the same construct already used for the session, scoped to a record.

**What it buys — and note the security gain is *not* the main one.** If a client swaps record X for Y between "show activities" and "run", the run re-authorizes Y anyway; they gain nothing they could not get by opening Y directly. The real win is **coherence**: the activity list was computed against the record as it was at that moment, and between render and click the record may have moved. Nothing currently connects the offer to the execution. That is a correctness problem, not a tampering one.

- **Tamper-evident** — signed; the client cannot edit the record id inside it.
- **Stateless** — nothing stored server-side, no sticky sessions.
- **Plural by construction** — one handle per open record, so tabs, related-record pivots and multi-record pages each carry their own. This is why a session-held "current record" was **rejected**: a browser is not one linear conversation, and a single slot collapses contexts that legitimately coexist.
- **Carries the version** — the run detects "changed since you were shown it".
- **Carries what was offered** — the run can verify it is executing something the server actually advertised.

**Signed, not encrypted.** Signing = integrity; encryption = confidentiality. Everything in the handle (record id, type, version, activities already displayed) is visible in the user's own UI, so there is nothing to conceal. Design rule that keeps it that way: **never put anything in a handle the user is not already entitled to see** — then the question never arises. Historical support: ViewState was MAC'd by default and *not* encrypted by default, and the famous 2010 break (MS10-070, padding oracle) was against the *encryption* path. Encryption done wrong is worse than signing done right.

**Overhead.** ~200–250 bytes of JSON + a 32-byte HMAC-SHA256 → **~350–450 bytes base64**. Sign and verify are single-digit microseconds, negligible beside a Postgres round trip. The real cost only appears if you mint one **per grid row** — 500 rows × ~400 bytes = ~200KB, which is precisely the ViewState mistake. Hence the issuing rule below.

**Practical notes:** include a **key id** so signing keys can rotate without invalidating everything; short **TTL**; and the handle is **integrity, never authority** — it can be replayed after a user's roles change, so the run must still re-authorize exactly as today. Anything that skips the re-check because "the handle says so" is the bug this design exists to prevent.

**Rejected:** an indirect object reference map (per-session opaque token → real record id). It stops *enumeration* only; it does not stop unauthorized access, which deny-as-not-found already handles. Real cost in every read path, marginal gain.

---

## 4. Pages, anchors and the issuing rule

**How it actually works today** — reconstructed from the demo dispatch app, since it was not written down anywhere. The component's callback contract is `(record, data)` and the call site passes the clicked row's id:

```
onDispatch?: (record: string, data: { crew: string }) => void
onDispatch(wo.id, { crew: 'Crew A' })
```

The activity is genuinely anchored (`act_dispatch_work_orders.show_condition` reads `context.record.status`) with the rest riding in `callbackData`.

**So: the anchor is per-callback, not per-page.** There was never a page-level record id — which is why the user could not recall how it worked. The recollection that "every activity is logged against a record" holds exactly; it is just not *one* record for the whole page.

### The page taxonomy (reconstructed, user-confirmed as clean)

| Kind | Anchor | Engine equivalent | Handle |
|---|---|---|---|
| **Record page** — workbench column 3 | one record, page-level | anchored activities, `context.record` set | yes |
| **App page** — a whole app on one page (the scheduling/dispatch case) | none at page level; each callback names its own | anchored activities, anchor per interaction | no |
| **Pure view** | none | no activity at all | no |

The first two both involve a workflow, and differ in whether the page as a whole is about one record.

**The issuing rule that falls out — one rule, no special cases:**

> **Handle when the user opens one record and works within it. No handle when acting on a row from a collection — authorize per run.**

This also settles the grid: `RecordsGrid` (column 2) mints nothing, and the runs it fires are CREATE with a null anchor anyway, so there is nothing to attest to. Column 3 gets the handle.

### Bake record scope into the page builder

Today the anchor is passed per component, call by call, and the page context roots are only `context.app` and `context.page`. There is no page-level record. Proposed:

- A **record page declares its anchor type** in the page file and is unreachable without a record. **"Anchor" is already an established term in this codebase** (`anchorRecord`, the anchor-read gate) — no new terminology needed.
- The record becomes a context root the whole page reads, rather than each component carrying its own. Fits the four-roots model; it is a record, not a scope, so the scope-blindness rule is untouched.
- **One handle per page instance** — opening the page authorizes once, every activity fired from anywhere on that page rides it. The page becomes one coherent view of one record at one version.
- **Projection becomes per-page**, not just per-user: a record page needs only its anchor type, its runnable activities, and what it reaches through relationships. Bigger payload win than role-filtering alone.
- **Workbench column 3 is the built-in instance of the same concept** — the record UI every SDM gets free; an authored record page is the customisable version. One concept, two implementations.

**Open:** multiple record contexts on one page (master-detail, comparison). Claude's instinct is one anchor per page, with related records reached through the `records` root, and a component minting its own handle only if it genuinely needs its own scope later — not built now. Also open: the **route shape** for reaching a record page, since it carries the record id; new URL structure, needs endorsement.

---

## 5. App / non-UI workflow as a special record type

**The user's idea:** an app may be a **special kind of record type** — each instance gets a record id, but these are not regular entity records. The record type is linked to a page and becomes its **audit record**. The same is needed for **non-UI workflows**.

**Why it does not exist today — structural, not just unbuilt.** Workflows hang off record types (`RecordTypeDef.workflow_ref`); activities live inside workflows; `record_map` is `CREATE | UPDATE | DELETE`, all of which imply a record; non-CREATE always requires an anchor. So an activity has no *definition* home except through a record type, and there is no record-less path anywhere in the chain. "An app has workflows separate from record ids" therefore means **a workflow not attached to a record type** — a genuine model change, not a config flag.

**Searched for an existing signal, per the user's request.** All 15 example entity schemas carry only `id, name, description, workflow_ref, id_field, custom_fields` (+ optional `access`). **No property signals app-ness.**

**But the concept is already written down**, from the retention angle — `docs/ARCHITECTURE.md:137`:

> a record type may declare a `complete_when` condition (FluxScript) and window in the SDM; completed records archive out of the transactional store. **Never-ending records (long-lived apps)** tier their append-only history instead — hot tail transactional, full spine relational/cold — while the record stays alive.

That is the same idea phrased as retention. The distinguishing property is `complete_when`: an ordinary record completes and archives; a **long-lived app record never completes** and tiers its history instead — so its history *is* the app's audit trail. It covers non-UI workflows identically: a never-ending record for the process, its history the audit trail, no UI.

**Caveat:** `complete_when` is design-only. It appears in that one line and nowhere else — no schema, no type, no code.

**Three resolutions that need no model change, worth testing the requirement against first:**

1. **It is actually a CREATE.** "Recalculate the schedule", "run the overnight optimisation", "export the board" each produce a record of the act (`rt_schedule_runs`, `rt_exports`). The activity anchors nowhere because *the act itself is the record*. This is the model-first thesis applied literally — an act that leaves no trace contradicts the platform.
2. **It anchors on a singleton.** A planning board, a session, a shift — a real record the app-level activities act on. Not contrived: a scheduling app genuinely has a *board* that gets published, locked, reopened.
3. **It is not an activity at all.** If it changes nothing (recompute a view, filter, expand) that is `services.page`, which already exists for exactly this.

**Proposed dividing line:** *if it changes something, that something is a record; if it changes nothing, it is not an activity.*

**Argument against a genuinely record-less activity:** history lives on records (`activityHistory`), so a record-less activity needs a new home for its history — a new storage mechanism, for acts the model has decided not to remember.

**Open:** whether a record-type flag is the answer and what it is called; whether `complete_when` is the right hook to hang it on; how a page links to its app record type.

---

## Suggested sequencing

1. **Table split** — foundational; makes projection natural and unblocks per-entity concurrency and history.
2. **Projection** — biggest security win per unit of work; independent of the rest once the narrow type exists.
3. **Session binding** — mechanical once 1–2 are in.
4. **Record handles + page anchors** — together, since the handle rule and the page taxonomy are the same design.
5. **App-as-record-type** — least settled; needs the requirement tested against the three no-change resolutions first.

`callbackData` (3, gap 1) is independent of all five and is the sharpest live gap; it could go first if it is judged urgent.

## Naming still to endorse

- Every table and column name in the split (1).
- The client-facing model type name (2).
- The record-type flag or property for app/workflow records, if that route is taken (5).
- The route shape for record pages (4).
