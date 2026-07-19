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
  type ContextUser,
  type Engine,
  type RecordInstance,
} from '@fluxus/engine';
import type { Db } from './db/client';
import { attachments, implementerLevels, operations, pageVersions, pages, records, roleAssignments, rptActivities, rptAttributes, sdmConfigs, solutions, type MenuItem, type OperationConfig } from './db/schema';
import { buildNotifyModule, consoleNotifySink, type NotifySink } from './services/notify';

/**
 * A loaded operation: its data partition (operationId) hydrated into an engine
 * built from its linked solution's config (solutionId). writeBack persists back
 * to the operation partition; the config/pages plane is keyed on the solution.
 */
export interface OperationHost {
  operationId: string;
  solutionId: string;
  config: ConfigRaw;
  adapter: MemoryAdapter;
  engine: Engine;
  /** Load-time serialization of each record — the diff baseline for writeBack. */
  baseline: Map<string, { json: string; historyLen: number }>;
}

export class SolutionNotFoundError extends Error {
  constructor(solutionId: string) {
    super(`No SDM config stored for solution '${solutionId}' — put one via config.put (or npm run seed)`);
  }
}

export class OperationNotFoundError extends Error {
  constructor(operationId: string) {
    super(`No operation '${operationId}' — create one in the Console (or npm run seed)`);
  }
}

export async function getSolutionConfig(db: Db, solutionId: string): Promise<ConfigRaw> {
  const rows = await db.select().from(sdmConfigs).where(eq(sdmConfigs.solutionId, solutionId));
  if (rows.length === 0) throw new SolutionNotFoundError(solutionId);
  return rows[0].config;
}

export interface OperationRow {
  id: string;
  orgId: string;
  solutionId: string;
  name: string;
  config: OperationConfig;
}

/** An operation resolved to its linked solution — the runtime call's two keys. */
export async function getOperation(db: Db, operationId: string): Promise<OperationRow> {
  const rows = await db.select().from(operations).where(eq(operations.id, operationId));
  if (rows.length === 0) throw new OperationNotFoundError(operationId);
  const r = rows[0];
  return { id: r.id, orgId: r.orgId, solutionId: r.solutionId, name: r.name, config: r.config };
}

/**
 * Hydrate an operation for a run: resolve operation → solution, load the
 * solution's config and the operation's record partition into one engine.
 */
export async function loadOperationHost(db: Db, operationId: string, sink: NotifySink = consoleNotifySink, user?: ContextUser): Promise<OperationHost> {
  const op = await getOperation(db, operationId);
  const config = await getSolutionConfig(db, op.solutionId);
  const rows = await db.select().from(records).where(eq(records.operationId, operationId));

  const initial: [string, RecordInstance][] = rows.map((r) => [
    r.id,
    { id: r.id, typeRef: r.typeRef, customFields: r.customFields, activityHistory: r.activityHistory },
  ]);
  const adapter = new MemoryAdapter(config, { initialRecords: initial });
  const engine = createEngine({
    store: adapter,
    config,
    services: [buildNotifyModule(sink), buildGeoModule(adapter)],
    // context.user for gates/hooks; entries record user.id as author.
    user,
  });

  const baseline = new Map(
    initial.map(([id, rec]) => [id, { json: JSON.stringify(rec), historyLen: rec.activityHistory.length }]),
  );

  return { operationId, solutionId: op.solutionId, config, adapter, engine, baseline };
}

/** Find an activity by id across the solution's workflows. */
export function findActivity(host: OperationHost, activityId: string): ActivityDef | null {
  for (const rt of host.adapter.listRecordTypes()) {
    const def = host.adapter.getRecordTypeDef(rt.id);
    const activity = def.workflow.activities.find((a) => a.id === activityId);
    if (activity) return activity;
  }
  return null;
}

// ── Write-back + projection ──────────────────────────────────────────────────

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
export async function writeBack(db: Db, host: OperationHost): Promise<void> {
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
          operationId: host.operationId,
          id: record.id,
          typeRef: record.typeRef,
          customFields: record.customFields,
          activityHistory: record.activityHistory,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [records.operationId, records.id],
          set: {
            customFields: record.customFields,
            activityHistory: record.activityHistory,
            updatedAt: new Date(),
          },
        });
    }
    if (deletes.length > 0) {
      await tx.delete(records).where(and(eq(records.operationId, host.operationId), inArray(records.id, deletes)));
    }
    for (const { record, entry } of newEntries) {
      const [activityRow] = await tx
        .insert(rptActivities)
        .values({
          operationId: host.operationId,
          recordId: record.id,
          recordType: record.typeRef,
          activityId: entry.activityId,
          activityName: entry.activityName,
          author: entry.author ?? LEGACY_AUTHOR,
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

export async function listPages(db: Db, solutionId: string): Promise<{ path: string; def: unknown }[]> {
  const rows = await db.select().from(pages).where(eq(pages.solutionId, solutionId));
  return rows.map((r) => ({ path: r.path, def: r.def }));
}

export async function putPage(db: Db, solutionId: string, path: string, def: unknown): Promise<void> {
  await db
    .insert(pages)
    .values({ solutionId, path, def, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [pages.solutionId, pages.path], set: { def, updatedAt: new Date() } });
}

export async function deletePage(db: Db, solutionId: string, path: string): Promise<void> {
  await db.delete(pages).where(and(eq(pages.solutionId, solutionId), eq(pages.path, path)));
}

// ── Page publishing (CONSOLE_RUNTIME_SPEC §3) ──────────────────────────────────
// Append-only, immutable versions. Publishing snapshots the current draft def
// at max(version)+1 with release notes; rollback is republishing an older
// version's def as a NEW version (the caller passes that def back as the draft).

export class PageDraftNotFoundError extends Error {
  constructor(path: string) { super(`No draft page '${path}' to publish`); }
}

/** Append `def` as the next immutable version of a page. */
async function appendVersion(db: Db, solutionId: string, path: string, def: unknown, readme: string, publishedBy: string): Promise<{ version: number }> {
  const [row] = await db
    .select({ maxV: sql<number | null>`MAX(${pageVersions.version})` })
    .from(pageVersions)
    .where(and(eq(pageVersions.solutionId, solutionId), eq(pageVersions.path, path)));
  const version = (row?.maxV ?? 0) + 1;
  await db.insert(pageVersions).values({ solutionId, path, version, def, readme, publishedBy });
  return { version };
}

/** Snapshot the current draft def into a new immutable version. */
export async function publishPage(db: Db, solutionId: string, path: string, readme: string, publishedBy: string): Promise<{ version: number }> {
  const draft = await db.select().from(pages).where(and(eq(pages.solutionId, solutionId), eq(pages.path, path)));
  if (draft.length === 0) throw new PageDraftNotFoundError(path);
  return appendVersion(db, solutionId, path, draft[0].def, readme, publishedBy);
}

/**
 * Roll back by republishing an older version's def as a NEW version (never a
 * delete/edit — append-only). The draft is left untouched.
 */
export async function rollbackPage(db: Db, solutionId: string, path: string, version: number, readme: string, publishedBy: string): Promise<{ version: number }> {
  const def = await getPageVersion(db, solutionId, path, version);
  if (def === null) throw new PageDraftNotFoundError(`${path} (version ${version})`);
  return appendVersion(db, solutionId, path, def, readme, publishedBy);
}

/** Version history for one page, newest first (readme + who/when). */
export async function listPageVersions(db: Db, solutionId: string, path: string): Promise<{ version: number; readme: string; publishedBy: string; publishedAt: Date }[]> {
  const rows = await db
    .select({ version: pageVersions.version, readme: pageVersions.readme, publishedBy: pageVersions.publishedBy, publishedAt: pageVersions.publishedAt })
    .from(pageVersions)
    .where(and(eq(pageVersions.solutionId, solutionId), eq(pageVersions.path, path)));
  return rows.sort((a, b) => b.version - a.version);
}

/** The def of one specific published version — for rollback (republish it). */
export async function getPageVersion(db: Db, solutionId: string, path: string, version: number): Promise<unknown | null> {
  const rows = await db
    .select({ def: pageVersions.def })
    .from(pageVersions)
    .where(and(eq(pageVersions.solutionId, solutionId), eq(pageVersions.path, path), eq(pageVersions.version, version)));
  return rows[0]?.def ?? null;
}

/** The latest published version per path — what Runtime renders (published-only). */
export async function listPublishedPages(db: Db, solutionId: string): Promise<{ path: string; def: unknown }[]> {
  const rows = await db
    .select({ path: pageVersions.path, version: pageVersions.version, def: pageVersions.def })
    .from(pageVersions)
    .where(eq(pageVersions.solutionId, solutionId));
  const latest = new Map<string, { version: number; def: unknown }>();
  for (const r of rows) {
    const cur = latest.get(r.path);
    if (!cur || r.version > cur.version) latest.set(r.path, { version: r.version, def: r.def });
  }
  return [...latest.entries()].map(([path, v]) => ({ path, def: v.def }));
}

// ── Solutions + operations (CONSOLE_RUNTIME_SPEC §2–3) ─────────────────────────
// Plain auth-tier reads/writes — no SDM, no activities. The Console admin
// surfaces are built by hand over these helpers.

export async function ensureSolution(db: Db, id: string, name: string): Promise<void> {
  await db.insert(solutions).values({ id, name }).onConflictDoNothing({ target: solutions.id });
}

export async function ensureOperation(db: Db, id: string, solutionId: string, name: string): Promise<void> {
  await db.insert(operations).values({ id, solutionId, name }).onConflictDoNothing({ target: operations.id });
}

export async function listSolutions(db: Db): Promise<{ id: string; name: string }[]> {
  const rows = await db.select().from(solutions);
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

export async function listOperations(db: Db): Promise<OperationRow[]> {
  const rows = await db.select().from(operations);
  return rows.map((r) => ({ id: r.id, orgId: r.orgId, solutionId: r.solutionId, name: r.name, config: r.config }));
}

/** Create an operation against an existing solution (the linked FK is enforced). */
export async function createOperation(db: Db, input: { id: string; solutionId: string; name: string }): Promise<void> {
  const sol = await db.select({ id: solutions.id }).from(solutions).where(eq(solutions.id, input.solutionId));
  if (sol.length === 0) throw new SolutionNotFoundError(input.solutionId);
  await db.insert(operations).values({ id: input.id, solutionId: input.solutionId, name: input.name });
}

/** Persist the operation's runtime config (menu, §5). */
export async function putOperationConfig(db: Db, operationId: string, config: OperationConfig): Promise<void> {
  const res = await db.update(operations).set({ config }).where(eq(operations.id, operationId)).returning({ id: operations.id });
  if (res.length === 0) throw new OperationNotFoundError(operationId);
}

export class MenuValidationError extends Error {
  constructor(public findings: string[]) {
    super(`Operation menu rejected:\n${findings.join('\n')}`);
  }
}

/**
 * Validate an operation menu against its linked solution (CONSOLE_RUNTIME_SPEC
 * §5): every leaf `page` must resolve to a **published** page of the solution;
 * every role id must be one the solution declares (`access.roles`); nesting is
 * one level max (MVP). Run at operation-config save.
 */
export async function validateOperationMenu(db: Db, solutionId: string, menu: MenuItem[]): Promise<void> {
  const published = new Set((await listPublishedPages(db, solutionId)).map((p) => p.path));
  const config = await getSolutionConfig(db, solutionId);
  const roleIds = new Set((config.access?.roles ?? []).map((r) => r.id));
  const errors: string[] = [];
  const walk = (items: MenuItem[], depth: number) => {
    for (const it of items) {
      if (it.page && !published.has(it.page)) errors.push(`"${it.label}" → no published page "${it.page}"`);
      for (const r of it.roles ?? []) if (!roleIds.has(r)) errors.push(`"${it.label}" → unknown role "${r}"`);
      if (it.items && it.items.length > 0) {
        if (depth >= 1) errors.push(`"${it.label}" nests too deep (one level max)`);
        else walk(it.items, depth + 1);
      }
    }
  };
  walk(menu, 0);
  if (errors.length > 0) throw new MenuValidationError(errors);
}

/**
 * Whether a published page def is openable to `roles` (RBAC_COMPACT page
 * surface / §6). Enforced server-side only when auth is configured AND the
 * solution declares roles; otherwise open (env stub / adoption). When active it
 * is **default deny**: `def.access.open` must list a held role. `def` is opaque
 * jsonb — this reads only the shallow `access.open` convention, no PageDef dep.
 */
export function pageOpenable(authConfigured: boolean | undefined, config: ConfigRaw, roles: string[] | undefined, def: unknown): boolean {
  if (!authConfigured) return true;
  if (!config.access?.roles?.length) return true;
  const open = (def as { access?: { open?: string[] } } | null)?.access?.open;
  if (!open || open.length === 0) return false;
  const held = new Set(roles ?? []);
  return open.some((r) => held.has(r));
}

// ── Governance store (RBAC stage 1; CONSOLE_RUNTIME_SPEC §2a) ──────────────────
// Bespoke auth-tier tables — plain reads/writes, no SDM. Assignments key the
// runtime plane (user → role ids in an operation); implementer levels key the
// design plane (user → level on a solution, consumed at RBAC stage 2/M5).

export async function listRoleAssignments(db: Db, operationId: string): Promise<{ userId: string; roleIds: string[] }[]> {
  const rows = await db
    .select({ userId: roleAssignments.userId, roleIds: roleAssignments.roleIds })
    .from(roleAssignments)
    .where(eq(roleAssignments.operationId, operationId));
  return rows.map((r) => ({ userId: r.userId, roleIds: r.roleIds }));
}

/** Upsert a user's role ids in an operation; empty roleIds clears the row. */
export async function putRoleAssignment(db: Db, input: { operationId: string; userId: string; roleIds: string[]; orgId?: string }): Promise<void> {
  const orgId = input.orgId ?? 'default';
  if (input.roleIds.length === 0) {
    await db.delete(roleAssignments).where(and(eq(roleAssignments.operationId, input.operationId), eq(roleAssignments.userId, input.userId)));
    return;
  }
  await db
    .insert(roleAssignments)
    .values({ orgId, operationId: input.operationId, userId: input.userId, roleIds: input.roleIds })
    .onConflictDoUpdate({ target: [roleAssignments.orgId, roleAssignments.operationId, roleAssignments.userId], set: { roleIds: input.roleIds } });
}

export async function listImplementerLevels(db: Db, solutionId: string): Promise<{ userId: string; level: 'read' | 'write' | 'admin' }[]> {
  const rows = await db
    .select({ userId: implementerLevels.userId, level: implementerLevels.level })
    .from(implementerLevels)
    .where(eq(implementerLevels.solutionId, solutionId));
  return rows.map((r) => ({ userId: r.userId, level: r.level }));
}

/** Upsert a user's implementer level on a solution. */
export async function putImplementerLevel(db: Db, input: { solutionId: string; userId: string; level: 'read' | 'write' | 'admin' }): Promise<void> {
  await db
    .insert(implementerLevels)
    .values({ userId: input.userId, solutionId: input.solutionId, level: input.level })
    .onConflictDoUpdate({ target: [implementerLevels.userId, implementerLevels.solutionId], set: { level: input.level } });
}

/**
 * Seed the config's demo records into an operation partition — dev bootstrap
 * only (moved out of putConfig, which is solution-plane and owns no records).
 * Each seed group loads only if the operation has no records of that type yet,
 * so user data is never touched.
 */
export async function seedOperationRecords(db: Db, operationId: string, config: ConfigRaw): Promise<void> {
  for (const group of config.seeds ?? []) {
    if (group.records.length === 0) continue;
    const existing = await db
      .select({ id: records.id })
      .from(records)
      .where(and(eq(records.operationId, operationId), eq(records.typeRef, group.typeId)))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(records).values(
      group.records.map((seed) => ({
        operationId,
        id: seed.id,
        typeRef: group.typeId,
        customFields: seed.fields,
        activityHistory: [] as ActivityHistoryEntry[],
      })),
    );
  }
}

// ── Config storage ────────────────────────────────────────────────────────────

export class ConfigValidationError extends Error {
  constructor(public findings: string[]) {
    super(`SDM config rejected:\n${findings.join('\n')}`);
  }
}

/**
 * Store an SDM config for a solution — the Phase 4 shift: config becomes a
 * stored artifact and "config-save-time validation" becomes literal. The
 * server rejects an invalid SDM at save, for humans and AI alike (same
 * guardrail posture as validatePage in the page builder). Config is
 * solution-plane and owns no records; demo-record seeding lives in
 * seedOperationRecords, called against an operation by the seed script.
 */
export async function putConfig(db: Db, solutionId: string, config: ConfigRaw, sink: NotifySink = consoleNotifySink): Promise<void> {
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

  await db
    .insert(sdmConfigs)
    .values({ solutionId, config, updatedAt: new Date() })
    .onConflictDoUpdate({ target: sdmConfigs.solutionId, set: { config, updatedAt: new Date() } });
}
