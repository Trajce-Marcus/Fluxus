// The page builder's engine host (backend stage 2): records and activity runs
// live on @fluxus/server; this module holds the fetched partition snapshot
// and the local engine that evaluates page expressions synchronously. Both
// hosts point at the same scope — one model, many apps, literally.
//
// Platform singletons as before — assigned by initSdmRuntime(), which
// main.tsx awaits before rendering (live bindings: importers always see the
// initialized values). Components never import this; they reach the SDM only
// through the declarative wiring layer (dynamic props in, callbacks out).

import { createEngine, buildGeoModule } from '@fluxus/engine';
import type { ActivityDef, ConfigRaw, Engine, MemoryAdapter, RecordTypeDef, WorkflowDef } from '@fluxus/engine';
import { FluxusClient } from '@fluxus/client';

export let sdmClient: FluxusClient;
export let sdmStore: MemoryAdapter;
export let sdmEngine: Engine;
export let config: ConfigRaw;

export async function initSdmRuntime(): Promise<void> {
  // Deployed builds bake in the live server URL; local dev (var unset) falls
  // back to the client's localhost default.
  sdmClient = await FluxusClient.connect({ url: import.meta.env.VITE_FLUXUS_API_URL });
  sdmStore = sdmClient.adapter;
  config = sdmClient.config;
  sdmEngine = createEngine({
    store: sdmStore,
    config,
    services: [buildGeoModule(sdmStore)],
  });
}

/** Resolve an activity id to its resolved def + owning record type. */
export function findActivity(
  activityId: string
): { activity: ActivityDef; typeDef: RecordTypeDef & { workflow: WorkflowDef } } | null {
  for (const rt of sdmStore.listRecordTypes()) {
    const typeDef = sdmStore.getRecordTypeDef(rt.id);
    const activity = typeDef.workflow.activities.find((a) => a.id === activityId);
    if (activity) return { activity, typeDef };
  }
  return null;
}
