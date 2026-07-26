# RBAC / Auth — Technical Spec (compressed from RBAC_DESIGN.md rev 6)

## Auth
- Provider: **Neon Auth (Managed Better Auth)** — identity + sessions only. Auth data (users, sessions, JWKS) in `neon_auth` schema in existing Neon Postgres.
- Transport: **bearer JWT** (`Authorization: Bearer`) on every tRPC call; never cookies. Same for headless callers.
- Verification: per-request, in tRPC `fetchRequestHandler` `createContext` — parse header → verify against cached JWKS → produce `context.user`. `AppContext` becomes per-request. Identical path under Hono / Lambda / Vercel bridge. `/health` open.
- Env-driven posture: Neon Auth env vars unset ⇒ demo stub, everything open. Set ⇒ valid session **required**; no anonymous mode.
- `context.user = { id, name, email, roles }`. History-entry `author` = Neon Auth user **id**; names resolved at render.
- Roles resolver seam, two lookups:
  - `(user, operation) → roleIds` → `context.user.roles`. Stub `[]` until RBAC stage 1.
  - `(user, solution) → implementer level` — server-only (`config.put`/page save), never in script env. Stub open until stage 2.
- Sign-in: minimal embedded email+password form per host, gating `connect()`. Signup open for MVP.

## Planes
| Plane | App | Role set |
|---|---|---|
| Implementer (design-time) | Console | fixed: `read` / `write` / `admin` |
| Runtime | Runtime | variable, declared per solution in `access.roles` |

## Roles
- Solution-scoped; ids `role_<plural>`, display names plural.
- **Definitions** in SDM config (`access.roles`, validated at save). **Assignments** in org-tier governance store, keyed `(org, operation, userId) → roleIds` — never in solution. Store shape ruled 2026-07-20 (§2a Option B): **bespoke auth-tier tables** (`role_assignments`, `implementer_levels`), not a governance solution.
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
- `config.put`/page save: require implementer `write`; permissions/role-assignment admin: `admin`.
- Hooks run with model authority (full partition, `SECURITY DEFINER` semantics).

## Implementer levels
- `read`: view all config/pages/records. `write`: edit config + pages incl. `access`. `admin`: `write` + manage implementers and user→role assignments.
- Attach to solution (stand-in: operation key).

## MVP exclusions
No row-level read conditions, field-level permissions, role inheritance/groups/wildcards, denial logging, `can()` builtin.

## Phasing
1. Auth (roles stubbed) — **BUILT 2026-07-19** (see RBAC_DESIGN §0 build note) → 2. RBAC stage 1: record types + activities — **BUILT 2026-07-20** (governance store `role_assignments`/`implementer_levels`; live `runtimeRoles`; record-type read filter, default-deny when auth configured + solution declares `access.roles`; anchor-read gate before the run check; Console assignments/implementers admin) → 3. Stage 2: pages + implementer plane — **BUILT 2026-07-20** (pages = M4: `def.access.open` server filter on published `pages.list`; implementer plane = M5: `implementer_levels` live, dormant-until-declared, gating config/pages/publish/menu/operations/governance; enforced only when auth configured) → 4. Evidence-driven extras.
