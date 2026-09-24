# @fluxus/platform — SPEC

Living design truth for the platform plane. First cut ruled and built
2026-08-03.

## 1. Why there is a fourth thing

The ladder before this was org → solution → operation, with the **org admin as
the single root of authority** (RBAC_COMPACT "Administration"). That root is the
root *within* an org, and it leaves two questions with no one to answer them:

- **Who creates an org?** Not an org admin — there is no org to be admin of yet.
- **Who sees across orgs?** Nobody could: every query in the API is scoped to one
  org by construction.

`bootstrapOrgAdmin` (`npm run bootstrap`) was the stopgap for the first
question — a script, outside the request path, writing the first row because
nothing inside the request path was allowed to. That is a tier wearing a
disguise. This package is the tier.

**The plane, named** (endorsed 2026-08-03): the *platform plane*, administered
by *platform admins*, in `@fluxus/platform`. The role slots into the existing
ladder — op admin → org admin → **platform admin** — and needs no new
vocabulary. The package is named for the plane rather than the audience
(`platform-admin` would name the audience), matching apps-named-by-role.

## 2. Who a platform admin is

**An env allowlist, not a table**: `FLUXUS_PLATFORM_ADMINS=a@x.com,b@x.com`, read
by `isPlatformAdmin` in `@fluxus/server`'s `auth.ts`.

A `platform_users` table would recreate one tier up exactly the chicken-and-egg
the bootstrap script exists to escape — who writes the first platform admin? The
env is already outside the request path, which is the only property the first
row of any tier needs. Platform admins are a handful of our own people, so the
audit trail and lifecycle a table would buy has nothing yet to record.

`isPlatformAdmin` is the single seam. Swapping it for a table later touches no
caller.

**This gate does not fall open in demo posture.** Every other check in the
router is open when auth is unconfigured, on the reasoning that with no identity
there is nothing to gate on — but those guard one org's data from that org's own
people. This one guards every org from everyone, and an unconfigured dev machine
must not be one where anyone who can reach the port registers orgs. Unset
allowlist ⇒ nobody, always.

## 3. Registering an org

`platform.registerOrg({ id, name, ownerEmail, ownerName? })` — one act:

1. the `orgs` row, with `owner_email` = the owner, so the org row itself
   answers "whose is this";
2. a `users` row for the owner (`status: 'invited'`) — the organisation's
   **first user**. Nobody invites the owner, because there is nobody there to do
   it, so the act that creates the org creates the person.

They cannot be two steps. After step 1 alone the org admits nobody — including
whoever would perform step 2.

The owner is deliberately **not** appointed an org admin here (rewritten
2026-08-04, see root [USERS.md](../../../docs/USERS.md)): they *appoint* org
admins, and appoint themselves one if they mean to do ordinary org-admin work.
Console access is derived from ownership, which is what makes that first
appointment reachable on an org where nobody holds a grant yet. This is the same
obligation RBAC_COMPACT states for the first admin, discharged in the request
path at last.

**The owner is a real thing on the org row** (`orgs.owner_email`, migration
0016 — superseding the 2026-08-03 ruling that it was merely the org's first
admin). It had to become one: the rule that no tier appoints its own tier leaves
nobody inside the org able to appoint the first org admin, so the root has to sit
above them. `owner_email` is also the org's contact address — a separate
`contact_email` was dropped (migration 0018) as a duplicate born identical to it.

**Transfer and demotion are still unbuilt**, which is why `owner_email` is not
writable through `orgs.putProfile`: editing the org is org-admin work, and an org
admin who could write that column would promote themselves to the root.

**Nothing is emailed** (ruled 2026-08-03). An invite is a database row until a
mail sender exists; the owner is told out of band. The app says so on the form
rather than implying a mail went out.

**Idempotence**: none. A duplicate id is a `CONFLICT`, because registering an
org twice is a mistake, not a retry. (`bootstrapOrgAdmin` is idempotent for the
opposite reason — it is a recovery tool.)

## 4. The org id is the URL

Org ids are `^[a-z0-9][a-z0-9-]*$`, max 63 chars, **permanent**.

Both browser apps read their org from the path — `/o/<orgId>/…` (ruled
2026-08-03, Neon's shape) — so the id has to survive being a URL segment
unescaped. `orgFromPath()` in `@fluxus/client` is the one parser; the URL is the
only place org identity lives client-side. No picker, no localStorage: a link is
a complete address, and two orgs can be open in two tabs without fighting.

- **Console** — `ConsoleClient.create({ orgId })` takes it once at boot and
  carries it into every org-scoped call, so no screen has to remember to pass
  it. Absent ⇒ the server's default org, which is what every existing dev URL
  and every single-org deployment wants.
- **Runtime** — the operation still determines the org (server-side, from
  `operations.org_id`), so the path prefix is *checked*, not trusted: a link
  naming a different org than its operation belongs to fails with a clear
  message rather than silently ignoring half the address.

## 5. What this made real: `org_id` as a boundary

Registering a second org turned the org key from decoration into a boundary, and
exposed holes that were invisible while `'default'` was the only org
(all fixed 2026-08-03, pinned in `test/platform.test.ts`):

- **Operations landed in `'default'` whatever their solution belonged to** —
  `createOperation` never set `org_id`. An operation now **inherits its
  solution's org**: the link is binding and permanent, so a mismatch could never
  be corrected, and one source of truth means no call site can disagree about
  whose operation it is.
- **Six admin gates asked "are you an admin?" without asking "of which org?"** —
  `requireOrgAdmin(ctx)` defaulted to `'default'`, so an admin of the default
  org could create, rename, delete and staff solutions in *anyone's* workspace,
  while the actual owner was refused. Each now names the org being written to,
  resolving it from the solution where the input does not carry it
  (`getSolutionOrg`).

## 6. The Performance screen (BUILT 2026-09-25)

The app's second screen, behind a two-item nav (Organisations · Performance) — no
router, one piece of state. Design: root
[docs/PERFORMANCE_LOGGING.md](../../../docs/PERFORMANCE_LOGGING.md) §8; data from
`perf.*` on the server, all gated by `requirePlatformAdmin` like everything here.
`Performance.tsx`, plain tables and no charts:

- **Switches** — the platform row, then every operation (`PlatformClient.listOperations`),
  each with logging and its three parts. An operation with no row shows `follow
  platform`; the platform row offers on/off only. A change is written through
  immediately and reaches the server within 30 seconds.
- **Time range** — last hour, 24 hours, 7 days — and a Refresh.
- **Slowest things** — per kind and name: count, typical (median), slow end (95th
  percentile), worst. Sortable by any column; defaults to slow end.
- **Page opens** — per page: opens, typical, slow end.
- **Database wake-ups** — `db_connect`: how many, typical, longest.
- **Recent slow actions** — traces over 2 seconds, newest first; a click opens the
  trace's spans as an indented tree (page open → its calls → the server's steps),
  a span whose parent is missing shown at the top rather than lost.

Not tested: the app has no test setup, and nothing here has been driven in a
browser — the server queries behind it are tested, the rendering is not.

## 7. Deliberately not here yet

- **Usage and billing.** They belong to this plane, but usage should fall out of
  the unified log (pipeline-as-log, per-class retention) as a query, not a
  parallel counter table. The performance log is **not** that log — it is timing,
  disposable after 30 days, and not a source for metering. `orgs.plan` records the tier and nothing meters yet.
- **Plan and status writes.** The columns exist and are ours to set, not the
  org's; no screen writes them yet.
- **Solution publishing and entitlement.** Cross-org solution distribution is
  platform-plane work (see root `docs/BLUEPRINT.md`, solution packaging), not
  org-admin work. Nothing built.
- **Suspending an org.** `orgs.status` exists; no path sets it.
