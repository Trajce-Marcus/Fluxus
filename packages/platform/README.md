# @fluxus/platform

The **platform plane** — the vendor's app, above every organisation. Registers
orgs and their owners; in time it is also where usage, billing and solution
entitlement live.

Distinct from the other two apps by audience: `@fluxus/console` is the design
plane an org builds in, `@fluxus/runtime` is what that org's people sign into,
and this is ours. It is a separate app rather than a Console section so that no
customer-facing deploy ships the code that can read across tenants.

**Status: first cut (2026-08-03), plus the Performance screen (2026-09-25).**
Three things work — list every org, register one with its owner, and read the
platform's own timing (switches, slowest things, page opens, database wake-ups,
slow actions). Nothing else is stubbed in: usage and billing wait on the unified
log rather than growing a counter table early.

## Run

```bash
npm run dev:platform          # http://localhost:5175 (server on :8787)
```

Two env vars, both required — this app has **no demo posture**, and says so on
screen when either is missing:

```bash
# packages/server/.env — who may use the platform plane at all
FLUXUS_PLATFORM_ADMINS=you@example.com,someone@example.com

# packages/platform/.env.local — so the app can sign you in and send a token
VITE_NEON_AUTH_URL=<your Neon Auth URL>
```

Unset ⇒ nobody is a platform admin, including in demo posture. This is the one
gate that does not fall open when auth is unconfigured — every other check
guards one org's data from its own people, while this one guards every org from
everyone.

## What registering an org does

Creating an org and creating its first admin are **one act**: an org whose owner
is a second step is an org nobody can enter. So `registerOrg` writes the org
row, records the owner as `orgs.contact_email`, and makes them an `org_users`
admin with status `invited`. They sign in, the auth id binds, and they invite
the rest from the Console.

**No mail is sent** — an invite is a database row and nothing more until a mail
sender exists. Tell the owner out of band.

This is what retires `npm run bootstrap` for every org but the first.

See [docs/SPEC.md](docs/SPEC.md) for the design, and root
[docs/RBAC_COMPACT.md](../../docs/RBAC_COMPACT.md) for the tiers below it.
