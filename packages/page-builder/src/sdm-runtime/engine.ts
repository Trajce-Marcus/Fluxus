// The page builder's SDM bootstrap (backend stage 2; slimmed at the
// page-runtime extraction): records and activity runs live on @fluxus/server;
// connect() fetches the scope's config + partition + pages, and the whole
// runtime cluster now reaches the SDM through the PageRuntime handle rather
// than singletons of its own. Both hosts point at the same scope — one model,
// many apps, literally.
//
// Platform singletons as before — assigned by initSdmRuntime(), which
// api.ts awaits before rendering (live bindings: importers always see the
// initialized values). Components never import this; they reach the SDM only
// through the declarative wiring layer (dynamic props in, callbacks out).

import { FluxusClient } from '@fluxus/client';
import { createPageRuntime, type PageRuntime } from '@fluxus/page-runtime';

export let sdmClient: FluxusClient;
export let pageRuntime: PageRuntime;

export async function initSdmRuntime(): Promise<void> {
  // Deployed builds bake in the live server URL; local dev (var unset) falls
  // back to the client's localhost default.
  sdmClient = await FluxusClient.connect({ url: import.meta.env.VITE_FLUXUS_API_URL });
  pageRuntime = createPageRuntime({ client: sdmClient });
}
