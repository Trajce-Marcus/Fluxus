# Client trust boundary — projection, session binding, record handles

**Status: designed 2026-08-08, NOT BUILT.** Spans engine / server / client,
which is why it lives here rather than in one package. The storage half of the
same conversation — splitting `sdm_configs` into tables — is deliberately kept
apart, in [packages/server/docs/SPEC.md](../packages/server/docs/SPEC.md)
"Model storage: the SDM config as tables". Threads 4–5 of the source discussion
(page anchors, app-as-record-type) remain open in
[docs/ideas/client-hardening-and-model-storage.md](ideas/client-hardening-and-model-storage.md).

Two questions, one boundary:

1. **What is the client given?** Today, the whole model. It should be a
   projection.
2. **What is the client allowed to say?** Today, its own operation, and an
   arbitrary JSON blob that reaches server-side script. Some of that should be
   bound, not accepted.

The concepts have names: **server-authoritative state** (the client is a view,
never a source of truth) and **"derive, don't accept"** (if the server can
compute a value from what it already knows, it must never take that value as
input). The attack classes closed are IDOR, parameter tampering and mass
assignment.

---

## 1. Model projection

**Today.** `config.get` returns the entire `SolutionConfig`, unfiltered — no
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
  door; `config.put` already requires sol admin, and read/write of a model are
  the same privilege in a one-grade world). `FluxusClient.connectSolution`
  keeps using it.
- **`config.getForOperation` `{ operationId }` → `ClientSolutionConfig`** —
  the runtime plane. Keyed on the **operation**, not the solution, because the
  projection is computed against the caller's roles *in that operation*.
  `FluxusClient.connect` switches to it.

Names endorsed 2026-08-08: **`ClientSolutionConfig`** (the narrow type) and
**`config.getForOperation`** (the runtime door).

### One pure function, whitelist not blacklist

The projection is **one pure server-side function** —
`projectConfig(config, { roles, enforced }) → ClientSolutionConfig` — so there
is a single place to audit and a single place to test.

It **builds its output by naming each field that goes in.** A blacklist
(`delete config.hooks`) leaks every field added to the model later, until
somebody remembers. A whitelist makes new fields invisible until deliberately
exposed. This is the rule the whole section rests on.

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

**Function reachability** is the fiddly part. MVP: ship every function
referenced by any shipped expression, with no transitive pruning. Tighten only
if it turns out to matter.

### Make the type system enforce it

Define `ClientSolutionConfig` first, then have `SolutionConfig` **extend** it.
Client-side code typed against the narrow one then *cannot compile* a
reference to `before_hook` — the projection becomes structurally unreachable
rather than merely filtered at runtime. Add one test asserting the projection
output contains no hook keys anywhere, and the guarantee survives model growth.

### What this costs the client

`MemoryAdapter` is constructed from the config on every host. Under projection
the runtime plane hands it a `ClientSolutionConfig`, so its parameter type
widens to the narrow one. Hooks arrive absent, which is already a legal state
(`before_hook: null`), and safe: **the client never executes hooks** — scripts
and persistence are server-side by ruling, and the client evaluates
expressions only (`show_condition`, `validation`, datasources). The Console is
unaffected: it still receives the full model through `config.get`.

**Interlock with the storage split.** Once the model is rows, the projection
selects the columns and rows it wants instead of trimming a blob, and
"unrunnable activities" starts to look like a `WHERE` clause rather than a
filter pass.

---

## 2. What the client may say

Every input to `activities.run` falls into one of three classes, decided by a
single question: **does this value vary per request?**

| Class | Values | Treatment |
|---|---|---|
| **Bound** | org, solution, operation, user, roles | never accepted from the client |
| **Selected** | `activityId`, `recordId`, `attributes`, `waived` | must be accepted; authorized on every use |
| **Derived** | record type, `record_map`, CREATE-vs-anchored, field mapping | never accepted (already true) |

**Bind what's constant, authorize what varies, derive everything else.**

A record id **cannot** be bound. The user picks it from a list at the moment of
acting, so it varies per request by definition and there is nothing to bind it
to. Its protection is authorization on every use — which already exists.

### Already correct today (verified in code)

- **Record type is derived from the activity**, never accepted:
  `record_map` decides CREATE vs anchored; supplying a `recordId` to a CREATE
  is a hard error, omitting it on an anchored activity likewise
  ([router.ts:759-776](../packages/server/src/router.ts#L759-L776)).
- **User and roles come from the JWT**, resolved per operation before the
  engine exists.
- **`waived` is validated** against `can_waive` and applicability; forged
  waivers are rejected.
- **Unknown attribute keys are dropped** by exact-key mapping — mass-assignment
  defence, already in place.
- **Anchor readability is checked before the gate**, and denied as *not-found*
  so a hidden record is indistinguishable from a missing one.

### Gap 1 — `callbackData: z.unknown()` (the sharpest)

Arbitrary client JSON handed straight to hooks as the `callbackData` root
([router.ts:744](../packages/server/src/router.ts#L744)) — an unvalidated
channel into server-side script execution.

**What it is for** (worth stating precisely, because the name is used twice):
in a *page callback script* `callbackData` is the packed component payload
`{ value, data }` and never leaves the browser; in a *hook* it is the one data
object of an **app-triggered run**, arriving over the wire when a page callback
calls `services.activities.run(activityId, record, data)`. It is therefore a
real capability of app pages — the channel by which a component supplies a
value that is not a captured attribute — not scaffolding, and not (as first
described) a service-callback mechanism. The demo dispatch page is its only
current user, but removing it would remove the capability, not just the demo.

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
   be the basis of an authorization decision. Anything authorization-bearing is
   either derived server-side or captured as an attribute — where it also gains
   type validation, waiver handling and a row in the reporting projection. The
   demo's crew is the worked example: as a list attribute with a datasource it
   becomes validated *and* queryable, which the blob never was.

The declaration format is not specified here — it is an SDM change and belongs
with the attribute-type work, not in this document.

### Gap 2 — `operationId` on every call

The client names its own scope on every request. It *is* checked
(`resolveUser` → `requireOpUser`), so this is not a hole — it is the prime
candidate for binding. **Direction: bind at connect, hand back a key, stop
accepting it** (see the operation handle below). Same for `solutionId` on the
design plane.

### Gap 3 — `acknowledgedWarnings: boolean`

The client asserts that the user saw the warnings. **Resolution:** the
`needs-confirmation` result carries a **confirmation token** — the warnings the
server actually issued, signed — and the re-run must return it. The
acknowledgement then references warnings that exist, instead of asserting a
state of mind. Name endorsed 2026-08-08: **confirmation token**.

---

## 3. Signed handles

One primitive, three uses. A **handle** is a small signed JSON blob the server
issues and the client returns: HMAC-SHA256, a **key id** so signing keys rotate
without invalidating everything, and a short **TTL**.

**Signed, not encrypted.** Signing gives integrity; encryption gives
confidentiality, and there is nothing here to conceal — everything in a handle
is already visible in the user's own UI. The design rule that keeps it that
way: **never put anything in a handle the user is not already entitled to
see**, and the question never arises. (Historical support: ViewState was MAC'd
by default and *not* encrypted by default, and the famous 2010 break was
against the encryption path. Encryption done wrong is worse than signing done
right.)

**Integrity, never authority.** A handle can be replayed after the user's roles
change, so **every run re-authorizes exactly as it does today**. Anything that
skips a check because "the handle says so" is the bug this design exists to
prevent.

### Operation handle (gap 2)

Issued at `connect`, carrying `{ org, solution, operation, kid, exp }`.
Subsequent calls present it instead of naming an `operationId`, and the server
reads the operation off the handle. This is the ASP.NET **Session** idea taken
correctly — keep the ids server-side, hand out a key — without Session's cost,
since nothing is stored and no sticky sessions are required. The user and their
roles still come from the JWT, not the handle.

### Record handle (coherence)

When the server serves one record for column-3-style work it returns, alongside
the details and the available activities, a handle attesting
`{ operation, record, version, activities offered, kid, exp }`. The client
returns it with the run. `version` is the record's `updated_at` — there is no
version column on `records` today and this does not add one.

**The gain is not primarily security.** If a client swaps record X for Y
between "show activities" and "run", the run re-authorizes Y anyway; the
attacker gains nothing they could not get by opening Y directly. The real win
is **coherence**: the activity list was computed against the record as it stood
at that moment, and between render and click the record may have moved. Nothing
currently connects the offer to the execution — a correctness problem, not a
tampering one. So the handle buys: *changed since you were shown it*, and
*this is something the server actually advertised*.

**Plural by construction.** One handle per open record, so tabs, related-record
pivots and multi-record pages each carry their own. This is why a session-held
"current record" is **rejected**: a browser is not one linear conversation, and
a single slot collapses contexts that legitimately coexist.

### The issuing rule

> **Handle when the user opens one record and works within it. No handle when
> acting on a row from a collection — authorize per run.**

Overhead is why the rule exists: ~200–250 bytes of JSON plus a 32-byte MAC ≈
**350–450 bytes base64**, negligible beside a Postgres round trip — *unless*
one is minted per grid row, where 500 rows × ~400 bytes ≈ 200KB reproduces
precisely the ViewState mistake.

Applied today: **workbench column 3 mints one**; `RecordsGrid` (column 2) mints
nothing, and the runs it fires are CREATE with a null anchor anyway, so there
is nothing to attest to. Where else handles are issued depends on the page
taxonomy (record page / app page / pure view), which is thread 4 and **out of
scope here** — this document specifies the primitive, not its full deployment.

**Rejected:** an indirect object reference map (per-session opaque token → real
record id). It stops *enumeration* only; it does not stop unauthorized access,
which deny-as-not-found already handles. Real cost in every read path,
marginal gain.

---

## Sequencing

1. **Projection** — biggest security win per unit of work, and independent of
   everything else once `ClientSolutionConfig` exists.
2. **Gap 1, `callbackData`** — independent of all of it, and the sharpest live
   gap; it can go first if judged urgent.
3. **The signing seam** — then the operation handle (gap 2) and the confirmation
   token (gap 3), which are mechanical once one signer exists.
4. **Record handles** — last, since their issuing rule is entangled with the
   page taxonomy still under discussion.

## Names (endorsed 2026-08-08, none in code yet)

`ClientSolutionConfig` · `config.getForOperation` · **projection** ·
**handle** · **operation handle** · **record handle** · **confirmation
token**. All carry GLOSSARY entries.
