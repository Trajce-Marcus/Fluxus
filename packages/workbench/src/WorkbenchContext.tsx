import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { createEngine, buildGeoModule, buildTimeModule, buildMathModule } from '@fluxus/engine';
import type {
  ActivityOption,
  ContextUser,
  Engine,
  RecordTypeDef,
  WorkflowDef,
  RecordInstance,
  ActivityDef,
  ReverseRefEntry,
  RunActivityResult,
} from '@fluxus/engine';
import type { CaptureHost } from '@fluxus/page-runtime';
import type { FluxusClient, ListFilter, UploadService } from '@fluxus/client';
import { NotificationLog } from './store/NotificationLog';
import { buildNotifyModule } from './services/notify';

// The workbench's own state (CONSOLE_RUNTIME_SPEC §4, M15). Everything
// record-shaped lives here — selected record type, selected record, activity
// runs — and nothing above <Workbench> knows these exist. The host hands over a
// connected FluxusClient, which holds no records until a screen fetches them
// (CONSOLE_RECORD_FETCHING): each screen holds what it shows through
// `useHeldLists` / `useHeldRecord` below and lets go when it closes. The local
// engine that evaluates the capture form's expressions (question conditions,
// datasources) synchronously against what is held is built here, per mounted
// workbench, from that client.
// Which actions are offered is not among them: the server answers that
// (`page.activities`, ACTIONS_OFFERED_BY_SERVER).

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
  /**
   * Which actions the server offers — on a record (`{ recordId }`), or with
   * no record on a record type (`{ typeId }`, its CREATEs). Decided there with
   * the designer's real roles in this operation; the same rule is re-checked
   * when an action runs.
   */
  offeredActivities: (item: { recordId: string } | { typeId: string }) => Promise<ActivityOption[]>;
  /** Bumped whenever the snapshot refreshes (after every run) — when the
   *  offered lists ask again. */
  snapshotVersion: number;
  // Resolves a stored fk_ref id to a human-readable label (§SDM_Change §6).
  resolveDisplayLabel: (fkRecordType: string, fkDisplayField: string | undefined, rawId: string) => string;
  // Returns the fk_display_field for an attribute key on a record type via key-matching (§SDM_Change §7).
  resolveAttributeDisplayField: (typeId: string, attrKey: string) => string | undefined;
  getReverseRefs: (targetTypeId: string) => ReverseRefEntry[];
  getRecordsByField: (typeId: string, fieldKey: string, value: string) => RecordInstance[];
  /** The client's holding calls (CONSOLE_RECORD_FETCHING §3) — screens use them through the hooks below. */
  fetchRecords: (typeId: string, filter?: ListFilter) => Promise<unknown>;
  releaseRecords: (typeId: string, filter?: ListFilter) => void;
  fetchRecord: (recordId: string) => Promise<unknown>;
  releaseRecord: (recordId: string) => void;
  /** Held by id, in full — what the record view waits on before it opens a form. */
  isRecordFetched: (recordId: string) => boolean;
  /**
   * What the standard capture form (@fluxus/page-runtime) runs against here:
   * this workbench's engine for expressions, this client for GET-backed
   * dropdowns and uploads. The record picker is added above, in
   * WorkbenchCaptureHost — this module stays free of component imports.
   */
  captureHost: CaptureHost;
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
  const [tick, setTick] = useState(0);
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
        model: client.model,
        services: [buildNotifyModule(new NotificationLog()), buildGeoModule(adapter), buildTimeModule(), buildMathModule()],
        user,
      }),
    [client, adapter, user]
  );

  // Re-render whenever what is held changes (a fetch, a release, the refresh after each activity run)
  useEffect(() => adapter.subscribe(() => setTick(t => t + 1)), [adapter]);

  // A re-scoped client brings a different model and holds nothing; the old
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

  const fetchRecords = useCallback((typeId: string, filter?: ListFilter) => client.fetchRecords(typeId, filter), [client]);
  const releaseRecords = useCallback((typeId: string, filter?: ListFilter) => client.releaseRecords(typeId, filter), [client]);
  const fetchRecord = useCallback((recordId: string) => client.fetchRecord(recordId), [client]);
  const releaseRecord = useCallback((recordId: string) => client.releaseRecord(recordId), [client]);
  const isRecordFetched = useCallback((recordId: string) => client.isRecordFetched(recordId), [client]);

  // client.uploads mints a fresh object per access; hold one stable instance so
  // widget effects keyed on it don't re-run every render.
  const uploads = useMemo(() => client.uploads, [client]);

  // The capture form's host (see the interface member above). Expressions
  // evaluate in this engine, so `context.user` and the services this workbench
  // wired are the same ones a condition sees anywhere else here; a datasource
  // that names a GET goes to the server like a page's would, and its gate
  // warnings go where this host's warnings go — the console.
  const captureHost = useMemo<CaptureHost>(() => ({
    evaluate: (source, script) => engine.evaluate(source, script),
    query: async (activityId, params, recordId) => {
      const result = await client.query({ activityId, attributes: params, recordId });
      for (const warning of result.warnings) console.warn(`[invoke ${activityId}] ${warning}`);
      return result.data;
    },
    uploads,
    resolveDisplayLabel: (fkRecordType, fkDisplayField, rawId) =>
      adapter.resolveDisplayLabel(fkRecordType, fkDisplayField, rawId),
    resolveAttributeDisplayField: (typeId, attrKey) => adapter.resolveAttributeDisplayField(typeId, attrKey),
    resolveAttributeTarget: (typeId, attrKey) => adapter.resolveAttributeTarget(typeId, attrKey),
  }), [engine, client, uploads, adapter]);

  const offeredActivities = useCallback(
    async (item: { recordId: string } | { typeId: string }) => (await client.pageActivities([item]))[0] ?? [],
    [client],
  );

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
      offeredActivities,
      snapshotVersion: tick,
      resolveDisplayLabel,
      resolveAttributeDisplayField,
      getReverseRefs,
      getRecordsByField,
      fetchRecords,
      releaseRecords,
      fetchRecord,
      releaseRecord,
      isRecordFetched,
      captureHost,
      uploads,
    }}>
      {children}
    </Ctx.Provider>
  );
}

/** Where a screen's fetch stands: an unfetched list and an empty one no longer look the same. */
export type HoldStatus = 'loading' | 'loaded' | 'failed';

/**
 * Hold these lists while the calling screen shows them (CONSOLE_RECORD_FETCHING
 * §4): fetched when the screen opens or the lists change, let go when it closes
 * or moves on, fetched again into a new client after a model save. Answers
 * 'failed' if any list could not be fetched.
 */
export function useHeldLists(lists: { typeId: string; filter?: ListFilter }[]): HoldStatus {
  const { operationId, fetchRecords, releaseRecords } = useWorkbench();
  const key = JSON.stringify(lists);
  const [state, setState] = useState<{ key: string; status: HoldStatus } | null>(null);
  useEffect(() => {
    const wanted: { typeId: string; filter?: ListFilter }[] = JSON.parse(key);
    if (!operationId || wanted.length === 0) return;
    let cancelled = false;
    // Only what was actually taken is let go: a fetch that failed released itself.
    const taken: typeof wanted = [];
    setState({ key, status: 'loading' });
    Promise.all(wanted.map((l) => fetchRecords(l.typeId, l.filter).then(
      () => { taken.push(l); if (cancelled) releaseRecords(l.typeId, l.filter); return true; },
      (err: unknown) => { console.error(`[workbench] could not fetch ${l.typeId}`, err); return false; },
    ))).then((ok) => { if (!cancelled) setState({ key, status: ok.every(Boolean) ? 'loaded' : 'failed' }); });
    return () => {
      cancelled = true;
      for (const l of taken) releaseRecords(l.typeId, l.filter);
    };
  }, [operationId, fetchRecords, releaseRecords, key]);
  if (lists.length === 0) return 'loaded';
  return state?.key === key ? state.status : 'loading';
}

/** Hold one record by id, in full, while the calling screen shows it. */
export function useHeldRecord(recordId: string | null): HoldStatus {
  const { operationId, fetchRecord, releaseRecord } = useWorkbench();
  const [state, setState] = useState<{ recordId: string; status: HoldStatus } | null>(null);
  useEffect(() => {
    if (!operationId || !recordId) return;
    let cancelled = false;
    let taken = false;
    setState({ recordId, status: 'loading' });
    fetchRecord(recordId).then(
      () => { taken = true; if (cancelled) releaseRecord(recordId); else setState({ recordId, status: 'loaded' }); },
      (err: unknown) => { console.error(`[workbench] could not fetch record ${recordId}`, err); if (!cancelled) setState({ recordId, status: 'failed' }); },
    );
    return () => {
      cancelled = true;
      if (taken) releaseRecord(recordId);
    };
  }, [operationId, fetchRecord, releaseRecord, recordId]);
  return recordId && state?.recordId === recordId ? state.status : 'loading';
}

export function useWorkbench(): WorkbenchContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useWorkbench must be used within <Workbench>');
  return ctx;
}
