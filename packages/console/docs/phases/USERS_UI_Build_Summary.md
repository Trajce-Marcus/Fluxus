# Users UI — build summary (2026-08-04)

Point-in-time snapshot. Append-only; not edited after the phase closed.

## What shipped

`platform-components/users/` — the Console's whole user surface, at three tiers,
on one pattern:

> **each Users screen shows the tier above read-only, the list it governs
> editable, and Invite.**

| Screen | Tabs | Mounted by |
|---|---|---|
| `OrgUsersScreen` | All users · Org admins · Sol admins | `AdminView`, organisation **Users** |
| `SolutionUsersScreen` | Sol admins (read-only) · Op admins | section registry, inside the open solution |
| `OperationUsersScreen` | Op users + roles · Op admins (read-only) | the operation view's **Users** tab |

Superseded and deleted: `OrgUsersSection`, `OpUsersSection`, `SolUsersAdmin`,
`UserRolesSection` — the 2026-08-04 first cut, built against the old model.

## Structure

Screens compose and hold no table markup of their own.

- `tables/` — one list each, **reused across screens**. A `readOnly` flag is the
  only difference between the two places a list appears, so the same component
  cannot disagree with itself about what a list means.
- `dialogs/` — every data entry, in a popup over the screen, never an inline
  form. `Dialog` is the shell; `InviteUserDialog`, `AppointDialog` and
  `EditRolesDialog` are the three acts.
- `shared/` — the tab strip, `ListHead`/`EmptyList`/`StatusPill`, and
  `useUserScreen`, the load/act cycle every screen repeats.

## Decisions worth keeping

- **Invite carries no admin connotation** and appears on all three screens,
  because it is the same act each time: it adds a person to the organisation and
  grants nothing anywhere.
- **An empty list says what the emptiness means** — "nobody may enter this
  operation" — never "unconfigured". Empty is a real answer here.
- **A read-only tab always says where its list IS edited**, or it reads as
  broken.
- **Sol admins are appointed at the organisation**, shown read-only inside the
  solution. Appointing a builder is an exercise of org authority, so it happens
  where that authority lives; the solution still answers "who builds this"
  without making the reader leave. This reversed an earlier placement in favour
  of the uniform pattern.
- **Nothing is optimistic.** The server owns these rules and an appointment can
  bounce off a tier check; a table showing a grant the server refused would be
  lying about who may do what.
- **An op admin cannot browse the organisation's people**, so Add user takes a
  typed address and the server answers for the pool. Its refusal — "not in this
  organisation" — is the feature, not an error to design away.
- **`me()` decides what to render, never what is allowed** — every call is
  re-checked server-side.
- A **fresh organisation** shows its owner the Org admins tab alone: they hold no
  grants yet, and this is the screen that exists so they can make the first
  appointment.

## Amended the same day — Expire, not Remove

The pool's destructive action became **Expire**: it drops every grant and keeps
the person, because record history names its author by auth id and their row is
the only thing that can resolve it. An expired row greys out, shows the date, and
offers **Unexpire** — which is deliberately not an undo: they return as a plain
member with no grants and are appointed again from scratch. The confirm dialog
says all of that, including why there is no delete.

## Left undone

- No way to see **which operations a person belongs to** from the pool — no
  procedure returns the join. First thing to add if the screen feels blind.
- The organisation's *Sol admins* tab lists every solution's admins grouped by
  solution; with a large catalogue this wants filtering or paging.
