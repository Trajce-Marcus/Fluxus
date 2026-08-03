// Auth (RBAC_COMPACT "Auth"; RBAC_DESIGN §0, settled rev 6): bearer JWT
// verified per request against Neon Auth's (Managed Better Auth) JWKS.
// Env-driven posture — NEON_AUTH_URL unset ⇒ the demo stub and everything
// open (fresh clone, tests, local dev); set ⇒ a valid session is REQUIRED on
// every tRPC call, no anonymous mode. The verification path is identical
// either way; the stub branch can be deleted later without redesign.
//
// Verified against live Neon docs 2026-07-19: JWKS at
// `${NEON_AUTH_URL}/.well-known/jwks.json`, EdDSA (Ed25519) tokens, issuer =
// the auth URL's origin, ~15-minute expiry; clients mint tokens with
// `authClient.token()` (@neondatabase/neon-js).

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { and, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { DEMO_USER, type ContextUser } from '@fluxus/engine';
import type { Db } from './db/client';
import { solUsers, userRoles } from './db/schema';

export type AuthUser = ContextUser;

/**
 * The two-lookup roles-resolver seam (§0.4) — one lookup per plane, both
 * stubbed at auth build. However §2a lands (governance solution or bespoke
 * table), it plugs into these two functions; nothing else moves.
 */
export interface RolesResolver {
  /** Runtime plane: role ids the user holds in the operation →
   *  `context.user.roles`. Keyed on **email** (2026-08-02) like every other
   *  grant, so roles can be granted before the person has ever signed in. */
  runtimeRoles(email: string | null | undefined, operation: string): Promise<string[]>;
  /**
   * Design plane: the user's level on the solution (`sol_users`). Server-only —
   * consumed by config.put/page save/publish, never in the script environment.
   * `'none'` = not a user of this solution.
   *
   * Keyed on **email**, not the auth user id (2026-08-02) — levels are appointed
   * from the org pool, whose users may not have signed in yet. A caller with
   * no email cannot match a row, so they get `'none'` once levels are declared.
   */
  solUserLevel(email: string | null | undefined, solutionId: string): Promise<'none' | 'read' | 'write'>;
}

/** Stage-1/2 stubs: no runtime roles, design plane open (everyone may build).
 *  Only ever reached when auth is unconfigured — the live resolver is strict. */
export const stubRolesResolver: RolesResolver = {
  runtimeRoles: async () => [],
  solUserLevel: async () => 'write',
};

/**
 * The live resolver. `runtimeRoles` reads `user_roles` (RBAC stage 1) —
 * populates `context.user.roles`, drives record-type + activity enforcement.
 *
 * `solUserLevel` reads `sol_users` (RBAC stage 2 / M5). **Strict, not dormant**
 * (ruled 2026-08-02, replacing the dormant-until-declared adoption posture): you
 * get access to a solution only if you are in its user list, exactly as with an
 * operation. One rule now covers both — "you belong to a thing, or you do not" —
 * instead of two surfaces answering the same shape of question differently.
 *
 * The consequence is a bootstrap, handled the same way as the operation gate:
 * `solutions.create` writes its creator in as a `write` user, and
 * `bootstrapOrgAdmin` covers solutions that already have nobody. The demo
 * posture (auth unconfigured) is still open at the caller.
 */
export function createDbRolesResolver(db: Db): RolesResolver {
  return {
    runtimeRoles: async (email, operationId) => {
      const key = email?.trim().toLowerCase();
      if (!key) return [];
      const rows = await db
        .select({ roleIds: userRoles.roleIds })
        .from(userRoles)
        .where(and(eq(userRoles.operationId, operationId), eq(userRoles.email, key)));
      return rows[0]?.roleIds ?? [];
    },
    solUserLevel: async (email, solutionId) => {
      const rows = await db
        .select({ email: solUsers.email, level: solUsers.level })
        .from(solUsers)
        .where(eq(solUsers.solutionId, solutionId));
      const key = email?.trim().toLowerCase();
      if (!key) return 'none'; // no email ⇒ no row can match
      return rows.find((r) => r.email === key)?.level ?? 'none';
    },
  };
}

export interface Auth {
  /** True when Neon Auth env vars are set — a valid session is then required. */
  configured: boolean;
  /**
   * Header → verified user (roles resolved separately, per operation).
   * Unconfigured: always the demo stub. Configured: missing/invalid token
   * throws UNAUTHORIZED.
   */
  authenticate(authorizationHeader: string | null | undefined): Promise<AuthUser>;
}

const unauthorized = (message: string) => new TRPCError({ code: 'UNAUTHORIZED', message });

/**
 * The platform tier (ruled 2026-08-03) — us, the vendor, above every org.
 * Registering an org is its work, because an org cannot create itself: the org
 * admin is the root of authority *within* an org, and there is no org to be
 * admin of yet.
 *
 * **An env allowlist, not a table**, and deliberately so. A `platform_users`
 * table recreates one tier up exactly the chicken-and-egg `bootstrapOrgAdmin`
 * exists to escape — who writes the first platform admin? The env is already
 * outside the request path, which is the only property the first row of any
 * tier needs. Platform admins are a handful of our own people, so the audit
 * and lifecycle a table would buy has nothing yet to record. `isPlatformAdmin`
 * is the single seam: swapping it for a table later touches no caller.
 *
 * Empty/unset ⇒ nobody is a platform admin, even in demo posture. This is the
 * one gate that does NOT fall open when auth is unconfigured: every other check
 * guards one org's data from its own people, where "no identity ⇒ nothing to
 * gate on" holds, while this one guards every org from everyone. An unset
 * allowlist on a machine with no auth would otherwise mean anyone who can reach
 * the port can register orgs.
 */
export function platformAdmins(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (env.FLUXUS_PLATFORM_ADMINS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isPlatformAdmin(email: string | null | undefined, env?: Record<string, string | undefined>): boolean {
  const key = email?.trim().toLowerCase();
  return key ? platformAdmins(env).has(key) : false;
}

export function createAuth(env: Record<string, string | undefined> = process.env): Auth {
  // NEON_AUTH_URL per Neon's backend guides; NEON_AUTH_BASE_URL is the name
  // their Next.js SDK docs use — accept both, one meaning.
  const baseUrl = env.NEON_AUTH_URL ?? env.NEON_AUTH_BASE_URL;
  if (!baseUrl) {
    return { configured: false, authenticate: async () => DEMO_USER };
  }

  // createRemoteJWKSet caches keys and refetches on unknown-kid — the "cached
  // JWKS" of §0.2; one instance for the process lifetime.
  const jwks = createRemoteJWKSet(new URL(`${baseUrl.replace(/\/$/, '')}/.well-known/jwks.json`));
  const issuer = new URL(baseUrl).origin;

  return {
    configured: true,
    authenticate: async (header) => {
      if (!header?.startsWith('Bearer ')) {
        throw unauthorized('Authentication required — send Authorization: Bearer <token>');
      }
      let payload;
      try {
        ({ payload } = await jwtVerify(header.slice('Bearer '.length), jwks, { issuer }));
      } catch {
        // Expired, bad signature, wrong issuer — all one answer; details
        // would only help an attacker and the client's fix is identical:
        // refresh the session token.
        throw unauthorized('Invalid or expired session token');
      }
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw unauthorized('Session token has no subject');
      }
      // Better Auth JWTs carry the user object as claims; be defensive about
      // optional fields — the id is the only thing enforcement hangs off.
      const email = typeof payload.email === 'string' ? payload.email : null;
      const name = typeof payload.name === 'string' && payload.name.length > 0 ? payload.name : (email ?? payload.sub);
      return { id: payload.sub, name, email, roles: [] };
    },
  };
}
