// Lockout recovery, and the first admin on a fresh deployment (USERS.md §7).
//
// The chain cannot start itself: there is no signup, and every gate is strict —
// an operation with no users admits nobody, including the Console, which reaches
// an operation through the same gate as the Runtime. Migrating a database where
// auth is configured therefore locks everyone out of everything until something
// outside the request path writes the first rows. In normal service that is
// `platform.registerOrg`; this is the escape hatch when there is no platform
// admin to call it, and a lockout you can only fix by writing another migration
// is not a fix.
//
// Deliberately **idempotent and re-runnable**. Three rules keep re-runs safe:
//   - the pool row and the org-admin appointment are upserted (promotion is the
//     whole point);
//   - the owner is claimed only if the org has none, never taken from someone;
//   - operations and solutions are opened ONLY where nobody administers them
//     yet. Something already governed is already governed, and silently
//     re-granting yourself entry on every seed would make the gates meaningless.
//
// Returns what it did, so the caller can say so rather than claim success.

import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { opAdmins, operations, orgAdmins, orgs, solAdmins, solutions } from '../db/schema';
import { inviteUser } from './pool';
import { DEFAULT_ORG_ID, normaliseEmail } from './types';

export interface BootstrapResult {
  email: string;
  /** True when this run claimed a previously ownerless organisation. */
  claimedOwnership: boolean;
  operationsOpened: string[];
  solutionsOpened: string[];
}

export async function bootstrapOrgAdmin(db: Db, input: { email: string; name?: string | null; orgId?: string }): Promise<BootstrapResult> {
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  const email = normaliseEmail(input.email);

  await inviteUser(db, { orgId, email, name: input.name });
  await db.insert(orgAdmins).values({ orgId, email }).onConflictDoNothing();

  // An org with no owner has nobody who may appoint org admins — the tier above
  // this one is empty, so recovery has to fill it. An org that HAS an owner is
  // left alone: ownership transfer is a deliberate act, not a side effect of
  // re-running a seed script.
  const claimed = await db
    .update(orgs)
    .set({ ownerEmail: email })
    .where(and(eq(orgs.id, orgId), isNull(orgs.ownerEmail)))
    .returning({ id: orgs.id });

  const ops = await db.select({ id: operations.id }).from(operations).where(eq(operations.orgId, orgId));
  const operationsOpened: string[] = [];
  for (const op of ops) {
    const [existing] = await db
      .select({ email: opAdmins.email })
      .from(opAdmins)
      .where(and(eq(opAdmins.orgId, orgId), eq(opAdmins.operationId, op.id)))
      .limit(1);
    if (existing) continue; // already governed — leave it alone
    await db.insert(opAdmins).values({ orgId, operationId: op.id, email }).onConflictDoNothing();
    operationsOpened.push(op.id);
  }

  // Same treatment for the design plane: a solution nobody builds is a solution
  // nobody can open. Solutions created through `solutions.create` enrol their
  // creator, so this only ever catches ones that predate that rule.
  const sols = await db.select({ id: solutions.id }).from(solutions).where(eq(solutions.orgId, orgId));
  const solutionsOpened: string[] = [];
  for (const sol of sols) {
    const [existing] = await db
      .select({ email: solAdmins.email })
      .from(solAdmins)
      .where(eq(solAdmins.solutionId, sol.id))
      .limit(1);
    if (existing) continue;
    await db.insert(solAdmins).values({ email, solutionId: sol.id }).onConflictDoNothing();
    solutionsOpened.push(sol.id);
  }

  return { email, claimedOwnership: claimed.length > 0, operationsOpened, solutionsOpened };
}
