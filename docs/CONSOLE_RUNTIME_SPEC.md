# Console & Runtime Apps — Master Spec

Status: **rev 3 (2026-07-20) — M1–M5 BUILT.** All five milestones (§9)
implemented and verified (server 59 tests + full workspace build green; fresh
seed publishes the demo page). Living truth now lives in the package SPECs
(`@fluxus/server`, `@fluxus/client`, `@fluxus/engine`) per the docs-with-code
rule; this doc is the milestone map + decision log. Not yet browser-smoked
end-to-end (tsc/tests/build only). Not yet committed.

## 0. Scope

- Build out **Console** (design plane: page builder + SDM authoring + admin) and **Runtime** (workbench → end-user app).
- Deliverables: operations tier; auth+RBAC wired into both apps; page publish w/ versioning + readme; per-operation runtime menus; page access control.
- Baseline built: bearer-JWT auth (RBAC_COMPACT), `@fluxus/page-runtime`, pages on config pipeline, prod deploy.

## 1. Entity model (GLOSSARY: org / solution / operation)

- **Solution** = design artifact, the container: SDM config + pages + role defs. No data, users, assignments, menus.
- **Operation** = runtime unit; **links to exactly one solution** (`solution_id` NOT NULL FK). Owns record partition, users, role assignments, files, **operation config** (menu + future runtime settings).
- Two operations on one solution ⇒ disjoint data/people/menus, shared model + pages.
- Opaque `scope` string splits: design artifacts key on **solutionId**; records + operation config key on **operationId** (endorsed rename of unendorsed "scope").
- Org tier: single implicit org MVP; column present, no org UI.

## 2. Storage (existing Drizzle/Neon pipeline — no new mechanisms)

- `solutions(id, name, created_at)` — MVP row = today's `demo/sdm` bundle.
- `operations(id, org_id, solution_id FK NOT NULL, name, config jsonb, created_at)` — `config` holds the menu (§5); jsonb column, not a table, until a second consumer demands one.
- Rekey: `configs`/`pages` → `solution_id`; `records`/`rpt_*` → `operation_id`. One migration; seed script updated.
- `page_versions(solution_id, path, version int, def jsonb, readme text, published_by, published_at)` — PK `(solution_id, path, version)`; **append-only, immutable** (activity-history posture).
- Governance (§2a **resolved 2026-07-20: Option B — bespoke org-tier structure**, RBAC_DESIGN rev 7):
  - `role_assignments` keyed `(org, operation, user) → roleIds`.
  - `implementer_levels` keyed `(user, solution) → level`.
  - Plain auth-tier reads (no SDM, no activities); admin CRUD surfaces built by hand in Console. Governance-solution dogfood remains a possible later migration, not a seam obligation.

## 3. Console app

- Host: current page-builder app grows sections; page editing unchanged (drafts = `pages` table).
- **Operations admin**: list/create operations (name + solution); user→role assignments UI; implementer levels UI (both over §2 governance tables).
- **Publish flow**: per-page action → dialog requiring **readme** (release notes, md) → `pages.publish` snapshots the draft def into `page_versions` at `max(version)+1`. Rollback = republish an older version's def as a new version — never delete/edit.
- **Menu editor**: edits the operation's `config.menu` (§5); requires implementer `write` (admin included) — ruled 2026-07-20.
- **Versions view**: per-page version list w/ readme. Diffing = non-goal.
- Gating (RBAC stage 2): `config.put` / page save / publish / menu edit require implementer `write`; role-assignment + implementer-level admin require `admin`. Until then: stub-open per env posture.

## 4. Runtime app

- Host: SDM workbench evolves in place.
- Boot: sign-in (built) → operation resolution (single membership auto-selects; picker if >1; MVP: single hardcoded op acceptable) → `connect(operationId)`.
- Renders **published page versions only** (latest per path); drafts never leave Console. Console preview keeps rendering drafts via embedded page-runtime.
- Nav = operation menu (§5), role-filtered.
- **Record grid / record view stay reachable for now** (ruled 2026-07-20) — a menu-addressable "Workbench" item, no longer the default surface.
- Solution branding, not platform branding (cosmetic MVP).

## 5. Menu (operation config — ruled 2026-07-20: operation-side, NOT in solution/SDM)

```jsonc
// operations.config
{ "menu": [
  { "label": "Dispatch", "page": "dispatch/board", "roles": ["role_dispatchers"] },
  { "label": "Admin", "roles": ["role_managers"], "items": [
    { "label": "Crews", "page": "admin/crews", "roles": ["role_managers"] } ] }
] }
```

- One level of nesting max (MVP).
- **Per-item role lists; no `roles` (or empty) ⇒ item hidden** — deny by default (ruled 2026-07-20). Visible iff user holds ≥1 listed role in the operation. Groups: own `roles` gate AND ≥1 visible child.
- Menu roles control **visibility**; page `access.open` (§6) still gates **entry** independently. Two layers, both deny-default.
- Role ids reference the linked solution's `access.roles`; page paths must resolve to **published** versions of the linked solution (ruled 2026-07-20) — both validated at operation-config save.

## 6. Page access control (RBAC stage-2 surface, per RBAC_COMPACT)

- `PageDef.access.open: [roleIds]`; default deny once the solution declares `access.roles`; no roles section ⇒ open (adoption posture).
- Enforcement: server filters the Runtime `pages.list` snapshot to openable published versions per `context.user.roles` (upgrades the "client interim" — cheap once roles are in context). Client menu filtering is cosmetic on top.
- Console preview exempt (implementer plane; `read` sees all).

## 7. Auth/RBAC wiring (existing seams)

- Roles resolver lookup 1 `(user, operation) → roleIds`: un-stub against `role_assignments`. Lookup 2 `(user, solution) → implementer level`: un-stub against `implementer_levels`.
- RBAC stage 1 (record types + activities) per RBAC_COMPACT enforcement table: partition filter, get→not-found, run gate. Sequenced M2, unchanged by this spec.
- Env-stub posture preserved: no auth env ⇒ everything open, menus unfiltered.

## 8. API surface (tRPC additions)

- `operations.list / operations.create / operations.putConfig`
- `pages.publish({ path, readme })`, `pages.versions({ path })`
- `pages.list`: published mode (Runtime) vs draft mode (Console)
- Governance: `assignments.list/put`, `implementers.list/put` (admin-gated)
- `@fluxus/client`: `connect(operationId)` snapshot adds operation config (menu) + published page set; Console client keeps the draft set.

## 9. Phasing

1. **M1 — operations tier**: tables, scope→solution/operation rekey, Console operations CRUD, client connect by operation. No behaviour change for the demo op. **BUILT 2026-07-20** — migration `0003_operations_tier`; `solutions`/`operations`; server rekeyed to solutionId/operationId; `@fluxus/client.connect(operationId)` + `ConsoleClient`; seed splits solution config + operation records; Console **Administration** activity → Operations list/create panel. Tests + full build green.
2. **M2 — RBAC stage 1**: governance tables (§2), roles resolver live, record-type + activity enforcement. **BUILT 2026-07-20** — `role_assignments`/`implementer_levels` (migration `0004_governance`); live `runtimeRoles` (`createDbRolesResolver`); record-type read filter (default-deny when auth configured + solution declares `access.roles`; anchor-read gate before the run check); `access.roles`/`access.read` on the engine config; `assignments.*`/`implementers.*` API + `ConsoleClient` methods; Console **Role assignments** + **Implementer levels** panels. Implementer *enforcement* deferred to M5. 8 RBAC tests green.
3. **M3 — publish pipeline**: `page_versions` + readme, Console publish UI, Runtime reads published-only. **BUILT 2026-07-20** — `page_versions` (migration `0005_page_versions`, append-only); `pages.publish`/`versions`/`getVersion`/`rollback` + `pages.list` published mode; `connect({ pages: 'published' })` for Runtime; Console **Publish**/**Versions** control in the page editor (per-page, required readme, rollback = republish); seed publishes demo pages. 5 publish tests green.
4. **M4 — menu + page access**: operation `config.menu` + editor, Runtime nav, server-side `open` filtering. **BUILT 2026-07-20** — menu validation at `operations.putConfig` (published pages + declared roles + one-level nesting); Console **Operation menu** editor; server-side published-`pages.list` filter by `def.access.open` (default-deny when enforced); `me` endpoint + `client.visibleMenu()`; Runtime **MenuNav** (role-filtered, Workbench item) in the sdm workbench. `pages.publishedPaths` (implementer read) for authoring. 7 menu/access tests green.
5. **M5 — implementer plane**: levels wired into `config.put` / save / publish / menu edit / admin surfaces. **BUILT 2026-07-20** — `implementerLevel` reads `implementer_levels` (dormant until declared: no rows ⇒ everyone admin; once declared, unlisted ⇒ denied); `requireImplementer` a no-op when auth unconfigured (env stub open), else ranks none<read<write<admin; write gates config/pages/publish/menu, admin gates operations/governance. The M2 Implementer-levels panel now enforces. 3 implementer tests green.

## 10. Non-goals (MVP)

- Solution publish/upgrade + version pinning per operation (operation always runs latest published pages; seam = future `pinned_version` on operations); catalogue/import; org management UI; page-version diffing; row/field-level permissions (RBAC_COMPACT exclusions); multi-org.

## 11. Decision log

- 2026-07-20 — §2a governance store: **Option B, bespoke org-tier structure** (user ruling; RBAC_DESIGN rev 7).
- 2026-07-20 — menu lives in **operation config**, not solution/SDM; operation→solution FK NOT NULL; solution = SDM + pages + role defs.
- 2026-07-20 — menu items carry **per-item role lists**; **no roles ⇒ no visibility** (deny default).
- 2026-07-20 — menu validates against **published pages only**.
- 2026-07-20 — Runtime keeps the record grid/workbench reachable for now.
- 2026-07-20 — operation-config/menu editing = implementer **write** (admin included).
- 2026-07-20 — doc name `CONSOLE_RUNTIME_SPEC.md` endorsed.
