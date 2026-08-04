// The tiers, as request checks (USERS.md §3). Every procedure in every router
// starts with one of these; the `users/` module answers the same questions
// against the database, and this file is the layer that knows about the caller.
//
// Authority has one root — the **org owner** — and flows downward only. No tier
// appoints its own tier, and the checks are deliberately NOT nested:
//
//   requireOrgOwner   — `orgs.owner_email`. Appoints org admins, nothing else.
//   requireOrgAdmin   — `org_admins`. Identity: who exists, who gets in, who
//                       builds, who administers an operation.
//   requireOpAdmin    — `op_admins` FOR THIS OPERATION. Authorization: what
//                       people may do once inside it.
//   requireSolAdmin   — `sol_admins`. The design plane: build this solution.
//   requireOpUser     — entry to an operation, which an op-admin row implies.
//
// **An org admin is not implicitly an op admin.** That is the governing split
// (identity vs authorization) and it is intentional: an org admin who wants to
// manage roles appoints themselves op admin first. A speed bump, not a wall —
// the point is that the grant is explicit and auditable rather than ambient.
//
// Env posture, uniformly: auth unconfigured ⇒ every check here falls open,
// because with no identity there is nothing to gate on. The one exception is
// the platform tier, which guards every org from everyone; its reasoning is on
// `requirePlatformAdmin`.

import { TRPCError } from '@trpc/server';
import { DEMO_USER } from '@fluxus/engine';
import { isPlatformAdmin, stubRolesResolver, type AuthUser } from './auth';
import type { AppContext } from './trpc';
import { DEFAULT_ORG } from './trpc';
import {
  isAnySolAdmin,
  isOpAdmin as isOpAdminRow,
  isOpUser as isOpUserRow,
  isOrgAdmin as isOrgAdminRow,
  isOrgOwner as isOrgOwnerRow,
} from './users';

/** The caller's email, normalised, or null when they have none. */
function callerEmail(ctx: AppContext): string | null {
  const email = (ctx.user ?? DEMO_USER).email?.trim().toLowerCase();
  return email || null;
}

export async function isOrgOwner(ctx: AppContext, orgId: string = DEFAULT_ORG): Promise<boolean> {
  const email = callerEmail(ctx);
  return email ? isOrgOwnerRow(ctx.db, { email, orgId }) : false;
}

export async function isOrgAdmin(ctx: AppContext, orgId: string = DEFAULT_ORG): Promise<boolean> {
  const email = callerEmail(ctx);
  return email ? isOrgAdminRow(ctx.db, { email, orgId }) : false;
}

export async function isOpAdmin(ctx: AppContext, operationId: string, orgId: string = DEFAULT_ORG): Promise<boolean> {
  const email = callerEmail(ctx);
  return email ? isOpAdminRow(ctx.db, { operationId, email, orgId }) : false;
}

export async function requireOrgOwner(ctx: AppContext, orgId: string = DEFAULT_ORG): Promise<void> {
  if (!ctx.authConfigured) return;
  if (await isOrgOwner(ctx, orgId)) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires the organisation owner' });
}

export async function requireOrgAdmin(ctx: AppContext, orgId: string = DEFAULT_ORG): Promise<void> {
  if (!ctx.authConfigured) return;
  if (await isOrgAdmin(ctx, orgId)) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires organisation admin' });
}

export async function requireOpAdmin(ctx: AppContext, operationId: string, orgId: string = DEFAULT_ORG): Promise<void> {
  if (!ctx.authConfigured) return;
  if (await isOpAdmin(ctx, operationId, orgId)) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: `Requires admin of operation '${operationId}'` });
}

/**
 * Design-plane check for config/page writes — keyed on the solution, because the
 * design plane attaches to the design artifact. One grade: you build it or you
 * do not (2026-08-04). Routed through the roles resolver rather than the table
 * directly, so the stub posture stays the seam it has always been.
 */
export async function requireSolAdmin(ctx: AppContext, solutionId: string): Promise<void> {
  if (!ctx.authConfigured) return;
  const user = ctx.user ?? DEMO_USER;
  const roles = ctx.roles ?? stubRolesResolver;
  // Email, not id — sol admins are appointed from the pool, whose people may
  // never have signed in.
  if (await roles.isSolAdmin(user.email, solutionId)) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires being an admin of this solution' });
}

/**
 * The entry gate: may this caller open this operation at all? Distinct from
 * roles — someone in the operation with no roles enters and sees nothing
 * (valid); roles without entry must never grant it.
 *
 * **Strict, not dormant**: an operation with nobody in it admits nobody.
 * Deliberately unlike the record-type/page surfaces, which are
 * dormant-until-declared — those ask "what may you see", and an un-configured
 * model staying visible is a reasonable adoption default. This asks "may you
 * enter", and an operation with no users listed has, literally, no users. An
 * empty list is an answer, not an absence of one.
 *
 * No design-plane bypass: someone who builds the solution is added to the
 * operation like anyone else. The Console reaches an operation's records
 * through this same gate as the Runtime.
 */
export async function requireOpUser(ctx: AppContext, operationId: string, user: AuthUser, orgId: string = DEFAULT_ORG): Promise<void> {
  if (!ctx.authConfigured) return;
  const email = user.email?.trim().toLowerCase();
  if (email && (await isOpUserRow(ctx.db, { operationId, email, orgId }))) return;
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: `You are not a user of operation '${operationId}'`,
  });
}

/**
 * The platform tier (ruled 2026-08-03) — above every org, and the only caller
 * that may read across them or register a new one. Backed by an env allowlist
 * (`isPlatformAdmin`), not a table; the reasoning is on that function.
 *
 * Note what this check does NOT do: fall open when auth is unconfigured. Every
 * other gate here guards one org's data from that org's own people, so with no
 * identity there is genuinely nothing to gate on. This one guards every org
 * from everyone, and an unconfigured dev machine must not be a machine where
 * anyone can register orgs.
 */
export async function requirePlatformAdmin(ctx: AppContext): Promise<void> {
  if (isPlatformAdmin(ctx.user?.email)) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires platform admin' });
}

/**
 * May this caller open the Console at all? **Derived, never a stored flag** — a
 * separate bit could contradict the grants it summarises. Three ways in:
 * owning the org, administering it, or building any of its solutions.
 *
 * The owner's derivation is the one that matters on a fresh organisation: they
 * hold no grants yet, and without this there would be nobody able to open the
 * screen that appoints the first org admin.
 */
export async function hasConsoleAccess(ctx: AppContext, orgId: string = DEFAULT_ORG): Promise<boolean> {
  if (!ctx.authConfigured) return true;
  const email = callerEmail(ctx);
  if (!email) return false;
  if (await isOrgOwnerRow(ctx.db, { email, orgId })) return true;
  if (await isOrgAdminRow(ctx.db, { email, orgId })) return true;
  return isAnySolAdmin(ctx.db, email);
}
