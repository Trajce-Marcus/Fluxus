// The user surface of the API (USERS.md) — one router per list the Console
// shows, because each list answers one question and is governed by one tier:
//
//   users      — the organisation's people. Invite, lifecycle, removal.
//   orgAdmins  — who administers the org. The **owner** alone appoints.
//   solAdmins  — who builds a solution. The **org admin** appoints.
//   opAdmins   — who runs an operation. The **org admin** appoints.
//   opUsers    — who may enter an operation. The **op admin** adds.
//   userRoles  — what they may do inside it. The **op admin** assigns.
//
// Read the gate on each procedure and the model reads back out of it: authority
// flows downward, and no tier appoints its own tier.
//
// Split out of router.ts on 2026-08-04 with the model rewrite.

import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  addOpUser,
  appointOpAdmin,
  appointOrgAdmin,
  appointSolAdmin,
  getOperation,
  getOwnerEmail,
  getSolutionConfig,
  getSolutionOrg,
  inviteUser,
  listOpAdmins,
  listOpAdminsForOperations,
  listOpUsers,
  listOperations,
  listOrgAdmins,
  listSolAdmins,
  listSolAdminsByOrg,
  listUserRoles,
  listUsers,
  putUserRoles,
  removeOpAdmin,
  removeOpUser,
  expireUser,
  removeOrgAdmin,
  removeSolAdmin,
  setUserStatus,
  unexpireUser,
} from '../host';
import {
  isOpAdmin,
  isOrgAdmin,
  isOrgOwner,
  requireOpAdmin,
  requireOrgAdmin,
  requireOrgOwner,
} from '../gates';
import {
  emailInput,
  operationInput,
  orgInput,
  rethrow,
  solutionInput,
  t,
  type AppContext,
} from '../trpc';

/** Adding someone to an operation and reading its list are the op admin's, but
 *  an org admin has to be able to see it — they appoint the op admin who will
 *  run it, and a list they cannot see is one they cannot verify. Either tier,
 *  and only here: everything else keeps to its own tier. */
async function requireOpOrOrgAdmin(ctx: AppContext, operationId: string, orgId: string): Promise<void> {
  if (!ctx.authConfigured) return;
  if (await isOpAdmin(ctx, operationId, orgId)) return;
  if (await isOrgAdmin(ctx, orgId)) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: `Requires admin of operation '${operationId}'` });
}

/**
 * The organisation's people. Being here grants nothing — it answers only
 * "does this person exist to us", which is why `invite` takes no level, no
 * solution and no operation. Every appointment is a separate act in one of the
 * routers below.
 */
export const usersRouter = t.router({
  list: t.procedure
    .input(z.object({ orgId: orgInput }).default({}))
    .query(async ({ ctx, input }) => {
      try {
        // The whole pool is the org admin's view. An op admin cannot browse it,
        // which is why `opUsers.add` validates an address against it for them.
        await requireOrgAdmin(ctx, input.orgId);
        return await listUsers(ctx.db, input.orgId);
      } catch (err) {
        rethrow(err);
      }
    }),

  /**
   * Invite someone into the organisation — the only way anyone gets in, and it
   * carries no admin connotation whatever (agreed 2026-08-04). **Whoever may
   * appoint may also invite**: the owner appoints org admins, org admins appoint
   * sol and op admins, op admins place people in their operation. Sol admins
   * never do — a person is needed either for an operation or to build another
   * solution, and neither appointment is theirs to make.
   */
  invite: t.procedure
    .input(z.object({
      email: emailInput,
      name: z.string().nullish(),
      orgId: orgInput,
      /** Present when an op admin invites: the operation whose admin they claim
       *  to be, since they have no org-wide standing to invite from. */
      operationId: z.string().min(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        if (ctx.authConfigured) {
          const viaOp = input.operationId
            ? await isOpAdmin(ctx, input.operationId, input.orgId)
            : false;
          if (!viaOp && !(await isOrgAdmin(ctx, input.orgId)) && !(await isOrgOwner(ctx, input.orgId))) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires an admin who may appoint' });
          }
        }
        await inviteUser(ctx.db, input);
        return { ok: true as const };
      } catch (err) {
        rethrow(err);
      }
    }),

  /** Suspend and reinstate — the reversible pause. Every grant survives, but a
   *  suspended person is no admin anywhere and enters nothing while it lasts.
   *  `expired` is refused here: it drops grants, which no status write should do
   *  silently. Org-wide, so org-admin work. */
  setStatus: t.procedure
    .input(z.object({
      email: emailInput,
      status: z.enum(['invited', 'active', 'suspended']),
      orgId: orgInput,
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        await requireOrgAdmin(ctx, input.orgId);
        await setUserStatus(ctx.db, input);
        return { ok: true as const };
      } catch (err) {
        rethrow(err);
      }
    }),

  /**
   * End the relationship. Drops every grant at every tier and stamps
   * `expired_at` — but **keeps the person**, because the record history that
   * names them as author has no other way to resolve who they were.
   *
   * This replaced a hard delete (2026-08-04). There is no other terminal path:
   * two, one of which quietly damages the audit trail, is a choice nobody should
   * have to make correctly under pressure.
   */
  expire: t.procedure
    .input(z.object({ email: emailInput, orgId: orgInput }))
    .mutation(async ({ ctx, input }) => {
      try {
        await requireOrgAdmin(ctx, input.orgId);
        await expireUser(ctx.db, input);
        return { ok: true as const };
      } catch (err) {
        rethrow(err);
      }
    }),

  /** Bring an expired person back — as a plain member with **no grants**.
   *  Expiry dropped them and kept nothing to restore, so whoever needs them
   *  appoints them again. */
  unexpire: t.procedure
    .input(z.object({ email: emailInput, orgId: orgInput }))
    .mutation(async ({ ctx, input }) => {
      try {
        await requireOrgAdmin(ctx, input.orgId);
        await unexpireUser(ctx.db, input);
        return { ok: true as const };
      } catch (err) {
        rethrow(err);
      }
    }),
});

/**
 * Who administers the organisation — **appointed by the owner alone**. This is
 * the rule the tier exists to express: no administrator appoints another at
 * their own level, so an org admin cannot mint a second one. The owner is the
 * root that makes the first appointment possible, and `npm run bootstrap`
 * remains the recovery path if even that is lost.
 */
export const orgAdminsRouter = t.router({
  list: t.procedure
    .input(z.object({ orgId: orgInput }).default({}))
    .query(async ({ ctx, input }) => {
      try {
        // Visible to any org admin — they work alongside these people — but
        // editable only by the owner, which the mutations below enforce.
        await requireOrgAdmin(ctx, input.orgId);
        return await listOrgAdmins(ctx.db, input.orgId);
      } catch (err) {
        rethrow(err);
      }
    }),
  /** The org's owner, so the Console can say whose organisation this is and
   *  decide whether to offer the appointment controls at all. */
  owner: t.procedure
    .input(z.object({ orgId: orgInput }).default({}))
    .query(async ({ ctx, input }) => {
      try {
        return { email: await getOwnerEmail(ctx.db, input.orgId) };
      } catch (err) {
        rethrow(err);
      }
    }),
  appoint: t.procedure
    .input(z.object({ email: emailInput, orgId: orgInput }))
    .mutation(async ({ ctx, input }) => {
      try {
        await requireOrgOwner(ctx, input.orgId);
        await appointOrgAdmin(ctx.db, input);
        return { ok: true as const };
      } catch (err) {
        rethrow(err);
      }
    }),
  remove: t.procedure
    .input(z.object({ email: emailInput, orgId: orgInput }))
    .mutation(async ({ ctx, input }) => {
      try {
        await requireOrgOwner(ctx, input.orgId);
        await removeOrgAdmin(ctx.db, input);
        return { ok: true as const };
      } catch (err) {
        rethrow(err);
      }
    }),
});

/**
 * Who builds a solution — **org-admin work on every procedure**, including the
 * read. "Create solutions and appoint who builds them" is the org tier's, and
 * the design plane governs no people: a sol admin cannot appoint another, and
 * these rows carry real identities they have no business seeing.
 */
export const solAdminsRouter = t.router({
  list: t.procedure
    .input(z.object({ solutionId: solutionInput }).default({}))
    .query(async ({ ctx, input }) => {
      try {
        await requireOrgAdmin(ctx, await getSolutionOrg(ctx.db, input.solutionId));
        return await listSolAdmins(ctx.db, input.solutionId);
      } catch (err) {
        rethrow(err);
      }
    }),
  /** Every solution's admins in one call — the organisation's *Sol admins* tab,
   *  which is where the appointments are made. */
  listByOrg: t.procedure
    .input(z.object({ orgId: orgInput }).default({}))
    .query(async ({ ctx, input }) => {
      try {
        await requireOrgAdmin(ctx, input.orgId);
        return await listSolAdminsByOrg(ctx.db, input.orgId);
      } catch (err) {
        rethrow(err);
      }
    }),
  appoint: t.procedure
    .input(z.object({ solutionId: solutionInput, email: emailInput }))
    .mutation(async ({ ctx, input }) => {
      try {
        const orgId = await getSolutionOrg(ctx.db, input.solutionId);
        await requireOrgAdmin(ctx, orgId);
        await appointSolAdmin(ctx.db, { ...input, orgId });
        return { ok: true as const };
      } catch (err) {
        rethrow(err);
      }
    }),
  remove: t.procedure
    .input(z.object({ solutionId: solutionInput, email: emailInput }))
    .mutation(async ({ ctx, input }) => {
      try {
        await requireOrgAdmin(ctx, await getSolutionOrg(ctx.db, input.solutionId));
        await removeSolAdmin(ctx.db, input);
        return { ok: true as const };
      } catch (err) {
        rethrow(err);
      }
    }),
});

/**
 * Who runs an operation — **appointed by an org admin**, never by another op
 * admin. The appointment is made from inside the solution the operation belongs
 * to, which is where an org admin is already looking when they stand one up.
 */
export const opAdminsRouter = t.router({
  list: t.procedure
    .input(z.object({ operationId: operationInput }).default({}))
    .query(async ({ ctx, input }) => {
      try {
        const op = await getOperation(ctx.db, input.operationId);
        // Read by the operation's own Users screen, where an op admin sees the
        // tier above them read-only.
        await requireOpOrOrgAdmin(ctx, input.operationId, op.orgId);
        return await listOpAdmins(ctx.db, input.operationId, op.orgId);
      } catch (err) {
        rethrow(err);
      }
    }),
  /** The op admins of every operation running one solution — the solution's
   *  *Op admins* tab. */
  listBySolution: t.procedure
    .input(z.object({ solutionId: solutionInput }).default({}))
    .query(async ({ ctx, input }) => {
      try {
        const orgId = await getSolutionOrg(ctx.db, input.solutionId);
        await requireOrgAdmin(ctx, orgId);
        const ops = (await listOperations(ctx.db)).filter((o) => o.solutionId === input.solutionId);
        return await listOpAdminsForOperations(ctx.db, ops.map((o) => o.id), orgId);
      } catch (err) {
        rethrow(err);
      }
    }),
  appoint: t.procedure
    .input(z.object({ operationId: operationInput, email: emailInput }))
    .mutation(async ({ ctx, input }) => {
      try {
        const op = await getOperation(ctx.db, input.operationId);
        await requireOrgAdmin(ctx, op.orgId);
        await appointOpAdmin(ctx.db, { ...input, orgId: op.orgId });
        return { ok: true as const };
      } catch (err) {
        rethrow(err);
      }
    }),
  remove: t.procedure
    .input(z.object({ operationId: operationInput, email: emailInput }))
    .mutation(async ({ ctx, input }) => {
      try {
        const op = await getOperation(ctx.db, input.operationId);
        await requireOrgAdmin(ctx, op.orgId);
        await removeOpAdmin(ctx.db, { ...input, orgId: op.orgId });
        return { ok: true as const };
      } catch (err) {
        rethrow(err);
      }
    }),
});

/**
 * Who may enter an operation — the **op admin's** list, and the half of the
 * split that is theirs: the org admin decides who exists and who administers,
 * the op admin staffs the operation and says what each person may do.
 */
export const opUsersRouter = t.router({
  list: t.procedure
    .input(z.object({ operationId: operationInput }).default({}))
    .query(async ({ ctx, input }) => {
      try {
        const op = await getOperation(ctx.db, input.operationId);
        await requireOpOrOrgAdmin(ctx, input.operationId, op.orgId);
        return await listOpUsers(ctx.db, input.operationId, op.orgId);
      } catch (err) {
        rethrow(err);
      }
    }),
  /**
   * Add someone from the organisation to this operation. The op admin cannot
   * browse the pool — they have no org-wide read — so they type an address and
   * the server answers for it, refusing with "not in this organisation" when
   * nobody has invited that person yet.
   */
  add: t.procedure
    .input(z.object({ operationId: operationInput, email: emailInput }))
    .mutation(async ({ ctx, input }) => {
      try {
        const op = await getOperation(ctx.db, input.operationId);
        await requireOpOrOrgAdmin(ctx, input.operationId, op.orgId);
        await addOpUser(ctx.db, { ...input, orgId: op.orgId });
        return { ok: true as const };
      } catch (err) {
        rethrow(err);
      }
    }),
  remove: t.procedure
    .input(z.object({ operationId: operationInput, email: emailInput }))
    .mutation(async ({ ctx, input }) => {
      try {
        const op = await getOperation(ctx.db, input.operationId);
        await requireOpAdmin(ctx, input.operationId, op.orgId);
        await removeOpUser(ctx.db, { ...input, orgId: op.orgId });
        return { ok: true as const };
      } catch (err) {
        rethrow(err);
      }
    }),
});

/**
 * What a person may do inside one operation. **Op admin**, deliberately — an
 * org admin is refused here even though they outrank one, because roles are the
 * "what may you do once inside" half of the split. An org admin who needs them
 * appoints themselves op admin, and that grant is then explicit and auditable.
 *
 * `roles` reads the linked solution's declared role definitions for the picker
 * and exposes no user data, so it is open.
 */
export const userRolesRouter = t.router({
  roles: t.procedure
    .input(z.object({ operationId: operationInput }).default({}))
    .query(async ({ ctx, input }) => {
      try {
        const op = await getOperation(ctx.db, input.operationId);
        const config = await getSolutionConfig(ctx.db, op.solutionId);
        return config.access?.roles ?? [];
      } catch (err) {
        rethrow(err);
      }
    }),
  list: t.procedure
    .input(z.object({ operationId: operationInput }).default({}))
    .query(async ({ ctx, input }) => {
      try {
        const op = await getOperation(ctx.db, input.operationId);
        await requireOpAdmin(ctx, input.operationId, op.orgId);
        return await listUserRoles(ctx.db, input.operationId);
      } catch (err) {
        rethrow(err);
      }
    }),
  put: t.procedure
    .input(z.object({ operationId: operationInput, email: emailInput, roleIds: z.array(z.string().min(1)) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const op = await getOperation(ctx.db, input.operationId);
        await requireOpAdmin(ctx, input.operationId, op.orgId);
        await putUserRoles(ctx.db, input);
        return { ok: true as const };
      } catch (err) {
        rethrow(err);
      }
    }),
});
