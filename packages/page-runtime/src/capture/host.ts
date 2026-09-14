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

export interface RecordPickerProps {
  targetTypeId: string;
  onSelect: (record: RecordInstance) => void;
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
   * page has always had here). It plugs in when a page can reach records
   * through a GET.
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
