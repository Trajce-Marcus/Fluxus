import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { createEngine, LocalStorageAdapter } from '@fluxus/engine';
import type { RecordTypeDef, WorkflowDef, RecordInstance, ActivityDef, ReverseRefEntry, RunActivityResult, ScriptContext } from '@fluxus/engine';
import { NotificationLog } from '../store/NotificationLog';
import { config } from '../config';
import { buildNotifyModule } from '../services/notify';
import { buildGeoModule } from '../services/geo';

// Module-level singletons — one adapter, one notification log, one engine for
// the lifetime of the app. The engine owns the activity pipeline; this context
// owns the workbench's UI state (selection) and channels (console warnings).
const adapter = new LocalStorageAdapter(config, {
  storageKey: 'fluxus:sdm:records',
  // Pre-rename key (aber-poc era) — data found there is merged in once.
  legacyStorageKey: 'aber-poc-v1-records',
});
export const notificationLog = new NotificationLog();
const engine = createEngine({
  store: adapter,
  config,
  services: [buildNotifyModule(notificationLog), buildGeoModule(adapter)],
});

// Config-save-time validation: with the SDM still file-edited, save time is app start.
engine.reportConfigFindings();

interface AppContextValue {
  recordTypes: RecordTypeDef[];
  selectedRecordType: (RecordTypeDef & { workflow: WorkflowDef }) | null;
  selectedRecord: RecordInstance | null;
  selectRecordType: (type: RecordTypeDef) => void;
  selectRecord: (record: RecordInstance) => void;
  // Select by id — used after CREATE, where only RunActivityResult.recordId is known.
  selectRecordById: (id: string) => void;
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

  // Re-render whenever the adapter mutates (createRecord / appendActivity / updateRecord)
  useEffect(() => adapter.subscribe(() => setTick(t => t + 1)), []);

  const selectRecordType = useCallback((type: RecordTypeDef) => {
    setSelectedTypeId(type.id);
    setSelectedRecordId(null);
  }, []);

  const selectRecord = useCallback((record: RecordInstance) => {
    setSelectedRecordId(record.id);
  }, []);

  const selectRecordById = useCallback((id: string) => {
    setSelectedRecordId(id);
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
    (source: string, script: ScriptContext) => engine.evaluate(source, script),
    []
  );

  // Thin host wrapper over the engine pipeline: the engine runs the activity;
  // the workbench reacts — deselect a deleted record, console the warnings
  // (its channel until a toast slot exists).
  const runActivity = useCallback((
    activity: ActivityDef,
    captured: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
    options?: { acknowledgedWarnings?: boolean; waived?: Record<string, string> }
  ): RunActivityResult => {
    const result = engine.runActivity(activity, captured, anchorRecord, options);
    if (result.status === 'done') {
      if (activity.record_map === 'DELETE' && result.recordId) {
        const deletedId = result.recordId;
        setSelectedRecordId(id => (id === deletedId ? null : id));
      }
      if (result.warnings.length > 0) console.warn(`[${activity.name}]`, result.warnings.join(' · '));
    }
    return result;
  }, []);

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
      selectRecord,
      selectRecordById,
      selectRecordType,
      getRecordTypeData: (typeId) => adapter.getRecordTypeData(typeId),
      getRecordTypeDef,
      getRecordAndType,
      runActivity,
      isActivityAvailable: (activity, anchorRecord) => engine.isActivityAvailable(activity, anchorRecord),
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
