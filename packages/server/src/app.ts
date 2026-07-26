// The HTTP shell: one Hono app serving the tRPC router. Hono handlers speak
// fetch Request/Response natively, so tRPC's fetch adapter mounts directly —
// the same app object runs under Node locally (src/index.ts), AWS Lambda
// (src/lambda.ts) and the Vercel bridge (src/vercel.ts) unchanged.
//
// Auth lives at the tRPC seam (RBAC_DESIGN §0.2): createContext runs per
// request, verifying the bearer JWT into context.user before any procedure —
// one code path under every runtime, because they all pass headers through
// untouched. /health stays open; when auth is configured an invalid/missing
// token rejects the whole call (no anonymous mode).

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, type AppContext } from './router';
import { createAuth, createDbRolesResolver, type Auth } from './auth';

/** What the entries construct once at boot; user is added per request. */
export type AppOptions = Omit<AppContext, 'user' | 'authConfigured'> & { auth?: Auth };

export function createApp(options: AppOptions): Hono {
  const { auth = createAuth(), ...base } = options;
  // The live roles resolver (RBAC stage 1): reads role_assignments for
  // context.user.roles. Enforcement (record-type read filter) is active only
  // when auth is configured — the env stub keeps everything open.
  const roles = base.roles ?? createDbRolesResolver(base.db);
  const app = new Hono();

  app.use('*', cors());
  app.get('/health', (c) => c.json({ ok: true }));

  app.all('/trpc/*', (c) =>
    fetchRequestHandler({
      endpoint: '/trpc',
      req: c.req.raw,
      router: appRouter,
      // Throws UNAUTHORIZED (→ 401) when auth is configured and the token is
      // missing/invalid — tRPC turns a createContext failure into an error
      // response for every call in the batch.
      createContext: async (): Promise<AppContext> => ({
        ...base,
        roles,
        authConfigured: auth.configured,
        user: await auth.authenticate(c.req.header('authorization')),
      }),
    }),
  );

  return app;
}
