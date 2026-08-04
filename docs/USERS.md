# Users, admins and roles

**Agreed 2026-08-04. This is the target model, not what is built.** The built
system still carries the 2026-08-02 shape (`org_users` / `sol_users` /
`op_users`, each with a `level` column); §6 lists exactly what changes.
[RBAC_COMPACT.md](RBAC_COMPACT.md) remains the technical source of truth and is
rewritten onto this model when the migration lands.

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
- **Suspension is here**, so it bites everywhere at once: a suspended person is
  not an admin anywhere and enters nothing, while every grant survives for
  reinstatement. Removal is the destructive counterpart and drops every grant.

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
| **Org owner** | Appoint and remove org admins. Make themselves an org admin. | Nothing else *as owner* — the owner is a root, not a super-admin. Ordinary org-admin work needs the self-appointment. |
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

Lifecycle — suspend and remove — stays with the org admin: it is org-wide and
destructive, and it is the one user-facing act that is not a side effect of a
grant.

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

*Names proposed, not yet endorsed:* `users`, `org_admins`, `sol_admins`,
`op_admins`, and whatever column carries the owner (`orgs.owner_email` is the
obvious one, but `orgs.contact_email` already exists and may just become it).

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
| `platform.registerOrg` writes org + first org admin | Writes org + **owner** |

Console consequences: the Organisation → Users screen loses its per-row
*Org admin* toggle (that becomes an org-admins list, appointed by the owner) and
the operation's *Op admin* checkbox moves to the org admin's operation-creation
path. The op users table and its add-user dialog survive as they are.

## 7. Starting an organisation

`platform.registerOrg` writes the organisation and its owner in one act — the
chain cannot start itself (no signup, and a fresh operation admits nobody), so
the first row has to come from outside the request path. The owner is then told
**manually**; automated notification comes later.

`npm run bootstrap` stays as lockout recovery and the first admin on a fresh
deployment.

**Deferred, deliberately** (2026-08-04): how an owner is changed or transferred,
and how platform admins are managed beyond the env allowlist. Neither blocks
anything; both get worked out when something actually needs them.

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

1. **Naming**, per §5.
2. Nothing shows **which operations a person belongs to** from the user list.
   Worth adding once the model settles.
3. An op admin can invite someone and never place them, leaving a user with no
   grants. Harmless — they can do nothing — but the user list should make
   "invited, placed nowhere" easy to see so it does not accumulate quietly.
