// What the capture form needs from whatever is hosting it (2026-08-16).
//
// The form was the workbench's, welded to `useWorkbench()`. Pages had a
// 60-line imitation that drew every attribute as a text box. One form now
// serves both, so the four things it actually reaches for — evaluate an
// expression, reach a GET, upload a file, resolve a reference's label — become
// this interface, and each host supplies its own.
//
// Deliberately NOT the store: a host hands over *evaluation*, not the data
// behind it. That is what lets the same form run where the browser holds a
// record snapshot (the workbench) and where it holds none (a page).

import { createContext, createElement, useContext, type ComponentType, type ReactNode } from 'react';
import type { GetQueryFn, RecordInstance, RoundInvoke } from '@fluxus/engine';
import type { UploadService } from '@fluxus/client';

/** The roots a capture-time expression evaluates against. */
export interface CaptureScript {
  /** The form's values, typed per attribute — the `attributes` root. */
  attributes: Record<string, unknown>;
  anchorRecord: RecordInstance | null;
  /**
   * The record the page was showing when this run was launched — `context.page.record`
   * (2026-09-15). It is what a CREATE has instead of an anchor: `context.record`
   * is null there, so the record a new one is created *under* reaches the form
   * this way. Null wherever there is no page, the workbench included.
   */
  pageRecord?: RecordInstance | null;
  activity: { id: string; name: string };
  /** Embedding-point extras, e.g. `{ value }` for a validation rule. */
  extras?: Record<string, unknown>;
  /**
   * Supplied by the form when the expression may name a GET, so the host wires
   * it into the evaluator as the `invoke` built-in. Absent on the conditions
   * that re-run per keystroke — those read what the browser already has.
   */
  invoke?: RoundInvoke;
}

/**
 * One candidate as the GET answered it — a DslRecord (`{id, type, fields}`) or
 * a projected row. Resolved against `keyField`/`displayField` by the picker.
 */
export type RecordPickerCandidate = unknown;

/**
 * What a record picker is handed. Two components fill this slot and nothing
 * else does: the workbench's `RecordPickerDialog`, which browses the record
 * snapshot, and this package's `SearchRecordPicker`, which searches over a GET.
 *
 * **The picker supplies the label** (RECORD_PICKER §6). It used to hand back a
 * record and the form resolved the label off the snapshot — which on a page
 * returns the raw id, because a page holds no snapshot. So the display field
 * travels *in* and the readable label travels *out*.
 */
export interface RecordPickerProps {
  targetTypeId: string;
  /**
   * Which field of a candidate to show. Comes from the attribute's declared
   * field, resolved by the form — the picker is told, it does not work it out.
   */
  displayField?: string;
  /** Which field of a candidate holds the stored value. Default `id`. */
  keyField?: string;
  /** Extra fields drawn as secondary text on a row — `3.4` beside a name. */
  columns?: string[];
  /**
   * Candidates from the attribute's datasource. **The form evaluates it, not
   * the picker** (§10): every other caller of the evaluate-fetch-evaluate
   * helper is a form field, and having the picker evaluate would make the two
   * fills of this slot structurally different components. Absent in the
   * workbench, which browses the snapshot instead.
   */
  rows?: RecordPickerCandidate[] | null;
  /** A search is in flight. */
  loading?: boolean;
  /** The datasource failed — shown in place of the list, with the message. */
  error?: string | null;
  /**
   * Ask for candidates matching a term. The picker debounces and applies its
   * own minimum length before calling this; the form does the fetching.
   */
  onSearch?: (term: string) => void;
  /** The stored value, and something a person can read. */
  onSelect: (value: string, label: string) => void;
  onClose: () => void;
}

export interface CaptureHost {
  /** Evaluate a FluxScript expression in capture posture. Synchronous — the
   *  waiting on GET answers is the form's, through `evaluateWithGets`. */
  evaluate(source: string, script: CaptureScript): unknown;
  /**
   * How a datasource that names a GET reaches it. Absent ⇒ `invoke` fails
   * loudly and such a datasource reports its error in place of the dropdown.
   */
  query?: GetQueryFn;
  /** File/photo capture (ATTRIBUTE_TYPES_FILES_SCALARS §10). */
  uploads: UploadService;
  /** A stored reference id → something a person can read. */
  resolveDisplayLabel(fkRecordType: string, fkDisplayField: string | undefined, rawId: string): string;
  resolveAttributeDisplayField(typeId: string, attrKey: string): string | undefined;
  /**
   * What a record type's field points at — called with the field a reference
   * attribute names (`type_config.field`), so one target is stated once.
   */
  resolveAttributeTarget(typeId: string, fieldKey: string): string | undefined;
  /**
   * How a reference attribute is picked. Injected because browsing records to
   * choose one is the workbench's own dialog and needs the record snapshot a
   * page does not have; a host that omits it gets a plain id input (what a
   * page has always had here).
   *
   * This is the **no-datasource** path only. An attribute that names a
   * `datasource` gets `SearchRecordPicker` from the form itself, on every host,
   * because searching over a GET needs nothing the host has not already
   * supplied (`evaluate` and `query`).
   */
  recordPicker?: ComponentType<RecordPickerProps>;
}

const Ctx = createContext<CaptureHost | null>(null);

export function CaptureHostProvider({ host, children }: { host: CaptureHost; children: ReactNode }) {
  return createElement(Ctx.Provider, { value: host }, children);
}

export function useCaptureHost(): CaptureHost {
  const host = useContext(Ctx);
  if (!host) throw new Error('useCaptureHost must be used within a CaptureHostProvider');
  return host;
}
