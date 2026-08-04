# RBAC / Auth — Technical Spec (compressed from RBAC_DESIGN.md rev 6)

## Auth
- Provider: **Neon Auth (Managed Better Auth)** — identity + sessions only. Auth data (users, sessions, JWKS) in `neon_auth` schema in existing Neon Postgres.
- Transport: **bearer JWT** (`Authorization: Bearer`) on every tRPC call; never cookies. Same for headless callers.
- Verification: per-request, in tRPC `fetchRequestHandler` `createContext` — parse header → verify against cached JWKS → produce `context.user`. `AppContext` becomes per-request. Identical path under Hono / Lambda / Vercel bridge. `/health` open.
- Env-driven posture: Neon Auth env vars unset ⇒ demo stub, everything open. Set ⇒ valid session **required**; no anonymous mode.
- `context.user = { id, name, email, roles }`. History-entry `author` = Neon Auth user **id**; names resolved at render.
- Roles resolver seam, two lookups:
  - `(user, operation) → roleIds` → `context.user.roles`. Stub `[]` until RBAC stage 1.
  - `(user, solution) → sol-user level` — server-only (`config.put`/page save), never in script env. Stub open until stage 2.
- Sign-in: minimal embedded email+password form per host, gating `connect()`. **No signup** — invite only (ruled 2026-08-02, see *Users*).

## Planes
| Plane | App | Role set |
|---|---|---|
| Design (design-time) | Console | `sol_users.level`: `read` / `write` |
| Runtime | Runtime | variable, declared per solution in `access.roles` |

## Roles
- Solution-scoped; ids `role_<plural>`, display names plural.
- **Definitions** in SDM config (`access.roles`, validated at save). **Assignments** in org-tier governance store, keyed `(org, operation, userId) → roleIds` — never in solution. Store shape ruled 2026-07-20 (§2a Option B): **bespoke auth-tier tables** (`user_roles`, `sol_users`), not a governance solution.
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
- `config.put`/page save: require sol-user `write`; user/role administration is the org and op admin tiers (see *Administration*).
- Hooks run with model authority (full partition, `SECURITY DEFINER` semantics).

## Users (org pool → op users → roles) — ruled 2026-08-02

Three layers, each a separate question. Nothing merges them.

| Layer | Table | Question it answers |
|---|---|---|
| Org pool | `org_users` | Does this person exist to us at all? |
| Op users | `op_users` | May they enter this operation? |
| Roles | `user_roles` | What may they see inside it? |

- **Email is the key.** An invited user has no auth id until first login, so the pool keys on email and binds `authUserId` on first successful sign-in. Roles can be assigned before the person has ever signed in.
- **No signup** (ruled 2026-08-02, replacing "signup open for MVP"). Entry is **invite only**, initiated in the Console. Long term this is replaced by an integration with a company's user directory; the invite flow is the interim, and the email key is what makes that swap cheap.
- **Being an op user is the entry gate.** Not being in `op_users` is a **refusal**, not a degraded session. Enforced in `resolveUser` — the one choke point every operation-scoped call passes through.
- **Strict, not dormant.** An operation with no `op_users` admits nobody. Unlike record types / pages / sol users, which are dormant-until-declared, this gate has no adoption default: those ask *what may you see*, this asks *may you enter*, and an empty user list is an answer. Demo posture (auth unconfigured) stays open — no identity, nothing to gate.
- **No design-plane bypass.** Someone who builds the solution adds themselves like anyone else; the Console reaches an operation's records through the same gate as the Runtime.
- **No roles ⇒ nothing visible.** Already true (deny-by-default across record types, pages and menu items) and unchanged by this.
- The two gates are independent and must stay so: op user without roles = enters, sees nothing; roles without op user = cannot enter. The second is not reachable through the UI but must not be reachable through the API either.

**Terminology (binding):** *users*, *org users*, *op users*. Not "members", not "memberships" — those were drift across the operation view and organisation People, three words for one concept, retired here.

### Administration — who may grant what (ruled 2026-08-02)

Authority has one root (the org admin) and flows **downward only**. There is no sideways delegation: no admin tier can appoint its own tier.

| Tier | Stored as | May do |
|---|---|---|
| **Org admin** | `org_users.level = 'admin'` | Create solutions and appoint solution admins. Create operations and assign each a solution. Appoint op admins. Invite into the pool, and own user **lifecycle** (expire/suspend/remove). |
| **Solution admin** | `sol_users` (`read`/`write`/`admin`) | Implement the solution: model, pages, `default_menu`. Design plane only. |
| **Op admin** | `op_users.level = 'admin'` | Implement the operation: op users, role assignments, the operation's menu override. Invite into the pool, limited to adding the invitee to **their own** operation. |
| **Op user** | `op_users.level = 'user'` | Enter the operation. Sees whatever their roles allow. |

**The governing split is identity vs authorization.** The org admin controls *who exists and who gets in*; the op admin controls *what they may do once inside*. So an org admin does **not** manage roles — deliberately, and unlike a conventional "admin inherits everything" model.

- **Solution admins get no user visibility at all.** Support requests go through the org admin. A person building the model has no business over real identities.
- **Menus stay split**, as already built: `default_menu` is design-plane (solution admin), the per-operation override is runtime-plane (op admin).
- **The separation of duties is a speed bump, not a wall.** An org admin appoints op admins, so may appoint themselves and then manage roles. That is accepted: it forces an explicit, auditable grant rather than ambient power. Do not treat it as a hard control.
- **Bootstrap: the first org admin is created with the org.** No signup means the chain cannot start itself, and the strict entry gate means a freshly migrated operation admits nobody — including the Console, which reaches an operation through the same gate as the Runtime, so nobody can open the screen that would invite the first person. Something outside the request path has to write the first row.

  **Built as `bootstrapOrgAdmin` — a script (`npm run bootstrap`), not a migration** (ruled 2026-08-02). A plain-SQL migration cannot read `FLUXUS_ORG_ADMIN_EMAIL`, and it runs exactly once — but this is also the *lockout recovery* tool, and a lockout you can only fix by writing another migration is not a fix. So it is idempotent and re-runnable, and deliberately separate from `npm run seed` (which installs the demo bundle and is for empty databases) so it is safe to point at production. Two rules keep re-runs safe: the pool row is upserted to org admin (promotion is the point), but op-admin rows go **only** into operations that currently have no users at all — an operation someone already administers is already governed. `seed` calls the same function when the env var is set, so a fresh clone gets it free. In demo posture (auth unconfigured) there is nothing to bootstrap. When an org-creation flow exists it carries the same obligation — creating an org and creating its first admin are one act.

  **That flow now exists (2026-08-03): `platform.registerOrg`**, in the platform plane. It discharges the obligation in the request path — org row plus owner's org-admin row, one call — so the script is demoted to lockout recovery and the very first admin on a fresh deployment. Everything above about the script still holds; it just runs far less often.
- **Above the org: the platform tier** (ruled 2026-08-03). The org admin is the root of authority *within* an org, which leaves two questions unanswerable from inside — who creates an org, and who sees across orgs. **Platform admin** is the tier that answers them: op admin → org admin → **platform admin**. Membership is an **env allowlist** (`FLUXUS_PLATFORM_ADMINS`), not a table: a `platform_users` table recreates the same chicken-and-egg one tier up, and the env is already outside the request path, which is the only property the first row of any tier needs. `isPlatformAdmin` is the one seam if that ever needs to become a table.

  **It is the one gate that stays shut in demo posture.** Every other check here is open when auth is unconfigured, because with no identity there is nothing to gate on — but those guard one org's data from that org's own people, while this guards every org from everyone.

  The platform tier grants nothing *inside* an org: registering one makes the owner its admin, and from there authority flows downward exactly as before. A platform admin is not implicitly an org admin, an op admin, or a sol user of anything.
- **The org owner is not a level.** They are the org's first `org_users` admin, recorded as `orgs.contact_email` so the row itself answers whose it is. A distinct `owner` value would need transfer rules, demotion rules and an answer to whether the last one can be removed — questions nothing needs yet. Revisit when billing gives "owner" a meaning "first admin" cannot carry.
- **Console access is derived, never a flag**: org admin, or any sol-user level on any solution. A separate "may use the Console" bit could contradict the grants above, so there isn't one.

## Solution users
- `read`: view all config/pages/records. `write`: edit config + pages incl. `access`. There is no third grade — `admin` collapsed into `write` (2026-08-02) once the admin tiers took over everything it guarded; appointing sol users is org-admin work.
- Attach to solution (stand-in: operation key).

## MVP exclusions
No row-level read conditions, field-level permissions, role inheritance/groups/wildcards, denial logging, `can()` builtin.

## Phasing
1. Auth (roles stubbed) — **BUILT 2026-07-19** (see RBAC_DESIGN §0 build note) → 2. RBAC stage 1: record types + activities — **BUILT 2026-07-20** (governance store `user_roles`/`sol_users`; live `runtimeRoles`; record-type read filter, default-deny when auth configured + solution declares `access.roles`; anchor-read gate before the run check; Console assignments/sol-users admin) → 3. Stage 2: pages + design plane — **BUILT 2026-07-20** (pages = M4: `def.access.open` server filter on published `pages.list`; design plane = M5: `sol_users` live, dormant-until-declared, gating config/pages/publish/menu/operations/governance; enforced only when auth configured) → 4. Evidence-driven extras.

### Built 2026-08-02 — the tiers, in code

`org_users.level` / `op_users.level` (migration 0011), `sol_users` rekeyed `user_id` → `email` (0012), and three non-nested checks in `packages/server/src/router.ts`: `requireOrgAdmin`, `requireOpAdmin`, `requireSolUser`.

| Procedure | Tier | Was |
|---|---|---|
| `users.listOrg` / `invite` / `removeOrg` / `setStatus` / `setOrgLevel` | org admin | ungated |
| `solutions.create`, `operations.create` | org admin | design plane `admin` |
| `solUsers.list` / `solUsers.put` | org admin | design plane `admin` |
| `users.addOp` (level `user`) | op admin **or** org admin | design plane `admin` |
| `users.addOp` (level `admin`) | **org admin only** | — |
| `users.removeOp` | op admin | design plane `admin` |
| `userRoles.list` / `userRoles.put` | op admin | design plane `admin` |
| `operations.putConfig` (menu override) | op admin | design plane `write` |
| `config.put`, `pages.*`, `publish` | sol user | unchanged |

- **The escalation rule lives in one place**: `users.addOp` branches on the `level` being written. Entry is an identity question, so either tier may add a plain user; only the org admin may write `admin`. **An op admin can never mint an op admin.**
- **Solution admins lose every user-facing grant**, including `solUsers.list` — since the rekey those rows carry real emails.
- **Suspension bites the tiers**, not just the entry gate: a suspended pool row is not an admin anywhere.
- `me` returns `{ orgAdmin, opAdmin, console }` so the Console can gate what it **renders**; every call is re-checked server-side. `console` is derived (org admin, or any sol-user level on any solution) — never a stored flag.
- **`user_roles` rekeyed too** — migration 0015 renamed `role_assignments` → `user_roles` and moved it off the auth id onto email, the same day. All four tables are now email-keyed, so roles can be granted to an invited user before first sign-in and `removeOpUser` genuinely clears their grants. (The build note above briefly recorded this as *not* rekeyed; corrected 2026-08-04.)
