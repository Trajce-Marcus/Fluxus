// Records a control hands to an activity, on their way into one named
// attribute (2026-09-08). Pure — the attribute and the ids in, the form's
// starting value out — so the rule can be read and tested on its own.
//
// The seed is always a **list**, because a selection is (one row or forty), and
// the attribute decides what it becomes: a `multi` attribute takes the list, a
// single-valued one takes the only record there is. Handing forty records to an
// attribute that holds one is an authoring mistake, not something to silently
// truncate, so it says so.

import { isBlank } from '@fluxus/engine';
import type { AttributeDef } from '@fluxus/engine';

export interface SeedResult {
  /** The value to start the attribute at, when there is one. */
  value?: unknown;
  /** What is wrong, when the seed cannot be used. */
  error?: string;
}

export function seedValue(attr: AttributeDef, records: readonly string[]): SeedResult {
  if (attr.type_config?.multi) return { value: [...records] };
  if (records.length === 0) return {};
  if (records.length > 1) {
    return { error: `'${attr.key}' holds one record, but ${records.length} were selected` };
  }
  return { value: records[0] };
}

/**
 * The attributes the form **answered for the user** rather than asked about:
 * one the activity declared a `source` for, and the one a control seeded. Both
 * are hidden from the form for the same reason — the click already said what
 * they are — and both must still reach the run, which is why the rule lives
 * here as one function instead of twice inside the form.
 *
 * Only a key that actually holds something counts. A source that resolved to
 * nothing, or a selection that was empty, leaves the attribute visible and
 * ordinary, so it is captured the ordinary way or not at all.
 *
 * Split out 2026-09-18: the form hid both and submitted only the sourced half,
 * so "Add child" on a WBS row created the node at the root and a bulk action
 * carried none of the ticked records.
 */
export function contextFilledKeys(
  attributes: readonly AttributeDef[],
  values: Record<string, unknown>,
  seed: { attribute: string; records: readonly string[] } | undefined,
): Set<string> {
  const filled = (a: AttributeDef): boolean => {
    if (isBlank(values[a.key])) return false;
    if (a.source !== undefined) return true;
    return seed?.attribute === a.key && !seedValue(a, seed.records).error;
  };
  return new Set(attributes.filter(filled).map((a) => a.key));
}
