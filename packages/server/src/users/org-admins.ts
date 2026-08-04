// The organisation tier (USERS.md §3): its owner, and its admins.
//
// The owner is the root of authority and lives on the org row — appointed by
// the platform tier at registration, which also writes their `users` row. They
// are NOT implicitly an org admin: they appoint org admins, and appoint
// themselves one if they mean to do ordinary org-admin work. What the owner
// alone may do is appoint and remove org admins, which is the rule this whole
// tier exists to express — no administrator appoints another at their own level.

import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { orgAdmins, orgs, users } from '../db/schema';
import { DEFAULT_ORG_ID, normaliseEmail, type Grant } from './types';
import { isActiveUser } from './pool';

export async function listOrgAdmins(db: Db, orgId = DEFAULT_ORG_ID): Promise<Grant[]> {
  const rows = await db.select({ email: orgAdmins.email }).from(orgAdmins).where(eq(orgAdmins.orgId, orgId));
  return rows.sort((a, b) => a.email.localeCompare(b.email));
}

/** Appoint an org admin. Refuses anyone not already in the pool: invite, then
 *  appoint — the order is the model, and enforcing it here keeps every grant
 *  table free of rows naming people the organisation does not know. */
export async function appointOrgAdmin(db: Db, input: { email: string; orgId?: string }): Promise<void> {
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  const email = normaliseEmail(input.email);
  await assertInPool(db, email, orgId);
  await db.insert(orgAdmins).values({ orgId, email }).onConflictDoNothing();
}

export async function removeOrgAdmin(db: Db, input: { email: string; orgId?: string }): Promise<void> {
  await db
    .delete(orgAdmins)
    .where(and(eq(orgAdmins.orgId, input.orgId ?? DEFAULT_ORG_ID), eq(orgAdmins.email, normaliseEmail(input.email))));
}

/** Is this person an org admin *right now*? Suspension is re-checked here rather
 *  than trusted from the grant row: lifecycle lives on the pool row precisely so
 *  suspending someone strips their authority everywhere without touching a
 *  single grant. */
export async function isOrgAdmin(db: Db, input: { email: string; orgId?: string }): Promise<boolean> {
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  const email = normaliseEmail(input.email);
  const [row] = await db
    .select({ email: orgAdmins.email })
    .from(orgAdmins)
    .where(and(eq(orgAdmins.orgId, orgId), eq(orgAdmins.email, email)))
    .limit(1);
  if (!row) return false;
  return isActiveUser(db, { email, orgId });
}

/** The org's owner email, or null. Read by the owner check and by the Console
 *  to decide whether to offer the Org admins tab as editable. */
export async function getOwnerEmail(db: Db, orgId = DEFAULT_ORG_ID): Promise<string | null> {
  const [row] = await db.select({ ownerEmail: orgs.ownerEmail }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
  return row?.ownerEmail ?? null;
}

/** The root check. Unlike the admin tiers this does not require a pool row to be
 *  active — suspending the owner must not orphan the organisation, since there
 *  is nobody above them inside the org to put it right. */
export async function isOrgOwner(db: Db, input: { email: string; orgId?: string }): Promise<boolean> {
  const owner = await getOwnerEmail(db, input.orgId ?? DEFAULT_ORG_ID);
  return owner !== null && owner === normaliseEmail(input.email);
}

/** Shared precondition for every appointment in this module and its siblings. */
export async function assertInPool(db: Db, email: string, orgId: string): Promise<void> {
  const [inPool] = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.email, email)))
    .limit(1);
  // Plain Error ⇒ BAD_REQUEST via the router's rethrow: the request is wrong,
  // not the target missing.
  if (!inPool) throw new Error(`'${email}' is not in this organisation — invite them first`);
}
