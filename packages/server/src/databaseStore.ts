// The server's database store (SERVER_DATA_LOADING §4.3). Built per request,
// holding no records at the start: it asks Postgres for each thing when a
// script needs it — one record by id, one type's records, records by a field
// value — and writes each change the moment it is made.
//
// An activity run holds one transaction from before its first read to its end
// (`begin` … `commit` / `rollback`), so every later read in the run sees the
// run's own writes because the database does. A hook runs inside a savepoint
// (`savepoint`), so a failing hook undoes only its own writes. A GET and the
// DSL Editor open no transaction: they read, and a GET appends its entry in one
// statement at the end.
//
// Reads select `id, type_ref, custom_fields` — never `activity_history`. Every
// record read is held by id for the rest of the request, and the same object
// is handed back for the same id every time and changed in place by every
// write, as MemoryAdapter does: the router's anchor and the `invoke` closure an
// activity run builds rely on seeing the anchor change. That is not caching
// between requests (ruling 2) — it is discarded with the store.

import { and, asc, eq, ne, sql } from 'drizzle-orm';
import {
  MemoryAdapter,
  coerceFieldValues,
  shapeNewRecord,
  uniqueValues,
  type ActivityHistoryEntry,
  type RecordInstance,
  type RecordTypeDef,
  type ReverseRefEntry,
  type Savepoint,
  type SolutionConfig,
  type WaitingStore,
  type WorkflowDef,
} from '@fluxus/engine';
import type { Db, DbOrTx } from './db/client';
import { records } from './db/schema';

/**
 * A run changed a record that another request deleted while it ran
 * (SERVER_DATA_LOADING ruling 17). The run fails and nothing of it is written —
 * the alternative, writing the record back, would bring a deleted record back
 * to life.
 */
export class RecordDeletedMeanwhileError extends Error {
  constructor(recordId: string) {
    super(`Record '${recordId}' was deleted meanwhile — nothing was saved; reload and try again`);
  }
}

/** The `write_back` span's counts (PERFORMANCE_LOGGING.md §4). */
export interface WriteCounts {
  created: number;
  changed: number;
  deleted: number;
}

/** What a savepoint must put back in the held records if it rolls back. */
interface UndoLog {
  /** Held records as they were before the savepoint first touched them. */
  before: Map<string, { record: RecordInstance; customFields: Record<string, unknown>; historyLength: number } | null>;
  counts: { created: Set<string>; changed: Set<string>; deleted: Set<string> };
}

/** Thrown inside the transaction callback to roll it back on purpose. */
const ROLLBACK = Symbol('rollback');

const COLUMNS = { id: records.id, typeRef: records.typeRef, customFields: records.customFields };

export class DatabaseStore implements WaitingStore {
  /** The model, resolved exactly as every other host resolves it. Holds no records. */
  private readonly model: MemoryAdapter;
  private readonly recordTypes: Map<string, RecordTypeDef>;
  /** The database, or the run's open transaction. */
  private handle: DbOrTx;
  private transaction: { finish: (commit: boolean) => void; done: Promise<void> } | null = null;
  private readonly held = new Map<string, RecordInstance>();
  private readonly undoLogs: UndoLog[] = [];
  private savepointSeq = 0;
  private afterCommitQueue: (() => void)[] = [];
  private readonly written = { created: new Set<string>(), changed: new Set<string>(), deleted: new Set<string>() };

  /**
   * Why this request's writes cannot commit, once something has made that so:
   * a database call that failed, or a record deleted meanwhile (ruling 17).
   * Kept after a hook's savepoint rolls back — a database error fails the
   * whole run (§4.2), not just the hook it happened in.
   */
  fault: unknown = null;

  constructor(
    private readonly db: Db,
    readonly operationId: string,
    config: SolutionConfig,
  ) {
    this.model = new MemoryAdapter(config);
    this.recordTypes = new Map(config.recordTypes.map((rt) => [rt.id, rt]));
    this.handle = db;
  }

  // ── The model: immediate ────────────────────────────────────────────────────

  listRecordTypes(): RecordTypeDef[] {
    return this.model.listRecordTypes();
  }

  getRecordTypeDef(typeId: string): RecordTypeDef & { workflow: WorkflowDef } {
    return this.model.getRecordTypeDef(typeId);
  }

  listWorkflows(): WorkflowDef[] {
    return this.model.listWorkflows();
  }

  resolveAttributeDisplayField(typeId: string, attrKey: string): string | undefined {
    return this.model.resolveAttributeDisplayField(typeId, attrKey);
  }

  resolveAttributeTarget(typeId: string, fieldKey: string): string | undefined {
    return this.model.resolveAttributeTarget(typeId, fieldKey);
  }

  getReverseRefs(targetTypeId: string): ReverseRefEntry[] {
    return this.model.getReverseRefs(targetTypeId);
  }

  // ── The transaction ─────────────────────────────────────────────────────────

  /**
   * Open the run's transaction. Everything the store reads and writes goes
   * through it until `commit` or `rollback`.
   */
  async begin(): Promise<void> {
    if (this.transaction) throw new Error('The run already holds a transaction');
    let opened!: (tx: DbOrTx) => void;
    const ready = new Promise<DbOrTx>((resolve) => {
      opened = resolve;
    });
    let finish!: (commit: boolean) => void;
    const decided = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    // Held open across the run: the callback hands the transaction out and
    // then waits for the run to decide. Drizzle commits when it returns and
    // rolls back when it throws.
    const done = this.db.transaction(async (tx) => {
      opened(tx);
      if (!(await decided)) throw ROLLBACK;
    });
    // Nobody awaits `done` until the run decides; a failure to open is raced
    // below, and a rollback is expected.
    done.catch(() => undefined);
    this.handle = await Promise.race([
      ready,
      done.then(() => {
        throw new Error('The transaction ended before it began');
      }),
    ]);
    this.transaction = { finish, done };
  }

  /**
   * Commit the run's writes, then dispatch the `queue`d calls that waited for
   * it. A store at fault rolls back instead, and throws why.
   */
  async commit(): Promise<WriteCounts> {
    if (this.fault) {
      await this.rollback();
      throw this.fault;
    }
    const transaction = this.endTransaction();
    transaction.finish(true);
    await transaction.done;
    const queued = this.afterCommitQueue;
    this.afterCommitQueue = [];
    for (const dispatch of queued) dispatch();
    return this.counts();
  }

  /** Roll the run's writes back. Its `queue`d calls never fire. */
  async rollback(): Promise<void> {
    this.afterCommitQueue = [];
    if (!this.transaction) return;
    const transaction = this.endTransaction();
    transaction.finish(false);
    try {
      await transaction.done;
    } catch (err) {
      if (err !== ROLLBACK) throw err;
    }
  }

  private endTransaction(): { finish: (commit: boolean) => void; done: Promise<void> } {
    const transaction = this.transaction;
    if (!transaction) throw new Error('The run holds no transaction');
    this.transaction = null;
    this.handle = this.db;
    return transaction;
  }

  /** How many records the request created, changed and deleted. */
  counts(): WriteCounts {
    const { created, changed, deleted } = this.written;
    let changedOnly = 0;
    for (const id of changed) if (!created.has(id) && !deleted.has(id)) changedOnly++;
    return { created: created.size, changed: changedOnly, deleted: deleted.size };
  }

  /** A hook's undo point (SERVER_DATA_LOADING ruling 10). */
  async savepoint(): Promise<Savepoint> {
    if (!this.transaction) throw new Error('A hook writes only inside a run, and this request opened none');
    const name = `hook_${++this.savepointSeq}`;
    await this.run(this.handle.execute(sql.raw(`SAVEPOINT ${name}`)));
    const log: UndoLog = {
      before: new Map(),
      counts: {
        created: new Set(this.written.created),
        changed: new Set(this.written.changed),
        deleted: new Set(this.written.deleted),
      },
    };
    this.undoLogs.push(log);
    const pop = () => {
      const at = this.undoLogs.lastIndexOf(log);
      if (at !== -1) this.undoLogs.splice(at, 1);
    };
    return {
      release: async () => {
        await this.run(this.handle.execute(sql.raw(`RELEASE SAVEPOINT ${name}`)));
        pop();
        // An enclosing savepoint must still be able to put these back.
        const outer = this.undoLogs[this.undoLogs.length - 1];
        if (outer) for (const [id, before] of log.before) if (!outer.before.has(id)) outer.before.set(id, before);
      },
      rollback: async () => {
        await this.run(this.handle.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${name}`)));
        await this.run(this.handle.execute(sql.raw(`RELEASE SAVEPOINT ${name}`)));
        pop();
        this.restore(log);
      },
    };
  }

  afterCommit(fn: () => void): void {
    this.afterCommitQueue.push(fn);
  }

  // ── Reads ───────────────────────────────────────────────────────────────────

  async getRecord(recordId: string): Promise<RecordInstance> {
    const held = this.held.get(recordId);
    if (held) return held;
    const rows = await this.run(
      this.handle
        .select(COLUMNS)
        .from(records)
        .where(and(eq(records.operationId, this.operationId), eq(records.id, recordId))),
    );
    if (rows.length === 0) throw new Error(`Record not found: ${recordId}`);
    return this.hold(rows[0]);
  }

  /** Step 2 reads the whole type; step 3 narrows a query to SQL. */
  async getRecordTypeData(typeId: string): Promise<RecordInstance[]> {
    const rows = await this.run(
      this.handle
        .select(COLUMNS)
        .from(records)
        .where(and(eq(records.operationId, this.operationId), eq(records.typeRef, typeId)))
        .orderBy(asc(records.id)),
    );
    return rows.map((row) => this.hold(row));
  }

  /** Compared as text, as MemoryAdapter compares; a missing key never matches. */
  async getRecordsByField(typeId: string, fieldKey: string, value: string): Promise<RecordInstance[]> {
    const rows = await this.run(
      this.handle
        .select(COLUMNS)
        .from(records)
        .where(and(
          eq(records.operationId, this.operationId),
          eq(records.typeRef, typeId),
          sql`${records.customFields}->>${fieldKey} = ${value}`,
        ))
        .orderBy(asc(records.id)),
    );
    return rows.map((row) => this.hold(row));
  }

  async resolveDisplayLabel(fkRecordType: string, fkDisplayField: string | undefined, rawId: string): Promise<string> {
    if (!rawId) return '';
    let record: RecordInstance;
    try {
      record = await this.getRecord(rawId);
    } catch {
      return rawId;
    }
    if (record.typeRef !== fkRecordType || !fkDisplayField) return rawId;
    return String(record.customFields[fkDisplayField] ?? rawId);
  }

  // ── Writes, as they happen (ruling 10) ──────────────────────────────────────

  async buildRecord(typeId: string, customFields: Record<string, unknown>): Promise<RecordInstance> {
    const rt = this.recordType(typeId);
    const record = shapeNewRecord(rt, customFields);
    await this.checkUnique(rt, record.customFields, null);
    return record;
  }

  /** The primary key refuses a clashing id — ids are UUIDv7, so nothing reads to check. */
  async insertRecord(record: RecordInstance): Promise<void> {
    await this.run(
      this.handle.insert(records).values({
        operationId: this.operationId,
        id: record.id,
        typeRef: record.typeRef,
        customFields: record.customFields,
        activityHistory: [],
        updatedAt: new Date(),
      }),
    );
    this.remember(record.id, null);
    this.held.set(record.id, record);
    this.written.created.add(record.id);
  }

  async createRecord(typeId: string, customFields: Record<string, unknown>): Promise<RecordInstance> {
    const record = await this.buildRecord(typeId, customFields);
    await this.insertRecord(record);
    return record;
  }

  async validateUpdate(recordId: string, fields: Record<string, unknown>): Promise<void> {
    const current = await this.getRecord(recordId);
    const rt = this.recordTypes.get(current.typeRef);
    for (const cf of rt?.custom_fields ?? []) {
      if (!(cf.key in fields)) continue;
      const newVal = String(fields[cf.key] ?? '').trim();
      if (cf.immutable && newVal !== String(current.customFields[cf.key] ?? '')) {
        throw new Error(`"${cf.key}" is immutable and cannot be changed`);
      }
    }
    if (rt) await this.checkUnique(rt, fields, recordId);
  }

  /** Only the fields given are written — `custom_fields || $changed`. */
  async updateRecord(recordId: string, fields: Record<string, unknown>): Promise<void> {
    await this.validateUpdate(recordId, fields);
    const current = await this.getRecord(recordId);
    const rt = this.recordTypes.get(current.typeRef);
    const changed = rt ? coerceFieldValues(rt, fields) : fields;
    const updated = await this.run(
      this.handle
        .update(records)
        .set({
          customFields: sql`${records.customFields} || ${JSON.stringify(changed)}::jsonb`,
          updatedAt: new Date(),
        })
        .where(and(eq(records.operationId, this.operationId), eq(records.id, recordId)))
        .returning({ id: records.id }),
    );
    if (updated.length === 0) this.deletedMeanwhile(recordId);
    this.remember(recordId, current);
    Object.assign(current.customFields, changed);
    this.written.changed.add(recordId);
  }

  async deleteRecord(recordId: string): Promise<void> {
    const deleted = await this.run(
      this.handle
        .delete(records)
        .where(and(eq(records.operationId, this.operationId), eq(records.id, recordId)))
        .returning({ id: records.id }),
    );
    if (deleted.length === 0) this.deletedMeanwhile(recordId);
    this.remember(recordId, this.held.get(recordId) ?? null);
    this.held.delete(recordId);
    this.written.deleted.add(recordId);
  }

  /**
   * Append one history entry, its reporting rows and the ledger flip — **one
   * statement**, so a GET, which opens no transaction, writes it atomically.
   * The entry lands on the record only if the record is still there; if it is
   * not, nothing lands and the request fails (ruling 17).
   */
  async appendActivity(recordId: string, entry: ActivityHistoryEntry): Promise<void> {
    const attributes = projectionAttributeRows(entry).map((row) => ({
      key: row.key,
      value: row.value,
      waive_desc: row.waiveDesc,
    }));
    const storageKeys = [...collectStorageKeys(entry.capturedAttributes)];
    const result = await this.run(
      this.handle.execute(sql`
        WITH appended AS (
          UPDATE records
          SET activity_history = activity_history || ${JSON.stringify([entry])}::jsonb, updated_at = now()
          WHERE operation_id = ${this.operationId} AND id = ${recordId}
          RETURNING id, type_ref
        ), activity_row AS (
          INSERT INTO rpt_activities (operation_id, record_id, record_type, activity_id, activity_name, author, ts)
          SELECT ${this.operationId}, appended.id, appended.type_ref, ${entry.activityId}, ${entry.activityName},
                 ${entry.author ?? LEGACY_AUTHOR}, ${entry.timestamp}::timestamptz
          FROM appended
          RETURNING id
        ), attribute_rows AS (
          INSERT INTO rpt_attributes (activity_row_id, key, value, waive_desc)
          SELECT activity_row.id, a.key, a.value, a.waive_desc
          FROM activity_row, jsonb_to_recordset(${JSON.stringify(attributes)}::jsonb) AS a(key text, value text, waive_desc text)
        ), ledger AS (
          UPDATE attachments SET status = 'committed'
          WHERE status = 'pending'
            AND storage_key IN (SELECT jsonb_array_elements_text(${JSON.stringify(storageKeys)}::jsonb))
            AND EXISTS (SELECT 1 FROM appended)
        )
        SELECT count(*)::int AS appended FROM appended
      `),
    );
    const appended = Number((result as unknown as { rows: { appended: number }[] }).rows[0]?.appended ?? 0);
    if (appended === 0) this.deletedMeanwhile(recordId);
    const held = this.held.get(recordId);
    if (held) {
      this.remember(recordId, held);
      held.activityHistory = [...held.activityHistory, entry];
    }
    this.written.changed.add(recordId);
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private recordType(typeId: string): RecordTypeDef {
    const rt = this.recordTypes.get(typeId);
    if (!rt) throw new Error(`RecordType not found: ${typeId}`);
    return rt;
  }

  /** "Does another record already have this unique value?" — one query per unique field set. */
  private async checkUnique(rt: RecordTypeDef, fields: Record<string, unknown>, exceptId: string | null): Promise<void> {
    for (const { key, value } of uniqueValues(rt, fields)) {
      const clash = await this.run(
        this.handle
          .select({ one: sql<number>`1` })
          .from(records)
          .where(and(
            eq(records.operationId, this.operationId),
            eq(records.typeRef, rt.id),
            sql`${records.customFields}->>${key} = ${value}`,
            exceptId === null ? undefined : ne(records.id, exceptId),
          ))
          .limit(1),
      );
      if (clash.length > 0) throw new Error(`"${key}" must be unique — "${value}" already exists`);
    }
  }

  /** The held object for a row — the one already held for its id, if any. */
  private hold(row: { id: string; typeRef: string; customFields: Record<string, unknown> }): RecordInstance {
    const held = this.held.get(row.id);
    if (held) return held;
    const record: RecordInstance = { id: row.id, typeRef: row.typeRef, customFields: row.customFields, activityHistory: [] };
    this.held.set(row.id, record);
    return record;
  }

  /** Before the open savepoint first changes a held record, note how it was. */
  private remember(recordId: string, record: RecordInstance | null): void {
    const log = this.undoLogs[this.undoLogs.length - 1];
    if (!log || log.before.has(recordId)) return;
    log.before.set(
      recordId,
      record ? { record, customFields: { ...record.customFields }, historyLength: record.activityHistory.length } : null,
    );
  }

  /** A savepoint rolled back: the held records say again what the database says. */
  private restore(log: UndoLog): void {
    for (const [id, before] of log.before) {
      if (before === null) {
        this.held.delete(id); // created inside the savepoint
        continue;
      }
      const { record, customFields, historyLength } = before;
      for (const key of Object.keys(record.customFields)) delete record.customFields[key];
      Object.assign(record.customFields, customFields);
      record.activityHistory = record.activityHistory.slice(0, historyLength);
      this.held.set(id, record); // deleted inside the savepoint comes back
    }
    this.written.created = log.counts.created;
    this.written.changed = log.counts.changed;
    this.written.deleted = log.counts.deleted;
  }

  private deletedMeanwhile(recordId: string): never {
    const error = new RecordDeletedMeanwhileError(recordId);
    this.fault ??= error;
    throw error;
  }

  /** Every database call: a failure puts the store at fault (§4.2 — the whole run rolls back). */
  private async run<T>(query: PromiseLike<T>): Promise<T> {
    try {
      return await query;
    } catch (err) {
      this.fault ??= err;
      throw err;
    }
  }
}

// ── Reporting rows (moved from host.ts with write-back) ──────────────────────

/** rpt author for entries recorded before entries carried one (pre-auth data). */
const LEGACY_AUTHOR = 'demo';

function attributeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Reporting rows for one committed history entry (ARCHITECTURE.md "fully
 * normalized"): one rpt_activities row per run; one rpt_attributes row per
 * attribute. A waived attribute is the SAME row with value null and
 * waive_desc set; system-produced attributes (system_log, system_warnings)
 * are ordinary rows. Plain-object values (composite attributes: attr → item →
 * column; and file/photo descriptors: attr → field) flatten to one row per
 * leaf, keyed by the dotted path (`prelim_activities.access_permission.ok`,
 * `before_photo.hash`). Arrays (multi attributes) flatten with positional
 * segments (`site_photos.0.hash`, `tags.0`) — '.' is reserved in keys for
 * this, so queries stay uniform on the single text value column.
 */
function projectionAttributeRows(entry: ActivityHistoryEntry): { key: string; value: string | null; waiveDesc: string | null }[] {
  const waived = entry.waived ?? {};
  const rows: { key: string; value: string | null; waiveDesc: string | null }[] = [];
  const push = (key: string, value: unknown) => {
    if (key in waived) return; // emitted below as the waived row
    if (Array.isArray(value)) {
      value.forEach((item, i) => push(`${key}.${i}`, item));
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) push(`${key}.${k}`, v);
      return;
    }
    rows.push({ key, value: attributeValue(value), waiveDesc: null });
  };
  for (const [key, value] of Object.entries(entry.capturedAttributes)) {
    push(key, value);
  }
  for (const [key, reason] of Object.entries(waived)) {
    rows.push({ key, value: null, waiveDesc: reason });
  }
  if (entry.warnings && entry.warnings.length > 0) {
    rows.push({ key: 'system_warnings', value: JSON.stringify(entry.warnings), waiveDesc: null });
  }
  return rows;
}

/**
 * Every `storage_key` a value references (ATTRIBUTE_TYPES_FILES_SCALARS §8):
 * a file/photo descriptor bag carries one; multi values are arrays of them;
 * composite cells nest them. Walked structurally so the ledger commit finds
 * them wherever they sit in an entry's capturedAttributes.
 */
function collectStorageKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectStorageKeys(item, out);
  } else if (value !== null && typeof value === 'object') {
    const bag = value as Record<string, unknown>;
    if (typeof bag.storage_key === 'string') out.add(bag.storage_key);
    for (const v of Object.values(bag)) collectStorageKeys(v, out);
  }
  return out;
}
