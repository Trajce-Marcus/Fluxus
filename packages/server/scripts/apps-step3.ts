// Apps Part 2, step 3 — a one-off script (APPS_AND_INSTANCES §2.8). Run it
// BEFORE the step 3 code is live: from then on a page with no list offers
// nothing. It only adds workflows and page versions, which the step 2 code
// ignores (a workflow no record type points to is never sent to a browser or
// offered; an unknown field on a page is read by nothing).
//
//   npx tsx scripts/apps-step3.ts            # prints what it would do; writes nothing
//   npx tsx scripts/apps-step3.ts --apply    # writes it
//
// For every published page it lists what the page uses today, and makes that
// the page's list — one workflow per page, `wf_app_<page>`:
//
// - the **whole workflow of each record type the page shows or acts on**: its
//   record; the rows of a record list fed by a GET (the type the GET's
//   `returns` names); the record a RecordActivities shows (`context.record.id`
//   or a reference field of it); the type whose workflow holds an activity a
//   RunActivity, a list's action column or bulk action, or a callback's
//   `services.activities.run` names with a literal id;
// - **every GET it calls through `invoke`** with a literal id — in dynamic
//   props, `{{ }}` holes in typed-in text, and named functions those reach.
//
// What it cannot work out (a computed id, a list whose GET names no type) it
// prints as unresolved, for the user to check. It then sets `workflowId` on the
// page's draft and on a new published version made from the **latest
// published** definition (not the draft, which may hold unpublished work). A
// page that already has a list is skipped, so a second run does nothing.
// Migrations are not applied: the script reads the database as it stands.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { parseExpression, parseScript, type Call, type Expr } from '@fluxus/dsl';
import { fullId, joinScript, type SolutionConfig } from '@fluxus/engine';
import { createDb, closeDb, type Db } from '../src/db/client';
import { configCollections, getSolutionConfig, listPublishedPages, putConfigEntity, putPage } from '../src/host';
import { pageVersions, pages, solutions } from '../src/db/schema';
import { consoleNotifySink } from '../src/services/notify';

interface SlotConfig {
  componentName?: string;
  staticConfig?: Record<string, unknown>;
  dynamicProps?: Record<string, string>;
  callbacks?: Record<string, string>;
}
interface StoredPage { record?: { type?: string }; workflowId?: string; slotConfigs?: Record<string, SlotConfig | null> }

/** What the script would do for one page. */
export interface PagePlan {
  solutionId: string;
  path: string;
  workflowId: string;
  /** Why nothing is done, when nothing is. */
  skipped?: string;
  /** The list, in order. */
  activityIds: string[];
  /** Record types whose whole workflow is on the list, and why. */
  types: { typeId: string; why: string }[];
  /** GETs on the list on their own (not already in an included workflow). */
  gets: string[];
  /** What it could not work out. */
  unresolved: string[];
  /** The workflow exists already (an earlier run stopped part way): reused. */
  reuse?: boolean;
}

/** The id of a page's list: `wf_app_` + the path, slashes (and anything else
 *  an id should not hold) made underscores. */
export const listIdFor = (path: string): string => `wf_app_${path.replace(/[^A-Za-z0-9_]/g, '_')}`;

const HOLE = /\{\{([\s\S]*?)\}\}/g;

/** Every Call reachable from a node. */
function calls(node: unknown, out: Call[] = []): Call[] {
  if (Array.isArray(node)) { for (const n of node) calls(n, out); return out; }
  if (node === null || typeof node !== 'object') return out;
  const rec = node as Record<string, unknown>;
  if (rec.kind === 'call') out.push(node as Call);
  for (const [key, value] of Object.entries(rec)) if (key !== 'pos') calls(value, out);
  return out;
}

const literal = (e: Expr | undefined): string | null => (e && e.kind === 'string' ? e.value : null);
const isIdent = (e: Expr, name: string) => e.kind === 'ident' && e.name.toLowerCase() === name;
const isServices = (callee: Expr, module: string, fn: string) =>
  callee.kind === 'member' && callee.name.toLowerCase() === fn &&
  callee.object.kind === 'member' && callee.object.name.toLowerCase() === module &&
  isIdent(callee.object.object, 'services');

function parse(source: string, script: boolean): unknown {
  try {
    return script ? parseScript(source) : parseExpression(source);
  } catch {
    return null;
  }
}

/** Plan every published page of every solution, reading only. */
export async function planStep3(db: Db): Promise<PagePlan[]> {
  const plans: PagePlan[] = [];
  const ids = (await db.select({ id: solutions.id }).from(solutions)).map((r) => r.id);
  for (const solutionId of ids.sort()) {
    const published = await listPublishedPages(db, solutionId);
    if (published.length === 0) continue;
    const config = await getSolutionConfig(db, solutionId);
    for (const { path, def } of [...published].sort((a, b) => a.path.localeCompare(b.path))) {
      plans.push(planPage(config, solutionId, path, def as StoredPage));
    }
  }
  return plans;
}

export function planPage(config: SolutionConfig, solutionId: string, path: string, def: StoredPage): PagePlan {
  const workflowId = listIdFor(path);
  const plan: PagePlan = { solutionId, path, workflowId, activityIds: [], types: [], gets: [], unresolved: [] };
  if (def.workflowId) { plan.skipped = `already has a list (${def.workflowId})`; return plan; }
  plan.reuse = config.workflows.some((w) => w.id === workflowId);

  const recordTypes = new Map(config.recordTypes.map((rt) => [rt.id, rt]));
  const workflows = new Map(config.workflows.map((w) => [w.id, w]));
  const activities = new Map(config.activities.map((a) => [a.id, a]));
  const functions = new Map((config.functions ?? []).map((f) => [f.name.toLowerCase(), joinScript(f.body) ?? '']));
  const typesListing = (activityId: string) => config.recordTypes
    .filter((rt) => (workflows.get(rt.workflow_ref)?.activities ?? []).some((u) => u.activity_ref === activityId))
    .map((rt) => rt.id);
  /** The record type a GET's `returns` names, when it starts at `records.<type>`. */
  const typeReturned = (getId: string): string | null => {
    const m = /^\s*records\.([A-Za-z_][A-Za-z0-9_]*)/.exec(joinScript(activities.get(getId)?.returns) ?? '');
    const id = m ? fullId(m[1]) : null;
    return id && recordTypes.has(id) ? id : null;
  };

  const types = new Map<string, string>();
  const named = new Map<string, string>(); // activity → where
  const gets = new Set<string>();
  const addType = (typeId: string, why: string) => { if (!types.has(typeId)) types.set(typeId, why); };
  const pageType = def.record?.type && recordTypes.has(def.record.type) ? def.record.type : null;
  if (pageType) addType(pageType, 'the page is about one');

  const seenFunctions = new Set<string>();
  /** The GETs an expression or script invokes, following named functions. */
  const invokes = (where: string, ast: unknown): string[] => {
    const found: string[] = [];
    for (const call of calls(ast)) {
      if (isIdent(call.callee, 'invoke')) {
        const id = literal(call.args[0]?.value);
        if (id) found.push(id);
        else plan.unresolved.push(`${where}: invoke with a computed id`);
      } else if (call.callee.kind === 'ident' && functions.has(call.callee.name.toLowerCase())) {
        const name = call.callee.name.toLowerCase();
        if (!seenFunctions.has(name)) {
          seenFunctions.add(name);
          found.push(...invokes(`function ${name}`, parse(functions.get(name)!, true)));
        }
      }
    }
    for (const id of found) gets.add(id);
    return found;
  };
  const names = (where: string, id: unknown) => {
    if (typeof id === 'string' && id) named.set(id, named.get(id) ?? where);
  };

  for (const [slot, c] of Object.entries(def.slotConfigs ?? {})) {
    if (!c) continue;
    const comp = c.componentName ?? '?';
    const where = `${comp} (${slot})`;
    // Typed-in text with {{ }} holes.
    for (const [key, value] of Object.entries(c.staticConfig ?? {})) {
      if (typeof value !== 'string') continue;
      for (const m of value.matchAll(HOLE)) invokes(`${where} ${key}`, parse(m[1], false));
    }
    const dynamic: Record<string, string[]> = {};
    for (const [prop, source] of Object.entries(c.dynamicProps ?? {})) dynamic[prop] = invokes(`${where} ${prop}`, parse(source, false));
    for (const [cb, source] of Object.entries(c.callbacks ?? {})) {
      const ast = parse(source, true);
      invokes(`${where} ${cb}`, ast);
      for (const call of calls(ast)) {
        if (!isServices(call.callee, 'activities', 'run')) continue;
        const id = literal(call.args[0]?.value);
        if (id) names(`${where} ${cb}`, id);
        else plan.unresolved.push(`${where} ${cb}: services.activities.run with a computed id`);
      }
    }
    const sc = c.staticConfig ?? {};
    if (comp === 'RunActivity') names(where, sc.target);
    if (comp === 'RecordList') {
      for (const col of (Array.isArray(sc.columns) ? sc.columns : []) as { component?: string; target?: string }[]) {
        if (col.component === 'RunActivity') names(`${where} column`, col.target);
      }
      for (const bulk of (Array.isArray(sc.bulkActions) ? sc.bulkActions : []) as { target?: string }[]) names(`${where} bulk action`, bulk.target);
      // Rows fed by a GET show records of the type it returns.
      const rowsGet = dynamic.rows?.[0];
      if (rowsGet) {
        const t = typeReturned(rowsGet);
        if (t) addType(t, `${where} lists them`);
        else plan.unresolved.push(`${where}: its rows come from '${rowsGet}', whose returns names no record type`);
      }
    }
    if (comp === 'RecordActivities') {
      const source = (c.dynamicProps ?? {}).record?.trim() ?? '';
      const m = /^context\.record\.([A-Za-z_][A-Za-z0-9_]*)$/i.exec(source);
      const field = m?.[1];
      if (field && field.toLowerCase() === 'id' && pageType) addType(pageType, `${where} shows its actions`);
      else if (field && pageType) {
        const cf = recordTypes.get(pageType)!.custom_fields.find((f) => f.key === field);
        if (cf?.type === 'fk_ref' && cf.fk_record_type && recordTypes.has(cf.fk_record_type)) addType(cf.fk_record_type, `${where} shows its actions`);
        else plan.unresolved.push(`${where}: its record (${source}) is not a reference the script can follow`);
      } else plan.unresolved.push(`${where}: its record (${source || 'none'}) is not one the script can follow`);
    }
  }

  // An activity named directly brings in the workflow of every type that lists it.
  const loose: string[] = [];
  for (const [id, where] of named) {
    if (!activities.has(id)) { plan.unresolved.push(`${where}: '${id}' is not an activity of this solution`); continue; }
    const owners = typesListing(id);
    if (owners.length === 0) loose.push(id);
    for (const t of owners) addType(t, `${where} runs ${id}`);
  }

  const list: string[] = [];
  const add = (id: string) => { if (!list.includes(id)) list.push(id); };
  for (const typeId of types.keys()) for (const u of workflows.get(recordTypes.get(typeId)!.workflow_ref)?.activities ?? []) add(u.activity_ref);
  for (const id of loose) add(id);
  for (const id of gets) {
    if (!activities.has(id)) { plan.unresolved.push(`invoke('${id}'): not an activity of this solution`); continue; }
    if (!list.includes(id)) plan.gets.push(id);
    add(id);
  }
  plan.activityIds = list;
  plan.types = [...types].map(([typeId, why]) => ({ typeId, why }));
  return plan;
}

/** Write one page's plan: its list (unless an earlier run made it), then
 *  `workflowId` on a new published version and on its draft. */
export async function applyPagePlan(db: Db, plan: PagePlan): Promise<void> {
  if (plan.skipped) return;
  if (!plan.reuse) {
    await putConfigEntity(db, plan.solutionId, configCollections.workflows, {
      id: plan.workflowId,
      name: plan.path,
      description: `What the page ${plan.path} uses (apps Part 2 step 3)`,
      activities: plan.activityIds.map((activity_ref) => ({ activity_ref })),
    }, consoleNotifySink, 'migration');
  }
  const [latest] = await db.select({ version: pageVersions.version, def: pageVersions.def })
    .from(pageVersions)
    .where(and(eq(pageVersions.solutionId, plan.solutionId), eq(pageVersions.path, plan.path)))
    .orderBy(sql`${pageVersions.version} DESC`)
    .limit(1);
  await db.insert(pageVersions).values({
    solutionId: plan.solutionId,
    path: plan.path,
    version: latest.version + 1,
    def: { ...(latest.def as object), workflowId: plan.workflowId },
    readme: 'Gave the page its list of activities (apps Part 2 step 3)',
    publishedBy: 'migration',
  });
  const [draft] = await db.select({ def: pages.def }).from(pages)
    .where(and(eq(pages.solutionId, plan.solutionId), eq(pages.path, plan.path)));
  if (draft) await putPage(db, plan.solutionId, plan.path, { ...(draft.def as object), workflowId: plan.workflowId });
}

function print(plans: PagePlan[]): void {
  let solution = '';
  for (const p of plans) {
    if (p.solutionId !== solution) { solution = p.solutionId; console.log(`\n=== ${solution}`); }
    console.log(`\n${p.path}  →  ${p.workflowId}${p.reuse ? '  (exists already — reused)' : ''}`);
    if (p.skipped) { console.log(`  skipped — ${p.skipped}`); continue; }
    for (const t of p.types) console.log(`  whole workflow of ${t.typeId} — ${t.why}`);
    for (const g of p.gets) console.log(`  GET ${g} — invoked`);
    console.log(`  list (${p.activityIds.length}): ${p.activityIds.join(', ') || '(empty — the page will offer nothing)'}`);
    for (const u of p.unresolved) console.log(`  UNRESOLVED: ${u}`);
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
  }
  const apply = process.argv.includes('--apply');
  const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus', applyMigrations: false });
  console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL' : 'PGlite'} — ${apply ? 'WRITING' : 'dry run, nothing is written'}`);
  const plans = await planStep3(db);
  print(plans);
  if (!apply) {
    console.log('\nNothing written. Run again with --apply to write it.');
  } else {
    for (const plan of plans) {
      await applyPagePlan(db, plan);
      if (!plan.skipped) console.log(`written: ${plan.solutionId} ${plan.path}`);
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
