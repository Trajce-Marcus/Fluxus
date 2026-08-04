# Users, admins and roles — build summary (2026-08-04)

Point-in-time snapshot. Append-only; not edited after the phase closed.

## What shipped

The users model rewritten from *three membership tables with `level` columns* to
**one population of people, then grants** — and the Console screens that make it
usable, which is what the phase was for. Design: root [USERS.md](../../../../docs/USERS.md).
Technical truth: [RBAC_COMPACT.md](../../../../docs/RBAC_COMPACT.md).

## Migration 0016

| Was | Is |
|---|---|
| `org_users` with `level` | `users` (identity only) + `org_admins` |
| `op_users` with `level` | `op_users` (entry only) + `op_admins` |
| `sol_users` with `read`/`write` | `sol_admins` — one grade; `read` rows dropped |
| owner = the first org admin, remembered as `contact_email` | `orgs.owner_email`, a real root |

Data preserved by **promotion**, not guesswork: an `admin` level becomes a row in
the matching admin table. An `op_users` row is dropped when its holder is
promoted, because an admin row implies entry and keeping both would record the
same fact twice. Orphan grants — rows naming somebody not in the pool — are
deleted, so invite-then-appoint is enforced rather than assumed.

## Code shape

The user surface left `host.ts` and `router.ts` and became its own three layers:

- **`src/users/`** — the store, one module per tier: `pool`, `org-admins`,
  `sol-admins`, `op-admins`, `op-users`, `roles`, `bootstrap`, `types`.
  `host.ts` re-exports it, so callers keep one import.
- **`src/gates.ts`** — the request checks: `requireOrgOwner`, `requireOrgAdmin`,
  `requireOpAdmin`, `requireSolAdmin`, `requireOpUser`, `requirePlatformAdmin`,
  plus `hasConsoleAccess`.
- **`src/routers/users.ts`** — one router per list (`users`, `orgAdmins`,
  `solAdmins`, `opAdmins`, `opUsers`, `userRoles`). Read the gate on each
  procedure and the model reads back out of it.
- **`src/trpc.ts`** — the context, builder, shared input schemas and `rethrow`,
  extracted so the user routers and `router.ts` need not import each other.

## The rules this phase settled

- **Authority has one root — the owner — and flows downward only.** The owner
  appoints org admins and nothing else, and is **not** implicitly one: the root
  delegates, it does not do the work.
- **Registering an org creates the owner as its first user.** Nobody invites the
  owner, because there is nobody there to do it.
- **Console access is derived** — owner, org admin, or sol admin of anything.
  The owner's derivation is what makes the first appointment reachable on an org
  where nobody holds a grant.
- **Invite grants nothing anywhere.** It appears on all three Users screens
  because the act is the same one each time; every appointment is separate.
- **Whoever may appoint may also invite**; sol admins never do.
- **An admin row implies entry** — the gate reads `op_users` OR `op_admins`.
- **Suspension bites every tier**, because lifecycle lives on the pool row and
  every `is*Admin` check re-reads it.

## Verification

Server suite green: **147 tests**, 10 files. `admintiers.test.ts` was rewritten
around the owner tier and the "no tier appoints its own tier" rule;
`solusers.test.ts` became `soladmins.test.ts` (one grade); `opusers.test.ts`
gained the admin-implies-entry and strip-every-grant cases. Every package
typechecks and the monorepo builds.

## Amended the same day — expiry replaces removal (migration 0017)

Asked what happens to a removed person's records. Answer: nothing cascades —
history, the activity projection and the publish trails are append-only and carry
no foreign keys — **but** deleting the row deleted the only thing that could name
the actor, since `author` is an auth id and `users.auth_user_id` is the only
bridge to a name.

So `users.status` gained **`expired`**, the row gained **`expired_at`**, and hard
delete was removed rather than kept beside it:

- **suspended** — reversible pause, every grant survives.
- **expired** — terminal, every grant dropped, the row kept forever.
- **unexpire** — back as a plain member with nothing; appointed again from
  scratch.

`bindAuthUser` will not resurrect an expired row (a live session must not undo an
administrator's decision) and `setUserStatus` refuses `expired` (dropping grants
is not something a status write may do silently). Six more tests; **152 green**.

## Left undone, deliberately

- **Nothing joins a person to the operations they belong to.** The pool lists
  people, each operation lists its own, and no procedure returns the join. First
  thing to add if the pool screen feels blind.
- **Owner transfer** and managing platform admins beyond the env allowlist.
  Neither blocks anything.
- **`author` is an auth id, not an email** — every user table moved to email in
  migrations 0012/0015 and this one did not. Fixing it would let authorship join
  the pool directly, but it means rewriting existing history entries. Its own
  decision; expiry does not depend on it.
- Prod still needs migrations 0008–0017 applied plus `npm run bootstrap`.
