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
import type { Engine, MemoryAdapter } from '@fluxus/engine';
import { FluxusClient } from '@fluxus/client';
import { NotificationLog } from './store/NotificationLog';
import { buildNotifyModule } from './services/notify';

// Dormant while hooks run server-side (their notify goes to the server sink);
// stays wired so the manifest validates and the bell returns with the
// unified-log design.
export const notificationLog = new NotificationLog();

export let client: FluxusClient;
export let adapter: MemoryAdapter;
export let engine: Engine;

export async function initHost(): Promise<void> {
  // Deployed builds bake in the live server URL; local dev (var unset) falls
  // back to the client's localhost default.
  client = await FluxusClient.connect({ url: import.meta.env.VITE_FLUXUS_API_URL });
  adapter = client.adapter;
  engine = createEngine({
    store: adapter,
    config: client.config,
    services: [buildNotifyModule(notificationLog), buildGeoModule(adapter)],
  });
  // The stored config was validated at config.put; re-reporting here is a
  // free safety net against server/client engine version drift.
  engine.reportConfigFindings();
}
