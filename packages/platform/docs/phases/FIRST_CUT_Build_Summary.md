# Platform plane — first cut (2026-08-03)

Point-in-time snapshot. Append-only; not edited after the phase closed.

## What prompted it

A question about `npm run bootstrap` failing (it was only a script in
`@fluxus/server`, missing at the repo root) turned into the observation that the
script is a tier in disguise: something outside the request path, writing the
first org admin because nothing inside the request path was permitted to. That
is the shape of a missing tier, not a missing feature.

Scope was then set explicitly: **bare bones** — org list, register an org with
its owner, owner invites the rest from the Console. No usage, no billing.

## Rulings

1. **The tier is named the platform plane; its role is platform admin.** Slots
   into the ladder as op admin → org admin → platform admin, so no new
   vocabulary. The package is `@fluxus/platform` — named for the plane, not the
   audience (`platform-admin` would name the audience), matching
   apps-named-by-role. "Admin" alone was rejected: it is already spent on org
   admin, op admin and the Console's own Administration section.
2. **A separate app, not a Console section.** The Console is scoped to one org
   by construction; folding cross-org data into it ships tenant-spanning code in
   every customer-facing deploy.
3. **Platform admins are an env allowlist** (`FLUXUS_PLATFORM_ADMINS`), not a
   table — a `platform_users` table recreates one tier up exactly the
   chicken-and-egg the bootstrap script exists to escape. `isPlatformAdmin` is
   the seam for a table later.
4. **That gate does not fall open in demo posture**, unlike every other check in
   the router: those guard one org's data from its own people, this guards every
   org from everyone.
5. **The org owner is not a new level** — the org's first `org_users` admin,
   also written to `orgs.contact_email`. A distinct `owner` value would need
   transfer and demotion rules nothing needs yet.
6. **Nothing is emailed.** There is no mail sender in the repo; an invite is a
   database row. The owner is told out of band, and the form says so rather than
   implying a mail went out.
7. **The org lives in the URL** — `/o/<orgId>/…`, Neon's shape. The only place
   org identity lives client-side: no picker, no localStorage, so a link is a
   complete address. This replaced the `users.me` membership-resolution approach
   that was on the table: if the URL names the org, the existing
   `requireOrgAdmin(ctx, orgId)` already verifies the caller belongs to it.

## Built

**`@fluxus/server`** — `isPlatformAdmin`/`platformAdmins` in `auth.ts`;
`requirePlatformAdmin` beside the other three gates; `platform.listOrgs` +
`platform.registerOrg`; host `listOrgs`, `registerOrg`, `getSolutionOrg`,
`OrgExistsError` → `CONFLICT`. **No schema change** — `orgs` and `org_users`
already carried everything.

**`@fluxus/client`** — `PlatformClient` (its own class: the one client not
scoped to an org, so no Console screen can reach a cross-org call by accident);
`orgFromPath()`; `ConsoleClient.create({ orgId })` carrying the session org into
every org-scoped call; `FluxusClient.orgId` exposed.

**`@fluxus/platform`** — new Vite app on port 5175: sign-in gate (sign-in only —
no sign-up link, since an account created here would land outside the
allowlist), org table with a Console link per row, register form.

**`@fluxus/console` / `@fluxus/runtime`** — Console reads its org from the URL at
boot. Runtime *checks* the prefix against `client.orgId` rather than trusting it:
the operation determines the org server-side, and a link naming a different one
fails loudly instead of half-applying.

## What registering org #2 exposed

The org key had been decoration while `'default'` was the only org. Two real
defects, both fixed here and pinned in `test/platform.test.ts`:

- **`createOperation` never set `org_id`.** Every operation landed in
  `'default'` whatever its solution belonged to. Operations now inherit the
  solution's org — the link is binding and permanent, so a mismatch could never
  have been corrected afterwards.
- **Six `requireOrgAdmin(ctx)` call sites defaulted to `'default'`**
  (`solutions.create/update/delete`, `operations.create`, `solUsers.*`). An admin
  of the default org could create, rename, delete and staff solutions in
  anyone's workspace, while the org's actual admin was refused. Each now names
  the org being written to, resolved via `getSolutionOrg` where the input does
  not carry it.

## Verification

14 new server tests (136 total, green): the gate refuses ordinary users, org
admins and demo posture; register creates org + owner as one act; the owner can
immediately administer their own org and nothing else; duplicate ids conflict;
non-slug ids are refused; the three org-boundary cases above. `tsc` clean across
all packages; `npm run build` green including the new app. **Not
browser-smoked** — left to the user.

## Not built, deliberately

Usage and billing (usage should fall out of the unified log as a query, not a
counter table), plan/status writes, org suspension, cross-org solution
entitlement, invite email.
