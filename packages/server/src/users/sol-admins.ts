// The design plane (USERS.md §3): who builds a solution.
//
// One grade — you build it or you do not. Sol admins model, build pages and set
// the default menu; they appoint nobody, invite nobody, and see no user list
// anywhere, including this one. Reaching an operation's live data is a separate
// grant like anyone else's, so there is no design-plane bypass.
//
// Appointing them is org-admin work, and it happens on the organisation's user
// screens: it is an exercise of the org admin's authority, not the solution's.

import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { solAdmins, solutions } from '../db/schema';
import { DEFAULT_ORG_ID, normaliseEmail, type Grant } from './types';
import { assertInPool } from './org-admins';

export async function listSolAdmins(db: Db, solutionId: string): Promise<Grant[]> {
  const rows = await db.select({ email: solAdmins.email }).from(solAdmins).where(eq(solAdmins.solutionId, solutionId));
  return rows.sort((a, b) => a.email.localeCompare(b.email));
}

/** Every sol admin of every solution in an org, for the organisation's
 *  *Sol admins* tab — the one place the appointments are made, so the one place
 *  that needs them joined across solutions. */
export async function listSolAdminsByOrg(db: Db, orgId = DEFAULT_ORG_ID): Promise<{ solutionId: string; email: string }[]> {
  const rows = await db
    .select({ solutionId: solAdmins.solutionId, email: solAdmins.email })
    .from(solAdmins)
    .innerJoin(solutions, eq(solutions.id, solAdmins.solutionId))
    .where(eq(solutions.orgId, orgId));
  return rows.sort((a, b) => a.solutionId.localeCompare(b.solutionId) || a.email.localeCompare(b.email));
}

/** Appoint someone to build a solution. `orgId` is the solution's org, needed
 *  only to check the pool — sol_admins itself carries no org, because solution
 *  ids are globally unique and the org is derivable through `solutions`. */
export async function appointSolAdmin(db: Db, input: { solutionId: string; email: string; orgId?: string }): Promise<void> {
  const email = normaliseEmail(input.email);
  await assertInPool(db, email, input.orgId ?? DEFAULT_ORG_ID);
  await db.insert(solAdmins).values({ email, solutionId: input.solutionId }).onConflictDoNothing();
}

export async function removeSolAdmin(db: Db, input: { solutionId: string; email: string }): Promise<void> {
  await db
    .delete(solAdmins)
    .where(and(eq(solAdmins.solutionId, input.solutionId), eq(solAdmins.email, normaliseEmail(input.email))));
}

export async function isSolAdmin(db: Db, input: { solutionId: string; email: string }): Promise<boolean> {
  const [row] = await db
    .select({ email: solAdmins.email })
    .from(solAdmins)
    .where(and(eq(solAdmins.solutionId, input.solutionId), eq(solAdmins.email, normaliseEmail(input.email))))
    .limit(1);
  return !!row;
}

/** Whether the caller builds *anything* — one third of the derived "may use the
 *  Console" answer (the others being owner and org admin). Never a stored flag:
 *  a separate bit could contradict the grants it summarises. */
export async function isAnySolAdmin(db: Db, email: string): Promise<boolean> {
  const [row] = await db
    .select({ email: solAdmins.email })
    .from(solAdmins)
    .where(eq(solAdmins.email, normaliseEmail(email)))
    .limit(1);
  return !!row;
}
