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

import { and, asc, eq } from 'drizzle-orm';
import { APPS_RECORD_TYPE, CONSOLE_EDIT, newRecordId, type ActivityHistoryEntry, type SolutionConfig } from '@fluxus/engine';
import type { Db, DbOrTx } from './db/client';
import { records } from './db/schema';
import { appendHistoryEntry } from './databaseStore';

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
}

/** The stored record fields: snake_case like every record field. `role_ids`
 *  and `definition` are text — a list and an object written as JSON. */
interface AppFields extends Record<string, unknown> {
  page_id: string;
  label: string;
  role_ids: string;
  definition: string;
}

type RecordRow = typeof records.$inferSelect;

export class AppNotFoundError extends Error {
  constructor(appId: string) {
    super(`This app is not set up for this operation (${appId})`);
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
  db: Db,
  operationId: string,
  input: AppInput,
  solution: { publishedPages: ReadonlySet<string>; config: SolutionConfig },
  author: string,
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
      const before = existing.customFields;
      changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) => before[k] !== v));
      if (Object.keys(changed).length === 0) return { id };
      await tx.update(records)
        .set({ customFields: { ...before, ...fields }, updatedAt: new Date() })
        .where(and(eq(records.operationId, operationId), eq(records.id, id)));
    }
    const entry: ActivityHistoryEntry = {
      activityId: CONSOLE_EDIT.id,
      activityName: CONSOLE_EDIT.name,
      author,
      capturedAttributes: changed,
      timestamp: new Date().toISOString(),
    };
    await appendHistoryEntry(tx, operationId, id, entry);
    return { id };
  });
}
