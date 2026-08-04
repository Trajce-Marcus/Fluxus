// Who administers one operation (USERS.md §3) — appointed by an org admin, at
// creation or after, and never by another op admin.
//
// The op admin runs the operation: adds its ordinary users, assigns their roles,
// sets its menu override. That is the other half of the governing split — the
// org admin controls who exists and who gets in, the op admin controls what they
// may do once inside. An org admin is therefore NOT implicitly an op admin; one
// who wants to manage roles appoints themselves, which is a speed bump rather
// than a wall, and the point is that the grant is explicit and auditable.

import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { opAdmins } from '../db/schema';
import { DEFAULT_ORG_ID, normaliseEmail, type Grant } from './types';
import { assertInPool } from './org-admins';
import { isActiveUser } from './pool';

export async function listOpAdmins(db: Db, operationId: string, orgId = DEFAULT_ORG_ID): Promise<Grant[]> {
  const rows = await db
    .select({ email: opAdmins.email })
    .from(opAdmins)
    .where(and(eq(opAdmins.orgId, orgId), eq(opAdmins.operationId, operationId)));
  return rows.sort((a, b) => a.email.localeCompare(b.email));
}

/** Every op admin across a set of operations — for the solution's *Op admins*
 *  tab, which lists the admins of all that solution's operations in one place
 *  because that is where an org admin goes to appoint them. */
export async function listOpAdminsForOperations(db: Db, operationIds: string[], orgId = DEFAULT_ORG_ID): Promise<{ operationId: string; email: string }[]> {
  if (operationIds.length === 0) return [];
  const rows = await db
    .select({ operationId: opAdmins.operationId, email: opAdmins.email })
    .from(opAdmins)
    .where(eq(opAdmins.orgId, orgId));
  const wanted = new Set(operationIds);
  return rows
    .filter((r) => wanted.has(r.operationId))
    .sort((a, b) => a.operationId.localeCompare(b.operationId) || a.email.localeCompare(b.email));
}

export async function appointOpAdmin(db: Db, input: { operationId: string; email: string; orgId?: string }): Promise<void> {
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  const email = normaliseEmail(input.email);
  await assertInPool(db, email, orgId);
  await db.insert(opAdmins).values({ orgId, operationId: input.operationId, email }).onConflictDoNothing();
}

export async function removeOpAdmin(db: Db, input: { operationId: string; email: string; orgId?: string }): Promise<void> {
  await db.delete(opAdmins).where(and(
    eq(opAdmins.orgId, input.orgId ?? DEFAULT_ORG_ID),
    eq(opAdmins.operationId, input.operationId),
    eq(opAdmins.email, normaliseEmail(input.email)),
  ));
}

/** Suspension is re-checked against the pool, as at every tier: a suspended
 *  person is no admin anywhere, while their grant rows survive intact for
 *  reinstatement. */
export async function isOpAdmin(db: Db, input: { operationId: string; email: string; orgId?: string }): Promise<boolean> {
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  const email = normaliseEmail(input.email);
  const [row] = await db
    .select({ email: opAdmins.email })
    .from(opAdmins)
    .where(and(eq(opAdmins.orgId, orgId), eq(opAdmins.operationId, input.operationId), eq(opAdmins.email, email)))
    .limit(1);
  if (!row) return false;
  return isActiveUser(db, { email, orgId });
}
