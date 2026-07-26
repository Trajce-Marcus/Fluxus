# Console & Runtime Apps — Master Spec

Status: **rev 5 (2026-07-26) — M1–M9 BUILT; M10 specced (UI phase step 1: Runtime shell + solution default menu).** M9 closes the design-plane data
gap (Console now builds against an operation's records) and gives the SDM config
the version history pages have had since M3. Server 64 tests + full workspace
build green. Living truth lives in the package SPECs (`@fluxus/server`,
`@fluxus/client`, `@fluxus/engine`) per the docs-with-code rule; this doc is the
milestone map + decision log. Browser-smoked end-to-end 2026-07-26: 10-step
Playwright baseline (Console boot → solution open → SDM edit/save → model
publish + versions → menu putConfig → Runtime boot → published page), zero
console errors in both apps. Follow-ups landed same day: config.put blocks
orphaning stored records; workflow binding mandatory in the record-types
editor; "Shared Data Model" labels.

## 0. Scope

- Build out **Console** (design plane: page builder + SDM authoring + admin) and **Runtime** (workbench → end-user app).
- Deliverables: operations tier; auth+RBAC wired into both apps; page publish w/ versioning + readme; per-operation runtime menus; page access control.
- Baseline built: bearer-JWT auth (RBAC_COMPACT), `@fluxus/page-runtime`, pages on config pipeline, prod deploy.

## 1. Entity model (GLOSSARY: org / solution / operation)

- **Solution** = design artifact, the container: SDM config + pages + role defs + **default menu** (M10 — amends "no menus"). No data, users, assignments.
- **Operation** = runtime unit; **links to exactly one solution** (`solution_id` NOT NULL FK). Owns record partition, users, role assignments, files, **operation config** (menu *override* since M10 + future runtime settings).
- Two operations on one solution ⇒ disjoint data/people/menus, shared model + pages.
- Opaque `scope` string splits: design artifacts key on **solutionId**; records + operation config key on **operationId** (endorsed rename of unendorsed "scope").
- Org tier: single implicit org MVP; column present, no org UI.

## 2. Storage (existing Drizzle/Neon pipeline — no new mechanisms)

- `solutions(id, name, created_at)` — MVP row = today's `demo/sdm` bundle.
- `operations(id, org_id, solution_id FK NOT NULL, name, config jsonb, created_at)` — `config` holds the menu (§5); jsonb column, not a table, until a second consumer demands one.
- Rekey: `configs`/`pages` → `solution_id`; `records`/`rpt_*` → `operation_id`. One migration; seed script updated.
- `page_versions(solution_id, path, version int, def jsonb, readme text, published_by, published_at)` — PK `(solution_id, path, version)`; **append-only, immutable** (activity-history posture).
- `sdm_config_versions(solution_id, version int, config jsonb, readme text, published_by, published_at)` — PK `(solution_id, version)`; same posture (M9). The model's change history, now that the database — not the repo files — is the source of truth for a solution.
- Governance (§2a **resolved 2026-07-20: Option B — bespoke org-tier structure**, RBAC_DESIGN rev 7):
  - `role_assignments` keyed `(org, operation, user) → roleIds`.
  - `implementer_levels` keyed `(user, solution) → level`.
  - Plain auth-tier reads (no SDM, no activities); admin CRUD surfaces built by hand in Console. Governance-solution dogfood remains a possible later migration, not a seam obligation.

## 3. Console app

- **Two-level IA (M7)**: the Console is a *workspace* until a solution is opened.
  - **Workspace level** (no solution open) — cross-solution/org admin: Solutions (list/create + operation count; **Open** = design it here), Operations (**Open** = run it in the Runtime app; **Admin** = the operation view, M11), Implementer levels. Activity bar = single **Workspace** item. Since M11 the operation-scoped admin — menu override, role assignments — lives inside the **operation view** (master/detail under Operations), not as separate picker-driven panels; the Operation menu and Role assignments sidebar entries retired.
  - **Solution level** (a solution open) — that solution's design artifacts: **Pages** (the builder), **SDM** (model editor), Components, Search. Activity bar switches to this set; header shows the solution name + **← Solutions** to return.
  - Opening a solution = `engine.openSolution(id, operationId?)` → `FluxusClient.connectSolution({ solutionId, operationId })` → `enterSolutionScope`. The shell subtree is keyed by `scopeVersion` and remounts so every view re-reads the fresh snapshot.
  - **Design data (M9, ruled 2026-07-26)**: the model and draft pages are solution-scoped; the **records come from one of the solution's operations**. Console previously connected with an empty record set, so the SDM editor and page preview showed nothing where the Runtime host showed rows — the platform contradicting itself, and authoring hooks/datasources/list columns blind. The header carries a **Data** picker (the solution's operations, remembered per solution in `fluxus:page-builder:data-operation:<solutionId>`); switching re-opens the solution against that operation and remounts. A solution with no operations still opens, with no records — the exception, not the design. Activities run normally in Console: running one is how you test a workflow.
- Host: current page-builder app grows sections; page editing unchanged (drafts = `pages` table).
- **The two Opens follow the two planes** (ruled 2026-07-26). **Solutions → Open** enters the **Console** design scope: author the model and pages, no operation required (authoring is never gated on data — a new solution opens with none, and the header Data picker fills in once operations exist). **Operations → Open** launches the **Runtime app** on that operation, in a new tab: `${VITE_FLUXUS_RUNTIME_URL}/?operation=<id>` (localhost:5173 in dev). One list is "what am I building", the other is "what is running".
- **Operations admin** (workspace level): list/create operations (name + solution) + the Runtime Open above; user→role assignments UI; implementer levels UI (both over §2 governance tables).
- **SDM editor** (solution level, M7): model authoring — record types (+ custom fields, workflow binding, RBAC read surface), the attribute pool (key/label/type + fk/list/multi/multiline config), workflows + their activities, and role defs. Plain forms over `config.get`/`config.put`; a save persists the whole config, reloads the solution to rebuild the model, and remounts. **Workflows editor** (M8, slice 2, lean): `WorkflowsEditor` under the `sdm/workflows` tab — workflows (id/name/description) with activities nested; per-activity id/name/description/sort_order/record_map/show_condition plus a lean attribute-usage composer (pick pool attribute, toggle required, insert section headings, reorder) and before/after hooks. FluxScript is edited as plain textareas (no DSL tooling yet); per-usage overrides (show_condition/validation/can_waive) and the FunctionDef/seed collections stay hand-edited — deferred.
- **Publish flow**: per-page action → dialog requiring **readme** (release notes, md) → `pages.publish` snapshots the draft def into `page_versions` at `max(version)+1`. Rollback = republish an older version's def as a new version — never delete/edit.
- **Model publish (M9)**: the same surface for the SDM — a toolbar above every SDM section → `config.publish` snapshots the solution's config into `sdm_config_versions`, readme required. One difference from pages: `config.rollback` republishes an older version **and restores it as the draft**, because the config draft is what every host evaluates against (a page draft is the builder's working copy, so it is left alone).
- **Menu editor**: edits the operation's `config.menu` (§5); requires implementer `write` (admin included) — ruled 2026-07-20.
- **Versions view**: per-page version list w/ readme. Diffing = non-goal.
- Gating (RBAC stage 2): `config.put` / page save / publish / menu edit require implementer `write`; role-assignment + implementer-level admin require `admin`. Until then: stub-open per env posture.

## 4. Runtime app

- Host: SDM workbench evolves in place.
- Boot: sign-in (built) → operation resolution (single membership auto-selects; picker if >1; MVP: single hardcoded op acceptable) → `connect(operationId)`.
- Renders **published page versions only** (latest per path); drafts never leave Console. Console preview keeps rendering drafts via embedded page-runtime.
- Nav = operation menu (§5), role-filtered.
- **Record grid / record view stay reachable for now** (ruled 2026-07-20) — a menu-addressable "Workbench" item, no longer the default surface. Longer term the workbench is a **platform-supplied component set** (`RecordGrid`/`RecordView` as page-runtime components; direction 2026-07-26) — decomposition deferred (§10); meanwhile nothing may couple it harder to the shell.
- Solution branding, not platform branding (cosmetic MVP). M10 cut: the header shows the **solution name** as the product name and the **operation name** as context (both from the connect snapshot — no branding config yet; logo/colours deferred, §10).
- **Shell (M10)**: standard app-shell chrome — top bar (solution name, operation name, signed-in user menu w/ sign-out, UAT toggle + notification bell retained), collapsible left nav, content area. Nav is the effective menu (§5) with the Workbench item; when a menu is effective the record-type and pages sidebar listings retire from the nav (record types show inside the Workbench surface only; the pages listing remains solely as the **no-menu fallback**, so an unconfigured demo operation is unchanged — adoption posture). Plain CSS; no component-library dependency without a ruling.

## 5. Menu (amended 2026-07-26: **defined solution-side, overridable operation-side**; original 2026-07-20 ruling was operation-side only)

- The solution's config artifact carries a top-level **`default_menu`** (key name pending endorsement) in the §5 shape below — versioned/published with the model via `sdm_config_versions`, so a prebuilt solution ships working menus. The engine stays menu-blind (`config.put` is `z.unknown()`; `validateConfig` ignores the key); the server validates it with the same §5 rules at `config.put`, roles read from the **incoming** config.
- `operations.config.menu` becomes the **override**: key absent ⇒ inherit the solution default; present ⇒ **whole-menu replacement** (`[]` = explicitly empty). Per-item merge is ruled out — that is where diff semantics and upgrade pain live. Effective menu = `operation.config.menu ?? solution.default_menu ?? []`, resolved at client connect.
- Role-filtering, deny-default, §5 validation, `visibleMenu()` are unchanged and run on whichever menu is effective.

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
6. **M6 — Solutions admin tools**: `solutions.create`, Console **Solutions** panel (list/create), first slice of the still-undesigned Solutions/workspace IA layer above operations. **BUILT 2026-07-20** — `host.createSolution` (plain insert, duplicate id → db unique-constraint error, no implementer gate pre-creation); `solutions.create` mutation; `ConsoleClient.createSolution`; `SolutionsAdmin.tsx` (mirrors `OperationsAdmin`); `ADMIN_TAB.solutions` / `admin/solutions`, listed above Operations in `AdminSidebar`. No implementer/RBAC gate yet — same stub-open posture as the rest of Console admin pre-stage-2.
7. **M7 — Solution admin (two-level IA + SDM editor)**: open a solution, author its pages + model in scope. **BUILT 2026-07-20** — `FluxusClient.connectSolution(solutionId)` (design plane: config + draft pages, no operation) + `saveConfig`; `engine.openSolution/reloadSolution` re-scope the design singletons; shell store `solutionId`/`scopeVersion` + `enterSolutionScope`/`exitSolutionScope`; two-level activity bar (Workspace vs Pages/SDM/Components/Search); `SolutionsAdmin` **Open** action; `HeaderBar` solution banner + back; Console boots to the Solutions list (no hardcoded operation). **SDM editor** (`sdm-builder/`): `SdmSidebar` + `SdmView` routing `sdm/record-types|attributes|roles`; `RecordTypesEditor` / `AttributesEditor` / `RolesEditor` over `commitConfig`. Page builder now mounts as a solution-level activity. Slice 1 only — workflow/activity/hook authoring deferred. tsc + vite build green; browser-smoked 2026-07-26.
8. **M8 — Workflows editor (SDM slice 2, lean)**: author workflows + activities in scope. **BUILT 2026-07-21** — `WorkflowsEditor` (`sdm-builder/`) under new `SDM_TAB.workflows` / `sdm/workflows`; sidebar **Workflows** entry between Attributes and Roles; `SdmView` routes it. Three-level master/detail over `commitConfig`: workflows (id/name/description) → nested activities list → activity editor (id/name/description/sort_order/`record_map` select/`show_condition`) with a lean attribute-usage composer (pool-attribute picker + required toggle + section markers + reorder) and before/after-hook textareas. FluxScript stays plain text (no DSL tooling); per-usage FluxScript overrides + FunctionDef/seed collections stay hand-edited. tsc + vite build green; browser-smoked 2026-07-26.

9. **M9 — design data + model history**: Console builds against real records; the SDM config gets page-style versioning; the repo files stop being a source of truth. **BUILT 2026-07-26** — `sdm_config_versions` (migration `0006_sdm_config_versions`, append-only); `config.publish`/`versions`/`rollback` (readme required, rollback also restores the draft); `FluxusClient.connectSolution({ solutionId, operationId })` now fetches that operation's records + `operationsForSolution` + `publishConfig`/`configVersions`/`rollbackConfig`; `engine.openSolution(solutionId, operationId?)` resolves and remembers the data operation; shell store `dataOperationId`/`dataOperations`; `HeaderBar` **Data** picker; `ConfigPublishControl` in a new SDM toolbar. Seed script demoted to **bootstrap-only** (skip-if-present, `--force` to overwrite from files). 5 config-publish tests green (64 server tests total); vite build green; browser-smoked 2026-07-26.

10. **M10 — Runtime shell + solution default menu (UI phase step 1)**: **BUILT 2026-07-26** (`default_menu` key endorsed) — server `config.put` default_menu validation (`validateOperationMenu` + `rolesFrom`), `operations.get` + connect snapshot carry solution/operation names; client resolves the effective menu and exposes the names; Runtime shell (collapsible nav, solution-branding header, user menu w/ sign-out, Workbench-scoped record-type list, pages listing as no-menu fallback); Console `MenuEditor` (SDM section, shared `MenuItemsEditor`) + `MenuAdmin` inherit/override posture (+ `ConsoleClient.getSolutionConfig`). 69 server tests green (5 new); both apps tsc + vite build green. Spec as below:
   - **Server**: `config.put` validates a top-level `default_menu` in the artifact via the §5 validator (published pages + one-level nesting; roles from the incoming config — `validateOperationMenu` gains a roles-override param rather than a twin). `connect` snapshot adds solution + operation display names (header). `operations.putConfig` unchanged — absent `menu` ⇒ inherit, `[]` ⇒ explicit empty.
   - **Client**: effective menu resolved at connect (`operation.config.menu ?? config.default_menu ?? []`, today's `op.config.menu` read); `visibleMenu()` untouched. Exposes solution/operation names.
   - **Engine**: untouched (menu-blind by construction).
   - **Runtime app**: §4 shell — top bar, collapsible nav, MenuNav as primary nav, record-type list scoped to the Workbench surface, pages listing as no-menu fallback only. Plain CSS.
   - **Console**: SDM section gains a **Menu** entry editing `default_menu` through `commitConfig` (reusing the MenuAdmin item composer); the operation **Menu editor** gains inherit/override posture — inheriting shows the default read-only + **Override** (copies default into the editor); overriding shows **Revert to inherit** (removes the key).
   - **Tests**: extend `menu.test.ts` — `default_menu` validated at `config.put`; inherit fallback; override wins; `[]` override yields empty.
   - **Acceptance**: Playwright — Runtime boots showing solution/operation names in the header; a solution-default menu renders role-filtered with no operation override; setting an override replaces it; demo op without any menu keeps today's fallback nav.

11. **M11 — Console operation view (UI phase step 2)**: **BUILT 2026-07-26.** The org-home regroup — operation-scoped admin consolidates into a detail view. `OperationsAdmin` becomes master/detail: the list keeps **Open** (Runtime) and create; selecting an operation opens its view — **Overview** (name, id, linked solution, Open in Runtime), **Menu** (the M10 inherit/override editor, scoped — `OperationMenuSection`), **Role assignments** (scoped — `AssignmentsSection`). The standalone `MenuAdmin`/`AssignmentsAdmin` panels and their sidebar entries (`admin/menu`, `admin/assignments`) are deleted; no operation pickers remain. Workspace sidebar: Solutions, Operations, Implementer levels.

12. **M12 — solution provenance (UI phase step 3)**: **BUILT 2026-07-26** (`origin`/`origin_ref` endorsed) — migration `0007_solution_provenance`, `solutions.list` + `ConsoleClient` carry `origin`, SolutionsAdmin Origin column. 69 server tests green. The packaging seam (decision log 2026-07-26: solutions are packages, extension/composition via dependency, entitlement not DRM) made honest in schema, and nothing more:
   - `solutions` gains **`origin`** (`text NOT NULL DEFAULT 'authored'`; values `'authored'` | `'installed'`) and **`origin_ref`** (`text`, null unless installed — an opaque ref to the source catalogue item/version, e.g. `catalogue:<solutionId>@<version>`, shape firmed up when the Catalogue exists). Version lineage of *authored* work is already `sdm_config_versions`/`page_versions`; `origin_ref` is the lineage of *installed* work.
   - Migration `0007_solution_provenance`; seed rows default `'authored'`.
   - `solutions.list` returns `origin`; `SolutionsAdmin` shows it as a badge. **No install path, no fork/copy affordance** — `'installed'` is unreachable from the UI until the Catalogue lands; the column exists so nothing built meanwhile can assume all solutions are locally authored.
   - No entitlement table yet (reserved concept; nothing enforces it until a second party exists).

## 10. Non-goals (MVP)

- Solution publish/upgrade + version pinning per operation (operation always runs latest published pages; seam = future `pinned_version` on operations); catalogue/import; org management UI; page-version diffing; row/field-level permissions (RBAC_COMPACT exclusions); multi-org.
- M10 deferrals: header operation **switcher** (boot stays `?operation=` / default); branding beyond names (logo, colours); per-item menu merge (ruled out, not deferred); workbench decomposition into page-runtime components; component-library adoption (needs a dependency ruling).

## 11. Decision log

- 2026-07-20 — §2a governance store: **Option B, bespoke org-tier structure** (user ruling; RBAC_DESIGN rev 7).
- 2026-07-20 — menu lives in **operation config**, not solution/SDM; operation→solution FK NOT NULL; solution = SDM + pages + role defs.
- 2026-07-20 — menu items carry **per-item role lists**; **no roles ⇒ no visibility** (deny default).
- 2026-07-20 — menu validates against **published pages only**.
- 2026-07-20 — Runtime keeps the record grid/workbench reachable for now.
- 2026-07-20 — operation-config/menu editing = implementer **write** (admin included).
- 2026-07-20 — doc name `CONSOLE_RUNTIME_SPEC.md` endorsed.
- 2026-07-26 — **Console builds against an operation's records.** A solution has no data by definition, but authoring a model or a page without data is guesswork, and two of our own apps disagreeing about what exists is a product defect. No new mechanism: the existing operation→solution link supplies the list, the user picks. No schema change.
- 2026-07-26 — **The database is the source of truth for solutions** (config + pages); git carries code and migrations. The repo's `sdm/config/` + `page-builder/pages/` files are a **bootstrap fixture** for an empty database (fresh clone, fresh Neon branch, PGlite, CI), never authority. The seed script no longer overwrites live content.
- 2026-07-26 — **The two Opens follow the two planes** (user ruling, settled after two wrong turns by Claude). Solutions → Open = **open the Console** on that solution (authoring never requires an operation). Operations → Open = **open the app** — launches the Runtime host at `?operation=<id>`. Solutions also shows each solution's operation count.
- 2026-07-26 — **SDM config gets page-style versioning** rather than relying on git for model history: history belongs beside the artifact. Same append-only posture; a later solution-level publish bundles config version + page versions into one release (§10).
- 2026-07-26 — **Menu placement amended** (UI-phase direction session): *defined solution-side* (`default_menu` in the config artifact, versioned with the model — prebuilt solutions ship working menus), *overridable operation-side* (whole-menu replacement; absent = inherit). Per-item merge ruled out. Amends the 2026-07-20 operation-side-only ruling; all M4 machinery survives on the effective menu.
- 2026-07-26 — **Workbench = platform-supplied component set**, not a solution artifact: stays the special menu item now; later decomposes into `RecordGrid`/`RecordView` page-runtime components (the out-of-the-box workbench becomes the default page composition). Deferred until a solution wants a grid inside a page.
- 2026-07-26 — **Solutions are packages; extension and composition are one mechanism** — a thin org solution *depending on* base package(s), adding glue (FKs, menu, activities). Never copy; **operation → exactly one solution stays locked** (composition is design-plane only). Copy protection = runtime entitlement, not DRM. Known hazard: cross-package id collisions → future package-qualified ids; no feature may assume ids globally unique across solutions. Direction only — nothing built until a second party exists.
