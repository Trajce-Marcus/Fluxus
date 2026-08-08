# RBAC / Auth — Technical Spec (compressed from RBAC_DESIGN.md rev 6)

## Auth
- Provider: **Neon Auth (Managed Better Auth)** — identity + sessions only. Auth data (users, sessions, JWKS) in `neon_auth` schema in existing Neon Postgres.
- Transport: **bearer JWT** (`Authorization: Bearer`) on every tRPC call; never cookies. Same for headless callers.
- Verification: per-request, in tRPC `fetchRequestHandler` `createContext` — parse header → verify against cached JWKS → produce `context.user`. `AppContext` becomes per-request. Identical path under Hono / Lambda / Vercel bridge. `/health` open.
- Env-driven posture: Neon Auth env vars unset ⇒ demo stub, everything open. Set ⇒ valid session **required**; no anonymous mode.
- `context.user = { id, name, email, roles }`. History-entry `author` = Neon Auth user **id**; names resolved at render.
- Roles resolver seam, two lookups:
  - `(user, operation) → roleIds` → `context.user.roles`. Stub `[]` until RBAC stage 1.
  - `(user, solution) → is sol admin` — server-only (`config.put`/page save), never in script env. Stub open until stage 2.
- Sign-in: minimal embedded email+password form per host, gating `connect()`. **No signup** — invite only (ruled 2026-08-02, see *Users*).

## Planes
| Plane | App | Role set |
|---|---|---|
| Design (design-time) | Console | `sol_admins` — one grade: you build it or you do not |
| Runtime | Runtime | variable, declared per solution in `access.roles` |

## Roles
- Solution-scoped; ids `role_<plural>`, display names plural.
- **Definitions** in SDM config (`access.roles`, validated at save). **Assignments** in org-tier governance store, keyed `(org, operation, userId) → roleIds` — never in solution. Store shape ruled 2026-07-20 (§2a Option B): **bespoke auth-tier tables** (`user_roles`, `sol_admins`), not a governance solution.
- `context.user.roles` = role ids in current operation; scripts scope-blind.

## Surfaces
| Surface | Verb | Form | Default | Enforced |
|---|---|---|---|---|
| Record type | `read` | role list | deny | server (partition filter) |
| Activity | `run` | `show_condition` expression | open | server (existing gate) |
| Page | `open` | role list | deny | server (published `pages.list` filter, M4; client menu cosmetic on top) |

- No `write`/`delete` verb — activities are the only mutation path.
- Grant semantics: union across roles (OR); no deny rules.

## Config
```jsonc
{ "access": { "roles": [ { "id": "role_dispatchers", "name": "Dispatchers" } ] },
  "recordTypes": { "rt_x": { "access": { "read": ["role_dispatchers"] } } },
  "activities": { "act_y": { "show_condition": "'role_dispatchers' in context.user.roles" } } }
// PageDef: { "access": { "open": ["role_dispatchers"] } }
```

## Enforcement
- `records.partition`/`list`: filter to readable types → visible-subset snapshot.
- `records.get`: deny ⇒ **not-found** (never forbidden).
- `activities.run`: gate is the run check; unreadable anchor ⇒ not-found, checked before gate. CREATE: `context.record` null.
- `config.put`, the per-entity model writes (`config.putAttribute` … `putDefaultMenu`) and page save: require **sol admin**; user/role administration is the owner, org-admin and op-admin tiers (see *Administration*).
- Hooks run with model authority (full partition, `SECURITY DEFINER` semantics).

## Users — one population, then grants (rewritten 2026-08-04; see [USERS.md](USERS.md))

`users` answers *who is this person* and nothing else. Everything else is a grant
laid on top, and **every grant table is keyed `(target, person)` — the row IS the
assignment**. There are no `level` columns anywhere.

| Table | Question it answers | Key |
|---|---|---|
| `users` | Who is this person? | org + email |
| `org_admins` | Who administers the organisation? | org + email |
| `sol_admins` | Who builds this solution? | solution + email |
| `op_users` | Who may enter this operation? | operation + email |
| `op_admins` | Who administers this operation? | operation + email |
| `user_roles` | What may they do inside it? | operation + email |

The owner is `orgs.owner_email` — also the org's contact address, since the separate `contact_email` was dropped (migration 0018) as a duplicate. Not writable through `orgs.putProfile`: that is org-admin work, and writing it would be ownership transfer.

- **Email is the key.** An invited person has no auth id until first login, so
  every table keys on email and `users.auth_user_id` binds on first successful
  sign-in. Every grant can be made before they have ever signed in.
- **No signup.** Entry is **invite only**, initiated in the Console. Long term
  replaced by an integration with a company's user directory; the email key is
  what makes that swap cheap.
- **Inviting and appointing are two steps.** Inviting adds a person to `users`
  and grants nothing anywhere; appointing names someone already there. Whoever
  may appoint may also invite. **Sol admins never invite** — neither appointment
  is theirs to make.
- **Entry is `op_users` OR `op_admins`.** An admin row implies entry: an
  administrator who cannot open what they administer would be nonsense. Enforced
  in `resolveUser` — the one choke point every operation-scoped call passes.
- **Strict, not dormant.** An operation with nobody in it admits nobody. Unlike
  record types and pages, which are dormant-until-declared, this gate has no
  adoption default: those ask *what may you see*, this asks *may you enter*, and
  an empty list is an answer. Demo posture (auth unconfigured) stays open.
- **No design-plane bypass.** Someone who builds the solution is added to an
  operation like anyone else; the Console reaches records through the same gate
  as the Runtime.
- **The two operation gates are independent and must stay so**: in the operation
  without roles = enters, sees nothing; roles without being in it = cannot enter.
  The second is not reachable through the UI and must not be through the API.
- **Lifecycle lives on the pool row** so it bites every tier at once.
  **`suspended`** is a reversible pause — every grant survives, and meanwhile
  they are no admin anywhere and enter nothing. **`expired`** (migration 0017)
  is terminal: every grant is dropped and `expired_at` records when.
- **Nobody is ever deleted.** `author` on a history entry is an auth id, and
  `users.auth_user_id` is the only bridge from it to a name — deleting the row
  would leave the append-only spine recording acts it can no longer attribute.
  Expiry **replaced** removal rather than joining it. Signing in does not
  resurrect an expired person; unexpiring returns them as a plain member with no
  grants, to be appointed again from scratch.

**Terminology (binding):** *users*, *org owner*, *org admins*, *sol admins*,
*op admins*, *op users*, *roles*. Not members, memberships, implementers, seats,
accounts, people, sol users, org users. There are no "kinds of user".

### Administration — who may appoint whom (rewritten 2026-08-04)

Authority has one root — the **org owner** — and flows **downward only**. No
administrator appoints another at their own level.

| Tier | Stored as | May do |
|---|---|---|
| **Platform admin** | env allowlist | Register an organisation and name its owner. Nothing inside one. |
| **Org owner** | `orgs.owner_email` | Appoint and remove org admins. Make themselves one. Nothing else *as owner*. |
| **Org admin** | `org_admins` | Invite, suspend, remove. Create solutions and appoint their sol admins. Create operations and appoint their op admins. |
| **Sol admin** | `sol_admins` | Build the solution: model, pages, `default_menu`. Appoint nobody, invite nobody, see no user list. |
| **Op admin** | `op_admins` | Add ordinary users to *their* operation, assign roles, set its menu override. Invite. **Never mint another op admin.** |
| **Op user** | `op_users` | Enter the operation. Sees whatever their roles allow. |

**The governing split is identity vs authorization.** The org admin controls *who
exists and who gets in*; the op admin controls *what they may do once inside*. So
an org admin does **not** manage roles — deliberately, and unlike a conventional
"admin inherits everything" model.

- **The owner is not implicitly an org admin.** The root delegates; it does not
  do the work. An owner who wants org-admin surfaces appoints themselves.
- **Sol admins get no user visibility at all**, including `sol_admins` itself.
  A person building the model has no business over real identities.
- **Menus stay split**: `default_menu` is design-plane (sol admin), the
  per-operation override is runtime-plane (op admin).
- **The separation of duties is a speed bump, not a wall.** An org admin appoints
  op admins, so may appoint themselves and then manage roles. Accepted: it forces
  an explicit, auditable grant rather than ambient power.
- **The pattern has a name.** The nearest formal treatment is *administrative
  RBAC* (ARBAC97), specifically Crampton & Loizou's **administrative scope**.
  Informally: separation of duties plus no privilege self-propagation. Most SaaS
  does not do this — admins appointing admins is the norm. The trade is that
  every tier depends on the tier above still existing, which is why the platform
  tier sits above the owner and why `npm run bootstrap` is kept as recovery.
- **Bootstrap.** No signup and a strict entry gate mean a freshly migrated
  deployment admits nobody, including the Console — so something outside the
  request path writes the first rows. `platform.registerOrg` is the normal path
  (org + `owner_email` + the owner's `users` row, one act). `npm run bootstrap`
  (`bootstrapOrgAdmin`) stays as **lockout recovery**: idempotent and re-runnable,
  it upserts the pool row and the org-admin appointment, claims ownership only of
  an org that has none, and opens operations/solutions **only** where nobody
  administers them yet.
- **Above the org: the platform tier** (ruled 2026-08-03). Membership is an env
  allowlist (`FLUXUS_PLATFORM_ADMINS`), not a table — a `platform_users` table
  recreates the same chicken-and-egg one tier up, and the env is already outside
  the request path, which is the only property the first row of any tier needs.
  `isPlatformAdmin` is the one seam if it ever needs to become a table.

  **It is the one gate that stays shut in demo posture.** Every other check is
  open when auth is unconfigured, because with no identity there is nothing to
  gate on — but those guard one org's data from that org's own people, while this
  guards every org from everyone.

  It grants nothing *inside* an org: a platform admin is not implicitly an owner,
  an org admin, an op admin, or a sol admin of anything.
- **Console access is derived, never a flag**: owner, org admin, or sol admin of
  any solution. A separate "may use the Console" bit could contradict the grants
  above, so there isn't one. The owner's derivation is what makes the first
  appointment reachable on a fresh organisation.

## Sol admins
- One grade: build the solution — model, pages, `access`, `default_menu`. The
  `read`/`write` split was dropped 2026-08-04: `read` bought only "look at the
  model", which is what opening the solution already means, and every surface a
  grade used to guard is admin work.
- Attached to the solution. Keyed on email, no `org_id` — solution ids are
  globally unique, so the org is derivable through `solutions`.

## MVP exclusions
No row-level read conditions, field-level permissions, role inheritance/groups/wildcards, denial logging, `can()` builtin.

## Phasing
1. Auth (roles stubbed) — **BUILT 2026-07-19** (see RBAC_DESIGN §0 build note) → 2. RBAC stage 1: record types + activities — **BUILT 2026-07-20** (governance store `user_roles`/`sol_admins`; live `runtimeRoles`; record-type read filter, default-deny when auth configured + solution declares `access.roles`; anchor-read gate before the run check; Console assignments/sol-users admin) → 3. Stage 2: pages + design plane — **BUILT 2026-07-20** (pages = M4: `def.access.open` server filter on published `pages.list`; design plane = M5: `sol_admins` live, dormant-until-declared, gating config/pages/publish/menu/operations/governance; enforced only when auth configured) → 4. Evidence-driven extras.

### Built 2026-08-02 — the tiers, in code

`org_users.level` / `op_users.level` (migration 0011), `sol_users` rekeyed `user_id` → `email` (0012), `role_assignments` → `user_roles` and rekeyed onto email (0015). **Superseded by the 2026-08-04 rewrite below**, which kept the email keys and the gates and removed every `level` column.

### Built 2026-08-04 — one population, then grants

**Migration 0016.** `org_users` → `users` (no level) + `org_admins`; `op_users` keeps entry only, admins promoted into `op_admins`; `sol_users` → `sol_admins`, one grade, the `read` rows dropped; `orgs.owner_email` added, seeded from `contact_email`. Data is preserved by promotion, and orphan grants — rows naming somebody not in the pool — are deleted.

**Code.** `packages/server/src/users/` is the whole store, one module per tier (`pool`, `org-admins`, `sol-admins`, `op-admins`, `op-users`, `roles`, `bootstrap`); `src/gates.ts` holds the request checks; `src/routers/users.ts` holds one router per list. `host.ts` re-exports the store so callers keep one import.

| Router | Tier | Notes |
|---|---|---|
| `users.list` / `setStatus` / `expire` / `unexpire` | org admin | identity and lifecycle; `setStatus` refuses `expired` |
| `users.invite` | owner, org admin, **or** op admin of the named operation | grants nothing anywhere |
| `orgAdmins.appoint` / `remove` | **owner only** | no tier appoints its own tier |
| `orgAdmins.list` / `owner` | org admin / open | the list is visible, the controls are not |
| `solAdmins.*` | org admin | including the read — the design plane governs no people |
| `opAdmins.appoint` / `remove` | org admin | an op admin can never mint an op admin |
| `opAdmins.list` | op admin **or** org admin | the tier above, read-only on the operation's screen |
| `opUsers.list` / `add` | op admin **or** org admin | entry is an identity question |
| `opUsers.remove` | op admin | their operation, their list |
| `userRoles.list` / `put` | op admin | the ORG admin is refused, deliberately |
| `operations.putConfig` (menu override) | op admin | unchanged |
| `config.put`, the per-entity model writes, `pages.*`, `publish` | sol admin | unchanged |

- **Suspension bites the tiers**, not just the entry gate: every `is*Admin` check re-reads the pool row, so a suspended person is no admin anywhere while their grants survive intact.
- **Appointment refuses anyone not in the pool** — invite, then appoint, enforced in the store rather than assumed by the UI.
- `me` returns `{ orgOwner, orgAdmin, opAdmin, console }` so the Console can gate what it **renders**; every call is re-checked server-side.
- **The Console's screens** are `packages/console/src/platform-components/users/` — one pattern at three tiers: the tier above read-only, the list this screen governs editable, and Invite. See [USERS.md](USERS.md) → *The screens this implies*.
