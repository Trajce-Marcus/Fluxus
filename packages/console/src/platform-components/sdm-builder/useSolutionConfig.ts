// SDM editor's read/write seam over the open solution's config. Reads the
// snapshot the design client holds (sdmClient.config); commit persists the
// whole config (config.put replaces it), reloads the solution to rebuild the
// adapter/pageRuntime, then bumps scopeVersion so every solution-scoped view
// re-reads the fresh snapshot. Editors keep a local draft and call commit.

import { useCallback, useState } from 'react';
import type { SolutionConfig } from '@fluxus/engine';
import { sdmClient, reloadSolution } from '../../sdm-runtime/engine';
import { shellStore } from '../shell/store';

/** A deep clone of the current config — safe to mutate as a draft. */
export function readConfig(): SolutionConfig {
  return structuredClone(sdmClient.config) as SolutionConfig;
}

/** Persist a full config, rebuild the model, and remount solution views. */
export async function commitConfig(next: SolutionConfig): Promise<void> {
  await sdmClient.saveConfig(next);
  await reloadSolution();
  shellStore.set((prev) => ({ ...prev, scopeVersion: prev.scopeVersion + 1 }));
}

/** Dirty registry. An editor's draft dies with its unmount, so the SDM sidebar
 *  has to know about unsaved work *before* it switches tabs — a module-level
 *  flag is the only thing that outlives the editor being replaced. */
export const sdmDirty = { current: false };

export function setSdmDirty(next: boolean): void {
  sdmDirty.current = next;
}

/** Editor-local dirty state mirrored into the registry above. */
export function useDirty(): [boolean, (next: boolean) => void] {
  const [dirty, set] = useState(false);
  const setDirty = useCallback((next: boolean) => {
    set(next);
    setSdmDirty(next);
  }, []);
  return [dirty, setDirty];
}

/** Empty/duplicate ids in an editable list, as one human line ("Duplicate id
 *  'rt_assets' · empty id on 2 items") or null when clean. Gates Save only —
 *  ids mid-typing are always allowed. */
export function idProblems(ids: string[]): string | null {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  let empty = 0;
  for (const raw of ids) {
    const id = raw.trim();
    if (!id) empty++;
    else if (seen.has(id)) dupes.add(id);
    else seen.add(id);
  }
  const parts = [...dupes].map((id) => `Duplicate id '${id}'`);
  if (empty) parts.push(`empty id on ${empty} item${empty === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : null;
}
