import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { createEngine, buildGeoModule } from '@fluxus/engine';
import type {
  ContextUser,
  Engine,
  RecordTypeDef,
  WorkflowDef,
  RecordInstance,
  ActivityDef,
  ReverseRefEntry,
  RunActivityResult,
  ScriptContext,
} from '@fluxus/engine';
import type { FluxusClient, UploadService } from '@fluxus/client';
import { NotificationLog } from './store/NotificationLog';
import { buildNotifyModule } from './services/notify';

// The workbench's own state (CONSOLE_RUNTIME_SPEC §4, M15). Everything
// record-shaped lives here — selected record type, selected record, activity
// runs — and nothing above <Workbench> knows these exist. The host hands over a
// connected FluxusClient; the local engine that evaluates expressions (show
// conditions, datasources, availability) synchronously against the fetched
// snapshot is built here, per mounted workbench, from that client.

interface WorkbenchContextValue {
  /** The operation whose partition is on screen — `null` = none picked yet, so
   *  the model shows and the data does not (ruled 2026-07-31). */
  operationId: string | null;
  /** The solution's operations, for the side-menu picker. */
  operations: { id: string; name: string }[];
  /** Absent when the host does not offer switching — the picker hides. */
  selectOperation?: (operationId: string | null) => void;
  /** Why the last switch didn't take, if it didn't. */
  operationError?: string | null;
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
  ) => Promise<RunActivityResult>;
  /** File/photo upload surface (ATTRIBUTE_TYPES_FILES_SCALARS §10) — the
   *  client's UploadService, scope pre-bound; injected into capture widgets. */
  uploads: UploadService;
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

const Ctx = createContext<WorkbenchContextValue | null>(null);

export interface WorkbenchProviderProps {
  /** The host's connected client — the snapshot, the config and the run door. */
  client: FluxusClient;
  /** Signed-in identity for `ctx.user` in expression parity; omitted in the
   *  demo (auth unconfigured) posture. */
  user?: ContextUser;
  /** The operation the client is connected to, or null for none picked. */
  operationId?: string | null;
  operations?: { id: string; name: string }[];
  /** Re-scope the host to another operation (or none). Omit and the picker
   *  hides — a host that binds the operation itself keeps the choice. */
  onSelectOperation?: (operationId: string | null) => void;
  /** Surfaced under the picker — a failed switch must not look like a no-op. */
  operationError?: string | null;
  children: React.ReactNode;
}

export function WorkbenchProvider({ client, user, operationId = null, operations = [], onSelectOperation, operationError, children }: WorkbenchProviderProps) {
  const [, setTick] = useState(0);
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  const adapter = client.adapter;

  // One engine per mounted workbench, rebuilt when the host re-scopes the
  // client (Console's Data picker, a solution switch). The notify sink is
  // local and dormant — hooks run server-side, so nothing writes to it; it
  // stays wired so the service manifest validates.
  const engine: Engine = useMemo(
    () =>
      createEngine({
        store: adapter,
        config: client.config,
        services: [buildNotifyModule(new NotificationLog()), buildGeoModule(adapter)],
        user,
      }),
    [client, adapter, user]
  );

  // Re-render whenever the snapshot changes (partition refresh after each run)
  useEffect(() => adapter.subscribe(() => setTick(t => t + 1)), [adapter]);

  // A re-scoped client brings a different model and partition; the old
  // selection does not belong to it.
  useEffect(() => {
    setSelectedTypeId(null);
    setSelectedRecordId(null);
  }, [client]);

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
  }, [adapter]);

  const getRecordAndType = useCallback((typeId: string, recordId: string) => {
    try {
      const typeDef = adapter.getRecordTypeDef(typeId);
      const record = adapter.getRecord(recordId);
      return { record, typeDef };
    } catch {
      return null;
    }
  }, [adapter]);

  const resolveDisplayLabel = useCallback(
    (fkRecordType: string, fkDisplayField: string | undefined, rawId: string) =>
      adapter.resolveDisplayLabel(fkRecordType, fkDisplayField, rawId),
    [adapter]
  );

  const resolveAttributeDisplayField = useCallback(
    (typeId: string, attrKey: string) =>
      adapter.resolveAttributeDisplayField(typeId, attrKey),
    [adapter]
  );

  const getReverseRefs = useCallback(
    (targetTypeId: string) => adapter.getReverseRefs(targetTypeId),
    [adapter]
  );

  const getRecordsByField = useCallback(
    (typeId: string, fieldKey: string, value: string) =>
      adapter.getRecordsByField(typeId, fieldKey, value),
    [adapter]
  );

  const dslEvaluate = useCallback(
    (source: string, script: ScriptContext) => engine.evaluate(source, script),
    [engine]
  );

  // client.uploads mints a fresh object per access; hold one stable instance so
  // widget effects keyed on it don't re-run every render.
  const uploads = useMemo(() => client.uploads, [client]);

  // Thin host wrapper over the server pipeline: the server runs the activity
  // (gate, hooks, persistence) and the client refreshes the snapshot; the
  // workbench reacts — deselect a deleted record, console the warnings
  // (its channel until a toast slot exists).
  const runActivity = useCallback(async (
    activity: ActivityDef,
    captured: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
    options?: { acknowledgedWarnings?: boolean; waived?: Record<string, string> }
  ): Promise<RunActivityResult> => {
    const result = await client.runActivity({
      activityId: activity.id,
      recordId: anchorRecord?.id,
      attributes: captured,
      waived: options?.waived,
      acknowledgedWarnings: options?.acknowledgedWarnings,
    });
    if (result.status === 'done') {
      if (activity.record_map === 'DELETE' && result.recordId) {
        const deletedId = result.recordId;
        setSelectedRecordId(id => (id === deletedId ? null : id));
      }
      if (result.warnings.length > 0) console.warn(`[${activity.name}]`, result.warnings.join(' · '));
    }
    return result;
  }, [client]);

  // Derived from adapter on every render; forceUpdate (via setTick) keeps it fresh
  const rtDef = selectedTypeId
    ? (() => { try { return adapter.getRecordTypeDef(selectedTypeId); } catch { return null; } })()
    : null;

  const selectedRecord = selectedRecordId
    ? (() => { try { return adapter.getRecord(selectedRecordId); } catch { return null; } })()
    : null;

  return (
    <Ctx.Provider value={{
      operationId,
      operations,
      selectOperation: onSelectOperation,
      operationError,
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
      uploads,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWorkbench(): WorkbenchContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWorkbench must be used within <Workbench>');
  return ctx;
}
