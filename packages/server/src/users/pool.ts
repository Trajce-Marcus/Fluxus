// The organisation's people (USERS.md §2) — one row per person per org, and it
// answers *who is this person* and nothing else.
//
// Email is the key, not the auth id: an invited person has no auth id until
// their first sign-in, so every grant in the sibling modules can be made before
// they have ever authenticated. There is no signup; `bindAuthUser` is the only
// path from "authenticated stranger" to "known person", and it refuses anyone
// who was not invited first.

import { and, eq, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { opAdmins, opUsers, orgAdmins, solAdmins, userRoles, users } from '../db/schema';
import { DEFAULT_ORG_ID, normaliseEmail, type User, type UserStatus } from './types';

const COLUMNS = {
  email: users.email,
  name: users.name,
  authUserId: users.authUserId,
  status: users.status,
  expiredAt: users.expiredAt,
} as const;

export async function listUsers(db: Db, orgId = DEFAULT_ORG_ID): Promise<User[]> {
  const rows = await db.select(COLUMNS).from(users).where(eq(users.orgId, orgId));
  return rows.sort((a, b) => a.email.localeCompare(b.email));
}

/** The pool row for one person, or null when they are not in it. Every tier
 *  check reads this, because a grant only counts while its holder exists and is
 *  not suspended. */
export async function getUser(db: Db, input: { email: string; orgId?: string }): Promise<User | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(users)
    .where(and(eq(users.orgId, input.orgId ?? DEFAULT_ORG_ID), eq(users.email, normaliseEmail(input.email))))
    .limit(1);
  return row ?? null;
}

/**
 * Invite a person into the organisation. This is the ONLY way anyone enters,
 * and it grants nothing at all — appointment is always a second, separate act
 * in the list it belongs to (USERS.md §3). Whoever may appoint may also invite;
 * that rule is enforced in the router, not here.
 *
 * Idempotent on (org, email): re-inviting updates the display name if one is
 * given, and never resets a bound auth id, an `active` status, or a name that
 * the caller simply did not supply.
 */
export async function inviteUser(db: Db, input: { email: string; name?: string | null; orgId?: string }): Promise<void> {
  const name = input.name ?? null;
  await db
    .insert(users)
    .values({ orgId: input.orgId ?? DEFAULT_ORG_ID, email: normaliseEmail(input.email), name })
    // A re-invite carrying no name leaves the row untouched rather than blanking
    // it — `bootstrapOrgAdmin` re-runs against real people and must not erase
    // them. `onConflictDoNothing` would be wrong the other way, so: conditional.
    .onConflictDoUpdate({ target: [users.orgId, users.email], set: name === null ? { orgId: input.orgId ?? DEFAULT_ORG_ID } : { name } });
}

/**
 * Suspend or reinstate — the **reversible** half of lifecycle. Every grant
 * survives, so reinstating is one call, but in the meantime the person is no
 * admin anywhere and enters nothing. Checked here, at the identity layer,
 * precisely so it bites all the tiers at once rather than being re-implemented
 * in each.
 *
 * Refuses `expired`: ending the relationship drops grants, which is a side
 * effect a status write must not have silently. Use `expireUser`.
 */
export async function setUserStatus(db: Db, input: { email: string; status: Exclude<UserStatus, 'expired'>; orgId?: string }): Promise<void> {
  await db
    .update(users)
    .set({ status: input.status })
    .where(and(
      eq(users.orgId, input.orgId ?? DEFAULT_ORG_ID),
      eq(users.email, normaliseEmail(input.email)),
      // An expired person is not suspendable or reinstatable — they have no
      // grants to pause or restore. `unexpireUser` is the way back.
      ne(users.status, 'expired'),
    ));
}

/**
 * Expire a person: the end of the relationship, and the terminal state.
 *
 * Every grant is dropped — admin appointments at all three tiers, operation
 * entry, roles — which is exactly what distinguishes this from suspension.
 * **The row itself is kept, always.** `author` on a history entry is an auth id,
 * and this row is the only thing that can turn that id back into a name;
 * deleting it would leave the append-only spine recording acts it can no longer
 * attribute. There is deliberately no hard delete anywhere in this module
 * (migration 0017).
 */
export async function expireUser(db: Db, input: { email: string; orgId?: string }): Promise<void> {
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  const email = normaliseEmail(input.email);
  await db.delete(orgAdmins).where(and(eq(orgAdmins.orgId, orgId), eq(orgAdmins.email, email)));
  await db.delete(opAdmins).where(and(eq(opAdmins.orgId, orgId), eq(opAdmins.email, email)));
  await db.delete(opUsers).where(and(eq(opUsers.orgId, orgId), eq(opUsers.email, email)));
  await db.delete(userRoles).where(and(eq(userRoles.orgId, orgId), eq(userRoles.email, email)));
  await db.delete(solAdmins).where(eq(solAdmins.email, email));
  await db
    .update(users)
    .set({ status: 'expired', expiredAt: new Date() })
    .where(and(eq(users.orgId, orgId), eq(users.email, email)));
}

/**
 * Bring an expired person back. They return as a plain member of the
 * organisation with **no grants** — expiry dropped them and nothing was kept to
 * restore. Whoever needs them appoints them again, which is the same
 * invite-then-appoint order everyone else follows.
 *
 * Status returns to what their sign-in history justifies: someone who has
 * authenticated is `active`, someone who never did is back to `invited`.
 * Claiming `active` for a person who has never signed in would be a lie the
 * `auth_user_id` column contradicts.
 */
export async function unexpireUser(db: Db, input: { email: string; orgId?: string }): Promise<void> {
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  const email = normaliseEmail(input.email);
  const row = await getUser(db, { email, orgId });
  if (!row || row.status !== 'expired') return;
  await db
    .update(users)
    .set({ status: row.authUserId ? 'active' : 'invited', expiredAt: null })
    .where(and(eq(users.orgId, orgId), eq(users.email, email)));
}

/**
 * Bind an authenticated caller to their pool row on first sign-in, flipping
 * `invited` → `active`. Keyed on email because that is all an invite knows;
 * a no-op when the email was never invited, which is what keeps this
 * invite-only — an authenticated stranger does not become a user by showing up.
 */
export async function bindAuthUser(db: Db, input: { email: string; authUserId: string; orgId?: string }): Promise<void> {
  await db
    .update(users)
    .set({ authUserId: input.authUserId, status: 'active' })
    .where(and(
      eq(users.orgId, input.orgId ?? DEFAULT_ORG_ID),
      eq(users.email, normaliseEmail(input.email)),
      // Self-disarming: once bound this matches nothing, so calling it on every
      // authenticated request costs an indexed no-op rather than a write.
      isNull(users.authUserId),
      // An expired person who still holds a valid session must not be
      // resurrected by signing in — that would flip them back to `active` and
      // undo an administrator's decision. They hold no grants either way, but
      // the status must not lie about where they stand.
      ne(users.status, 'expired'),
    ));
}

/** Whether a person exists in the pool and their access is live — the
 *  precondition every appointment and every gate shares. Expiry already drops
 *  every grant, so this is belt and braces for expired rows; suspension relies
 *  on it entirely, since suspended grants are deliberately left intact. */
export async function isActiveUser(db: Db, input: { email: string; orgId?: string }): Promise<boolean> {
  const row = await getUser(db, input);
  return row !== null && row.status !== 'suspended' && row.status !== 'expired';
}
