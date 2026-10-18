// How a page reaches the record it is about (CLIENT_TRUST_BOUNDARY §7,
// DATA_THROUGH_ACTIVITIES step 3). Every run is about exactly one record, so a
// page that fires activities — or asks a GET, which is an activity — needs one
// of its own before its first frame: the entry has to land somewhere, and the
// page handle and per-page model trim will key on it too.
//
// An **app record** is an ordinary record. Nothing in the record type marks it
// as an app; the only special thing is how you arrive at the record, which is
// what this module is.

import type { RecordInstance } from '@fluxus/engine';
import type { PageDef } from './pageDef';
import type { PageRuntime } from './runtime';

/**
 * Resolve the page's anchor record:
 *
 * - no declaration ⇒ null: a pure view, whose reads stay untraced;
 * - a record type ⇒ the id supplied by the host (the URL's `record` param),
 *   fetched from the server; nothing is created, because the record already
 *   exists. The fetch is also the read check.
 *
 * The lookup goes through the **client**, not the local snapshot (2026-08-16):
 * a pages-only host connects with no records at all.
 *
 * The `'one'` page — a single record per operation, found or created when the
 * page opened — went with apps Part 2 step 2 (APPS_AND_INSTANCES §2.2): the
 * operation's app does its job.
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
  if (!recordId) {
    throw new Error('This page is about a record — open it with a record id');
  }
  return runtime.client.fetchRecord(recordId); // throws if it isn't the caller's to read
}
