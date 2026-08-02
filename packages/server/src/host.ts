// The headless host (DSL Phase 4). Per request: fetch the scope's partition
// into a MemoryAdapter, run the same sync engine every browser host runs, then
// write the diff back to Postgres in one transaction — the ARCHITECTURE.md
// "partition-fetch + filter" runtime model made literal. Leanness of the
// transactional layer is what makes this viable; retention enforces it.
//
// Concurrency is last-write-wins per record for now (single-writer dev
// deployments); optimistic versioning slots into writeBack when it matters.

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
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
import { attachments, solUsers, opUsers, operations, orgUsers, orgs, pageVersions, pages, records, userRoles, rptActivities, rptAttributes, sdmConfigVersions, sdmConfigs, solutions, type MenuItem, type OperationConfig } from './db/schema';
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

export class OrgNotFoundError extends Error {
  constructor(orgId: string) {
    super(`No org '${orgId}' — the workspace is not onboarded (or npm run seed)`);
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

// Bootstrap upserts. M9 demoted the seed to skip-if-present for *content*
// (config, records); display names are not content, so these refresh the name
// on conflict — renaming the demo tenancy stays a one-line seed edit.
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
  if (!r) return { id: orgId, name: orgId, contactEmail: null, plan: 'free', status: 'active', createdAt: null };
  return { id: r.id, name: r.name, contactEmail: r.contactEmail, plan: r.plan, status: r.status, createdAt: r.createdAt };
}

export interface OrgRow {
  id: string;
  name: string;
  contactEmail: string | null;
  /** What the org is subscribed to. Billing is later — this records the tier. */
  plan: string;
  status: string;
  /** Registration date; null only for the synthetic un-onboarded row. */
  createdAt: Date | null;
}

/** Edit the org profile. Only the fields an org owns about itself — `plan` and
 *  `status` are ours to set, never theirs, so they are not writable here. */
export async function putOrgProfile(db: Db, orgId: string, input: { name: string; contactEmail: string | null }): Promise<void> {
  const res = await db.update(orgs)
    .set({ name: input.name, contactEmail: input.contactEmail })
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

/** Create a solution (the design-artifact container, §1). Duplicate id → db unique-constraint error. */
/** Create a solution, and enrol its creator as a `write` user of it.
 *
 *  The enrolment is not a convenience — the design plane is **strict** (you get
 *  access to a solution only if you are in its user list), so a solution created
 *  with an empty list would be a solution nobody can build, including the person
 *  who just made it. Creating a solution and creating its first user are one
 *  act, the same rule the org tier already follows. `createdBy` absent (seed,
 *  tests, demo posture) ⇒ no row, and nothing to be locked out of. */
export async function createSolution(db: Db, input: { id: string; name: string; orgId?: string; createdBy?: string | null }): Promise<void> {
  await db.insert(solutions).values({ id: input.id, name: input.name, orgId: input.orgId ?? 'default' });
  if (input.createdBy) {
    await db
      .insert(solUsers)
      .values({ email: normaliseEmail(input.createdBy), solutionId: input.id, level: 'write' })
      .onConflictDoNothing();
  }
}

/** Edit a solution's profile. **Name only** — the id is permanent: the config,
 *  page drafts and versions, sol users and every operation are keyed
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
 *     `sdm_config_versions`, `sdm_configs`, `sol_users`;
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
 * Validate a menu against its solution (CONSOLE_RUNTIME_SPEC §5): every leaf
 * `page` must resolve to a **published** page of the solution; every role id
 * must be one the solution declares (`access.roles`); nesting is one level max
 * (MVP). Run at operation-config save (the override) and at config.put (the
 * solution's `default_menu`) — the latter passes `rolesFrom` so roles are read
 * from the config being saved, not the stored one it is replacing.
 */
export async function validateOperationMenu(db: Db, solutionId: string, menu: MenuItem[], rolesFrom?: ConfigRaw): Promise<void> {
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
// runtime plane (user → role ids in an operation); sol users key the
// design plane (user → level on a solution, consumed at RBAC stage 2/M5).

// ── Users: org pool → op users (RBAC_COMPACT "Users", ruled 2026-08-02) ───────
// Email is the key at both layers; `auth_user_id` is bound on first sign-in, so
// a person can be invited, added to operations and given roles before they have
// ever authenticated.

export type AdminLevel = 'admin' | 'user';

export interface OrgUser {
  email: string;
  name: string | null;
  authUserId: string | null;
  status: 'invited' | 'active' | 'suspended';
  level: AdminLevel;
}

export async function listOrgUsers(db: Db, orgId = 'default'): Promise<OrgUser[]> {
  const rows = await db
    .select({ email: orgUsers.email, name: orgUsers.name, authUserId: orgUsers.authUserId, status: orgUsers.status, level: orgUsers.level })
    .from(orgUsers)
    .where(eq(orgUsers.orgId, orgId));
  return rows.sort((a, b) => a.email.localeCompare(b.email));
}

/** Invite a user into the org pool. Idempotent on (org, email) — re-inviting an
 *  existing user updates the display name and never resets a bound auth id or
 *  an `active` status back to `invited`.
 *
 *  `level` doubles as the appointment path: re-inviting with `level: 'admin'`
 *  promotes an existing pool user to org admin. Omitted ⇒ the existing level is
 *  kept (a plain re-invite must never silently demote an admin). */
export async function inviteOrgUser(db: Db, input: { email: string; name?: string | null; level?: AdminLevel; orgId?: string }): Promise<void> {
  const email = normaliseEmail(input.email);
  await db
    .insert(orgUsers)
    .values({ orgId: input.orgId ?? 'default', email, name: input.name ?? null, level: input.level ?? 'user' })
    .onConflictDoUpdate({
      target: [orgUsers.orgId, orgUsers.email],
      set: input.level ? { name: input.name ?? null, level: input.level } : { name: input.name ?? null },
    });
}

/**
 * User lifecycle (RBAC_COMPACT "Administration": the org admin owns it).
 * `suspended` is the reversible half of removal — the pool row, op users and
 * roles all survive, so reinstating is one call, but the entry gate refuses
 * them everywhere in the meantime.
 */
export async function setOrgUserStatus(db: Db, input: { email: string; status: 'invited' | 'active' | 'suspended'; orgId?: string }): Promise<void> {
  await db
    .update(orgUsers)
    .set({ status: input.status })
    .where(and(eq(orgUsers.orgId, input.orgId ?? 'default'), eq(orgUsers.email, normaliseEmail(input.email))));
}

/** Appoint/demote an org admin. Separate from `invite` so the Console has an
 *  unambiguous call for it and the audit trail reads as an appointment. */
export async function setOrgUserLevel(db: Db, input: { email: string; level: AdminLevel; orgId?: string }): Promise<void> {
  await db
    .update(orgUsers)
    .set({ level: input.level })
    .where(and(eq(orgUsers.orgId, input.orgId ?? 'default'), eq(orgUsers.email, normaliseEmail(input.email))));
}

/** The caller's org-pool row, or null when they are not in the pool. The tier
 *  checks read this; `status` matters because a suspended admin is not an admin. */
export async function getOrgUser(db: Db, input: { email: string; orgId?: string }): Promise<OrgUser | null> {
  const [row] = await db
    .select({ email: orgUsers.email, name: orgUsers.name, authUserId: orgUsers.authUserId, status: orgUsers.status, level: orgUsers.level })
    .from(orgUsers)
    .where(and(eq(orgUsers.orgId, input.orgId ?? 'default'), eq(orgUsers.email, normaliseEmail(input.email))))
    .limit(1);
  return row ?? null;
}

/** Remove a user from the org pool, and every grant that hangs off it — op
 *  users (or they keep entering operations) and sol users (or they
 *  keep their design-plane access to solutions). Now that sol users are
 *  email-keyed they are reachable from here, which they were not before. */
export async function removeOrgUser(db: Db, input: { email: string; orgId?: string }): Promise<void> {
  const orgId = input.orgId ?? 'default';
  const email = normaliseEmail(input.email);
  await db.delete(opUsers).where(and(eq(opUsers.orgId, orgId), eq(opUsers.email, email)));
  await db.delete(solUsers).where(eq(solUsers.email, email));
  await db.delete(orgUsers).where(and(eq(orgUsers.orgId, orgId), eq(orgUsers.email, email)));
}

/**
 * Bind an authenticated caller to their pool row on first sign-in, flipping
 * `invited` → `active`. Keyed on email because that is all an invite knows;
 * no-op when the email was never invited, which is what keeps this invite-only
 * (an authenticated stranger does not become an org user by showing up).
 */
export async function bindAuthUser(db: Db, input: { email: string; authUserId: string; orgId?: string }): Promise<void> {
  const orgId = input.orgId ?? 'default';
  await db
    .update(orgUsers)
    .set({ authUserId: input.authUserId, status: 'active' })
    .where(and(
      eq(orgUsers.orgId, orgId),
      eq(orgUsers.email, normaliseEmail(input.email)),
      // Self-disarming: once bound this matches nothing, so calling it on every
      // authenticated request costs an indexed no-op rather than a write.
      isNull(orgUsers.authUserId),
    ));
}

export interface OpUser {
  email: string;
  level: AdminLevel;
}

/** The design-plane grade on a solution. Two values, not three: 'admin' was
 *  collapsed into 'write' (migration 0013) once the admin tiers took over
 *  everything it used to guard. */
export type SolLevel = 'read' | 'write';

export interface SolUser {
  email: string;
  level: SolLevel;
}

export async function listOpUsers(db: Db, operationId: string): Promise<OpUser[]> {
  const rows = await db
    .select({ email: opUsers.email, level: opUsers.level })
    .from(opUsers)
    .where(eq(opUsers.operationId, operationId));
  return rows.sort((a, b) => a.email.localeCompare(b.email));
}

/** Add a pool user to an operation, or change the level of one already there.
 *  Refuses an email that is not in the org pool — the pool is the only way in,
 *  so op_users can never be the wider set.
 *
 *  Who may call this with which `level` is the escalation rule, and it lives in
 *  the router (users.addOp) rather than here: an op admin may add users, only an
 *  org admin may mint op admins. */
export async function addOpUser(db: Db, input: { operationId: string; email: string; level?: AdminLevel; orgId?: string }): Promise<void> {
  const orgId = input.orgId ?? 'default';
  const email = normaliseEmail(input.email);
  const [inPool] = await db
    .select({ email: orgUsers.email })
    .from(orgUsers)
    .where(and(eq(orgUsers.orgId, orgId), eq(orgUsers.email, email)))
    .limit(1);
  // Plain Error ⇒ BAD_REQUEST via the router's rethrow: the request is wrong,
  // not the operation missing.
  if (!inPool) throw new Error(`'${email}' is not in this organisation — invite them first`);
  const level = input.level ?? 'user';
  await db
    .insert(opUsers)
    .values({ orgId, operationId: input.operationId, email, level })
    .onConflictDoUpdate({ target: [opUsers.orgId, opUsers.operationId, opUsers.email], set: { level } });
}

/** The caller's row in one operation, or null. Read by the op-admin tier check. */
export async function getOpUser(db: Db, input: { operationId: string; email: string; orgId?: string }): Promise<OpUser | null> {
  const [row] = await db
    .select({ email: opUsers.email, level: opUsers.level })
    .from(opUsers)
    .where(and(
      eq(opUsers.orgId, input.orgId ?? 'default'),
      eq(opUsers.operationId, input.operationId),
      eq(opUsers.email, normaliseEmail(input.email)),
    ))
    .limit(1);
  return row ?? null;
}

/** Remove a user from an operation, clearing their roles there too — a stale
 *  assignment would silently reapply if they were ever re-added. */
export async function removeOpUser(db: Db, input: { operationId: string; email: string; orgId?: string }): Promise<void> {
  const orgId = input.orgId ?? 'default';
  const email = normaliseEmail(input.email);
  await db.delete(opUsers).where(and(eq(opUsers.orgId, orgId), eq(opUsers.operationId, input.operationId), eq(opUsers.email, email)));
  // Actually clears something since the rekey (0015) — while user_roles was
  // keyed on the auth id this deleted nothing, and a re-added user silently got
  // their old roles back.
  await db.delete(userRoles).where(and(eq(userRoles.operationId, input.operationId), eq(userRoles.email, email)));
}

/**
 * The entry gate: may this caller open this operation at all? Being an op user
 * is a separate question from holding roles — an op user with no roles enters
 * and sees nothing, which is valid; roles without an op_users row must never
 * grant entry.
 *
 * Unauthenticated/demo posture is handled by the caller (no auth ⇒ open).
 */
export async function isOpUser(db: Db, input: { operationId: string; email: string; orgId?: string }): Promise<boolean> {
  const [row] = await db
    .select({ email: opUsers.email })
    .from(opUsers)
    .where(and(
      eq(opUsers.orgId, input.orgId ?? 'default'),
      eq(opUsers.operationId, input.operationId),
      eq(opUsers.email, normaliseEmail(input.email)),
    ))
    .limit(1);
  return !!row;
}

/**
 * Bootstrap the first org admin (RBAC_COMPACT "Administration": creating an org
 * and creating its first admin are one act).
 *
 * There is no signup, so the chain cannot start itself, and the entry gate is
 * strict — an operation with no op users admits nobody, including the Console,
 * which reaches an operation through the same gate as the Runtime. Migrating a
 * database where auth is configured therefore locks everyone out of everything
 * until this has run.
 *
 * Deliberately **idempotent and re-runnable** — this is the recovery tool as
 * well as the bootstrap, and a lockout you can only fix by writing another
 * migration is not a fix. Two rules keep re-runs safe:
 *   - the pool row is upserted to org admin (promotion is the whole point), but
 *   - op-admin rows are written ONLY into operations that currently have **no**
 *     users at all. An operation someone already administers is already
 *     governed; silently re-granting yourself entry to it on every seed would
 *     make the gate meaningless.
 *
 * Returns what it did, so the caller can say so rather than claiming success.
 */
export async function bootstrapOrgAdmin(db: Db, input: { email: string; name?: string | null; orgId?: string }): Promise<{ email: string; operationsOpened: string[]; solutionsOpened: string[] }> {
  const orgId = input.orgId ?? 'default';
  const email = normaliseEmail(input.email);
  await db
    .insert(orgUsers)
    .values({ orgId, email, name: input.name ?? null, level: 'admin', status: 'invited' })
    .onConflictDoUpdate({ target: [orgUsers.orgId, orgUsers.email], set: { level: 'admin' } });

  const ops = await db.select({ id: operations.id }).from(operations).where(eq(operations.orgId, orgId));
  const opened: string[] = [];
  for (const op of ops) {
    const [existing] = await db
      .select({ email: opUsers.email })
      .from(opUsers)
      .where(and(eq(opUsers.orgId, orgId), eq(opUsers.operationId, op.id)))
      .limit(1);
    if (existing) continue; // already governed — leave it alone
    await db
      .insert(opUsers)
      .values({ orgId, operationId: op.id, email, level: 'admin' })
      .onConflictDoNothing();
    opened.push(op.id);
  }

  // Same treatment for solutions, since the design plane went strict: a
  // solution with no users is a solution nobody can build. Solutions created
  // through `solutions.create` enrol their creator, so this only ever catches
  // ones that predate the rule.
  const sols = await db.select({ id: solutions.id }).from(solutions).where(eq(solutions.orgId, orgId));
  const solsOpened: string[] = [];
  for (const sol of sols) {
    const [existing] = await db
      .select({ email: solUsers.email })
      .from(solUsers)
      .where(eq(solUsers.solutionId, sol.id))
      .limit(1);
    if (existing) continue;
    await db
      .insert(solUsers)
      .values({ email, solutionId: sol.id, level: 'write' })
      .onConflictDoNothing();
    solsOpened.push(sol.id);
  }
  return { email, operationsOpened: opened, solutionsOpened: solsOpened };
}

/** Emails are compared, stored and keyed lower-cased and trimmed — the pool key
 *  must not admit `A@x.com` and `a@x.com` as two people. */
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function listUserRoles(db: Db, operationId: string): Promise<{ email: string; roleIds: string[] }[]> {
  const rows = await db
    .select({ email: userRoles.email, roleIds: userRoles.roleIds })
    .from(userRoles)
    .where(eq(userRoles.operationId, operationId));
  return rows.map((r) => ({ email: r.email, roleIds: r.roleIds })).sort((a, b) => a.email.localeCompare(b.email));
}

/** Upsert a user's role ids in an operation; empty roleIds clears the row.
 *  Keyed on email (0015), so roles can be granted to someone who has been
 *  invited but never signed in — the invite-first flow, end to end. */
export async function putUserRoles(db: Db, input: { operationId: string; email: string; roleIds: string[]; orgId?: string }): Promise<void> {
  const orgId = input.orgId ?? 'default';
  const email = normaliseEmail(input.email);
  if (input.roleIds.length === 0) {
    await db.delete(userRoles).where(and(eq(userRoles.operationId, input.operationId), eq(userRoles.email, email)));
    return;
  }
  await db
    .insert(userRoles)
    .values({ orgId, operationId: input.operationId, email, roleIds: input.roleIds })
    .onConflictDoUpdate({ target: [userRoles.orgId, userRoles.operationId, userRoles.email], set: { roleIds: input.roleIds } });
}

/** Sol users are keyed on **email** (rekeyed 2026-08-02, migration 0012) — a
 *  solution user is appointed from the org pool, and pool users usually have
 *  not signed in yet, so there is no auth id to key on. */
export async function listSolUsers(db: Db, solutionId: string): Promise<SolUser[]> {
  const rows = await db
    .select({ email: solUsers.email, level: solUsers.level })
    .from(solUsers)
    .where(eq(solUsers.solutionId, solutionId));
  return rows.map((r) => ({ email: r.email, level: r.level })).sort((a, b) => a.email.localeCompare(b.email));
}

/** Upsert a user's level on a solution. Two grades only: `read` looks at the
 *  model, `write` builds it. Appointing them is org-admin work. */
export async function putSolUser(db: Db, input: { solutionId: string; email: string; level: SolLevel }): Promise<void> {
  const email = normaliseEmail(input.email);
  await db
    .insert(solUsers)
    .values({ email, solutionId: input.solutionId, level: input.level })
    .onConflictDoUpdate({ target: [solUsers.email, solUsers.solutionId], set: { level: input.level } });
}

/** Remove a user from a solution. */
export async function removeSolUser(db: Db, input: { solutionId: string; email: string }): Promise<void> {
  await db.delete(solUsers).where(and(eq(solUsers.solutionId, input.solutionId), eq(solUsers.email, normaliseEmail(input.email))));
}

/** Whether the caller is a user of any solution — half of the derived "may use
 *  the Console" answer (the other half is org admin). Never a stored flag: a
 *  separate bit could contradict the grants it summarises. */
export async function isAnySolUser(db: Db, email: string): Promise<boolean> {
  const [row] = await db
    .select({ email: solUsers.email })
    .from(solUsers)
    .where(eq(solUsers.email, normaliseEmail(email)))
    .limit(1);
  return !!row;
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

  await db
    .insert(sdmConfigs)
    .values({ solutionId, config, updatedAt: new Date() })
    .onConflictDoUpdate({ target: sdmConfigs.solutionId, set: { config, updatedAt: new Date() } });
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
async function appendConfigVersion(db: Db, solutionId: string, config: ConfigRaw, readme: string, publishedBy: string): Promise<{ version: number }> {
  const [row] = await db
    .select({ maxV: sql<number | null>`MAX(${sdmConfigVersions.version})` })
    .from(sdmConfigVersions)
    .where(eq(sdmConfigVersions.solutionId, solutionId));
  const version = (row?.maxV ?? 0) + 1;
  await db.insert(sdmConfigVersions).values({ solutionId, version, config, readme, publishedBy });
  return { version };
}

/** Snapshot the solution's current draft config into a new immutable version. */
export async function publishConfig(db: Db, solutionId: string, readme: string, publishedBy: string): Promise<{ version: number }> {
  const rows = await db.select().from(sdmConfigs).where(eq(sdmConfigs.solutionId, solutionId));
  if (rows.length === 0) throw new ConfigDraftNotFoundError(solutionId);
  return appendConfigVersion(db, solutionId, rows[0].config, readme, publishedBy);
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
export async function getConfigVersion(db: Db, solutionId: string, version: number): Promise<ConfigRaw | null> {
  const rows = await db
    .select({ config: sdmConfigVersions.config })
    .from(sdmConfigVersions)
    .where(and(eq(sdmConfigVersions.solutionId, solutionId), eq(sdmConfigVersions.version, version)));
  return rows[0]?.config ?? null;
}
