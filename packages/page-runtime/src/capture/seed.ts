// Records a control hands to an activity, on their way into one named
// attribute (2026-09-08). Pure — the attribute and the ids in, the form's
// starting value out — so the rule can be read and tested on its own.
//
// The seed is always a **list**, because a selection is (one row or forty), and
// the attribute decides what it becomes: a `multi` attribute takes the list, a
// single-valued one takes the only record there is. Handing forty records to an
// attribute that holds one is an authoring mistake, not something to silently
// truncate, so it says so.

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
