# Users, admins and roles

**Agreed and BUILT 2026-08-04** — migration 0016, `packages/server/src/users/`,
and the Console screens in `packages/console/src/platform-components/users/`.
§6 records what changed from the 2026-08-02 shape it replaced.
[RBAC_COMPACT.md](RBAC_COMPACT.md) is the technical source of truth and has been
rewritten onto this model; build notes are in each package's `docs/phases/`.

---

## 1. The shape in a paragraph

There is **one population of people** — the organisation's users. Being one of
them grants nothing. Everything else is a grant laid on top, and there are only
two kinds: **administration** (who may administer what) and **roles** (what a
person may do inside one operation). Users, admins and roles are three
independent layers and never merge.

## 2. One user list

```text
users
-----
org, email, name, auth id, status
```

One row per person per organisation. It answers *who is this person* and nothing
else — no level, no authority, no access.

- **Email is the key.** Someone can be invited before they have an account; the
  auth id binds on first sign-in and flips *invited* → *active*.
- **Invite only, no signup.** Replaced later by a directory integration; the
  email key is what makes that swap cheap.
- **Lifecycle is here**, so it bites everywhere at once. Two ways to end
  someone's access, and the difference is what survives:
  - **suspended** — a reversible pause. Every grant survives, so reinstating is
    one act; meanwhile they are no admin anywhere and enter nothing.
  - **expired** — the end of the relationship. Every grant is dropped, and
    `expired_at` records when. Unexpiring brings the person back as a plain
    member with **nothing**; they are appointed again from scratch.
- **Nobody is ever deleted** (2026-08-04). Deleting a person deleted nothing they
  had *done* — record history, the activity projection and the publish trails are
  append-only and carry no foreign keys — but it deleted the only row that could
  say who they *were*: `author` on a history entry is an auth id, and
  `users.auth_user_id` is the only bridge from that id to a name. An append-only
  audit trail that quietly stops being readable is not one. So expiry replaced
  removal outright rather than joining it: two terminal paths, one of which
  silently damages the trail, is a choice nobody should have to make correctly
  under pressure.

## 3. Administration

Authority has a single root — the **org owner** — and is delegated downward. No
administrator appoints another administrator at their own level.

```text
platform admin              (ours: env allowlist, outside every org)
      │  registers the org and names its owner
      ▼
org owner                   (one per org; not an admin, but may appoint itself one)
      │  appoints
      ▼
org admins ──────────┬──────────────┐
                     │              │
      creates solutions +      creates operations +
        their sol admins         their op admins
                     ▼              ▼
                sol admins      op admins
                (build it)      (run it: adds users, assigns roles)
```

| Actor | May | May not |
|---|---|---|
| **Platform admin** | Register an organisation and name its owner. | Anything inside an org. Not implicitly anything within one. |
| **Org owner** | Appoint and remove org admins — and read that list, invite, and nothing more. | Nothing else *as owner* — the owner is a root, not a super-admin. Ordinary org-admin work, including browsing the people, needs the self-appointment. |
| **Org admin** | Invite users, suspend and remove them. Create solutions and appoint their sol admins. Create operations and appoint their op admins. | Appoint another org admin. Add ordinary users to an operation, or assign roles — both belong to the op admin. |
| **Sol admin** | Build the solution: model, pages, default menu. | Appoint anyone, including another sol admin. Invite. See or govern any user list. |
| **Op admin** | Invite users. Add them to *their* operation and assign their roles. Set that operation's menu override. | Appoint another op admin. Reach outside their operation. |
| **Op user** | Enter the operation, and see what their roles allow. | Everything above. |

**Inviting and appointing are two steps.** Inviting puts a person in the user
list and grants them nothing; appointing them references a user who is already
there. So making someone a sol admin is: invite them (they exist), then make them
an admin of that solution (they can build it). A user with no grants yet is a
normal, expected state — someone invited and not yet placed.

**Who may invite follows who may appoint.** Op admins invite (they place people
in their operation), org admins invite (they appoint sol admins and op admins),
and the owner invites (they appoint org admins). **Sol admins do not**: a person
is needed either *for an operation* or *to build another solution*, and neither
appointment is theirs to make, so neither is the invitation.

Lifecycle — suspend and expire — stays with the org admin: it is org-wide, and
it is the one user-facing act that is not a side effect of a grant.

**An admin row implies entry.** An op admin can open the operation they
administer without a separate op-user row — an administrator who cannot open the
thing they administer would be nonsense.

**Administrative authority is never an ordinary role.** Admins are recorded in
their own lists; roles are business permissions inside one operation. Neither can
turn into the other by accident.

### The pattern this is, by name

There is no settled industry name for "no administrator appoints another at
their own level". The nearest formal treatment is **administrative RBAC**
(ARBAC97, Sandhu et al.) and in particular Crampton & Loizou's **administrative
scope** — an administrator may only administer what is strictly below them in
the hierarchy, which is exactly this. Informally it is **separation of duties**
plus **no privilege self-propagation** (the concern AWS permission boundaries
exist to address).

Worth stating plainly: **most SaaS does not do this** — admins appointing admins
is the norm. The trade we are making is that every tier depends on the tier above
still existing, which is precisely why the platform tier sits above the owner and
why `npm run bootstrap` is kept as recovery.

## 4. Roles

Roles answer *what may this person do inside this operation* — dispatcher,
finance, warehouse. They are declared by the solution and assigned per operation
by its op admin.

The two operation-level gates stay independent, deliberately:

- A user in the operation with **no roles** enters and sees nothing. Valid.
- Roles **without** being in the operation grant nothing at all.

## 5. Tables

Every table answers exactly one question. There are no `level` columns.

| Table | Question | Key |
|---|---|---|
| `users` | Who is this person? | org + email |
| `org_admins` | Who administers the organisation? | org + email |
| `sol_admins` | Who builds this solution? | solution + email |
| `op_users` | Who may enter this operation? | operation + email |
| `op_admins` | Who administers this operation? | operation + email |
| `user_roles` | What may they do inside it? | operation + email |

The owner is recorded on the organisation row.

**Every grant table is keyed `(target, person)` — the row *is* the assignment.**
There is no "create a sol admin" step followed by an "assign them to a solution"
step: appointing someone admin of *Logistics* writes one row naming both. The
same person can be sol admin of two solutions, op admin of a third operation and
an ordinary user in a fourth, with no notion of a "sol admin account" existing
anywhere. This is what *one population, then grants* means in the schema, and it
repeats identically at every level.

*Built as proposed (migration 0016):* `users`, `org_admins`, `sol_admins`,
`op_admins`, plus **`orgs.owner_email`**, seeded from `contact_email`.
`contact_email` was then **dropped** (migration 0018): registration set both to
the same address, so they were born identical and only ever drifted, and nothing
read the contact for behaviour. The owner is the org's contact address until
billing exists to give a separate one a meaning. Names remain open per §10.

### Expiry, not deletion (2026-08-04, migration 0017)

`users.status` gains **`expired`** and the row gains **`expired_at`**. `remove`
is gone from the API and the store; `expire` and `unexpire` replace it. Signing
in does **not** resurrect an expired person — a live session must not undo an
administrator's decision — and suspension is refused on one, because there is
nothing to pause.

Still open, deliberately: `author` on a history entry is the **auth id** while
every user table is keyed on **email**. Every other table moved to email in
migrations 0012/0015; this one did not. Fixing it would let authorship join the
pool directly, but it means rewriting existing history entries — its own
decision, and expiry does not depend on it.

## 6. What changes from what is built

| Built today | Becomes |
|---|---|
| `org_users` with `level` | `users` (no level) + `org_admins` |
| `sol_users` with `read`/`write` | `sol_admins` — **one grade**; the `read` viewer grade is dropped |
| `op_users` with `level` | `op_users` (entry only) + `op_admins` |
| `user_roles` | unchanged |
| Org owner is not a level — the first org admin, remembered as `orgs.contact_email` | Owner is a real thing on the org row, and is **not** implicitly an org admin |
| Org admin adds op users and appoints op admins | Org admin appoints **op admins only**; ordinary users are the op admin's to add |
| Only org admins invite | Op admins, org admins and the owner invite — whoever may appoint may also invite. Sol admins never invite. Invitation stays a separate step from appointment. |
| `platform.registerOrg` writes org + first org admin | Writes org + **owner** + the owner's `users` row — the organisation's first user |

Console consequences: the Organisation → Users screen loses its per-row
*Org admin* toggle (that becomes an org-admins list, appointed by the owner) and
the operation's *Op admin* checkbox moves to the org admin's operation-creation
path. The op users table and its add-user dialog survive as they are.

### The screens this implies

**Agreed 2026-08-04.** One pattern, repeated at every tier: a Users screen shows
the tier above it **read-only**, the list it governs **editable**, and an
**Invite** button. Invite only ever adds a person to the organisation's user list
— it carries no admin connotation anywhere it appears; every appointment is made
in the list it belongs to.

| Screen | Tabs | Editable by |
|---|---|---|
| **Organisation → Users** | *All users* (suspend, reinstate, remove) · *Org admins* · *Sol admins*, by solution | org admin; the *Org admins* tab, the owner alone |
| **Solution → Users** | *Sol admins* (read-only here) · *Op admins* for this solution's operations | org admin |
| **Operation → Users** | *Op admins* (read-only here) · *Op users*, with their roles | op admin |

Sol admins are appointed at the **organisation**, not inside the solution they
build: appointing one is an act of the org admin's authority, and the org's user
screens are where that authority is exercised. The open solution shows them so
its own screen answers "who builds this" without leaving — and shows them
read-only for the same reason. This reverses an earlier placement (the solution
was to own the list) in favour of the uniform pattern.

Sol admins see none of these screens; the solution's Users item is not rendered
for them.

## 7. Starting an organisation

`platform.registerOrg` writes the organisation and its owner in one act — the
chain cannot start itself (no signup, and a fresh operation admits nobody), so
the first row has to come from outside the request path. The owner is then told
**manually**; automated notification comes later.

**Registering an org creates the owner as its first user** (agreed 2026-08-04):
one `users` row, named on the org row as owner, and no grants. Nobody invites the
owner — there is nobody there to do it — so the act that creates the org creates
the person. They can then sign in, appoint the first org admins, and appoint
themselves one if they intend to do ordinary org-admin work.

**Console access is derived, never a flag.** It follows from being the owner, an
org admin, or a sol admin of any solution. The owner's derivation is what makes
the first appointment reachable: signing in as owner with no grants opens
Organisation → Users and nothing else.

**What that screen owes the owner** (fixed 2026-08-09 — it was reachable but not
usable, and each half failed for the same reason: the owner is deliberately not
an org admin, so anything gated on `org_admins` shut them out of their own root).

- **They read the org-admin roster.** `orgAdmins.list` answered org admins only,
  while appoint and remove answered the owner only — so the owner could write a
  list they could not read. A list a caller may not read renders as an empty one,
  so an owner who had already appointed several admins was told nobody
  administered the organisation. The read now answers either; everything else at
  the org tier stays the admin's.
- **They appoint by typing an address.** Only an org admin may browse the people,
  so the owner's appoint dialog was a picker over a list they could not fetch —
  empty, with the button disabled. They now get the same typed-address dialog an
  op admin gets, and the server answers for the pool. This is what makes
  appointing *themselves* possible, which is the ordinary first act.
- **They may invite**, and now have the button. `users.invite` has always
  admitted the owner — whoever may appoint may invite — but the screen offered it
  only alongside the pool, which the owner cannot see.

None of this widens the owner's authority: they still appoint org admins and
nothing else, and every other org-tier act needs the self-appointment.

`npm run bootstrap` stays as lockout recovery and the first admin on a fresh
deployment.

**Deferred, deliberately** (2026-08-04): how an owner is changed or transferred,
and how platform admins are managed beyond the env allowlist. Neither blocks
anything; both get worked out when something actually needs them.

Until transfer exists, `owner_email` is **not writable through the org profile**.
Editing the org is org-admin work, and an org admin who could write that column
would promote themselves to the root that appoints org admins. Org → Settings
edits the name and shows the owner read-only.

## 8. Walk-throughs

**A new joiner.** The op admin of *North* invites `sam@acme.com` — Sam is now
one of the organisation's users and can do nothing at all. The same op admin
adds Sam to *North*, which lets them in, and gives them the *Dispatchers* role,
which decides what they see. Three deliberate steps; stopping after the first
two is valid, and Sam enters seeing nothing. Sam signs in, the auth id binds,
and the row goes *active*.

**Standing up an operation.** An org admin creates *South*, appoints Priya its
op admin. Priya can enter it immediately, adds her people from the
organisation's users, assigns roles, and adjusts the menu. The org admin does
not staff it — that is Priya's job, and the org admin cannot appoint a second op
admin's worth of authority to themselves without an explicit, visible grant.

**Someone who builds.** An org admin invites `dev@acme.com`, then makes them an
admin of solution *Logistics*. They model and build pages, see no user list
anywhere, and invite nobody. To test against *North*'s live data they ask its op
admin to add them, like anyone else.

## 9. Terminology (binding)

**users** (the organisation's people), **org owner**, **org admins**, **sol
admins**, **op admins**, **op users**, **roles**.

Not: members, memberships, implementers, teammates, seats, accounts, staff,
participants, people, sol users, org users. There are no "kinds of user" — one
population, then grants.

## 10. Open

1. **Naming**, per §5 — the table names shipped as proposed (`users`,
   `org_admins`, `sol_admins`, `op_admins`), and `orgs.owner_email` was added
   and **replaced** `contact_email`, which migration 0018 dropped. Still open
   for renaming.
2. Nothing shows **which operations a person belongs to** from the user list.
   No procedure returns the join; deliberately left out of the build. The first
   thing to add if the pool screen feels blind.
3. An op admin can invite someone and never place them, leaving a user with no
   grants. Harmless — they can do nothing — but the user list should make
   "invited, placed nowhere" easy to see so it does not accumulate quietly.
4. The organisation's **Sol admins** tab lists every solution's admins grouped by
   solution. With a large catalogue that wants filtering or paging.
