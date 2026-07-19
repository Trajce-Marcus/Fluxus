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

import { ConsoleClient, createHostAuth, FluxusClient } from '@fluxus/client';
import { createPageRuntime, type PageRuntime } from '@fluxus/page-runtime';
import { signInGate } from './SignIn';

export let sdmClient: FluxusClient;
export let pageRuntime: PageRuntime;
// The Console-plane client (cross-operation admin: solutions/operations CRUD,
// and later publish/versions/governance). Shares the host's auth transport.
export let consoleClient: ConsoleClient;

export async function initSdmRuntime(): Promise<void> {
  // Auth gate (RBAC_DESIGN §0): VITE_NEON_AUTH_URL unset ⇒ demo posture, no
  // sign-in; set ⇒ a session is required before connect() — the overlay form
  // holds every pending mount until sign-in succeeds.
  const auth = createHostAuth(import.meta.env.VITE_NEON_AUTH_URL);
  if (auth.configured && !(await auth.session())) await signInGate(auth);
  // Deployed builds bake in the live server URL; local dev (var unset) falls
  // back to the client's localhost default.
  const url = import.meta.env.VITE_FLUXUS_API_URL;
  const getToken = auth.configured ? auth.getToken : undefined;
  sdmClient = await FluxusClient.connect({ url, getToken });
  consoleClient = ConsoleClient.create({ url, getToken });
  pageRuntime = createPageRuntime({ client: sdmClient });
}
