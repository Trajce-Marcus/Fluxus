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
import { TRPCError } from '@trpc/server';
import { DEMO_USER, type ContextUser } from '@fluxus/engine';

export type AuthUser = ContextUser;

/**
 * The two-lookup roles-resolver seam (§0.4) — one lookup per plane, both
 * stubbed at auth build. However §2a lands (governance solution or bespoke
 * table), it plugs into these two functions; nothing else moves.
 */
export interface RolesResolver {
  /** Runtime plane: role ids the user holds in the operation → `context.user.roles`. */
  runtimeRoles(userId: string, operation: string): Promise<string[]>;
  /**
   * Console plane: the user's implementer level on the solution (stand-in:
   * operation key). Server-only — consumed by config.put/page save, never in
   * the script environment.
   */
  implementerLevel(userId: string, operation: string): Promise<'read' | 'write' | 'admin'>;
}

/** Stage-1/2 stubs: no runtime roles, implementer plane open (everyone admin). */
export const stubRolesResolver: RolesResolver = {
  runtimeRoles: async () => [],
  implementerLevel: async () => 'admin',
};

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
