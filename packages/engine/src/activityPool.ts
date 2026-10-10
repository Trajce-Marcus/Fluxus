// The activity pool (APPS_AND_INSTANCES Part 1). Activities are stored once per
// solution; a workflow is an ordered list of references into the pool. These
// are the walks every reader of the stored shape shares, so "which activities
// does this workflow have" and "which record types reach this activity" are
// each answered in one place.

import type { ActivityRawDef, ActivityUsage, ClientActivityRawDef, ClientSolutionConfig, SolutionConfig } from './types';

/** The pool activities a workflow lists, in its order. A reference the pool
 *  does not hold is skipped — `validateConfig` reports it at save. */
export function workflowActivities<A extends ClientActivityRawDef>(
  pool: readonly A[],
  workflow: { activities: readonly ActivityUsage[] },
): A[] {
  const byId = new Map(pool.map((a) => [a.id, a]));
  const out: A[] = [];
  for (const usage of workflow.activities) {
    const act = byId.get(usage.activity_ref);
    if (act) out.push(act);
  }
  return out;
}

/** Every activity id some workflow lists — the activities that can run. A pool
 *  activity no workflow includes cannot (§1.5). */
export function includedActivityIds(config: Pick<ClientSolutionConfig, 'workflows'>): Set<string> {
  const ids = new Set<string>();
  for (const wf of config.workflows) {
    for (const usage of wf.activities) ids.add(usage.activity_ref);
  }
  return ids;
}

/**
 * Activity id → the record types whose workflow lists it, in config order.
 * An activity may have several (a shared activity) or none (in the pool only,
 * or only in a workflow no record type points at).
 */
export function recordTypesByActivity(config: Pick<ClientSolutionConfig, 'recordTypes' | 'workflows'>): Map<string, string[]> {
  const wfById = new Map(config.workflows.map((wf) => [wf.id, wf]));
  const out = new Map<string, string[]>();
  for (const rt of config.recordTypes) {
    const wf = wfById.get(rt.workflow_ref);
    for (const usage of wf?.activities ?? []) {
      const types = out.get(usage.activity_ref) ?? [];
      if (!types.includes(rt.id)) types.push(rt.id);
      out.set(usage.activity_ref, types);
    }
  }
  return out;
}

// ── The old shape → the pool ─────────────────────────────────────────────────

/** Two definitions of one activity disagree, so neither can stand for both. */
export class ActivityPoolConflictError extends Error {
  constructor(public activityId: string) {
    super(`Activity '${activityId}' is defined differently in two workflows — the pool can hold only one definition. Make them separate activities first.`);
  }
}

/** A workflow entry that is a whole activity, as stored before the pool. */
const isNested = (entry: unknown): entry is ActivityRawDef & { sort_order?: number } =>
  typeof entry === 'object' && entry !== null && !('activity_ref' in entry) && typeof (entry as { id?: unknown }).id === 'string';

/** True when any workflow still carries its activities inside it. */
export function hasNestedActivities(config: { workflows?: { activities?: unknown[] }[] }): boolean {
  return (config.workflows ?? []).some((wf) => (wf.activities ?? []).some(isNested));
}

/** Key order and `sort_order` aside, are two definitions the same? */
function sameDefinition(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([k, x]) => k !== 'sort_order' && x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * Turn a model stored before the pool into the pool shape — the same rules
 * migration 0022 applies in SQL (one test fixture runs through both):
 *
 *  - each workflow's nested activities are ordered by `sort_order`, then by
 *    their position (a missing `sort_order` sorts last);
 *  - each goes into the pool without `sort_order`, and the workflow keeps a
 *    reference in that order;
 *  - the same id in two workflows with the same definition becomes one pool
 *    activity; with different definitions it is refused, naming the id.
 *
 * A model already in the pool shape comes back unchanged. Run by every path
 * that accepts a whole model: import (`putConfig`) and rollback.
 */
export function toActivityPool(config: SolutionConfig): SolutionConfig {
  if (!hasNestedActivities(config)) {
    return { ...config, activities: config.activities ?? [] };
  }
  const pool = new Map<string, ActivityRawDef>();
  for (const act of config.activities ?? []) pool.set(act.id, act);

  const workflows = config.workflows.map((wf) => {
    const entries = (wf.activities as unknown[]).map((entry, position) => ({ entry, position }));
    const key = (e: { entry: unknown }) => {
      const order = isNested(e.entry) ? e.entry.sort_order : undefined;
      return typeof order === 'number' ? order : Number.POSITIVE_INFINITY;
    };
    entries.sort((a, b) => key(a) - key(b) || a.position - b.position);

    const refs: ActivityUsage[] = [];
    const seen = new Set<string>();
    for (const { entry } of entries) {
      let id: string;
      if (isNested(entry)) {
        const { sort_order: _dropped, ...def } = entry;
        id = def.id;
        const existing = pool.get(id);
        if (existing && !sameDefinition(existing, def)) throw new ActivityPoolConflictError(id);
        if (!existing) pool.set(id, def as ActivityRawDef);
      } else {
        id = (entry as ActivityUsage).activity_ref;
      }
      if (seen.has(id)) continue;
      seen.add(id);
      refs.push({ activity_ref: id });
    }
    return { ...wf, activities: refs };
  });

  return { ...config, activities: [...pool.values()], workflows };
}
