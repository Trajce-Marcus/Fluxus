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

1. the `orgs` row, with `contact_email` = the owner, so the org row itself
   answers "whose is this";
2. an `org_users` row for the owner: `level: 'admin'`, `status: 'invited'`.

They cannot be two steps. After step 1 alone the org admits nobody — including
whoever would perform step 2. This is the same obligation RBAC_COMPACT states
for the first admin, discharged in the request path at last.

**The owner is not a new level** (ruled 2026-08-03). "Owner" is the org's first
`org_users` admin, and their authority is fully expressed by the level that
already exists. A distinct `owner` value would need transfer rules, deletion
rules, and an answer to whether an owner can be demoted — real questions this
tier does not need answered yet. Revisit when billing gives "owner" a meaning
"first admin" cannot carry.

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

## 6. Deliberately not here yet

- **Usage and billing.** They belong to this plane, but usage should fall out of
  the unified log (pipeline-as-log, per-class retention) as a query, not a
  parallel counter table. `orgs.plan` records the tier and nothing meters yet.
- **Plan and status writes.** The columns exist and are ours to set, not the
  org's; no screen writes them yet.
- **Solution publishing and entitlement.** Cross-org solution distribution is
  platform-plane work (see root `docs/BLUEPRINT.md`, solution packaging), not
  org-admin work. Nothing built.
- **Suspending an org.** `orgs.status` exists; no path sets it.
