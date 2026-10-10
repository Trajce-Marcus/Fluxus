// SDM editor's read/write seam over the open solution's config. Reads the
// snapshot the design client holds (sdmClient.config); saves go **per entity**
// — the attribute you touched, not the graph you happen to be holding — then
// reload the solution to rebuild the adapter/pageRuntime and bump scopeVersion
// so every solution-scoped view re-reads the fresh snapshot.
//
// Why per entity: the change unit is one entity while the consistency unit is
// the whole graph. Saving the whole config conflated the two, so two people
// editing two different record types had no logical conflict yet the second
// save silently dropped the first. The server still validates everything, under
// a per-solution lock — only the write narrows.

import { useCallback, useState } from 'react';
import type { ActivityRawDef, AttributeDef, RecordTypeDef, RoleDef, SolutionConfig, WorkflowRawDef } from '@fluxus/engine';
import type { MenuItem } from '@fluxus/client';
import { sdmClient, reloadSolution } from '../../sdm-runtime/engine';
import { shellStore } from '../shell/store';

/** A deep clone of the current config — safe to mutate as a draft. */
export function readConfig(): SolutionConfig {
  return structuredClone(sdmClient.config);
}

/** The config as it stood when the editor mounted: the baseline a per-entity
 *  save diffs against, to know which entities actually changed. Stable for the
 *  editor's life, and every save remounts it, so it cannot drift unnoticed. */
export function useLoadedConfig(): SolutionConfig {
  return useState(readConfig)[0];
}

/** Rebuild the model and remount every solution-scoped view. */
export async function refreshSolutionViews(): Promise<void> {
  await reloadSolution();
  shellStore.set((prev) => ({ ...prev, scopeVersion: prev.scopeVersion + 1 }));
}

/**
 * Save one collection entity by entity: put what changed, delete what the
 * editor dropped. Each call is its own server transaction, validated against
 * the whole graph, so an edit that would dangle fails on its own and leaves the
 * rest saved.
 *
 * Puts run before deletes because a rename is put(new) + delete(old), and the
 * delete must be free to fail while anything still references the old identity.
 */
async function saveEntities<T>(
  loaded: T[],
  current: T[],
  id: (entity: T) => string,
  put: (entity: T) => Promise<void>,
  remove: (id: string) => Promise<void>,
): Promise<void> {
  const before = new Map(loaded.map((e) => [id(e), JSON.stringify(e)]));
  const present = new Set(current.map(id));
  for (const entity of current) {
    if (before.get(id(entity)) !== JSON.stringify(entity)) await put(entity);
  }
  for (const key of before.keys()) {
    if (!present.has(key)) await remove(key);
  }
}

export const saveAttributes = (loaded: AttributeDef[], current: AttributeDef[]) =>
  saveEntities(loaded, current, (a) => a.key, (a) => sdmClient.putAttribute(a), (k) => sdmClient.deleteAttribute(k));

export const saveRecordTypes = (loaded: RecordTypeDef[], current: RecordTypeDef[]) =>
  saveEntities(loaded, current, (r) => r.id, (r) => sdmClient.putRecordType(r), (id) => sdmClient.deleteRecordType(id));

/** The activity pool. New and changed activities are put before any delete,
 *  and a delete fails while a workflow still lists the activity. */
export const saveActivities = (loaded: ActivityRawDef[], current: ActivityRawDef[]) =>
  saveEntities(loaded, current, (a) => a.id, (a) => sdmClient.putActivity(a), (id) => sdmClient.deleteActivity(id));

/**
 * A workflow stores references only. Every per-entity save validates the whole
 * model, so the order must never pass through an invalid state
 * (APPS_AND_INSTANCES §1.6): when a CREATE moves between workflows, the one
 * losing it is saved first, or for a moment two record types would reach it.
 *
 * So a workflow that drops an activity another workflow picks up in the same
 * save goes before that workflow — whatever else either of them added, which
 * is what an "adds nothing goes first" rule got wrong (cold test, 2026-10-10).
 * Otherwise, workflows that only drop go before ones that add, then list order.
 * A swap (each picks up what the other drops) has no valid order; it keeps the
 * fallback and the server says which CREATE clashed.
 */
export const saveWorkflows = (loaded: WorkflowRawDef[], current: WorkflowRawDef[]) => {
  const refs = (w: WorkflowRawDef) => new Set(w.activities.map((r) => r.activity_ref));
  const before = new Map(loaded.map((w) => [w.id, refs(w)]));
  const gains = new Map(current.map((w) => [w.id, [...refs(w)].filter((id) => !before.get(w.id)?.has(id))]));
  const drops = new Map(current.map((w) => {
    const now = refs(w);
    return [w.id, [...(before.get(w.id) ?? [])].filter((id) => !now.has(id))];
  }));
  // Must `a` be saved before `b`? It must when `a` drops something `b` gains.
  const precedes = (a: WorkflowRawDef, b: WorkflowRawDef) =>
    a.id !== b.id && drops.get(a.id)!.some((id) => gains.get(b.id)!.includes(id));

  const pending = [...current].sort((a, b) => Number(gains.get(a.id)!.length > 0) - Number(gains.get(b.id)!.length > 0));
  const ordered: WorkflowRawDef[] = [];
  while (pending.length > 0) {
    // The first workflow nothing still pending has to precede; in a cycle, the first.
    const i = Math.max(0, pending.findIndex((w) => !pending.some((p) => precedes(p, w))));
    ordered.push(...pending.splice(i, 1));
  }
  return saveEntities(loaded, ordered, (w) => w.id, (w) => sdmClient.putWorkflow(w), (id) => sdmClient.deleteWorkflow(id));
};

export const saveRoles = (loaded: RoleDef[], current: RoleDef[]) =>
  saveEntities(loaded, current, (r) => r.id, (r) => sdmClient.putRole(r), (id) => sdmClient.deleteRole(id));

/** The menu is the config's one non-collection field: it saves whole. */
export const saveDefaultMenu = (menu: MenuItem[]) => sdmClient.putDefaultMenu(menu);

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
