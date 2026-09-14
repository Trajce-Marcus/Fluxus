// Which activities apply to a record, right now.
//
// The model already knows: a record type's workflow lists them, and each one's
// `show_condition` says whether it applies to this record in this state. That
// is the model's answer to *may I do this?* — the question the 2026-08-26
// ruling reserved for access control and availability, as against wiring, which
// is the author's business and stays visible.
//
// Pure, so it holds without a DOM or a client: the caller passes the evaluator.

import type { ActivityDef } from '@fluxus/engine';

/** One act a person may take on the record, in the order the workflow declares. */
export interface ActivityOption {
  id: string;
  name: string;
}

/** Evaluates one `show_condition` against the record. */
export type ConditionEvaluator = (source: string) => Promise<unknown>;

/**
 * The record-level activities that apply.
 *
 * - **CREATE and GET are excluded.** A CREATE has no anchor — it is a button on
 *   a collection, not on a record — and a GET answers a question rather than
 *   being an act someone takes (DSL_SPEC §5a). The workbench's own
 *   `AvailableActivities` draws the same line.
 * - **A condition that throws hides its activity.** Availability fails closed,
 *   exactly as the engine's gate does: a broken access rule must never wave an
 *   activity through. The reason goes to the console, since the person looking
 *   at the page can do nothing with it.
 * - **Conditions are evaluated together**, because each is a round trip in a
 *   host whose expressions are async.
 */
export async function availableActivities(
  activities: ActivityDef[],
  evaluate: ConditionEvaluator,
  onWarn: (message: string) => void = (m) => console.warn(m),
): Promise<ActivityOption[]> {
  const candidates = activities
    .filter((a) => a.record_map !== 'CREATE' && a.record_map !== 'GET')
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const verdicts = await Promise.all(candidates.map(async (activity) => {
    const condition = activity.show_condition;
    if (!condition) return true;
    try {
      return Boolean(await evaluate(condition));
    } catch (err) {
      onWarn(`'${activity.id}' availability condition failed, so it is not offered: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }));

  return candidates
    .filter((_, i) => verdicts[i])
    .map((activity) => ({ id: activity.id, name: activity.name }));
}
