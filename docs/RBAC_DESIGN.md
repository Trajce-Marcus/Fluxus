# Fluxus — RBAC Design (PROPOSAL, for review)

Status: **draft for review, rev 3 (2026-07-15).** Not yet agreed; nothing here
is built. Rev 3 locks four decisions (§11): activity access **is** the gate
expression (settled — no separate access expression); running an activity
against an unreadable anchor is **blocked**; page enforcement is **client-only
until pages move server-side** (accepted interim); role definitions **stay in
the SDM config**. One consideration is newly open and genuinely interesting —
whether role *assignments* are themselves modelled *with the platform* (a
governance SDM) or as bespoke structure (§2a). Rev 2 established: strict-by-
default for record types + pages, open-by-default for activities; three-level
implementer plane; row-level read conditions deferred.

Spans packages, so it lives in root docs. When agreed and built, the living
truth moves into the package SPECs and this becomes the design record.

Hard dependency: **auth**. `context.user` is still the demo stub; every
enforcement rule assumes the server can identify the caller and populate
`context.user` (incl. `context.user.roles`). Auth design (identity, sessions,
tokens) is out of scope here and comes first (§11 phasing).

---

## 1. Two planes, one analogy

GitHub is the reference model, and it splits permissions the same way we need:

| Plane | GitHub analogue | Fluxus meaning |
|---|---|---|
| **Implementer (design-time)** | repo permission levels (read / write / admin) | who may view/edit the SDM config, pages, and the access rules themselves |
| **App (runtime)** | what the *product built on the repo* lets its end users do | who may read which records, run which activities, open which pages |

These never mix: an implementer level says nothing about runtime data access,
and an app role grants no config-editing power. A solo implementer holds `admin`
on the design plane *and* whatever app roles they need to test — two hats, worn
explicitly.

## 2. Roles

- A **role** is an org-created named grant bundle pertaining to an app / module
  (e.g. `role_dispatchers`, `role_technicians`). Roles are module-scoped, not
  platform-global: "Dispatcher" means something only within its module.
- **Roles are declared in the SDM config, created as needed** — a new
  `access.roles` section at config root. Declaring them there means role ids
  are validatable at config-save time (schema-aware validation doctrine), and
  the model travels: an SDM imported elsewhere carries the roles its rules
  reference; the importing org just populates them with people.
- **Assignments (user → roles) are NOT in the app's config.** They are
  operational data, maintained through a **user-roles admin tool** (admin only —
  §8), living in a **separate governance repo**, org-scoped, keyed `(org, scope,
  userId) → roleIds`. Why not the app config (answering rev-1 Q): (a) the config
  is reusable model that exports/travels — you don't want specific people baked
  into a shareable SDM; (b) staff churn (onboarding/offboarding) would otherwise
  route every assignment change through config-edit + validation +
  change-management, far too heavy for what is really HR-shaped operations; (c)
  it is exactly the per-user state an app's model shouldn't hold. So: **role
  *definitions* in the app's SDM config, role *assignments* in a governance repo
  of their own.** *How* that governance store is shaped is the open fork in §2a.
- `context.user.roles` — the role ids the user holds **in the current scope** —
  is injected by the host into every script environment. Scripts stay
  scope-blind: they name roles, never orgs or scopes.
- Naming: role ids `role_<plural>`, display names plural ("Dispatchers").

## 2a. The governance store — SDM or bespoke? (OPEN, the interesting fork)

Where role assignments live is settled (a governance repo of their own, §2).
*How they are shaped* is open, and it is a real "eat your own dogfood" question:
**do we model governance with the platform, or beside it?**

**Option A — a governance SDM (dogfood).** Assignments are a record type
(`rt_role_assignments`: user ref, role id, scope) in a system-repo SDM;
granting/revoking are **activities** (`act_grant_role`, `act_revoke_role`). What
this buys, essentially for free:

- **Audit is automatic.** Every grant/revoke is a history entry on the spine —
  who granted whom which role, when — with no separate audit store. Governance
  changes get the same truthful, never-edited log as business data.
- **The admin tool is just a page-builder app** over that SDM — no bespoke CRUD
  surface; the workbench already renders it.
- **Change-management reuses the same machinery** (the future review → approve →
  publish flow works on activities, so it covers grants too).
- **One mechanism.** Strongly aligned with the One Pipeline Invariant.

The catch is **bootstrap ordering**, and it is the crux:

- Resolving `context.user.roles` is a **pre-pipeline** step — the server needs
  it *before* it can evaluate any availability gate or filter any partition. If
  that resolution is itself an SDM read that requires roles, it is circular.
- Resolution: a **privileged, RBAC-exempt read path** for the governance
  partition — "who am I" is answered by a direct lookup that does not go through
  the access checks it feeds. The *write* side still flows through activities
  (audit preserved); only the hot identity read bypasses the gate. This is a
  normal auth pattern (the session layer reads its own tables un-gated), not a
  hole — but it must be designed deliberately, not fall out by accident.
- Scoping mismatch: assignments are org-scoped and cross-app (`(org, scope,
  user)`), while SDMs are the unit of scope. A governance SDM would be
  **org-scoped**, sitting in the system repo the locked hierarchy already
  anticipates — a slightly different citizen from an app SDM, which is worth
  being explicit about.

**Option B — bespoke org-tier structure.** Assignments are plain rows in the
auth/org tier (a `role_assignments` table), no SDM, no activities. Simpler
bootstrap (it's just an auth-tier read), no scoping gymnastics — but audit,
admin UI, and change-management are all **rebuilt by hand** instead of inherited.

**Leaning: Option A**, precisely because governance is exactly the kind of
audited, change-managed, mutated-only-through-actions data the platform exists to
handle — governing the platform *with* the platform is the strongest possible
dogfood, and the only real cost (the privileged identity read) is a well-trodden
pattern. But it is not locked: it hinges on being comfortable with the
RBAC-exempt bootstrap read and with an org-scoped governance SDM as a distinct
citizen. Flagged for decision; nothing depends on it until auth exists.

## 3. What can be protected — three surfaces, three postures

The three the platform has, and only these, because the architecture already
funnels everything through them:

| Surface | Verb | Form | Default | Enforced |
|---|---|---|---|---|
| **Record type** | `read` | role list | **strict (deny)** | server (partition filter) |
| **Activity** | `run` | **expression** (the availability gate) | **open** | server (pipeline, existing gate) |
| **Page** | `open` | role list | **strict (deny)** | client / UI (until pages move server-side) |

Rationale for the split (TT's ruling):

- **Record types and pages are strict** — no access unless granted. Reaching a
  record type or a page is a UI-facing act (a human is browsing/navigating);
  the safe default there is silence-means-no.
- **Activities are open by default** — because an activity is *also* the
  headless/integration entry point, and its applicability is already governed
  by the availability gate. Open-by-default here means "no gate ⇒ invocable,"
  exactly today's behaviour; you narrow an activity by writing a gate
  expression.
- **No `write`/`delete` verb anywhere.** Records are never edited directly, so
  *activity access is write access.* Granting the activity grants its effect.
  This is the activity spine paying rent.
- **Page access is UX, not the security boundary.** A page's data is already
  governed by record-type reads (its dynamic props evaluate against the filtered
  partition) and its callbacks by activity access. So a user who circumvents a
  hidden page still sees only readable records and can still run only invocable
  activities — defence in depth. That's why client-side enforcement for pages is
  acceptable for MVP.

## 4. Activity access = the availability gate (no new mechanism)

TT's key ruling: an activity should be governed by a **run expression**, not a
role list — e.g. *"dispatchers, or the assigned tech, and only while not
completed."* The platform already has exactly this expression: the
**availability gate** (`show_condition` on the activity def) — an expression
over `context` (incl. `context.user.roles`) and `context.record`, strict
boolean, **fail-closed**, and **server-enforced since Phase 4**. Once auth makes
`context.user.roles` real, the gate expresses role rules directly:

```
show_condition:
  "'role_dispatchers' in context.user.roles
    and context.record.status not in ('Completed')"
```

(`in` / `not in` / `and` are real DSL operators; `context.user.roles` is a list
of role-id strings.)

So we **reuse the gate** rather than add a parallel `run: [roles]` list:

- One mechanism per job (One Pipeline Invariant; the tt_todo "activity access
  via `show_condition`" item is already Done — this is its role-aware
  continuation).
- The gate already unifies *who* (`context.user.roles`) and *when*
  (`context.record.status`) in one expression, which is precisely the shape TT
  asked for.
- Open-by-default falls out for free: no gate ⇒ available.

**Decided (rev 3):** one expression — the gate — carries both "who may" and
"does it apply right now." No separate access expression. A single, familiar
mechanism, and the shape TT asked for. (If a config ever shows the gate drowning
in role boilerplate we can factor a role check into a named function and call it
from the gate — the DSL already supports that, so even the readability escape
hatch needs no new mechanism.)

## 5. Config shape

Role definitions at config root; grants co-located with their subject (rev-1 Q
answered — co-location, not a central block, because the availability gate
already lives on the activity def, and an implementer editing a record type or
activity sees its access right there; a tool can still synthesise an
"all access" view):

```jsonc
{
  "access": {
    "roles": [
      { "id": "role_dispatchers", "name": "Dispatchers", "description": "…" },
      { "id": "role_technicians", "name": "Technicians", "description": "…" }
    ]
  },

  "recordTypes": {
    "rt_work_orders": {
      "fields": [ /* … */ ],
      "access": { "read": ["role_dispatchers", "role_technicians"] }
      // strict: a role not listed cannot see this type at all
    }
  },

  "activities": {
    "act_complete_work_orders": {
      // access IS the availability gate — no separate access key
      "show_condition":
        "'role_dispatchers' in context.user.roles or context.record.assigned_to = context.user.id"
    }
    // an activity with no gate is open (default)
  }
}
```

Pages carry `open` in the page file (pages are page-builder artifacts, not SDM
records — until "pages as SDM citizens" lands, §11 Q3):

```jsonc
// PageDef gains:
{ "access": { "open": ["role_dispatchers"] } }   // strict: unlisted ⇒ hidden
```

Grant semantics for the list-form surfaces (record `read`, page `open`):

- **Union across roles (OR).** Effective access is the union of every grant
  matching any role the user holds.
- **No deny rules.** Grants only add. Deny/precedence is a complexity cliff with
  no MVP consumer.

## 6. Enforcement points (server authoritative, UI cosmetic)

Same doctrine as the availability gate: **the UI hides, the server enforces.**

**Server (`@fluxus/server`) — the security boundary:**

- `records.partition` / `records.list` — filter to the caller's **readable
  types** before the response leaves the server. The browser hosts'
  `MemoryAdapter` snapshot becomes a **visible-subset snapshot**; client-side
  expression evaluation is automatically consistent because unreadable data
  simply isn't present.
- `records.get` — apply the type read check; denial returns **not-found, never
  forbidden** (existence must not leak).
- `activities.run` — **no new pipeline step**: the availability gate already
  runs first and is server-authoritative (Phase 4). With real
  `context.user.roles`, the gate's expression *is* the run check. CREATE has no
  anchor (`context.record` null, as today); the gate references only
  `context.user.roles` there.
  - **Anchor readability (decided, rev 3): blocked.** Running an activity
    against a record the caller can't read is refused — you can't act on a row
    you can't see. The anchor is already loaded, so this is the same type read
    check applied to it; it returns `not-found` (matching `records.get`, so
    existence doesn't leak), checked before the gate runs.
- GET activities (when built) — governed by their gate like any activity; the
  `returns` expression evaluates against the caller's **filtered** partition, so
  a read can't launder rows the caller couldn't see.
- `config.put` / page save — implementer plane (§8).

**Hooks run with model authority.** Once an activity is authorized, its before/
after hooks execute against the **full** partition with full mutation rights —
SQL `SECURITY DEFINER`, not `INVOKER`. RBAC governs entry points, not the
model's own logic; otherwise cascading after-hook mutations break and hook
behaviour would vary by caller, which the audit spine can't tolerate.

**Hosts (workbench, page builder) — UX mirrors, recomputed from the same config
+ filtered partition the client already fetches:**

- Workbench: unreadable record types vanish from the type list; the grid/record
  view shows the filtered partition it was handed; ungated-out activities
  disappear from the strip and New button.
- Page builder runtime: pages without `open` vanish from navigation/explorer;
  direct open shows a standard "not authorized" surface.

## 7. Defaults and adoption

- **No auth / no `access` anywhere → everything open** (today's dev behaviour;
  existing demo scopes keep working untouched).
- **Once auth + access rules are engaged, per §3:** record types and pages are
  **deny-by-default** (unlisted ⇒ hidden), activities are **open-by-default**
  (no gate ⇒ invocable). No global "strict mode" flag — the default is fixed per
  surface, which is fewer knobs and matches how each surface is reached.
- MVP-first: no permission groups, no role inheritance, no wildcard grants, no
  row-level read conditions (§9). A grants list per type/page plus a gate
  expression per sensitive activity is verbose but readable and auditable;
  sugar can come later from usage evidence.

## 8. Implementer (design-time) plane

GitHub repo levels, **collapsed to three** (TT's ruling — `write` and `maintain`
merged; a single implementer doing full stack doesn't need the split):

| Level | Grants |
|---|---|
| `read` | view config, pages, and the workbench in full — implementers see everything at design time, incl. all runtime records (needed to build against real data; hiding rows from the person who writes the rules is theatre — TT agreed) |
| `write` | edit SDM config **and** pages, **including the `access` section and roles** (`config.put`, page save) |
| `admin` | `write` + manage implementer permissions **and** user→role assignments (the admin tool of §2) |

- Enforcement: `config.put` and page save require `write`; managing who is an
  implementer and running the user-roles admin tool require `admin`.
- Scope of these levels: today the scope path; later the org-defined **repo**
  (locked hierarchy ruling already earmarks repos as "the unit of sharing/import
  and permissions"). Scope-blindness means no script/config changes when that
  arrives.
- The change-management pipeline from the tt_todo (review → approve → publish,
  "cooked in") is acknowledged and **deferred**: these levels are the substrate
  it will sit on (approval = an `admin`/second `write` actor other than the
  author), not a replacement.

## 9. What RBAC deliberately does not do (MVP)

- **No row-level read conditions** (TT: leave out initially). Record `read` is a
  role list — a role sees all rows of a granted type or none. Per-row visibility
  (`where record.assigned_to = context.user.id`) is future work; the seam is a
  new narrow expression posture (roots `context` + candidate `record`, no
  `records` queries, fail-closed) added when a real modelling need appears.
- **No field-level permissions / column masking.** A row is visible or it isn't.
  (See the separate PII-hashing idea now in tt_todo — related but distinct.)
- **No write/delete verb** — activities are the only mutation path.
- **No history-specific rules** — history rides the record (`read` shows it);
  the never-edited promise covers integrity; reporting is org-scoped BI with its
  own future governance.
- **No script-level permission checks / `can(...)` builtin** — scripts aren't
  principals; hooks run as the model. `context.user.roles` membership tests
  cover conditional UI and gates.
- **No org hierarchy work** — roles/assignments key off the existing opaque
  scope; when repos land, assignments re-key by repo with scripts and config
  untouched.

## 10. Auditing posture

- Authorized runs already carry the author on the history entry — who did what
  is the spine's existing contract.
- **Denials persist nothing** for MVP, consistent with rejected gates. The
  unified-log direction (system-class entries, per-class retention) is the
  natural home for denial logging, and the per-activity **watch** dial is the
  already-agreed escalation valve for capturing denials when investigating.
  Nothing new invented — folded into that open design.
- Grant changes are config changes, audited like any config edit when config
  versioning/change-management arrives. Assignment changes (admin tool) are
  org-tier events audited there. RBAC adds no separate audit store (One Pipeline
  Invariant).

## 11. Decisions and the one remaining fork

**Decided (rev 3):**

1. **Activity access is the availability gate expression** — one expression for
   who + when, no separate access mechanism (§4).
2. **Running against an unreadable anchor is blocked** — `not-found`, checked
   before the gate (§6).
3. **Page enforcement is client-only until pages move server-side** — accepted
   interim. (Update 2026-07-16: pages now DO live server-side — backend
   stage 3 put them in the `pages` table — so the storage precondition is
   met; `open` enforcement can move into `pages.list` when RBAC lands. Page
   access remains UX, the security boundary is record reads + activity
   gates (§3).)
4. **Role definitions stay in the SDM config** — created as needed, validated at
   save time, travel with the model. (If a role ever needs to span modules, the
   home can move to an org registry with the same declaration shape — but not
   now.)

**Still open — the one fork worth a decision (§2a):** whether role *assignments*
are modelled with a **governance SDM** (grant/revoke as activities → audit and
admin UI for free, at the cost of a deliberate RBAC-exempt identity-read on
bootstrap) or as **bespoke org-tier structure** (simpler bootstrap, everything
else rebuilt by hand). Leaning governance-SDM (dogfood); not locked. Nothing
depends on it until auth exists.

## 12. Phasing (proposed)

1. **Auth** (prerequisite, separate design): identity, sessions, `context.user`
   real, `context.user.roles` populated, reporting `author` real.
2. **RBAC stage 1 — record types + activities:** `access.roles` in config, role
   validation, server-side partition filtering by readable type, role-aware
   availability gates, workbench UX mirror. The security boundary, complete and
   server-enforced.
3. **RBAC stage 2 — pages + implementer plane:** page `open` grants (client
   mirror), the three implementer levels on `config.put`/page save, the
   user-roles admin tool (workbench, admin-only).
4. **Later, evidence-driven:** row-level read conditions, org-level role
   registry, denial logging via unified log, change-management pipeline,
   field-level/PII handling if justified.
