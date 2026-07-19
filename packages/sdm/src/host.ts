// The workbench's connection to @fluxus/server (backend stage 2). Records and
// activity runs live server-side; this module holds the fetched partition
// snapshot and the local engine that keeps every expression (show conditions,
// datasources, availability) evaluating synchronously in the browser.
//
// Module-level singletons as before — one client, one adapter, one engine for
// the lifetime of the app — but assigned by initHost(), which main.tsx awaits
// before rendering. There is no localStorage fallback by ruling: if the
// server is down, boot fails loudly.

import { createEngine, buildGeoModule } from '@fluxus/engine';
import type { ContextUser, Engine, MemoryAdapter } from '@fluxus/engine';
import { FluxusClient, type HostAuth } from '@fluxus/client';
import { createPageRuntime, type PageRuntime } from '@fluxus/page-runtime';
import { NotificationLog } from './store/NotificationLog';
import { buildNotifyModule } from './services/notify';

// Dormant while hooks run server-side (their notify goes to the server sink);
// stays wired so the manifest validates and the bell returns with the
// unified-log design.
export const notificationLog = new NotificationLog();

export let client: FluxusClient;
export let adapter: MemoryAdapter;
export let engine: Engine;
// The run-a-page cluster's injected handle (@fluxus/page-runtime): renders
// published pages in the workbench — the first step of workbench → Runtime app.
export let pageRuntime: PageRuntime;

export async function initHost(auth?: HostAuth): Promise<void> {
  // The signed-in identity: bearer token on every tRPC call, and the local
  // engine's context.user for UI-side expression parity (roles stubbed []
  // until RBAC stage 1). Auth unconfigured → both stay undefined (demo stub).
  const session = auth?.configured ? await auth.session() : null;
  const user: ContextUser | undefined = session
    ? { id: session.id, name: session.name, email: session.email, roles: [] }
    : undefined;
  // Deployed builds bake in the live server URL; local dev (var unset) falls
  // back to the client's localhost default.
  client = await FluxusClient.connect({
    url: import.meta.env.VITE_FLUXUS_API_URL,
    getToken: auth?.configured ? auth.getToken : undefined,
  });
  adapter = client.adapter;
  engine = createEngine({
    store: adapter,
    config: client.config,
    services: [buildNotifyModule(notificationLog), buildGeoModule(adapter)],
    user,
  });
  pageRuntime = createPageRuntime({ client });
  // The stored config was validated at config.put; re-reporting here is a
  // free safety net against server/client engine version drift.
  engine.reportConfigFindings();
}
