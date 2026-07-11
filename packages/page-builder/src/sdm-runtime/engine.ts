// The page builder's engine host (Extraction stage 2, fork 2 rulings):
// one platform singleton created at module load — NOT inside React state —
// with its own storage key. Components never import this; they reach the SDM
// only through the declarative wiring layer (procedures in, run-activity
// callbacks out).

import { createEngine, LocalStorageAdapter } from '@fluxus/engine';
import type { ActivityDef, RecordTypeDef, WorkflowDef } from '@fluxus/engine';
import { config } from './config';

export const sdmStore = new LocalStorageAdapter(config, {
  storageKey: 'fluxus:page-builder:records',
});

export const sdmEngine = createEngine({ store: sdmStore, config });

// Config-save-time validation — same posture as the workbench host.
sdmEngine.reportConfigFindings();

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
