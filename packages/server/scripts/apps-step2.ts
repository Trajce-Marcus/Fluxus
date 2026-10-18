// Apps Part 2, step 2 — a one-off script (APPS_AND_INSTANCES §2.8). RUN on
// the dev database 2026-10-18; since step 3 dropped `sdm_menus` (0023) it
// cannot build menus from the solution's default menu any more, and every
// operation it would touch has apps, so it skips them all. Kept as the record
// of what it did. Run it
// AFTER the step 2 deploy: old code refuses every model save once
// `rt_sys_apps` rows exist, and the step 2 code keeps them out.
//
//   npx tsx scripts/apps-step2.ts            # prints what it would do; writes nothing
//   npx tsx scripts/apps-step2.ts --apply    # writes it
//
// For every operation:
//
// - **an app for each published page of its solution.** Its name is the
//   page's label on the operation's effective menu (its own, else the
//   solution's default); for a page on no menu, the page's path. Its roles are
//   the page's `access.open` (roles the solution no longer declares are left
//   out, and said). Its definition is `{}`. Its first history entry is
//   `sys_migration` / "Created by the migration";
// - **its menu rebuilt** from its effective menu: each leaf points at the app
//   made for its page; group labels and order are kept; roles are dropped. A
//   page on two menu items keeps the first, in menu order, and an item that
//   opens nothing is dropped — both said.
//
// An operation that already has apps is skipped, so a second run does
// nothing. Each operation is written in one transaction. Migrations are not
// applied: the script reads the database as it stands.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { APPS_RECORD_TYPE, MIGRATION_EDIT, newRecordId, type SolutionConfig } from '@fluxus/engine';
import { createDb, closeDb, type Db } from '../src/db/client';
import { getSolutionConfig, listOperations, listPublishedPages, putOperationConfig, type OperationRow } from '../src/host';
import { putApp, validateAppMenu, type App } from '../src/apps';
import { records, type MenuItem, type MenuLeaf } from '../src/db/schema';

/** A menu as it was before apps Part 2 (the shape `sdm_menus` held). */
interface DefaultMenuItem { id?: string; label: string; page?: string; roles?: string[]; items?: DefaultMenuItem[] }

/** What the script would do for one operation. */
export interface OperationPlan {
  operation: OperationRow;
  /** Why nothing is done, when nothing is. */
  skipped?: string;
  apps: { pageId: string; label: string; roleIds: string[] }[];
  menu: MenuItem[];
  /** Things the user should know: dropped items, left-out roles, apps nobody may run. */
  notes: string[];
}

const isOldMenu = (menu: unknown): menu is DefaultMenuItem[] =>
  Array.isArray(menu) && menu.some((it) => it && typeof it === 'object' && ('label' in it || 'page' in it) && !('appId' in it));

/** Plan every operation, reading only. */
export async function planStep2(db: Db): Promise<OperationPlan[]> {
  const plans: OperationPlan[] = [];
  for (const op of await listOperations(db)) {
    const plan: OperationPlan = { operation: op, apps: [], menu: [], notes: [] };
    plans.push(plan);
    const [existing] = await db.select({ id: records.id }).from(records)
      .where(and(eq(records.operationId, op.id), eq(records.typeRef, APPS_RECORD_TYPE))).limit(1);
    if (existing) { plan.skipped = 'already has apps'; continue; }

    const [published, config] = await Promise.all([listPublishedPages(db, op.solutionId), getSolutionConfig(db, op.solutionId)]);
    if (published.length === 0) { plan.skipped = 'its solution has no published pages'; continue; }
    const pages = new Map(published.map((p) => [p.path, p.def as { access?: { open?: string[] } } | null]));
    const declared = new Set((config.access?.roles ?? []).map((r) => r.id));

    // The effective menu: the operation's own, else the solution's default.
    const own = op.config.menu as unknown;
    const effective: DefaultMenuItem[] = isOldMenu(own) ? own
      : (Array.isArray(own) && own.length > 0) ? [] // already in the new shape: nothing to carry over
      : ((config as { default_menu?: DefaultMenuItem[] }).default_menu ?? []);
    if (Array.isArray(own) && own.length > 0 && !isOldMenu(own)) plan.notes.push('its menu is already in the new shape; it is replaced');

    // The name each page takes: its first label on the menu, in menu order.
    const labelOf = new Map<string, string>();
    const walk = (items: DefaultMenuItem[]) => {
      for (const it of items) {
        if (it.page && pages.has(it.page) && !labelOf.has(it.page)) labelOf.set(it.page, it.label);
        if (it.items) walk(it.items);
      }
    };
    walk(effective);

    for (const pageId of [...pages.keys()].sort()) {
      const open = pages.get(pageId)?.access?.open ?? [];
      const roleIds = open.filter((r) => declared.has(r));
      for (const r of open.filter((x) => !declared.has(x))) plan.notes.push(`${pageId}: role '${r}' is not declared by the solution any more — left out`);
      if (roleIds.length === 0) plan.notes.push(`${pageId}: its page named no roles, so nobody may run its app until roles are given`);
      plan.apps.push({ pageId, label: labelOf.get(pageId) ?? pageId, roleIds });
    }

    // The menu, rebuilt: leaves point at the app made for their page.
    const placed = new Set<string>();
    const leafFor = (it: DefaultMenuItem, where: string): MenuLeaf | null => {
      if (!it.page) { plan.notes.push(`${where}"${it.label}" opens nothing — dropped`); return null; }
      if (!pages.has(it.page)) { plan.notes.push(`${where}"${it.label}" → '${it.page}' is not published — dropped`); return null; }
      if (placed.has(it.page)) { plan.notes.push(`${where}"${it.label}" → '${it.page}' is on the menu already — dropped, the first item keeps it`); return null; }
      placed.add(it.page);
      return { id: it.id ?? newRecordId(), appId: `page:${it.page}` }; // the app's id is issued when it is written
    };
    for (const it of effective) {
      if (it.items !== undefined) {
        plan.menu.push({
          id: it.id ?? newRecordId(),
          label: it.label,
          items: it.items.flatMap((c) => {
            if (c.items !== undefined) { plan.notes.push(`"${it.label}" › "${c.label}" is a group inside a group — dropped`); return []; }
            const leaf = leafFor(c, `"${it.label}" › `);
            return leaf ? [leaf] : [];
          }),
        });
      } else {
        const leaf = leafFor(it, '');
        if (leaf) plan.menu.push(leaf);
      }
    }
  }
  return plans;
}

/** Write one operation's plan: its apps, then its menu pointing at them, in one transaction. */
export async function applyPlan(db: Db, plan: OperationPlan): Promise<void> {
  if (plan.skipped) return;
  const op = plan.operation;
  const [published, config]: [{ path: string }[], SolutionConfig] = await Promise.all([
    listPublishedPages(db, op.solutionId),
    getSolutionConfig(db, op.solutionId),
  ]);
  const publishedPages = new Set(published.map((p) => p.path));
  await db.transaction(async (tx) => {
    const appIdOf = new Map<string, string>();
    const created: App[] = [];
    for (const a of plan.apps) {
      const { id } = await putApp(tx, op.id, { ...a, definition: '{}' }, { publishedPages, config }, 'migration', MIGRATION_EDIT);
      appIdOf.set(a.pageId, id);
      created.push({ id, ...a, definition: '{}' });
    }
    const resolve = (leaf: MenuLeaf): MenuLeaf => ({ id: leaf.id, appId: appIdOf.get(leaf.appId.slice('page:'.length)) ?? leaf.appId });
    const menu: MenuItem[] = plan.menu.map((it) => ('items' in it ? { ...it, items: it.items.map(resolve) } : resolve(it)));
    validateAppMenu(menu, created);
    await putOperationConfig(tx as unknown as Db, op.id, { ...op.config, menu });
  });
}

function print(plans: OperationPlan[]): void {
  for (const plan of plans) {
    const op = plan.operation;
    console.log(`\n${op.id}  (solution ${op.solutionId})`);
    if (plan.skipped) { console.log(`  skipped — ${plan.skipped}`); continue; }
    console.log(`  apps (${plan.apps.length}):`);
    for (const a of plan.apps) console.log(`    "${a.label}"  ← ${a.pageId}  roles: ${a.roleIds.length ? a.roleIds.join(', ') : '(none)'}`);
    const label = (leaf: MenuLeaf) => plan.apps.find((a) => `page:${a.pageId}` === leaf.appId)?.label ?? leaf.appId;
    console.log(`  menu (${plan.menu.length} item${plan.menu.length === 1 ? '' : 's'}):`);
    if (plan.menu.length === 0) console.log('    (empty)');
    for (const it of plan.menu) {
      if ('items' in it) {
        console.log(`    [${it.label}]`);
        for (const c of it.items) console.log(`      ${label(c)}`);
      } else {
        console.log(`    ${label(it)}`);
      }
    }
    for (const n of plan.notes) console.log(`  note: ${n}`);
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
  }
  const apply = process.argv.includes('--apply');
  const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus', applyMigrations: false });
  console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL' : 'PGlite'} — ${apply ? 'WRITING' : 'dry run, nothing is written'}`);
  const plans = await planStep2(db);
  print(plans);
  if (!apply) {
    console.log('\nNothing written. Run again with --apply to write it.');
  } else {
    for (const plan of plans) {
      await applyPlan(db, plan);
      if (!plan.skipped) console.log(`written: ${plan.operation.id}`);
    }
  }
  await closeDb(db);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
