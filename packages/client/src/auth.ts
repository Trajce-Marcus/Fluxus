// The browser hosts' Neon Auth seam (RBAC_DESIGN §0): sign-in state and the
// session JWT live here so hosts stay shallow — a host renders a form, calls
// signIn/signUp, then hands `getToken` to FluxusClient.connect. The young
// @neondatabase/neon-js SDK (Managed Better Auth client) is used ONLY in this
// module (prefer-established-deps: young dep behind a seam, shallow usage);
// swapping it for raw Better Auth REST calls touches nothing outside.
//
// Env posture mirrors the server: no auth URL ⇒ `configured` false, hosts skip
// the sign-in gate and connect tokenless (the unconfigured server is open).

import { createAuthClient } from '@neondatabase/neon-js/auth';

export interface AuthSession {
  id: string;
  name: string;
  email: string;
}

export interface HostAuth {
  /** False when no auth URL was provided — skip the sign-in gate entirely. */
  configured: boolean;
  /** The signed-in user, or null (also null when unconfigured). */
  session(): Promise<AuthSession | null>;
  signIn(email: string, password: string): Promise<{ error: string | null }>;
  signUp(name: string, email: string, password: string): Promise<{ error: string | null }>;
  signOut(): Promise<void>;
  /**
   * A currently-valid session JWT for Authorization: Bearer, or null when
   * unconfigured/signed out. Tokens are short-lived (~15 min) — cached here
   * and re-minted just before expiry, so it is safe to call per request.
   */
  getToken(): Promise<string | null>;
}

/** Seconds-since-epoch `exp` claim, without verifying (the server verifies). */
function tokenExp(jwt: string): number {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch {
    return 0;
  }
}

const errText = (error: unknown): string =>
  (error as { message?: string })?.message ?? 'Authentication failed';

export function createHostAuth(authUrl: string | undefined): HostAuth {
  if (!authUrl) {
    return {
      configured: false,
      session: async () => null,
      signIn: async () => ({ error: 'Auth is not configured' }),
      signUp: async () => ({ error: 'Auth is not configured' }),
      signOut: async () => {},
      getToken: async () => null,
    };
  }

  const client = createAuthClient(authUrl);
  let cached: { token: string; exp: number } | null = null;

  // The SDK is inconsistent about failures: some surface as { error }, some
  // as rejected promises (a 401 sign-in rejects). Every method here must
  // settle either way — a rejection escaping signIn wedges the form's busy
  // state, and one escaping getToken turns into a bogus "server unreachable"
  // at connect().
  return {
    configured: true,
    session: async () => {
      try {
        const { data } = await client.getSession();
        const user = data?.user;
        return user ? { id: user.id, name: user.name, email: user.email } : null;
      } catch {
        return null;
      }
    },
    signIn: async (email, password) => {
      cached = null;
      try {
        const { error } = await client.signIn.email({ email, password });
        return { error: error ? errText(error) : null };
      } catch (err) {
        return { error: errText(err) };
      }
    },
    signUp: async (name, email, password) => {
      cached = null;
      try {
        const { error } = await client.signUp.email({ name, email, password });
        return { error: error ? errText(error) : null };
      } catch (err) {
        return { error: errText(err) };
      }
    },
    signOut: async () => {
      cached = null;
      await client.signOut().catch(() => {});
    },
    getToken: async () => {
      // 30s slack: never hand out a token that expires mid-flight.
      if (cached && cached.exp - 30 > Date.now() / 1000) return cached.token;
      try {
        // Direct fetch, not client.token(): the SDK method resolves empty in
        // the browser; GET /token with the session cookie is the verified
        // path (curl-proven against the live managed service).
        const res = await fetch(`${authUrl.replace(/\/$/, '')}/token`, { credentials: 'include' });
        if (!res.ok) return null;
        const { token } = (await res.json()) as { token?: string };
        if (!token) return null;
        cached = { token, exp: tokenExp(token) };
        return token;
      } catch {
        return null;
      }
    },
  };
}
