// An operation's apps list (APPS_AND_INSTANCES Part 2 §2.4). Each app in it is
// a record of the platform's `rt_sys_apps` in the ordinary `records` table, so
// its history lives with every other record's — the same `activity_history`
// column and the same `rpt_activities` rows. No solution defines the type, and
// these rows are kept out of every general read (records.*, scripts, the
// stray-type check at model save): they are read only through here.
//
// The Console writes them directly, not through activities — setting up an app
// is not working data, BLUEPRINT rule 1's one exception — and every change
// still leaves a history entry on the app, through the same append an activity
// run uses (`appendHistoryEntry`).

import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { APPS_RECORD_TYPE, CONSOLE_EDIT, formGetIds, newRecordId, type ActivityHistoryEntry, type SolutionModel } from '@fluxus/engine';
import type { DbOrTx } from './db/client';
import { pageVersions, records, type MenuGroup, type MenuItem, type MenuLeaf } from './db/schema';
import { appendHistoryEntry } from './databaseStore';
import { MenuValidationError, isPagePublished, listPublishedPages } from './host';

/** One app in an operation's apps list, as calls carry it. */
export interface App {
  id: string;
  /** The published page it is made from — its path, which is its id. */
  pageId: string;
  /** Its name, e.g. "Water scheduler"; what the menu shows. */
  label: string;
  /** Who may run it. */
  roleIds: string[];
  /** What it needs set for this operation: JSON, as text. */
  definition: string;
  /** `expired` once expired (§3.2) — final; absent on the record is active. */
  status: 'active' | 'expired';
}

/** The stored record fields: snake_case like every record field. `role_ids`
 *  and `definition` are text — a list and an object written as JSON. */
interface AppFields extends Record<string, unknown> {
  page_id: string;
  label: string;
  role_ids: string;
  definition: string;
  /** Written only by `expireApp` (§3.2); absent is active. */
  status?: 'expired';
}

type RecordRow = typeof records.$inferSelect;

export class AppNotFoundError extends Error {
  constructor(appId: string) {
    super(`This app is not set up for this operation (${appId})`);
  }
}

/** Check 1 on an expired app (§3.2): not set up, saying why. */
export class AppExpiredError extends AppNotFoundError {
  constructor(appId: string) {
    super(appId);
    this.message = `This app has expired (${appId})`;
  }
}

export class AppValidationError extends Error {
  constructor(public findings: string[]) {
    super(`App rejected: ${findings.join(' · ')}`);
  }
}

function parseRoleIds(text: unknown): string[] {
  try {
    const value = JSON.parse(String(text ?? '[]'));
    return Array.isArray(value) ? value.filter((r): r is string => typeof r === 'string') : [];
  } catch {
    return [];
  }
}

export function appFromRow(row: Pick<RecordRow, 'id' | 'customFields'>): App {
  const f = row.customFields;
  return {
    id: row.id,
    pageId: String(f.page_id ?? ''),
    label: String(f.label ?? ''),
    roleIds: parseRoleIds(f.role_ids),
    definition: String(f.definition ?? '{}'),
    status: f.status === 'expired' ? 'expired' : 'active',
  };
}

/** The operation's apps, in the order they were added (ids are UUIDv7). */
export async function listApps(db: DbOrTx, operationId: string): Promise<App[]> {
  const rows = await db
    .select({ id: records.id, customFields: records.customFields })
    .from(records)
    .where(and(eq(records.operationId, operationId), eq(records.typeRef, APPS_RECORD_TYPE)))
    .orderBy(asc(records.id));
  return rows.map(appFromRow);
}

/** One app with its history, or null when the operation has no such app. */
export async function getAppRecord(db: DbOrTx, operationId: string, appId: string): Promise<RecordRow | null> {
  const [row] = await db
    .select()
    .from(records)
    .where(and(eq(records.operationId, operationId), eq(records.id, appId), eq(records.typeRef, APPS_RECORD_TYPE)));
  return row ?? null;
}

/** The app an id names in this operation, or null. */
export async function getApp(db: DbOrTx, operationId: string, appId: string): Promise<App | null> {
  const row = await getAppRecord(db, operationId, appId);
  return row ? appFromRow(row) : null;
}

/** Whether a record id names an app — the ids a call may never send as a
 *  record (APPS_AND_INSTANCES §2.3). */
export function isAppRecord(record: { typeRef: string } | null | undefined): boolean {
  return record?.typeRef === APPS_RECORD_TYPE;
}

export interface AppInput {
  /** Absent to add an app; an app's id to change it. */
  id?: string;
  pageId: string;
  label: string;
  roleIds: string[];
  definition: string;
}

/**
 * Add an app to an operation's apps list, or change one (§2.4), checked first:
 * the page is a published page of the solution, every role exists in it, the
 * name is not blank, and the definition is JSON (blank is `{}`). The history
 * entry carries the changed fields with their new values; a change that
 * changes nothing writes nothing.
 */
export async function putApp(
  db: DbOrTx,
  operationId: string,
  input: AppInput,
  solution: { publishedPages: ReadonlySet<string>; config: SolutionModel },
  author: string,
  /** The history entry's activity: a Console change, or the step 2 migration. */
  edit: { id: string; name: string } = CONSOLE_EDIT,
): Promise<{ id: string }> {
  const findings: string[] = [];
  const label = input.label.trim();
  if (!label) findings.push('give the app a name');
  if (!solution.publishedPages.has(input.pageId)) findings.push(`no published page '${input.pageId}'`);
  const known = new Set((solution.config.access?.roles ?? []).map((r) => r.id));
  const roleIds = [...new Set(input.roleIds)];
  for (const r of roleIds) if (!known.has(r)) findings.push(`unknown role '${r}'`);
  const definition = input.definition.trim() === '' ? '{}' : input.definition;
  try {
    JSON.parse(definition);
  } catch (err) {
    findings.push(`the definition is not JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (findings.length > 0) throw new AppValidationError(findings);

  const fields: AppFields = { page_id: input.pageId, label, role_ids: JSON.stringify(roleIds), definition };
  return db.transaction(async (tx) => {
    let id = input.id;
    let changed: Partial<AppFields>;
    if (id === undefined) {
      id = newRecordId();
      changed = fields;
      await tx.insert(records).values({
        operationId, id, typeRef: APPS_RECORD_TYPE, customFields: fields, activityHistory: [], updatedAt: new Date(),
      });
    } else {
      const existing = await getAppRecord(tx, operationId, id);
      if (!existing) throw new AppNotFoundError(id);
      if (existing.customFields.status === 'expired') throw new AppValidationError([`"${String(existing.customFields.label)}" has expired and cannot be changed`]);
      const before = existing.customFields;
      changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) => before[k] !== v));
      if (Object.keys(changed).length === 0) return { id };
      await tx.update(records)
        .set({ customFields: { ...before, ...fields }, updatedAt: new Date() })
        .where(and(eq(records.operationId, operationId), eq(records.id, id)));
    }
    const entry: ActivityHistoryEntry = {
      activityId: edit.id,
      activityName: edit.name,
      author,
      capturedAttributes: changed,
      timestamp: new Date().toISOString(),
    };
    await appendHistoryEntry(tx, operationId, id, entry);
    return { id };
  });
}

/**
 * Expire an app (§3.2): final, and nothing is deleted — the record and its
 * history stay, and the Console keeps showing it. The change leaves the
 * Console's history entry, like every other.
 */
export async function expireApp(db: DbOrTx, operationId: string, appId: string, author: string): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await getAppRecord(tx, operationId, appId);
    if (!existing) throw new AppNotFoundError(appId);
    if (existing.customFields.status === 'expired') throw new AppValidationError([`"${String(existing.customFields.label)}" has expired already`]);
    await tx.update(records)
      .set({ customFields: { ...existing.customFields, status: 'expired' }, updatedAt: new Date() })
      .where(and(eq(records.operationId, operationId), eq(records.id, appId)));
    const entry: ActivityHistoryEntry = {
      activityId: CONSOLE_EDIT.id,
      activityName: CONSOLE_EDIT.name,
      author,
      capturedAttributes: { status: 'expired' },
      timestamp: new Date().toISOString(),
    };
    await appendHistoryEntry(tx, operationId, appId, entry);
  });
}

/** Whether a caller may run an app — check 2 (§2.3): they hold one of its
 *  roles. With sign-in off there is nobody to check, so everyone may. */
export function mayRunApp(app: App, authConfigured: boolean | undefined, roles: string[] | undefined): boolean {
  if (!authConfigured) return true;
  const held = new Set(roles ?? []);
  return app.roleIds.some((r) => held.has(r));
}

/** Check 1 (§2.3): the app is in this operation's apps list, not expired
 *  (§3.2), and its page has a published version; otherwise it is not set up
 *  for this operation. */
export async function loadAppForCall(db: DbOrTx, operationId: string, solutionId: string, appId: string): Promise<App> {
  const app = await getApp(db, operationId, appId);
  if (app?.status === 'expired') throw new AppExpiredError(appId);
  if (!app || !(await isPagePublished(db, solutionId, app.pageId))) throw new AppNotFoundError(appId);
  return app;
}

/**
 * What an app may offer and run (§2.2): the activities on its page's list —
 * the page's own workflow, `PageDef.workflowId` on its latest published
 * version — and the app's condition on each. A page with no list, one naming a
 * workflow that does not exist, or one a record type points to, offers
 * nothing.
 */
export interface AppList {
  ids: ReadonlySet<string>;
  conditions: ReadonlyMap<string, string>;
  /** The GETs its listed activities' forms call (step 4): on the list without
   *  being added, worked out from the literal ids their datasources invoke. */
  formGets: ReadonlySet<string>;
}

const EMPTY_LIST: AppList = { ids: new Set(), conditions: new Map(), formGets: new Set() };

/** The workflow a page's latest published version names as its list, if it
 *  is one: it exists, and no record type points to it. */
export async function listWorkflowOf(db: DbOrTx, solutionId: string, pageId: string, config: SolutionModel): Promise<SolutionModel['workflows'][number] | null> {
  const [latest] = await db.select({ def: pageVersions.def }).from(pageVersions)
    .where(and(eq(pageVersions.solutionId, solutionId), eq(pageVersions.path, pageId)))
    .orderBy(desc(pageVersions.version))
    .limit(1);
  const workflowId = (latest?.def as { workflowId?: unknown } | undefined)?.workflowId;
  if (typeof workflowId !== 'string') return null;
  const workflow = config.workflows.find((w) => w.id === workflowId);
  if (!workflow || config.recordTypes.some((rt) => rt.workflow_ref === workflowId)) return null;
  return workflow;
}

export async function appListOf(db: DbOrTx, solutionId: string, pageId: string, config: SolutionModel): Promise<AppList> {
  const workflow = await listWorkflowOf(db, solutionId, pageId, config);
  if (!workflow) return EMPTY_LIST;
  const ids = new Set(workflow.activities.map((u) => u.activity_ref));
  return {
    ids,
    conditions: new Map(workflow.activities.filter((u) => u.show_condition?.trim()).map((u) => [u.activity_ref, u.show_condition!])),
    formGets: formGetIds(config, ids),
  };
}

// ── The app menu (§2.5) ──────────────────────────────────────────────────────
// Stored on the operation (`operations.menu`): pointers at apps in its
// apps list, in groups one level deep, with no roles of their own.

const menuLeafSchema: z.ZodType<MenuLeaf> = z.object({ id: z.string().min(1), appId: z.string().min(1) });
const menuGroupSchema: z.ZodType<MenuGroup> = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1, 'a group needs a name'),
  items: z.array(menuLeafSchema),
});
/** The app menu's wire shape. A group is tried first: a leaf has no `items`. */
export const menuSchema = z.array(z.union([menuGroupSchema, menuLeafSchema]));

const isGroup = (item: MenuItem): item is MenuGroup => 'items' in item;

/** Checked at save: every leaf points at an active app of this operation
 *  (§3.2), an app appears at most once, and item ids are unique. */
export function validateAppMenu(menu: MenuItem[], apps: App[]): void {
  const known = new Map(apps.map((a) => [a.id, a]));
  const errors: string[] = [];
  const ids = new Set<string>();
  const placed = new Set<string>();
  const seeId = (id: string) => {
    if (ids.has(id)) errors.push(`duplicate item id "${id}"`);
    ids.add(id);
  };
  const leaf = (l: MenuLeaf) => {
    seeId(l.id);
    const app = known.get(l.appId);
    if (!app) { errors.push(`"${l.appId}" is not an app of this operation`); return; }
    if (app.status === 'expired') errors.push(`"${app.label}" has expired — take it off the menu`);
    if (placed.has(l.appId)) errors.push(`"${app.label}" is on the menu more than once`);
    placed.add(l.appId);
  };
  for (const item of menu) {
    if (isGroup(item)) { seeId(item.id); item.items.forEach(leaf); } else leaf(item);
  }
  if (errors.length > 0) throw new MenuValidationError(errors);
}

/** The stored app menu, keeping only items in its shape — a menu written
 *  before apps Part 2 (labels and pages) reads as empty until the step 2
 *  script rebuilds it. */
export function readMenu(menu: unknown[] | null | undefined): MenuItem[] {
  return (menu ?? []).flatMap((item) => {
    const parsed = z.union([menuGroupSchema, menuLeafSchema]).safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** One caller's menu, built on the server: the leaves whose app they may run,
 *  and the groups that keep at least one, in the stored order. */
export function menuFor(menu: MenuItem[], mayRun: (appId: string) => boolean): MenuItem[] {
  return menu.flatMap((item): MenuItem[] => {
    if (!isGroup(item)) return mayRun(item.appId) ? [item] : [];
    const items = item.items.filter((l) => mayRun(l.appId));
    return items.length > 0 ? [{ ...item, items }] : [];
  });
}

/** What the Runtime receives at sign-in (`apps.user`, §2.7). */
export interface UserApps {
  /** The apps the caller may run (checks 1–2), as a page sees one. */
  apps: { id: string; label: string; pageId: string; definition: string }[];
  /** Their pages' published definitions. */
  pages: { path: string; def: unknown }[];
  menu: MenuItem[];
}

/** No published page at that path — `pages.appDefaults` (§3.3). */
export class PageNotPublishedError extends Error {}

/**
 * A new app's starting values, from its page's latest published version
 * (APPS_AND_INSTANCES §3.1, §3.3): the page's example definition, or null; its
 * default roles the solution still declares, so a stale id never reaches
 * `putApp`'s unknown-role refusal.
 */
export async function appDefaults(db: DbOrTx, solutionId: string, path: string, config: SolutionModel): Promise<{ definition: string | null; roleIds: string[] }> {
  const page = (await listPublishedPages(db, solutionId)).find((p) => p.path === path);
  if (!page) throw new PageNotPublishedError(`no published page '${path}'`);
  const def = (page.def ?? {}) as { exampleDefinition?: unknown; roleIds?: unknown };
  const definition = typeof def.exampleDefinition === 'string' && def.exampleDefinition.trim() !== '' ? def.exampleDefinition : null;
  const known = new Set((config.access?.roles ?? []).map((r) => r.id));
  const roleIds = Array.isArray(def.roleIds) ? def.roleIds.filter((r): r is string => typeof r === 'string' && known.has(r)) : [];
  return { definition, roleIds };
}

/** A published page as the Runtime gets it: without what only authoring reads
 *  — its example definition (§3.1) and default roles (§3.3). */
function withoutAuthoring(def: unknown): unknown {
  if (!def || typeof def !== 'object') return def;
  const { exampleDefinition: _example, roleIds: _roles, ...rest } = def as Record<string, unknown>;
  return rest;
}

export async function appsForUser(
  db: DbOrTx,
  op: { id: string; solutionId: string; menu: unknown[] },
  authConfigured: boolean | undefined,
  roles: string[] | undefined,
): Promise<UserApps> {
  const [all, published] = await Promise.all([listApps(db, op.id), listPublishedPages(db, op.solutionId)]);
  const defs = new Map(published.map((p) => [p.path, p.def]));
  const runnable = all.filter((a) => a.status === 'active' && defs.has(a.pageId) && mayRunApp(a, authConfigured, roles));
  const runnableIds = new Set(runnable.map((a) => a.id));
  return {
    apps: runnable.map(({ id, label, pageId, definition }) => ({ id, label, pageId, definition })),
    pages: [...new Set(runnable.map((a) => a.pageId))].map((path) => ({ path, def: withoutAuthoring(defs.get(path)) })),
    menu: menuFor(readMenu(op.menu), (appId) => runnableIds.has(appId)),
  };
}
