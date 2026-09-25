import type { RecordQuery } from '@fluxus/dsl';
import type { RecordTypeDef, WorkflowDef, RecordInstance, ActivityHistoryEntry, ReverseRefEntry } from './types';

// The Store contract, split three ways (SERVER_DATA_LOADING §4.2):
//   - the **model**, which every store answers immediately;
//   - the **records**, which a store may answer later — the server's database
//     store asks Postgres for each thing when a script needs it;
//   - **subscribe**, which only the browser has (the workbench re-renders on it).
// `Store` is the browser's shape: records answer immediately, so nothing in the
// browser handles a promise. `WaitingStore` is what the engine's waiting paths
// accept. `MemoryAdapter` satisfies both.

type MaybePromise<T> = T | Promise<T>;

/** The model half: answers immediately, from the config. */
export interface ModelStore {
  listRecordTypes(): RecordTypeDef[];
  getRecordTypeDef(typeId: string): RecordTypeDef & { workflow: WorkflowDef };
  /**
   * Every resolved workflow, including any no record type points at. Optional
   * because the record-type route covers every workflow a solution actually
   * uses; the model projection needs the rest too, since `model.activities`
   * lists them and their capture lists would otherwise be silently missing.
   */
  listWorkflows?(): WorkflowDef[];
  // Returns the fk_display_field for an attribute by key-matching against the
  // record type's CustomFields (§SDM_Change §7 resolution rule).
  resolveAttributeDisplayField(typeId: string, attrKey: string): string | undefined;
  /** What a record type's field points at, for a reference attribute that names it. */
  resolveAttributeTarget(typeId: string, fieldKey: string): string | undefined;
  // Returns all (sourceTypeId, fieldKey) pairs whose fk_ref points at targetTypeId.
  // Derived from config at construction time — no data scan required.
  getReverseRefs(targetTypeId: string): ReverseRefEntry[];
}

/**
 * A store whose record methods may answer with a promise — the server's
 * database store. The engine's waiting functions take one.
 */
export interface WaitingStore extends ModelStore {
  getRecordTypeData(typeId: string): MaybePromise<RecordInstance[]>;
  getRecord(recordId: string): MaybePromise<RecordInstance>;
  createRecord(typeId: string, customFields: Record<string, unknown>): MaybePromise<RecordInstance>;
  updateRecord(recordId: string, fields: Record<string, unknown>): MaybePromise<void>;
  // ── Staged-mutation support (DSL Phase 2) ─────────────────────────────────
  // Hooks stage mutations and commit atomically: build/validate now, persist
  // later. createRecord ≡ buildRecord + insertRecord; updateRecord ≡
  // validateUpdate + apply. A write-through store (below) is not staged.
  // Validate a create and shape the record (defaults merged, id assigned) WITHOUT persisting.
  buildRecord(typeId: string, customFields: Record<string, unknown>): MaybePromise<RecordInstance>;
  // Persist a previously built record.
  insertRecord(record: RecordInstance): MaybePromise<void>;
  // Constraint check (immutable/unique) for an update WITHOUT applying it.
  validateUpdate(recordId: string, fields: Record<string, unknown>): MaybePromise<void>;
  deleteRecord(recordId: string): MaybePromise<void>;
  appendActivity(recordId: string, entry: ActivityHistoryEntry): MaybePromise<void>;
  // Resolves a stored fk_ref id to a human-readable label (§SDM_Change §6).
  // Falls back to rawId when the record or display field is not found.
  resolveDisplayLabel(fkRecordType: string, fkDisplayField: string | undefined, rawId: string): MaybePromise<string>;
  // Returns all records of typeId where customFields[fieldKey] === value.
  getRecordsByField(typeId: string, fieldKey: string, value: string): MaybePromise<RecordInstance[]>;
  /**
   * Present on a store that writes each change the moment it is made, inside
   * one transaction (SERVER_DATA_LOADING ruling 10). A hook's writes then go
   * straight through instead of being staged, inside the undo point this opens;
   * a failing hook rolls back to it, undoing only its own writes.
   */
  savepoint?(): Promise<Savepoint>;
  /** With `savepoint`: run `fn` once the store's writes commit; never if they roll back. */
  afterCommit?(fn: () => void): void;
  /**
   * Answer a record query itself (SERVER_DATA_LOADING §5) — the database
   * store, with one SQL statement. Types are the store's ids (`rt_…`) here,
   * in `query.type` and in every field path. The rows, at most
   * `query.maxRows + 1` of them, or the count when `query.count`. A store
   * without it has the evaluator filter in memory.
   */
  queryRecords?(query: RecordQuery): MaybePromise<RecordInstance[] | number>;
}

/** A hook's undo point on a write-through store. */
export interface Savepoint {
  release(): Promise<void>;
  rollback(): Promise<void>;
}

/** The browser's store: every record method answers immediately. */
export interface Store extends ModelStore {
  getRecordTypeData(typeId: string): RecordInstance[];
  getRecord(recordId: string): RecordInstance;
  createRecord(typeId: string, customFields: Record<string, unknown>): RecordInstance;
  updateRecord(recordId: string, fields: Record<string, unknown>): void;
  buildRecord(typeId: string, customFields: Record<string, unknown>): RecordInstance;
  insertRecord(record: RecordInstance): void;
  validateUpdate(recordId: string, fields: Record<string, unknown>): void;
  deleteRecord(recordId: string): void;
  appendActivity(recordId: string, entry: ActivityHistoryEntry): void;
  resolveDisplayLabel(fkRecordType: string, fkDisplayField: string | undefined, rawId: string): string;
  getRecordsByField(typeId: string, fieldKey: string, value: string): RecordInstance[];
  subscribe(cb: () => void): () => void;
}
