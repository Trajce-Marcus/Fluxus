// Roles (USERS.md §4) — what a person may do inside one operation. Declared by
// the solution, assigned per operation by its op admin.
//
// Not a membership layer of its own: this is an attribute of being an op user,
// which is why it lives beside `op-users` and why removing someone from an
// operation clears it there.

import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { userRoles } from '../db/schema';
import { DEFAULT_ORG_ID, normaliseEmail } from './types';

export interface RoleGrant {
  email: string;
  roleIds: string[];
}

export async function listUserRoles(db: Db, operationId: string): Promise<RoleGrant[]> {
  const rows = await db
    .select({ email: userRoles.email, roleIds: userRoles.roleIds })
    .from(userRoles)
    .where(eq(userRoles.operationId, operationId));
  return rows.map((r) => ({ email: r.email, roleIds: r.roleIds })).sort((a, b) => a.email.localeCompare(b.email));
}

/** Upsert a person's role ids in an operation; an empty list clears the row.
 *  Keyed on email, so roles can be granted to someone invited but never signed
 *  in — the invite-first flow, end to end. */
export async function putUserRoles(db: Db, input: { operationId: string; email: string; roleIds: string[]; orgId?: string }): Promise<void> {
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  const email = normaliseEmail(input.email);
  if (input.roleIds.length === 0) {
    await db.delete(userRoles).where(and(eq(userRoles.operationId, input.operationId), eq(userRoles.email, email)));
    return;
  }
  await db
    .insert(userRoles)
    .values({ orgId, operationId: input.operationId, email, roleIds: input.roleIds })
    .onConflictDoUpdate({ target: [userRoles.orgId, userRoles.operationId, userRoles.email], set: { roleIds: input.roleIds } });
}
