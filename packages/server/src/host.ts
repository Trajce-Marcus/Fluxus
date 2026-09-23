// The headless host (DSL Phase 4). Per request: fetch the scope's partition
// into a MemoryAdapter, run the same sync engine every browser host runs, then
// write the diff back to Postgres in one transaction — the ARCHITECTURE.md
// "partition-fetch + filter" runtime model made literal. Leanness of the
// transactional layer is what makes this viable; retention enforces it.
//
// Concurrency is last-write-wins per record for now (single-writer dev
// deployments); optimistic versioning slots into writeBack when it matters.

import { and, asc, eq, inArray, isNull, not, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  createEngine,
  MemoryAdapter,
  buildGeoModule,
  buildTimeModule,
  buildMathModule,
  type ActivityDef,
  type ActivityHistoryEntry,
  type AttributeDef,
  type FunctionDef,
  type SolutionConfig,
  type ContextUser,
  type Engine,
  type RecordInstance,
  type RecordTypeDef,
  type RoleDef,
  type WorkflowRawDef,
} from '@fluxus/engine';
import type { Db, DbOrTx } from './db/client';
import { attachments, solAdmins, operations, orgs, pageVersions, pages, records, rptActivities, rptAttributes, sdmAttributes, sdmConfigVersions, sdmFunctions, sdmMenus, sdmRecordTypes, sdmRoles, sdmWorkflows, solutions, users, type MenuItem, type OperationConfig } from './db/schema';
import { normaliseEmail } from './users';
import { buildNotifyModule, consoleNotifySink, type NotifySink } from './services/notify';

/**
 * A loaded operation: its data partition (operationId) hydrated into an engine
 * built from its linked solution's config (solutionId). writeBack persists back
 * to the operation partition; the config/pages plane is keyed on the solution.
 */
export interface OperationHost {
  operationId: string;
  solutionId: string;
  config: SolutionConfig;
  adapter: MemoryAdapter;
  engine: Engine;
  /** Load-time serialization of each record — the diff baseline for writeBack. */
  baseline: Map<string, { json: string; historyLen: number }>;
}

export class SolutionNotFoundError extends Error {
  constructor(solutionId: string) {
    super(`No SDM config stored for solution '${solutionId}' — author one in the Console, or put one via config.put`);
  }
}

export class OperationNotFoundError extends Error {
  constructor(operationId: string) {
    super(`No operation '${operationId}' — create one in the Console`);
  }
}

export class OrgNotFoundError extends Error {
  constructor(orgId: string) {
    super(`No org '${orgId}' — the workspace is not onboarded; register it via platform.registerOrg`);
  }
}

/**
 * The solution's model, assembled from the six `sdm_*` tables — **one round
 * trip**, which is what let the derived `sdm_configs` snapshot be dropped
 * (2026-08-09) rather than kept as a second copy of the truth.
 *
 * Selecting `FROM solutions` makes the same query answer "does this solution
 * exist": a solution with no model yet assembles to the empty model, while an
 * unknown solution has no row at all and throws. Ordering is by identity —
 * rows carry no authored order, by design.
 */
export async function getSolutionConfig(db: DbOrTx, solutionId: string): Promise<SolutionConfig> {
  const [row] = await db
    .select({
      attributes: sql<AttributeDef[] | null>`(SELECT jsonb_agg(${sdmAttributes.def} ORDER BY ${sdmAttributes.key}) FROM ${sdmAttributes} WHERE ${eq(sdmAttributes.solutionId, solutionId)})`,
      recordTypes: sql<RecordTypeDef[] | null>`(SELECT jsonb_agg(${sdmRecordTypes.def} ORDER BY ${sdmRecordTypes.id}) FROM ${sdmRecordTypes} WHERE ${eq(sdmRecordTypes.solutionId, solutionId)})`,
      workflows: sql<WorkflowRawDef[] | null>`(SELECT jsonb_agg(${sdmWorkflows.def} ORDER BY ${sdmWorkflows.id}) FROM ${sdmWorkflows} WHERE ${eq(sdmWorkflows.solutionId, solutionId)})`,
      functions: sql<FunctionDef[] | null>`(SELECT jsonb_agg(${sdmFunctions.def} ORDER BY ${sdmFunctions.id}) FROM ${sdmFunctions} WHERE ${eq(sdmFunctions.solutionId, solutionId)})`,
      roles: sql<RoleDef[] | null>`(SELECT jsonb_agg(${sdmRoles.def} ORDER BY ${sdmRoles.id}) FROM ${sdmRoles} WHERE ${eq(sdmRoles.solutionId, solutionId)})`,
      defaultMenu: sql<MenuItem[] | null>`(SELECT ${sdmMenus.def} FROM ${sdmMenus} WHERE ${eq(sdmMenus.solutionId, solutionId)})`,
    })
    .from(solutions)
    .where(eq(solutions.id, solutionId));
  if (!row) throw new SolutionNotFoundError(solutionId);
  return {
    attributes: row.attributes ?? [],
    recordTypes: row.recordTypes ?? [],
    workflows: row.workflows ?? [],
    // Absent collections stay absent — `functions` and `access` are optional in
    // the config, and no `access.roles` at all is what switches RBAC off, which
    // an empty array would not say.
    ...(row.functions ? { functions: row.functions } : {}),
    ...(row.roles ? { access: { roles: row.roles } } : {}),
    ...(row.defaultMenu ? { default_menu: row.defaultMenu } : {}),
  } as SolutionConfig;
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
    services: [buildNotifyModule(sink), buildGeoModule(adapter), buildTimeModule(), buildMathModule()],
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
export async function listPublishedPages(db: DbOrTx, solutionId: string): Promise<{ path: string; def: unknown }[]> {
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

// Idempotent upserts, used by tests and `scripts/bootstrap.ts` to stand a
// tenancy up. Nothing in the request path calls them and no script installs
// content with them any more (the seed script went with all other
// prepopulation, 2026-08-05) — orgs arrive via platform.registerOrg,
// solutions via solutions.create, operations via operations.create.
export async function ensureOrg(db: Db, id: string, name: string): Promise<void> {
  await db.insert(orgs).values({ id, name }).onConflictDoUpdate({ target: orgs.id, set: { name } });
}

export async function ensureSolution(db: Db, id: string, name: string, orgId = 'default'): Promise<void> {
  await db.insert(solutions).values({ id, name, orgId }).onConflictDoUpdate({ target: solutions.id, set: { name } });
}

export async function ensureOperation(db: Db, id: string, solutionId: string, name: string): Promise<void> {
  await db.insert(operations).values({ id, solutionId, name }).onConflictDoUpdate({ target: operations.id, set: { name } });
}

/** Display name for an org (Runtime header, M13); falls back to the id so a
 *  missing row can't break boot — the same posture as getSolutionName. */
export async function getOrgName(db: Db, orgId: string): Promise<string> {
  const rows = await db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId));
  return rows[0]?.name ?? orgId;
}

/** The org's profile — what Console's Organisation → Settings surface shows
 *  (M14). Unknown id ⇒ a synthetic row so an un-onboarded workspace renders
 *  rather than errors; the same don't-break-boot posture as getOrgName. */
export async function getOrg(db: Db, orgId: string): Promise<OrgRow> {
  const rows = await db.select().from(orgs).where(eq(orgs.id, orgId));
  const r = rows[0];
  if (!r) return { id: orgId, name: orgId, ownerEmail: null, plan: 'free', status: 'active', createdAt: null };
  return { id: r.id, name: r.name, ownerEmail: r.ownerEmail, plan: r.plan, status: r.status, createdAt: r.createdAt };
}

export interface OrgRow {
  id: string;
  name: string;
  /** The root of authority (USERS.md §3) — named at registration, and the org's
   *  contact address since `contact_email` was dropped (migration 0018). Null
   *  only on orgs that predate it and on the synthetic un-onboarded row. */
  ownerEmail: string | null;
  /** What the org is subscribed to. Billing is later — this records the tier. */
  plan: string;
  status: string;
  /** Registration date; null only for the synthetic un-onboarded row. */
  createdAt: Date | null;
}

/** Every org, for the platform plane's org list. The only cross-org read in
 *  the codebase — every other query is scoped to one org by construction, which
 *  is why this one is reachable through the platform router alone. */
export async function listOrgs(db: Db): Promise<OrgRow[]> {
  const rows = await db.select().from(orgs).orderBy(asc(orgs.name));
  return rows.map((r) => ({
    id: r.id, name: r.name, ownerEmail: r.ownerEmail, plan: r.plan, status: r.status, createdAt: r.createdAt,
  }));
}

export class OrgExistsError extends Error {
  constructor(orgId: string) {
    super(`Org '${orgId}' already exists`);
  }
}

/**
 * Register an org and its owner — **one act** (USERS.md §7): the chain cannot
 * start itself, so creating an org and creating the person who will govern it
 * cannot be two steps. After the first, the org admits nobody — including
 * whoever would perform the second.
 *
 * Three rows, one meaning: the org, its `owner_email` (the root of authority),
 * and the owner's `users` row — **the organisation's first user**. Nobody
 * invites the owner, because there is nobody there to do it, so the act that
 * creates the org creates the person (agreed 2026-08-04).
 *
 * The owner is deliberately **not** appointed an org admin here. They appoint
 * org admins — that is the authority the tier carries — and appoint themselves
 * one if they mean to do ordinary org-admin work. Console access is derived
 * from ownership, which is what makes that first appointment reachable.
 *
 * Nothing is emailed: invites are a database row and nothing more until a mail
 * sender exists, so the owner is told out of band (ruled 2026-08-03).
 */
export async function registerOrg(
  db: Db,
  input: { id: string; name: string; ownerEmail: string; ownerName?: string | null; plan?: string },
): Promise<void> {
  const existing = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, input.id));
  if (existing.length > 0) throw new OrgExistsError(input.id);
  const ownerEmail = normaliseEmail(input.ownerEmail);
  await db.insert(orgs).values({
    id: input.id,
    name: input.name,
    ownerEmail,
    ...(input.plan ? { plan: input.plan } : {}),
  });
  await db
    .insert(users)
    .values({ orgId: input.id, email: ownerEmail, name: input.ownerName ?? null, status: 'invited' })
    .onConflictDoUpdate({ target: [users.orgId, users.email], set: { name: input.ownerName ?? null } });
}

/** Edit the org profile — **the name, and nothing else**.
 *
 *  `plan` and `status` are ours to set, never theirs. `owner_email` is not
 *  editable here either (2026-08-04): changing it is **ownership transfer**, and
 *  this call is org-admin work — an org admin who could write that column would
 *  promote themselves to the root that appoints org admins. Transfer stays
 *  deliberately unbuilt (USERS.md §7). */
export async function putOrgProfile(db: Db, orgId: string, input: { name: string }): Promise<void> {
  const res = await db.update(orgs)
    .set({ name: input.name })
    .where(eq(orgs.id, orgId))
    .returning({ id: orgs.id });
  if (res.length === 0) throw new OrgNotFoundError(orgId);
}

/** The org's solutions. `org_id` is scoping — it decides whose list this is —
 *  so every read of the catalogue filters on it (added 2026-08-02). Solution
 *  ids stay globally unique, so nothing else has to know about the org. */
export async function listSolutions(db: Db, orgId = 'default'): Promise<{ id: string; name: string; origin: string }[]> {
  const rows = await db.select().from(solutions).where(eq(solutions.orgId, orgId)).orderBy(asc(solutions.name));
  return rows.map((r) => ({ id: r.id, name: r.name, origin: r.origin }));
}

/** Display name for an operation's linked solution (Runtime header, M10);
 *  falls back to the id so a missing row can't break boot. */
export async function getSolutionName(db: Db, solutionId: string): Promise<string> {
  const rows = await db.select({ name: solutions.name }).from(solutions).where(eq(solutions.id, solutionId));
  return rows[0]?.name ?? solutionId;
}

/** Create a solution (the design-artifact container, §1), and appoint its
 *  creator its first sol admin. Duplicate id → db unique-constraint error.
 *
 *  The appointment is not a convenience — the design plane is **strict** (you
 *  build a solution only if you are appointed to it), so a solution created with
 *  an empty list would be one nobody can build, including the person who just
 *  made it. Creating a solution and appointing its first admin are one act, the
 *  same rule the org tier follows. `createdBy` absent (tests, demo posture)
 *  ⇒ no row, and nothing to be locked out of. */
export async function createSolution(db: Db, input: { id: string; name: string; orgId?: string; createdBy?: string | null }): Promise<void> {
  await db.insert(solutions).values({ id: input.id, name: input.name, orgId: input.orgId ?? 'default' });
  if (input.createdBy) {
    await db
      .insert(solAdmins)
      .values({ email: normaliseEmail(input.createdBy), solutionId: input.id })
      .onConflictDoNothing();
  }
}

/** Edit a solution's profile. **Name only** — the id is permanent: the config,
 *  page drafts and versions, sol admins and every operation are keyed
 *  on it, so a rename would orphan all of them (the `operations.solution_id`
 *  reasoning, §1a). `origin`/`origin_ref` are provenance, not user data. */
export async function updateSolution(db: Db, input: { solutionId: string; name: string }): Promise<void> {
  const rows = await db.select({ id: solutions.id }).from(solutions).where(eq(solutions.id, input.solutionId));
  if (rows.length === 0) throw new SolutionNotFoundError(input.solutionId);
  await db.update(solutions).set({ name: input.name }).where(eq(solutions.id, input.solutionId));
}

export class NotImplementedError extends Error {}

/**
 * Delete a solution — **the destructive half is deliberately not written yet**
 * (ruled 2026-07-31). The endpoint exists so the Console's danger zone is wired
 * end to end; calling it fails loudly instead of destroying anything.
 *
 * TODO — deleting a solution **cascades to its operations** (user ruling
 * 2026-07-31: "deleting solution means deleting all operations"), so the
 * implementation has to remove, in one transaction:
 *   - per operation: `records`, `rpt_attributes` → `rpt_activities`,
 *     `user_roles`, `attachments` (and the blobs behind them), then the
 *     `operations` row;
 *   - then the design artifacts: `page_versions`, `pages`,
 *     `sdm_config_versions`, `sdm_configs`, `sol_admins`;
 *   - then the `solutions` row.
 * Open questions to settle first: whether stored files are deleted from R2 or
 * left to a sweeper, and whether a delete is recorded anywhere (nothing in this
 * schema is append-only about *deletion* yet).
 */
export async function deleteSolution(db: Db, solutionId: string): Promise<void> {
  const rows = await db.select({ id: solutions.id }).from(solutions).where(eq(solutions.id, solutionId));
  if (rows.length === 0) throw new SolutionNotFoundError(solutionId);
  throw new NotImplementedError(
    `Deleting a solution is not implemented yet — it must cascade to the operations running it, ` +
    `and their records. Nothing was deleted.`,
  );
}

export async function listOperations(db: Db): Promise<OperationRow[]> {
  // Ordered, and it matters: the Console binds its **data operation** to the
  // first operation of a solution when nothing is remembered locally, so an
  // unordered read (Postgres heap order, which moves as rows are written) made
  // "which records the workbench shows" nondeterministic between loads.
  const rows = await db.select().from(operations).orderBy(asc(operations.name));
  return rows.map((r) => ({ id: r.id, orgId: r.orgId, solutionId: r.solutionId, name: r.name, config: r.config }));
}

/** Create an operation against an existing solution (the linked FK is enforced). */
export async function createOperation(db: Db, input: { id: string; solutionId: string; name: string }): Promise<void> {
  const sol = await db.select({ id: solutions.id, orgId: solutions.orgId }).from(solutions).where(eq(solutions.id, input.solutionId));
  if (sol.length === 0) throw new SolutionNotFoundError(input.solutionId);
  // The operation INHERITS the solution's org rather than taking one as input
  // (2026-08-03). Two reasons: the link is binding and permanent, so an
  // operation in a different org from its solution could never be corrected;
  // and one source of truth means no call site can disagree about whose
  // operation this is. Until now nothing passed an org at all and every
  // operation landed in 'default' — invisible while 'default' was the only org.
  await db.insert(operations).values({ id: input.id, solutionId: input.solutionId, name: input.name, orgId: sol[0].orgId });
}

/** Which org owns a solution — the gate lookup for every solution-scoped admin
 *  call. Unknown id is NOT treated as 'default': that would let an admin of the
 *  default org act on a typo'd id somewhere else. */
export async function getSolutionOrg(db: Db, solutionId: string): Promise<string> {
  const rows = await db.select({ orgId: solutions.orgId }).from(solutions).where(eq(solutions.id, solutionId));
  if (rows.length === 0) throw new SolutionNotFoundError(solutionId);
  return rows[0].orgId;
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

/** A menu's wire shape — the operation override's input schema, and what a
 *  config's `default_menu` is checked against before its references are. */
export const menuItemSchema: z.ZodType<MenuItem> = z.lazy(() =>
  z.object({
    // Zod strips unknown keys, so the stable id has to be declared here or a
    // saved override would come back without ids.
    id: z.string().min(1).optional(),
    label: z.string().min(1),
    page: z.string().min(1).optional(),
    roles: z.array(z.string().min(1)).optional(),
    items: z.array(menuItemSchema).optional(),
  }),
);

/**
 * Validate a menu against its solution (CONSOLE_RUNTIME_SPEC §5): every leaf
 * `page` must resolve to a **published** page of the solution; every role id
 * must be one the solution declares (`access.roles`); nesting is one level max
 * (MVP). Run at operation-config save (the override) and at config.put (the
 * solution's `default_menu`) — the latter passes `rolesFrom` so roles are read
 * from the config being saved, not the stored one it is replacing.
 */
export async function validateOperationMenu(db: DbOrTx, solutionId: string, menu: MenuItem[], rolesFrom?: SolutionConfig): Promise<void> {
  const published = new Set((await listPublishedPages(db, solutionId)).map((p) => p.path));
  const config = rolesFrom ?? (await getSolutionConfig(db, solutionId));
  const roleIds = new Set((config.access?.roles ?? []).map((r) => r.id));
  const errors: string[] = [];
  // Item ids must be unique across the whole menu — they identify an item for
  // selection, reordering and (§5a) an operation's per-item overrides.
  const seenIds = new Set<string>();
  const walk = (items: MenuItem[], depth: number) => {
    for (const it of items) {
      if (it.id) {
        if (seenIds.has(it.id)) errors.push(`"${it.label}" → duplicate item id "${it.id}"`);
        seenIds.add(it.id);
      }
      if (it.page && !published.has(it.page)) errors.push(`"${it.label}" → no published page "${it.page}"`);
      // A leaf that opens nothing is a dead entry: it renders, it highlights
      // nothing, and clicking it does nothing — while its presence hides the
      // Pages list the Runtime app falls back to when an operation has no
      // menu. Caught here since 2026-08-20, after three such items in the demo
      // operation made its published pages unreachable.
      //
      // A **group** is any item carrying an `items` key, empty included: the
      // editor makes a group first and fills it by dragging items in, and an
      // empty one is invisible at runtime anyway (`visibleMenu` drops a group
      // with no visible child). What is rejected is an item that is neither —
      // a label with nothing behind it.
      if (!it.page && it.items === undefined) {
        errors.push(`"${it.label}" → give it a page, or make it a group and put items under it`);
      }
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
export function pageOpenable(authConfigured: boolean | undefined, config: SolutionConfig, roles: string[] | undefined, def: unknown): boolean {
  if (!authConfigured) return true;
  if (!config.access?.roles?.length) return true;
  const open = (def as { access?: { open?: string[] } } | null)?.access?.open;
  if (!open || open.length === 0) return false;
  const held = new Set(roles ?? []);
  return open.some((r) => held.has(r));
}

// ── Governance store (RBAC stage 1; CONSOLE_RUNTIME_SPEC §2a) ──────────────────
// Users, admins and roles moved to `./users` with the 2026-08-04 model rewrite
// (one population, then grants) — six small tables, one module per tier, none of
// it touching the SDM or the engine. Re-exported so callers keep one import.
export * from './users';

// ── Config storage ────────────────────────────────────────────────────────────

export class ConfigValidationError extends Error {
  constructor(public findings: string[]) {
    super(`SDM config rejected:\n${findings.join('\n')}`);
  }
}

/**
 * Everything a stored model has to satisfy, whichever door it came through:
 * `config.put` (the whole graph at once) and the per-entity mutations below run
 * exactly this. The consistency unit is the **whole graph** — a workflow
 * references attributes — so no per-entity write gets a smaller check.
 */
async function validateConfigGraph(db: DbOrTx, solutionId: string, config: SolutionConfig, sink: NotifySink): Promise<void> {
  // Structural check first — MemoryAdapter resolves every attribute_ref and
  // workflow_ref, throwing on danglers…
  const adapter = new MemoryAdapter(config);
  for (const rt of config.recordTypes) adapter.getRecordTypeDef(rt.id);
  // …then every FluxScript surface against the schema + service registry.
  const engine = createEngine({
    store: adapter,
    config,
    services: [buildNotifyModule(sink), buildGeoModule(adapter), buildTimeModule(), buildMathModule()],
  });
  const errors = engine.validateConfig().filter((f) => f.diagnostic.severity === 'error');
  if (errors.length > 0) {
    throw new ConfigValidationError(errors.map((f) => `${f.where}: ${f.diagnostic.message}`));
  }

  // The config must also survive the data it already governs: a stored record's
  // typeRef has to resolve in the new config, or those records become
  // unreachable through every activity path (mutation is activity-only, so
  // nothing could ever touch them again). Blocks renaming/removing a record
  // type that any of the solution's operations still holds records of.
  const ids = config.recordTypes.map((rt) => rt.id);
  const stored = await db
    .selectDistinct({ typeRef: records.typeRef })
    .from(records)
    .innerJoin(operations, eq(records.operationId, operations.id))
    .where(eq(operations.solutionId, solutionId));
  const orphaned = stored.map((r) => r.typeRef).filter((t) => !ids.includes(t));
  if (orphaned.length > 0) {
    throw new ConfigValidationError(
      orphaned.map((t) => `recordTypes: stored records still reference '${t}' — rename or remove is blocked while records of this type exist`),
    );
  }
}

/**
 * Store a whole SDM config for a solution — the Phase 4 shift: config becomes a
 * stored artifact and "config-save-time validation" becomes literal. The
 * server rejects an invalid SDM at save, for humans and AI alike (same
 * guardrail posture as validatePage in the page builder). Config is
 * solution-plane and owns no records — an operation starts empty and every
 * record in it arrives through an activity, with no seeding path around that.
 *
 * Since the storage split this is the **import** path, not the editing path
 * (the Console saves one entity at a time): it explodes the incoming config
 * into rows, replacing all five collections and the menu, and **rows absent
 * from the incoming config are deleted**. `rollbackConfig` depends on it, and
 * installing a solution package will too.
 */
export async function putConfig(
  db: Db,
  solutionId: string,
  config: SolutionConfig,
  sink: NotifySink = consoleNotifySink,
  author: string | null = null,
): Promise<void> {
  await editConfig(db, solutionId, sink, async (tx) => {
    // Deletes walk the FK order backwards and precede every insert: a record
    // type that is going has to go before the workflow it points at can.
    for (const collection of [...COLLECTIONS_IN_FK_ORDER].reverse()) {
      await collection.removeExcept(tx, solutionId, collection.read(config).map((e) => identityOf(collection, e)));
    }
    for (const collection of COLLECTIONS_IN_FK_ORDER) {
      for (const entity of collection.read(config)) {
        await collection.put(tx, solutionId, identityOf(collection, entity), entity, author);
      }
    }
    const menu = (config as { default_menu?: MenuItem[] }).default_menu;
    if (menu && menu.length > 0) {
      await tx
        .insert(sdmMenus)
        .values({ solutionId, def: menu, createdBy: author, updatedBy: author })
        .onConflictDoUpdate({ target: sdmMenus.solutionId, set: { def: menu, updatedAt: new Date(), updatedBy: author } });
    } else {
      await tx.delete(sdmMenus).where(eq(sdmMenus.solutionId, solutionId));
    }
  });
}

// ── The model as tables (storage split, step 2) ───────────────────────────────
// The consistency unit is the whole graph; the **change unit is one entity**.
// The blob conflated the two, so `config.put` was last-write-wins across the
// entire model — two sol admins editing two different record types had no
// logical conflict, yet one silently lost their work. Step 1 narrowed the write
// API to one entity per call; this is the storage underneath it.
//
// **The tables are the only copy.** A write changes rows and then validates the
// model those rows assemble to (`getSolutionConfig`, one round trip). The
// derived `sdm_configs` snapshot that stood beside them for a day was dropped
// 2026-08-09 — see migration 0020.

/**
 * One collection of the model: the name errors use, the identity field the
 * entity itself carries (`key` for attributes, `id` for the rest — the config's
 * own spelling), where it sits within a config, and its rows.
 *
 * `def` is stored **verbatim, including its own key/id**, so `read` is a plain
 * lift out of an incoming config — the import path's exploder needs nothing
 * reconstructed, and assembly is `jsonb_agg` in the database.
 */
export interface ConfigCollection<T> {
  name: string;
  idField: 'key' | 'id';
  read(config: SolutionConfig): T[];
  /** Every def for a solution, ordered by identity — assembly is deterministic
   *  by key, since rows carry no authored order (lost at migration, by design). */
  list(tx: DbOrTx, solutionId: string): Promise<T[]>;
  /** Insert or update one row. `created_by` on insert, `updated_by` on update. */
  put(tx: DbOrTx, solutionId: string, id: string, def: T, author: string | null): Promise<void>;
  /** Delete by identity, or (`ids` omitted) every row the given identities do
   *  not name — the import path's "rows absent from the incoming config go". */
  remove(tx: DbOrTx, solutionId: string, id: string): Promise<void>;
  removeExcept(tx: DbOrTx, solutionId: string, keep: string[]): Promise<void>;
}

export const configCollections = {
  attributes: {
    name: 'attributes',
    idField: 'key',
    read: (c) => c.attributes ?? [],
    list: async (tx, solutionId) => (await tx
      .select({ def: sdmAttributes.def })
      .from(sdmAttributes)
      .where(eq(sdmAttributes.solutionId, solutionId))
      .orderBy(asc(sdmAttributes.key))).map((r) => r.def),
    put: async (tx, solutionId, key, def, author) => {
      await tx
        .insert(sdmAttributes)
        .values({ solutionId, key, def, createdBy: author, updatedBy: author })
        .onConflictDoUpdate({
          target: [sdmAttributes.solutionId, sdmAttributes.key],
          set: { def, updatedAt: new Date(), updatedBy: author },
        });
    },
    remove: async (tx, solutionId, key) => {
      await tx.delete(sdmAttributes).where(and(eq(sdmAttributes.solutionId, solutionId), eq(sdmAttributes.key, key)));
    },
    removeExcept: async (tx, solutionId, keep) => {
      await tx.delete(sdmAttributes).where(and(
        eq(sdmAttributes.solutionId, solutionId),
        keep.length > 0 ? not(inArray(sdmAttributes.key, keep)) : undefined,
      ));
    },
  } as ConfigCollection<AttributeDef>,

  // Activities ride inside their workflow (ruled 2026-08-08) — the change unit
  // is the workflow, and nesting keeps their authored order for free.
  workflows: {
    name: 'workflows',
    idField: 'id',
    read: (c) => c.workflows ?? [],
    list: async (tx, solutionId) => (await tx
      .select({ def: sdmWorkflows.def })
      .from(sdmWorkflows)
      .where(eq(sdmWorkflows.solutionId, solutionId))
      .orderBy(asc(sdmWorkflows.id))).map((r) => r.def),
    put: async (tx, solutionId, id, def, author) => {
      await tx
        .insert(sdmWorkflows)
        .values({ solutionId, id, def, createdBy: author, updatedBy: author })
        .onConflictDoUpdate({
          target: [sdmWorkflows.solutionId, sdmWorkflows.id],
          set: { def, updatedAt: new Date(), updatedBy: author },
        });
    },
    remove: async (tx, solutionId, id) => {
      await tx.delete(sdmWorkflows).where(and(eq(sdmWorkflows.solutionId, solutionId), eq(sdmWorkflows.id, id)));
    },
    removeExcept: async (tx, solutionId, keep) => {
      await tx.delete(sdmWorkflows).where(and(
        eq(sdmWorkflows.solutionId, solutionId),
        keep.length > 0 ? not(inArray(sdmWorkflows.id, keep)) : undefined,
      ));
    },
  } as ConfigCollection<WorkflowRawDef>,

  recordTypes: {
    name: 'recordTypes',
    idField: 'id',
    read: (c) => c.recordTypes ?? [],
    list: async (tx, solutionId) => (await tx
      .select({ def: sdmRecordTypes.def })
      .from(sdmRecordTypes)
      .where(eq(sdmRecordTypes.solutionId, solutionId))
      .orderBy(asc(sdmRecordTypes.id))).map((r) => r.def),
    // `workflow_ref` is promoted out of the def into its own column so the one
    // reference the split can hand to Postgres is a real FK. The def still
    // carries it — the column is a lift, not a move.
    put: async (tx, solutionId, id, def, author) => {
      await tx
        .insert(sdmRecordTypes)
        .values({ solutionId, id, workflowRef: def.workflow_ref, def, createdBy: author, updatedBy: author })
        .onConflictDoUpdate({
          target: [sdmRecordTypes.solutionId, sdmRecordTypes.id],
          set: { workflowRef: def.workflow_ref, def, updatedAt: new Date(), updatedBy: author },
        });
    },
    remove: async (tx, solutionId, id) => {
      await tx.delete(sdmRecordTypes).where(and(eq(sdmRecordTypes.solutionId, solutionId), eq(sdmRecordTypes.id, id)));
    },
    removeExcept: async (tx, solutionId, keep) => {
      await tx.delete(sdmRecordTypes).where(and(
        eq(sdmRecordTypes.solutionId, solutionId),
        keep.length > 0 ? not(inArray(sdmRecordTypes.id, keep)) : undefined,
      ));
    },
  } as ConfigCollection<RecordTypeDef>,

  functions: {
    name: 'functions',
    idField: 'id',
    read: (c) => c.functions ?? [],
    list: async (tx, solutionId) => (await tx
      .select({ def: sdmFunctions.def })
      .from(sdmFunctions)
      .where(eq(sdmFunctions.solutionId, solutionId))
      .orderBy(asc(sdmFunctions.id))).map((r) => r.def),
    put: async (tx, solutionId, id, def, author) => {
      await tx
        .insert(sdmFunctions)
        .values({ solutionId, id, def, createdBy: author, updatedBy: author })
        .onConflictDoUpdate({
          target: [sdmFunctions.solutionId, sdmFunctions.id],
          set: { def, updatedAt: new Date(), updatedBy: author },
        });
    },
    remove: async (tx, solutionId, id) => {
      await tx.delete(sdmFunctions).where(and(eq(sdmFunctions.solutionId, solutionId), eq(sdmFunctions.id, id)));
    },
    removeExcept: async (tx, solutionId, keep) => {
      await tx.delete(sdmFunctions).where(and(
        eq(sdmFunctions.solutionId, solutionId),
        keep.length > 0 ? not(inArray(sdmFunctions.id, keep)) : undefined,
      ));
    },
  } as ConfigCollection<FunctionDef>,

  roles: {
    name: 'access.roles',
    idField: 'id',
    read: (c) => c.access?.roles ?? [],
    list: async (tx, solutionId) => (await tx
      .select({ def: sdmRoles.def })
      .from(sdmRoles)
      .where(eq(sdmRoles.solutionId, solutionId))
      .orderBy(asc(sdmRoles.id))).map((r) => r.def),
    put: async (tx, solutionId, id, def, author) => {
      await tx
        .insert(sdmRoles)
        .values({ solutionId, id, def, createdBy: author, updatedBy: author })
        .onConflictDoUpdate({
          target: [sdmRoles.solutionId, sdmRoles.id],
          set: { def, updatedAt: new Date(), updatedBy: author },
        });
    },
    remove: async (tx, solutionId, id) => {
      await tx.delete(sdmRoles).where(and(eq(sdmRoles.solutionId, solutionId), eq(sdmRoles.id, id)));
    },
    removeExcept: async (tx, solutionId, keep) => {
      await tx.delete(sdmRoles).where(and(
        eq(sdmRoles.solutionId, solutionId),
        keep.length > 0 ? not(inArray(sdmRoles.id, keep)) : undefined,
      ));
    },
  } as ConfigCollection<RoleDef>,
} as const;

/**
 * Workflows before record types, always: `sdm_record_types.workflow_ref` is a
 * real FK, so an insert order that put a record type first would be rejected by
 * Postgres, and a delete order that dropped a workflow first likewise. Deletes
 * walk this list backwards.
 */
// Typed at `unknown` because this list is walked heterogeneously: each entry
// only ever hands its own defs back to its own methods, so the element type is
// the one thing no caller here needs to know.
const COLLECTIONS_IN_FK_ORDER: readonly ConfigCollection<unknown>[] = [
  configCollections.attributes,
  configCollections.workflows,
  configCollections.recordTypes,
  configCollections.functions,
  configCollections.roles,
];

/** The identity an entity carries in its own def — nothing reconstructs it, so
 *  a def that lacks one has nowhere to live. */
function identityOf<T>(collection: ConfigCollection<T>, entity: unknown): string {
  const id = (entity as Record<string, unknown> | null | undefined)?.[collection.idField];
  if (typeof id !== 'string' || id.trim() === '') {
    throw new ConfigValidationError([`${collection.name}: the entity carries no '${collection.idField}'`]);
  }
  return id;
}

/**
 * One transaction: take the lock, write the rows, re-read the graph, validate
 * it. Any error rolls the row writes back with it, so a rejected edit leaves
 * the stored model exactly as it was.
 *
 * **The lock is the solution's own row** (`solutions`, `FOR UPDATE`; it was the
 * `sdm_configs` row until that table was dropped 2026-08-09). Its only job is to
 * be one row both writers reach for, so validation **serialises per solution**
 * while the writes stay per entity: two admins editing different entities both
 * keep their work, queueing only for the length of one validation. Writers of
 * *different* solutions take different rows and never wait on each other.
 *
 * Locking `solutions` also settles existence in the same statement: every entity
 * row is FK'd to it, so a model for a solution that does not exist is an orphan
 * the database would refuse anyway — asked here so it reads as "no such
 * solution" rather than as a constraint violation.
 */
async function editConfig(
  db: Db,
  solutionId: string,
  sink: NotifySink,
  writeRows: (tx: DbOrTx) => Promise<void>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [solution] = await tx
      .select({ id: solutions.id })
      .from(solutions)
      .where(eq(solutions.id, solutionId))
      .for('update');
    if (!solution) throw new SolutionNotFoundError(solutionId);
    await writeRows(tx);
    const next = await getSolutionConfig(tx, solutionId);
    await validateConfigGraph(tx, solutionId, next, sink);
    await validateDefaultMenu(tx, solutionId, next);
  });
}

/**
 * The solution's `default_menu` (§5, M10) — shape, then references, against the
 * config it rides in. The engine is menu-blind, so this is the only place the
 * config's one non-collection field is checked. A role delete that a menu item
 * still names fails here, exactly like any other dangling reference.
 */
export async function validateDefaultMenu(db: DbOrTx, solutionId: string, config: SolutionConfig): Promise<void> {
  const defaultMenu = (config as { default_menu?: unknown }).default_menu;
  if (defaultMenu === undefined) return;
  const parsed = z.array(menuItemSchema).safeParse(defaultMenu);
  if (!parsed.success) throw new ConfigValidationError([`default_menu is not a menu: ${parsed.error.message}`]);
  await validateOperationMenu(db, solutionId, parsed.data, config);
}

/** Add or replace one entity of a collection, by the identity its def carries. */
export async function putConfigEntity<T>(
  db: Db,
  solutionId: string,
  collection: ConfigCollection<T>,
  entity: unknown,
  sink: NotifySink = consoleNotifySink,
  author: string | null = null,
): Promise<void> {
  const id = identityOf(collection, entity);
  await editConfig(db, solutionId, sink, (tx) => collection.put(tx, solutionId, id, entity as T, author));
}

/**
 * Remove one entity of a collection. Idempotent, like every other delete here:
 * an id that is already gone is a delete that already happened. A delete that
 * would dangle (an attribute an activity still uses, a workflow a record type
 * still points at) fails validation and rolls back — the FK catches the
 * record-type case earlier and more cheaply.
 */
export async function deleteConfigEntity<T>(
  db: Db,
  solutionId: string,
  collection: ConfigCollection<T>,
  id: string,
  sink: NotifySink = consoleNotifySink,
): Promise<void> {
  await editConfig(db, solutionId, sink, (tx) => collection.remove(tx, solutionId, id));
}

/** Replace the solution's default runtime menu. No delete procedure: `[]` is the
 *  empty menu, and it drops the row, because "no default" is the absent key. */
export async function putDefaultMenu(
  db: Db,
  solutionId: string,
  menu: MenuItem[],
  sink: NotifySink = consoleNotifySink,
  author: string | null = null,
): Promise<void> {
  await editConfig(db, solutionId, sink, async (tx) => {
    if (menu.length === 0) {
      await tx.delete(sdmMenus).where(eq(sdmMenus.solutionId, solutionId));
      return;
    }
    await tx
      .insert(sdmMenus)
      .values({ solutionId, def: menu, createdBy: author, updatedBy: author })
      .onConflictDoUpdate({
        target: sdmMenus.solutionId,
        set: { def: menu, updatedAt: new Date(), updatedBy: author },
      });
  });
}

// ── SDM config publishing (ruled 2026-07-26) ─────────────────────────────────
// The model gets the history pages have had since M3, and for the same reason:
// once Console is the authoring surface and the DB is the source of truth, the
// change record has to live beside the artifact. Identical posture to
// page_versions — append-only, readme required, rollback republishes.

export class ConfigDraftNotFoundError extends Error {
  constructor(solutionId: string) { super(`Solution '${solutionId}' has no SDM config to publish`); }
}

/** Append `config` as the next immutable version of a solution's model. */
async function appendConfigVersion(db: Db, solutionId: string, config: SolutionConfig, readme: string, publishedBy: string): Promise<{ version: number }> {
  const [row] = await db
    .select({ maxV: sql<number | null>`MAX(${sdmConfigVersions.version})` })
    .from(sdmConfigVersions)
    .where(eq(sdmConfigVersions.solutionId, solutionId));
  const version = (row?.maxV ?? 0) + 1;
  await db.insert(sdmConfigVersions).values({ solutionId, version, config, readme, publishedBy });
  return { version };
}

/**
 * Snapshot the solution's current draft config into a new immutable version.
 * A version is a whole config by design — an immutable artifact for install /
 * share / rollback, which is history rather than a second copy of live truth.
 *
 * "Nothing to publish" used to mean "no `sdm_configs` row"; with the model in
 * tables it means an **empty model**, which is the same condition stated
 * against the truth instead of against a snapshot.
 */
export async function publishConfig(db: Db, solutionId: string, readme: string, publishedBy: string): Promise<{ version: number }> {
  const config = await getSolutionConfig(db, solutionId);
  const empty = config.attributes.length === 0
    && config.recordTypes.length === 0
    && config.workflows.length === 0
    && (config.functions?.length ?? 0) === 0
    && (config.access?.roles?.length ?? 0) === 0;
  if (empty) throw new ConfigDraftNotFoundError(solutionId);
  return appendConfigVersion(db, solutionId, config, readme, publishedBy);
}

/**
 * Roll back by republishing an older version as a NEW version, and restore it
 * as the draft — unlike pages (whose draft is the page builder's working copy),
 * the config draft IS what every host evaluates against, so a rollback that
 * left it untouched would change nothing observable.
 */
export async function rollbackConfig(db: Db, solutionId: string, version: number, readme: string, publishedBy: string): Promise<{ version: number }> {
  const config = await getConfigVersion(db, solutionId, version);
  if (config === null) throw new ConfigDraftNotFoundError(`${solutionId} (version ${version})`);
  await putConfig(db, solutionId, config);
  return appendConfigVersion(db, solutionId, config, readme, publishedBy);
}

/** Version history for a solution's model, newest first. */
export async function listConfigVersions(db: Db, solutionId: string): Promise<{ version: number; readme: string; publishedBy: string; publishedAt: Date }[]> {
  const rows = await db
    .select({ version: sdmConfigVersions.version, readme: sdmConfigVersions.readme, publishedBy: sdmConfigVersions.publishedBy, publishedAt: sdmConfigVersions.publishedAt })
    .from(sdmConfigVersions)
    .where(eq(sdmConfigVersions.solutionId, solutionId));
  return rows.sort((a, b) => b.version - a.version);
}

/** One specific published config — the rollback source. */
export async function getConfigVersion(db: Db, solutionId: string, version: number): Promise<SolutionConfig | null> {
  const rows = await db
    .select({ config: sdmConfigVersions.config })
    .from(sdmConfigVersions)
    .where(and(eq(sdmConfigVersions.solutionId, solutionId), eq(sdmConfigVersions.version, version)));
  return rows[0]?.config ?? null;
}
