import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { evaluateExpression, executeScript, FluxFailError } from '@fluxus/dsl';
import type { RecordTypeDef, WorkflowDef, RecordInstance, ActivityDef, ReverseRefEntry, RunActivityResult } from '../types';
import { LocalStorageAdapter } from '../store/LocalStorageAdapter';
import { config } from '../config';
import { buildEvalHost, coerceCaptured, type ScriptContext } from '../dsl/bridge';
import { reportConfigFindings } from '../dsl/validateConfig';

// Module-level singleton — one adapter for the lifetime of the app
const adapter = new LocalStorageAdapter(config);

// Config-save-time validation: with the SDM still file-edited, save time is app start.
reportConfigFindings(config);

// Activity-level show_condition — the availability gate. Strict boolean: only
// `true` makes the activity available. Evaluation errors FAIL CLOSED (unlike
// attribute show_conditions, which leave the input visible): this is an access
// rule, and a broken gate must not wave the activity through.
function activityAvailability(
  activity: ActivityDef,
  anchorRecord: RecordInstance | null
): { available: boolean; error?: string } {
  if (!activity.show_condition) return { available: true };
  try {
    const result = evaluateExpression(
      activity.show_condition,
      buildEvalHost(adapter, config, { anchorRecord, activity: { id: activity.id, name: activity.name } })
    );
    return { available: result === true };
  } catch (err) {
    console.warn(`show_condition failed for activity '${activity.id}' — failing closed:`, err);
    return { available: false, error: err instanceof Error ? err.message : String(err) };
  }
}

interface AppContextValue {
  recordTypes: RecordTypeDef[];
  selectedRecordType: (RecordTypeDef & { workflow: WorkflowDef }) | null;
  selectedRecord: RecordInstance | null;
  selectRecordType: (type: RecordTypeDef) => void;
  selectRecord: (record: RecordInstance) => void;
  getRecordTypeData: (typeId: string) => RecordInstance[];
  getRecordTypeDef: (typeId: string) => (RecordTypeDef & { workflow: WorkflowDef }) | null;
  getRecordAndType: (typeId: string, recordId: string) => { record: RecordInstance; typeDef: RecordTypeDef & { workflow: WorkflowDef } } | null;
  runActivity: (
    activity: ActivityDef,
    captured: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
    options?: { acknowledgedWarnings?: boolean; waived?: Record<string, string> }
  ) => RunActivityResult;
  // Activity-level show_condition (availability): drives UI visibility; the
  // same rule is re-checked inside runActivity as the pipeline gate.
  isActivityAvailable: (activity: ActivityDef, anchorRecord: RecordInstance | null) => boolean;
  // Resolves a stored fk_ref id to a human-readable label (§SDM_Change §6).
  resolveDisplayLabel: (fkRecordType: string, fkDisplayField: string | undefined, rawId: string) => string;
  // Returns the fk_display_field for an attribute key on a record type via key-matching (§SDM_Change §7).
  resolveAttributeDisplayField: (typeId: string, attrKey: string) => string | undefined;
  getReverseRefs: (targetTypeId: string) => ReverseRefEntry[];
  getRecordsByField: (typeId: string, fieldKey: string, value: string) => RecordInstance[];
  // Evaluate a FluxScript expression (datasource, show condition) against the
  // live store, with the given script context injected as the four roots.
  dslEvaluate: (source: string, script: ScriptContext) => unknown;
}

const Ctx = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [, setTick] = useState(0);
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  // Ref keeps current typeId accessible in the stable runActivity callback
  const selectedTypeIdRef = useRef(selectedTypeId);
  selectedTypeIdRef.current = selectedTypeId;

  // Re-render whenever the adapter mutates (createRecord / appendActivity / updateRecord)
  useEffect(() => adapter.subscribe(() => setTick(t => t + 1)), []);

  const selectRecordType = useCallback((type: RecordTypeDef) => {
    setSelectedTypeId(type.id);
    setSelectedRecordId(null);
  }, []);

  const selectRecord = useCallback((record: RecordInstance) => {
    setSelectedRecordId(record.id);
  }, []);

  const getRecordTypeDef = useCallback((typeId: string) => {
    try { return adapter.getRecordTypeDef(typeId); } catch { return null; }
  }, []);

  const getRecordAndType = useCallback((typeId: string, recordId: string) => {
    try {
      const typeDef = adapter.getRecordTypeDef(typeId);
      const record = adapter.getRecord(recordId);
      return { record, typeDef };
    } catch {
      return null;
    }
  }, []);

  const resolveDisplayLabel = useCallback(
    (fkRecordType: string, fkDisplayField: string | undefined, rawId: string) =>
      adapter.resolveDisplayLabel(fkRecordType, fkDisplayField, rawId),
    []
  );

  const resolveAttributeDisplayField = useCallback(
    (typeId: string, attrKey: string) =>
      adapter.resolveAttributeDisplayField(typeId, attrKey),
    []
  );

  const getReverseRefs = useCallback(
    (targetTypeId: string) => adapter.getReverseRefs(targetTypeId),
    []
  );

  const getRecordsByField = useCallback(
    (typeId: string, fieldKey: string, value: string) =>
      adapter.getRecordsByField(typeId, fieldKey, value),
    []
  );

  const dslEvaluate = useCallback(
    (source: string, script: ScriptContext) =>
      evaluateExpression(source, buildEvalHost(adapter, config, script)),
    []
  );

  const runActivity = useCallback((
    activity: ActivityDef,
    captured: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
    options?: { acknowledgedWarnings?: boolean; waived?: Record<string, string> }
  ): RunActivityResult => {
    // Availability gate — first step of the pipeline, before the before hook.
    // The UI hides unavailable activities, but the gate is the enforcement
    // point (headless callers skip the UI entirely).
    const availability = activityAvailability(activity, anchorRecord);
    if (!availability.available) {
      throw new Error(
        availability.error
          ? `'${activity.name}' availability check failed — blocked: ${availability.error}`
          : `'${activity.name}' is not available for this record`
      );
    }

    const warnings: string[] = [];
    // Attributes declared unavailable: scripts see them as null, they never
    // write to record fields, and the waiver lands on the history entry.
    const waived = options?.waived ?? {};

    // Hooks see captured values coerced to their attribute's declared type (DSL_SPEC §5)
    const stringValues = Object.fromEntries(
      Object.entries(captured).map(([k, v]) => [k, String(v ?? '')])
    );
    const typedAttributes = coerceCaptured(activity.attributes, stringValues);
    const scriptContext: ScriptContext = {
      attributes: typedAttributes,
      anchorRecord,
      activity: { id: activity.id, name: activity.name },
    };

    // before hook = gate (DSL_SPEC §6): read-only; fail() rejects the activity
    // before anything persists. A runtime error in the hook also blocks — a
    // broken gate must not wave submissions through.
    if (activity.before_hook) {
      try {
        const result = executeScript(activity.before_hook, buildEvalHost(adapter, config, scriptContext), { mode: 'read' });
        warnings.push(...result.warnings);
      } catch (err) {
        if (err instanceof FluxFailError) throw new Error(err.message);
        throw new Error(`Before hook error: ${err instanceof Error ? err.message : String(err)}`);
      }
      // Gate warnings are a soft stop: hand them back for the user to confirm.
      // Nothing has persisted (the gate is read-only), so cancelling is free.
      if (warnings.length > 0 && !options?.acknowledgedWarnings) {
        return { status: 'needs-confirmation', warnings };
      }
    }

    let targetRecordId: string;

    if (activity.record_map === 'CREATE') {
      const typeId = selectedTypeIdRef.current!;
      // Exact-key matching: only attributes whose key matches a custom_field key are written.
      // Unmatched attributes (e.g. 'raise_notes' on the sample Raise activity) are silently dropped.
      // This is SDM §1.9.3 rule 2 — DO NOT treat it as a bug.
      const cfKeys = new Set(
        adapter.getRecordTypeDef(typeId).custom_fields.map(cf => cf.key)
      );
      const mappedFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(captured)) {
        if (cfKeys.has(k) && !(k in waived)) mappedFields[k] = v; // waived: field seeds from default
      }
      const newRecord = adapter.createRecord(typeId, mappedFields);
      targetRecordId = newRecord.id;
    } else if (activity.record_map === 'UPDATE') {
      // Exact-key matching against the anchor record's custom fields — SDM §1.9.5.
      const cfKeys = new Set(
        adapter.getRecordTypeDef(anchorRecord!.typeRef).custom_fields.map(cf => cf.key)
      );
      const mappedFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(captured)) {
        // Waived = "can't provide it now" — it must never blank a value
        // someone captured earlier
        if (cfKeys.has(k) && !(k in waived)) mappedFields[k] = v;
      }
      adapter.updateRecord(anchorRecord!.id, mappedFields);
      targetRecordId = anchorRecord!.id;
    } else if (activity.record_map === 'DELETE') {
      if (String(captured['confirm'] ?? '').trim() !== 'DELETE') return { status: 'done', warnings };
      const recordId = anchorRecord!.id;
      adapter.deleteRecord(recordId);
      // deselect if this record was selected
      setSelectedRecordId(id => (id === recordId ? null : id));
      return { status: 'done', warnings };
    } else {
      // ordinary capture — append against the anchor record
      targetRecordId = anchorRecord!.id;
    }

    // append an entry to the Record's activity history; acknowledged gate
    // warnings are part of the submission's story (audit), captured separately
    // from user input
    adapter.appendActivity(targetRecordId, {
      activityId: activity.id,
      activityName: activity.name,
      capturedAttributes: captured,
      ...(warnings.length > 0 ? { warnings: [...warnings] } : {}),
      ...(Object.keys(waived).length > 0 ? { waived: { ...waived } } : {}),
      timestamp: new Date().toISOString(),
    });

    // after hook = effects (DSL_SPEC §6–§7): mutations stage during the run and
    // commit atomically; queued service calls dispatch only after the commit.
    // The activity itself has already persisted — a failing after hook applies
    // no changes but does not un-record the activity.
    if (activity.after_hook) {
      try {
        const result = executeScript(
          activity.after_hook,
          buildEvalHost(adapter, config, { ...scriptContext, anchorRecord: adapter.getRecord(targetRecordId) }),
          { mode: 'mutate' },
        );
        warnings.push(...result.warnings);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`After hook failed — the activity was recorded but no changes were applied: ${message}`);
      }
    }

    // After-hook warnings are informational (the commit already happened):
    // console for now, until the workbench grows a toast slot.
    if (warnings.length > 0) console.warn(`[${activity.name}]`, warnings.join(' · '));
    return { status: 'done', warnings };
  }, [setSelectedRecordId]);

  // Derived from adapter on every render; forceUpdate (via setTick) keeps it fresh
  const rtDef = selectedTypeId
    ? (() => { try { return adapter.getRecordTypeDef(selectedTypeId); } catch { return null; } })()
    : null;

  const selectedRecord = selectedRecordId
    ? (() => { try { return adapter.getRecord(selectedRecordId); } catch { return null; } })()
    : null;

  return (
    <Ctx.Provider value={{
      recordTypes: adapter.listRecordTypes(),
      selectedRecordType: rtDef,
      selectedRecord,
      selectRecordType,
      selectRecord,
      getRecordTypeData: (typeId) => adapter.getRecordTypeData(typeId),
      getRecordTypeDef,
      getRecordAndType,
      runActivity,
      isActivityAvailable: (activity, anchorRecord) => activityAvailability(activity, anchorRecord).available,
      resolveDisplayLabel,
      resolveAttributeDisplayField,
      getReverseRefs,
      getRecordsByField,
      dslEvaluate,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
