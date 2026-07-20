// SDM editor's read/write seam over the open solution's config. Reads the
// snapshot the design client holds (sdmClient.config); commit persists the
// whole config (config.put replaces it), reloads the solution to rebuild the
// adapter/pageRuntime, then bumps scopeVersion so every solution-scoped view
// re-reads the fresh snapshot. Editors keep a local draft and call commit.

import type { ConfigRaw } from '@fluxus/engine';
import { sdmClient, reloadSolution } from '../../sdm-runtime/engine';
import { shellStore } from '../shell/store';

/** A deep clone of the current config — safe to mutate as a draft. */
export function readConfig(): ConfigRaw {
  return structuredClone(sdmClient.config) as ConfigRaw;
}

/** Persist a full config, rebuild the model, and remount solution views. */
export async function commitConfig(next: ConfigRaw): Promise<void> {
  await sdmClient.saveConfig(next);
  await reloadSolution();
  shellStore.set((prev) => ({ ...prev, scopeVersion: prev.scopeVersion + 1 }));
}
