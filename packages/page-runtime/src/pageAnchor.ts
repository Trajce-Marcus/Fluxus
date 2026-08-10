// How a page reaches the record it is about (CLIENT_TRUST_BOUNDARY §7,
// DATA_THROUGH_ACTIVITIES step 3). Every run is about exactly one record, so a
// page that fires activities — or asks a GET, which is an activity — needs one
// of its own before its first frame: the entry has to land somewhere, and the
// page handle and per-page model trim will key on it too.
//
// An **app record** is an ordinary record. Nothing in the record type marks it
// as an app; the only special thing is how you arrive at the record, which is
// what this module is.

import type { ActivityDef, RecordInstance } from '@fluxus/engine';
import type { PageDef } from './pageDef';
import type { PageRuntime } from './runtime';

/** The CREATE activity of a record type's workflow, or null if it has none. */
export function createActivityFor(runtime: PageRuntime, typeId: string): ActivityDef | null {
  const typeDef = runtime.store.getRecordTypeDef(typeId);
  return typeDef.workflow.activities.find((a) => a.record_map === 'CREATE') ?? null;
}

/**
 * Resolve the page's anchor record, creating it if this is the first time
 * anyone opened a one-instance page.
 *
 * - no declaration ⇒ null: a pure view, whose reads stay untraced;
 * - `many` ⇒ the id supplied by the host (the URL's `record` param), looked up
 *   in the snapshot; nothing is created, because the record already exists;
 * - `one` ⇒ the single instance for this operation, found or created. The
 *   create runs as an ordinary create activity through the server, so the
 *   record's history starts with "created" exactly like a record raised by
 *   hand — there is no second way to bring a record into being.
 *
 * Two instances of a "one instance" type is an authoring error the model
 * cannot prevent (a record type does not know a page called it single), so the
 * oldest wins and the page stays deterministic rather than flipping between
 * boards. `validatePage` warns at save time, which is where it can be fixed.
 */
export async function resolvePageAnchor(
  runtime: PageRuntime,
  def: PageDef,
  recordId?: string,
): Promise<RecordInstance | null> {
  const declared = def.record;
  if (!declared) return null;

  const known = new Set(runtime.store.listRecordTypes().map((rt) => rt.id));
  if (!known.has(declared.type)) {
    throw new Error(`This page is about '${declared.type}', which is not a record type in this model`);
  }

  if (declared.instances === 'many') {
    if (!recordId) {
      throw new Error('This page is about one record of many — open it with a record id');
    }
    return runtime.store.getRecord(recordId); // throws if it isn't in the snapshot
  }

  const existing = runtime.store.getRecordTypeData(declared.type);
  if (existing.length > 0) {
    return [...existing].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  }

  const create = createActivityFor(runtime, declared.type);
  if (!create) {
    throw new Error(`'${declared.type}' has no create activity, so this page cannot open its record`);
  }
  const result = await runtime.client.runActivity({ activityId: create.id, attributes: {} });
  if (!result.recordId) {
    throw new Error(`'${create.name}' did not create a record for this page to open`);
  }
  return runtime.store.getRecord(result.recordId);
}
