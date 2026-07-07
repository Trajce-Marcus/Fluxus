import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { evaluateExpression } from '@fluxus/dsl';
import type { RecordTypeDef, WorkflowDef, RecordInstance, ActivityDef, ReverseRefEntry } from '../types';
import { LocalStorageAdapter } from '../store/LocalStorageAdapter';
import { config } from '../config';
import { buildEvalHost, type ScriptContext } from '../dsl/bridge';
import { reportConfigFindings } from '../dsl/validateConfig';

// Module-level singleton — one adapter for the lifetime of the app
const adapter = new LocalStorageAdapter(config);

// Config-save-time validation: with the SDM still file-edited, save time is app start.
reportConfigFindings(config);

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
    anchorRecord: RecordInstance | null
  ) => void;
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
    anchorRecord: RecordInstance | null
  ) => {
    // before_hook — stubbed this cut (pipeline slot exists; body deferred)

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
        if (cfKeys.has(k)) mappedFields[k] = v;
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
        if (cfKeys.has(k)) mappedFields[k] = v;
      }
      adapter.updateRecord(anchorRecord!.id, mappedFields);
      targetRecordId = anchorRecord!.id;
    } else if (activity.record_map === 'DELETE') {
      if (String(captured['confirm'] ?? '').trim() !== 'DELETE') return;
      const recordId = anchorRecord!.id;
      adapter.deleteRecord(recordId);
      // deselect if this record was selected
      setSelectedRecordId(id => (id === recordId ? null : id));
      return;
    } else {
      // ordinary capture — append against the anchor record
      targetRecordId = anchorRecord!.id;
    }

    // append an entry to the Record's activity history
    adapter.appendActivity(targetRecordId, {
      activityId: activity.id,
      activityName: activity.name,
      capturedAttributes: captured,
      timestamp: new Date().toISOString(),
    });

    // after_hook — stubbed this cut (pipeline slot exists; body deferred)
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
