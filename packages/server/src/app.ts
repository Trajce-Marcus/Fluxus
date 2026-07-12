// The HTTP shell: one Hono app serving the tRPC router. Hono handlers speak
// fetch Request/Response natively, so tRPC's fetch adapter mounts directly —
// the same app object runs under Node locally (src/index.ts) and AWS Lambda
// (src/lambda.ts) unchanged.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, type AppContext } from './router';

export function createApp(context: AppContext): Hono {
  const app = new Hono();

  app.use('*', cors());
  app.get('/health', (c) => c.json({ ok: true }));

  app.all('/trpc/*', (c) =>
    fetchRequestHandler({
      endpoint: '/trpc',
      req: c.req.raw,
      router: appRouter,
      createContext: () => context,
    }),
  );

  return app;
}
