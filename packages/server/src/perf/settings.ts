// The switches (docs/PERFORMANCE_LOGGING.md §6): platform-wide, plus a
// per-operation override in the same three parts. Read with a 30-second
// in-memory cache so a request's settings lookup costs nothing most of the
// time — turning logging off takes effect within half a minute, per spec.

import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { perfSettings } from '../db/schema';

export type SwitchValue = 'on' | 'off' | 'follow';

export interface RawSettingsRow {
  scope: string;
  enabled: SwitchValue;
  server: SwitchValue;
  browser: SwitchValue;
  dbCounts: SwitchValue;
  updatedAt: Date;
}

/** What a request actually does, once the platform row and (if any) the
 *  operation's override have been resolved together. */
export interface ResolvedSettings {
  enabled: boolean;
  server: boolean;
  browser: boolean;
  dbCounts: boolean;
}

const PLATFORM_SCOPE = 'platform';

const DEFAULT_PLATFORM: RawSettingsRow = {
  scope: PLATFORM_SCOPE,
  enabled: 'on',
  server: 'on',
  browser: 'on',
  dbCounts: 'on',
  updatedAt: new Date(0),
};

const CACHE_MS = 30_000;
let cache: { db: Db; at: number; platform: RawSettingsRow; operations: Map<string, RawSettingsRow> } | null = null;

async function loadAll(db: Db): Promise<{ platform: RawSettingsRow; operations: Map<string, RawSettingsRow> }> {
  const rows = await db.select().from(perfSettings);
  const platform = rows.find((r) => r.scope === PLATFORM_SCOPE) ?? DEFAULT_PLATFORM;
  const operations = new Map(rows.filter((r) => r.scope !== PLATFORM_SCOPE).map((r) => [r.scope, r]));
  return { platform, operations };
}

// Keyed on the `Db` instance, not just time (tests build a fresh one per
// case via `createDb()`) — a stale cache from a previous test's db would
// otherwise answer for a database that no longer exists.
async function loadCached(db: Db): Promise<{ platform: RawSettingsRow; operations: Map<string, RawSettingsRow> }> {
  const now = Date.now();
  if (!cache || cache.db !== db || now - cache.at > CACHE_MS) {
    cache = { db, at: now, ...(await loadAll(db)) };
  }
  return cache;
}

function resolvePart(opValue: SwitchValue | undefined, platformValue: SwitchValue): boolean {
  const v = opValue && opValue !== 'follow' ? opValue : platformValue;
  return v === 'on';
}

/** The effective settings for one operation (or the platform alone, with no
 *  operation named — `platform.*`/`orgs.*`/console-authoring calls). */
export async function getSettings(db: Db, operationId?: string | null): Promise<ResolvedSettings> {
  const { platform, operations } = await loadCached(db);
  const op = operationId ? operations.get(operationId) : undefined;
  const enabled = resolvePart(op?.enabled, platform.enabled);
  if (!enabled) return { enabled: false, server: false, browser: false, dbCounts: false };
  return {
    enabled: true,
    server: resolvePart(op?.server, platform.server),
    browser: resolvePart(op?.browser, platform.browser),
    dbCounts: resolvePart(op?.dbCounts, platform.dbCounts),
  };
}

/** The raw rows, for the dashboard's Switches panel — platform admins edit
 *  these directly, unlike `getSettings`' resolved booleans. */
export async function rawSettings(db: Db): Promise<{ platform: RawSettingsRow; operations: RawSettingsRow[] }> {
  const { platform, operations } = await loadCached(db);
  return { platform, operations: [...operations.values()] };
}

export function invalidateSettingsCache(): void {
  cache = null;
}

/** `scope` is 'platform' or an operation id. Unset parts keep their current
 *  value — an edit names only what it changes, like the model's per-entity
 *  writes. On the first write to a scope the rest start as the scope's own
 *  neutral: 'on' for the platform, 'follow' for an operation, so editing one
 *  switch never silently pins the others. */
export async function setSettings(
  db: Db,
  scope: string,
  patch: Partial<Pick<RawSettingsRow, 'enabled' | 'server' | 'browser' | 'dbCounts'>>,
): Promise<void> {
  const neutral: SwitchValue = scope === PLATFORM_SCOPE ? 'on' : 'follow';
  await db
    .insert(perfSettings)
    .values({
      scope,
      enabled: patch.enabled ?? neutral,
      server: patch.server ?? neutral,
      browser: patch.browser ?? neutral,
      dbCounts: patch.dbCounts ?? neutral,
    })
    .onConflictDoUpdate({
      target: perfSettings.scope,
      set: { ...patch, updatedAt: new Date() },
    });
  invalidateSettingsCache();
}

/** Used only by tests that want a clean slate between cases. */
export async function deleteSettings(db: Db, scope: string): Promise<void> {
  await db.delete(perfSettings).where(eq(perfSettings.scope, scope));
  invalidateSettingsCache();
}
