// Entry to one operation (USERS.md §4) — may this person open it at all.
//
// Deliberately separate from roles: someone in the operation with no roles
// enters and sees nothing, which is valid; roles without entry grant nothing at
// all. The two gates stay independent and are never merged.
//
// Adding people here is the **op admin's** job, not the org admin's.

import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { opUsers, userRoles } from '../db/schema';
import { DEFAULT_ORG_ID, normaliseEmail, type Grant } from './types';
import { assertInPool } from './org-admins';
import { isOpAdmin } from './op-admins';

export async function listOpUsers(db: Db, operationId: string, orgId = DEFAULT_ORG_ID): Promise<Grant[]> {
  const rows = await db
    .select({ email: opUsers.email })
    .from(opUsers)
    .where(and(eq(opUsers.orgId, orgId), eq(opUsers.operationId, operationId)));
  return rows.sort((a, b) => a.email.localeCompare(b.email));
}

/** Add someone from the pool to an operation. Refuses an email that is not in
 *  the pool — it is the only way in, so this list can never be the wider set.
 *  The refusal is what an op admin sees when they type an address of somebody
 *  the organisation has not invited: they cannot browse the pool, so the server
 *  answers for it. */
export async function addOpUser(db: Db, input: { operationId: string; email: string; orgId?: string }): Promise<void> {
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  const email = normaliseEmail(input.email);
  await assertInPool(db, email, orgId);
  await db.insert(opUsers).values({ orgId, operationId: input.operationId, email }).onConflictDoNothing();
}

/** Remove someone from an operation, clearing their roles there too — a stale
 *  assignment would silently reapply if they were ever re-added. */
export async function removeOpUser(db: Db, input: { operationId: string; email: string; orgId?: string }): Promise<void> {
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  const email = normaliseEmail(input.email);
  await db.delete(opUsers).where(and(eq(opUsers.orgId, orgId), eq(opUsers.operationId, input.operationId), eq(opUsers.email, email)));
  await db.delete(userRoles).where(and(eq(userRoles.operationId, input.operationId), eq(userRoles.email, email)));
}

/**
 * The entry gate. **An admin row implies entry** (USERS.md §3): an op admin
 * opens the operation they administer without a separate op-user row, because
 * an administrator who cannot open the thing they administer would be nonsense.
 * Both tables are therefore consulted, and this is the only place that fact is
 * encoded — callers ask "may they enter", never "which table says so".
 *
 * Unauthenticated/demo posture is handled by the caller (no auth ⇒ open).
 */
export async function isOpUser(db: Db, input: { operationId: string; email: string; orgId?: string }): Promise<boolean> {
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  const email = normaliseEmail(input.email);
  const [row] = await db
    .select({ email: opUsers.email })
    .from(opUsers)
    .where(and(eq(opUsers.orgId, orgId), eq(opUsers.operationId, input.operationId), eq(opUsers.email, email)))
    .limit(1);
  if (row) return true;
  return isOpAdmin(db, { operationId: input.operationId, email, orgId });
}
