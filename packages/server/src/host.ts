// The headless host (DSL Phase 4). Per request: fetch the scope's partition
// into a MemoryAdapter, run the same sync engine every browser host runs, then
// write the diff back to Postgres in one transaction — the ARCHITECTURE.md
// "partition-fetch + filter" runtime model made literal. Leanness of the
// transactional layer is what makes this viable; retention enforces it.
//
// Concurrency is last-write-wins per record for now (single-writer dev
// deployments); optimistic versioning slots into writeBack when it matters.

import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  createEngine,
  MemoryAdapter,
  buildGeoModule,
  type ActivityDef,
  type ActivityHistoryEntry,
  type ConfigRaw,
  type Engine,
  type RecordInstance,
} from '@fluxus/engine';
import type { Db } from './db/client';
import { attachments, pages, records, rptActivities, rptAttributes, sdmConfigs } from './db/schema';
import { buildNotifyModule, consoleNotifySink, type NotifySink } from './services/notify';

export interface ScopeHost {
  scope: string;
  config: ConfigRaw;
  adapter: MemoryAdapter;
  engine: Engine;
  /** Load-time serialization of each record — the diff baseline for writeBack. */
  baseline: Map<string, { json: string; historyLen: number }>;
}

export class ScopeNotFoundError extends Error {
  constructor(scope: string) {
    super(`No SDM config stored for scope '${scope}' — put one via config.put (or npm run seed)`);
  }
}

export async function getScopeConfig(db: Db, scope: string): Promise<ConfigRaw> {
  const rows = await db.select().from(sdmConfigs).where(eq(sdmConfigs.scope, scope));
  if (rows.length === 0) throw new ScopeNotFoundError(scope);
  return rows[0].config;
}

export async function loadScopeHost(db: Db, scope: string, sink: NotifySink = consoleNotifySink): Promise<ScopeHost> {
  const config = await getScopeConfig(db, scope);
  const rows = await db.select().from(records).where(eq(records.scope, scope));

  const initial: [string, RecordInstance][] = rows.map((r) => [
    r.id,
    { id: r.id, typeRef: r.typeRef, customFields: r.customFields, activityHistory: r.activityHistory },
  ]);
  const adapter = new MemoryAdapter(config, { initialRecords: initial });
  const engine = createEngine({
    store: adapter,
    config,
    services: [buildNotifyModule(sink), buildGeoModule(adapter)],
  });

  const baseline = new Map(
    initial.map(([id, rec]) => [id, { json: JSON.stringify(rec), historyLen: rec.activityHistory.length }]),
  );

  return { scope, config, adapter, engine, baseline };
}

/** Find an activity by id across the scope's workflows. */
export function findActivity(host: ScopeHost, activityId: string): ActivityDef | null {
  for (const rt of host.adapter.listRecordTypes()) {
    const def = host.adapter.getRecordTypeDef(rt.id);
    const activity = def.workflow.activities.find((a) => a.id === activityId);
    if (activity) return activity;
  }
  return null;
}

// ── Write-back + projection ──────────────────────────────────────────────────

/** context.user is the engine's demo stub until auth exists (engine SPEC). */
const AUTHOR = 'demo';

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

/** Ledger's live footprint — the quota fuse's SUM(size) (§7 #3). */
export async function usedStorageBytes(db: Db): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM(${attachments.size}), 0)` })
    .from(attachments);
  return Number(row?.total ?? 0);
}

/** Record a pending bucket object at presign time (§8). */
export async function insertPendingAttachment(
  db: Db,
  row: {
    storageKey: string;
    size: number;
    mime: string;
    hash?: string | null;
    width?: number | null;
    height?: number | null;
    lat?: number | null;
    lng?: number | null;
    takenAt?: Date | null;
  },
): Promise<void> {
  await db.insert(attachments).values({
    storageKey: row.storageKey,
    size: row.size,
    mime: row.mime,
    hash: row.hash ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    takenAt: row.takenAt ?? null,
  });
}

/**
 * Persist everything the run changed, atomically: record upserts/deletes on
 * the transactional layer, the reporting projection of each new history
 * entry, and the ledger flip (pending → committed) for every storage_key the
 * new entries reference — the v1 synchronous in-transaction projection
 * (ARCHITECTURE.md "Hosting options"); the outbox/async upgrade replaces this
 * call body, not its callers.
 */
export async function writeBack(db: Db, host: ScopeHost): Promise<void> {
  const current = host.adapter.allRecords();
  const currentIds = new Set(current.map((r) => r.id));

  const upserts: RecordInstance[] = [];
  const newEntries: { record: RecordInstance; entry: ActivityHistoryEntry }[] = [];
  for (const record of current) {
    const base = host.baseline.get(record.id);
    if (base && base.json === JSON.stringify(record)) continue;
    upserts.push(record);
    for (const entry of record.activityHistory.slice(base?.historyLen ?? 0)) {
      newEntries.push({ record, entry });
    }
  }
  const deletes = [...host.baseline.keys()].filter((id) => !currentIds.has(id));

  if (upserts.length === 0 && deletes.length === 0 && newEntries.length === 0) return;

  await db.transaction(async (tx) => {
    for (const record of upserts) {
      await tx
        .insert(records)
        .values({
          scope: host.scope,
          id: record.id,
          typeRef: record.typeRef,
          customFields: record.customFields,
          activityHistory: record.activityHistory,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [records.scope, records.id],
          set: {
            customFields: record.customFields,
            activityHistory: record.activityHistory,
            updatedAt: new Date(),
          },
        });
    }
    if (deletes.length > 0) {
      await tx.delete(records).where(and(eq(records.scope, host.scope), inArray(records.id, deletes)));
    }
    for (const { record, entry } of newEntries) {
      const [activityRow] = await tx
        .insert(rptActivities)
        .values({
          scope: host.scope,
          recordId: record.id,
          recordType: record.typeRef,
          activityId: entry.activityId,
          activityName: entry.activityName,
          author: AUTHOR,
          ts: new Date(entry.timestamp),
        })
        .returning({ id: rptActivities.id });
      const attributeRows = projectionAttributeRows(entry);
      if (attributeRows.length > 0) {
        await tx.insert(rptAttributes).values(
          attributeRows.map((row) => ({ activityRowId: activityRow.id, ...row })),
        );
      }
    }
    // Ledger commit: every blob a new entry references is now real business
    // data — flip it out of `pending` so GC never reaps it (§8).
    const referenced = new Set<string>();
    for (const { entry } of newEntries) collectStorageKeys(entry.capturedAttributes, referenced);
    if (referenced.size > 0) {
      await tx
        .update(attachments)
        .set({ status: 'committed' })
        .where(and(eq(attachments.status, 'pending'), inArray(attachments.storageKey, [...referenced])));
    }
  });
}

// ── Page storage ──────────────────────────────────────────────────────────────
// Pages ride the config pipeline (server = runtime truth, repo files = deploy
// input) but stay opaque jsonb: PageDef and validatePage belong to the page
// builder, and the server never depends on a peer host — so unlike putConfig
// there is no save-time validation here. put is an unconditional upsert:
// a deploy overwrites the stored page, which is the files-win semantics.

export async function listPages(db: Db, scope: string): Promise<{ path: string; def: unknown }[]> {
  const rows = await db.select().from(pages).where(eq(pages.scope, scope));
  return rows.map((r) => ({ path: r.path, def: r.def }));
}

export async function putPage(db: Db, scope: string, path: string, def: unknown): Promise<void> {
  await db
    .insert(pages)
    .values({ scope, path, def, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [pages.scope, pages.path], set: { def, updatedAt: new Date() } });
}

export async function deletePage(db: Db, scope: string, path: string): Promise<void> {
  await db.delete(pages).where(and(eq(pages.scope, scope), eq(pages.path, path)));
}

// ── Config storage ────────────────────────────────────────────────────────────

export class ConfigValidationError extends Error {
  constructor(public findings: string[]) {
    super(`SDM config rejected:\n${findings.join('\n')}`);
  }
}

/**
 * Store an SDM config for a scope — the Phase 4 shift: config becomes a
 * stored artifact and "config-save-time validation" becomes literal. The
 * server rejects an invalid SDM at save, for humans and AI alike (same
 * guardrail posture as validatePage in the page builder).
 *
 * Seed semantics: each seed group loads only if
 * the scope has no records of that type yet — user data is never touched.
 */
export async function putConfig(db: Db, scope: string, config: ConfigRaw, sink: NotifySink = consoleNotifySink): Promise<void> {
  // Structural check first — MemoryAdapter resolves every attribute_ref and
  // workflow_ref, throwing on danglers…
  const adapter = new MemoryAdapter(config);
  for (const rt of config.recordTypes) adapter.getRecordTypeDef(rt.id);
  // …then every FluxScript surface against the schema + service registry.
  const engine = createEngine({
    store: adapter,
    config,
    services: [buildNotifyModule(sink), buildGeoModule(adapter)],
  });
  const errors = engine.validateConfig().filter((f) => f.diagnostic.severity === 'error');
  if (errors.length > 0) {
    throw new ConfigValidationError(errors.map((f) => `${f.where}: ${f.diagnostic.message}`));
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(sdmConfigs)
      .values({ scope, config, updatedAt: new Date() })
      .onConflictDoUpdate({ target: sdmConfigs.scope, set: { config, updatedAt: new Date() } });

    for (const group of config.seeds ?? []) {
      const existing = await tx
        .select({ id: records.id })
        .from(records)
        .where(and(eq(records.scope, scope), eq(records.typeRef, group.typeId)))
        .limit(1);
      if (existing.length > 0) continue;
      if (group.records.length === 0) continue;
      await tx.insert(records).values(
        group.records.map((seed) => ({
          scope,
          id: seed.id,
          typeRef: group.typeId,
          customFields: seed.fields,
          activityHistory: [] as ActivityHistoryEntry[],
        })),
      );
    }
  });
}
