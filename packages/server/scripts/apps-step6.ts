// Apps Part 2, step 6 — a one-off script (APPS_AND_INSTANCES §2.8). Run it
// AFTER the code that has `OpenApp` is live and BEFORE the code that removes
// the old way of opening: until it has run, every link names a page, and from
// then on a page is opened only as an app, by its id.
//
//   npx tsx scripts/apps-step6.ts            # prints what it would do; writes nothing
//   npx tsx scripts/apps-step6.ts --apply    # writes it
//
// For every solution with published pages:
//
// - **one key per page that something links to**, the page's name in camelCase
//   plus `LinkId` (`pages/shift-report` → `shiftReportLinkId`), the same in
//   every page that links to it;
// - **every literal link rewritten**: an `OpenPage` button and a RecordList
//   action column naming `OpenPage` become `OpenApp`, their `target` the key;
//   `services.page.open('<page>', record)` in a callback becomes
//   `services.app.open(context.app.definition.<key>, { recordId: record })`.
//   A link whose page is computed is listed for the author to rewrite;
// - **every operation's apps' definitions filled**: an app made from a page
//   that links gets, under each key its page uses, the id of the operation's
//   only app made from the page linked to. None, or several, is listed for an
//   operation admin to fill by hand. A key the definition already holds is
//   kept, and said if it differs.
//
// Definitions are written first, each change leaving a `sys_migration` history
// entry; then each page gets a new published version made from the **latest
// published** definition, rewritten, and its draft is rewritten too. A page
// with nothing left to rewrite is skipped, so a second run does nothing.
// Migrations are not applied: the script reads the database as it stands.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { lex, parseScript, TokenType, type Token } from '@fluxus/dsl';
import { MIGRATION_EDIT } from '@fluxus/engine';
import { createDb, closeDb, type Db } from '../src/db/client';
import { getSolutionConfig, listOperations, listPublishedPages, putPage } from '../src/host';
import { AppValidationError, listApps, putApp, type App } from '../src/apps';
import { pageVersions, pages, solutions } from '../src/db/schema';

interface SlotConfig {
  componentName?: string;
  staticConfig?: Record<string, unknown>;
  dynamicProps?: Record<string, string>;
  callbacks?: Record<string, string>;
}
interface StoredPage { slotConfigs?: Record<string, SlotConfig | null>; [key: string]: unknown }

/** One link, before and after. */
export interface Rewrite { where: string; from: string; to: string }

/** One page definition rewritten: what changed, and the new definition. */
export interface PageRewrite {
  def: StoredPage;
  rewrites: Rewrite[];
  /** The pages its links open. */
  targets: string[];
  /** Links it could not rewrite (a computed page), for the author. */
  unresolved: string[];
}

/** What the script would do for one page. */
export interface PagePlan {
  path: string;
  /** The latest published version, rewritten; null when it needs nothing. */
  published: (PageRewrite & { version: number }) | null;
  /** The draft, rewritten; null when it needs nothing. */
  draft: PageRewrite | null;
}

/** What the script would do for one app's definition. */
export interface DefinitionPlan {
  operationId: string;
  app: App;
  before: string;
  after: string;
}

/** What the script would do for one solution. */
export interface SolutionPlan {
  solutionId: string;
  /** Page linked to → its key. */
  keys: Record<string, string>;
  pages: PagePlan[];
  definitions: DefinitionPlan[];
  /** What it could not do: computed links, operations with none or several apps for a page. */
  unresolved: string[];
}

/** The key a page's links read from an app's definition: the page's name in
 *  camelCase plus `LinkId` (`pages/shift-report` → `shiftReportLinkId`). */
export function keyFor(path: string): string {
  const words = (path.split('/').pop() ?? path).split(/[^A-Za-z0-9]+/).filter(Boolean);
  const camel = words.map((w, i) => (i === 0 ? w[0].toLowerCase() : w[0].toUpperCase()) + w.slice(1)).join('');
  return `${/^[A-Za-z]/.test(camel) ? camel : `page${camel}`}LinkId`;
}

/** Keys for every page linked to, one each; two pages whose names give the
 *  same key take their whole path instead. */
function keysFor(targets: Iterable<string>): Record<string, string> {
  const keys: Record<string, string> = {};
  const taken = new Map<string, string>();
  for (const path of [...new Set(targets)].sort()) {
    let key = keyFor(path);
    if (taken.has(key.toLowerCase())) key = keyFor(path.replace(/\//g, '-'));
    taken.set(key.toLowerCase(), path);
    keys[path] = key;
  }
  return keys;
}

// ── Rewriting `services.page.open` in a script, in place ──────────────────────

interface OpenCall { start: number; end: number; page: string | null; record: string | null; extra: boolean }

/** Every `services.page.open(…)` in a script, found with the DSL's own lexer
 *  so strings and comments are never mistaken for one. */
function findOpens(source: string): OpenCall[] | null {
  let tokens: Token[];
  try {
    tokens = lex(source);
  } catch {
    return null;
  }
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
  const at = (t: Token) => lineStarts[t.line - 1] + t.col - 1;
  for (const t of tokens) if (t.type !== TokenType.EOF && t.type !== TokenType.Newline && source.slice(at(t), at(t) + t.raw.length) !== t.raw) return null;

  const isWord = (t: Token | undefined, w: string) => (t?.type === TokenType.Identifier || t?.type === TokenType.Keyword) && t.value === w;
  const found: OpenCall[] = [];
  for (let i = 0; i + 5 < tokens.length; i++) {
    if (!(isWord(tokens[i], 'services') && tokens[i + 1].type === TokenType.Dot && isWord(tokens[i + 2], 'page')
      && tokens[i + 3].type === TokenType.Dot && isWord(tokens[i + 4], 'open') && tokens[i + 5].type === TokenType.LParen)) continue;
    // The arguments: split at commas outside any bracket, up to the matching ')'.
    let depth = 0;
    let j = i + 5;
    const args: Token[][] = [[]];
    for (; j < tokens.length; j++) {
      const t = tokens[j];
      if (t.type === TokenType.LParen || t.type === TokenType.LBracket || t.type === TokenType.LBrace) { depth++; if (depth === 1) continue; }
      if (t.type === TokenType.RParen || t.type === TokenType.RBracket || t.type === TokenType.RBrace) { depth--; if (depth === 0) break; }
      if (depth === 1 && t.type === TokenType.Comma) { args.push([]); continue; }
      if (t.type !== TokenType.Newline) args[args.length - 1].push(t);
    }
    if (j >= tokens.length) return null;
    const text = (ts: Token[]) => (ts.length === 0 ? null : source.slice(at(ts[0]), at(ts[ts.length - 1]) + ts[ts.length - 1].raw.length));
    const [page = [], record = [], ...rest] = args;
    found.push({
      start: at(tokens[i]),
      end: at(tokens[j]) + 1,
      page: page.length === 1 && page[0].type === TokenType.String ? page[0].value : null,
      record: text(record),
      extra: rest.length > 0,
    });
    i = j;
  }
  return found;
}

/** A script with each literal `services.page.open` rewritten to open the app
 *  its key names. */
function rewriteScript(where: string, source: string, keys: Record<string, string>, out: PageRewrite): string {
  const opens = findOpens(source);
  if (opens === null) {
    if (/services\s*\.\s*page\s*\.\s*open/i.test(source)) out.unresolved.push(`${where}: names services.page.open, but the script does not read — rewrite it by hand`);
    return source;
  }
  let next = source;
  const rewrites: Rewrite[] = [];
  const targets: string[] = [];
  for (const call of [...opens].reverse()) {
    const from = source.slice(call.start, call.end);
    if (call.page === null || call.extra || !keys[call.page]) {
      out.unresolved.push(`${where}: ${from} — its page is computed; rewrite it to services.app.open(context.app.definition.<key>, { recordId })`);
      continue;
    }
    const to = `services.app.open(context.app.definition.${keys[call.page]}${call.record ? `, { recordId: ${call.record} }` : ''})`;
    next = next.slice(0, call.start) + to + next.slice(call.end);
    rewrites.unshift({ where, from, to });
    targets.push(call.page);
  }
  if (rewrites.length === 0) return source;
  try {
    parseScript(next);
  } catch (err) {
    out.unresolved.push(`${where}: the rewritten script does not read (${err instanceof Error ? err.message : String(err)}) — left as it was`);
    return source;
  }
  out.rewrites.push(...rewrites);
  out.targets.push(...targets);
  return next;
}

// ── Pages ─────────────────────────────────────────────────────────────────────

/** The pages a definition's literal links open — the first pass, for keys. */
export function linkedPages(def: StoredPage): string[] {
  const targets: string[] = [];
  for (const c of Object.values(def.slotConfigs ?? {})) {
    if (!c) continue;
    const sc = c.staticConfig ?? {};
    if (c.componentName === 'OpenPage' && typeof sc.target === 'string' && sc.target) targets.push(sc.target);
    for (const col of (Array.isArray(sc.columns) ? sc.columns : []) as { component?: string; target?: unknown }[]) {
      if (col?.component === 'OpenPage' && typeof col.target === 'string' && col.target) targets.push(col.target);
    }
    for (const source of Object.values(c.callbacks ?? {})) for (const call of findOpens(source) ?? []) if (call.page) targets.push(call.page);
  }
  return targets;
}

/** A page definition with every literal link rewritten. */
export function rewritePage(def: StoredPage, keys: Record<string, string>): PageRewrite {
  const out: PageRewrite = { def, rewrites: [], targets: [], unresolved: [] };
  const slotConfigs: Record<string, SlotConfig | null> = {};
  for (const [slot, c] of Object.entries(def.slotConfigs ?? {})) {
    if (!c) { slotConfigs[slot] = c; continue; }
    const comp = c.componentName ?? '?';
    const where = `${comp} (${slot})`;
    let next: SlotConfig = c;
    const sc = c.staticConfig ?? {};
    if (comp === 'OpenPage') {
      const target = sc.target;
      if (typeof target === 'string' && keys[target]) {
        next = { ...next, componentName: 'OpenApp', staticConfig: { ...sc, target: keys[target] } };
        out.rewrites.push({ where, from: `OpenPage target '${target}'`, to: `OpenApp target '${keys[target]}'` });
        out.targets.push(target);
      } else {
        out.unresolved.push(`${where}: an OpenPage with no page to open — replace it with an OpenApp by hand`);
      }
    }
    if (Array.isArray(sc.columns)) {
      const columns = (sc.columns as Record<string, unknown>[]).map((col, i) => {
        if (col?.component !== 'OpenPage') return col;
        const target = col.target;
        if (typeof target !== 'string' || !keys[target]) {
          out.unresolved.push(`${where} column ${i + 1}: an OpenPage with no page to open — make it an OpenApp by hand`);
          return col;
        }
        out.rewrites.push({ where: `${where} column ${i + 1} '${String(col.label ?? '')}'`, from: `OpenPage target '${target}'`, to: `OpenApp target '${keys[target]}'` });
        out.targets.push(target);
        return { ...col, component: 'OpenApp', target: keys[target] };
      });
      next = { ...next, staticConfig: { ...(next.staticConfig ?? {}), columns } };
    }
    const callbacks = Object.fromEntries(Object.entries(c.callbacks ?? {}).map(([cb, source]) => [cb, rewriteScript(`${where} ${cb}`, source, keys, out)]));
    if (c.callbacks) next = { ...next, callbacks };
    // services.page.open is an effect, which only a callback may call; one
    // anywhere else is said rather than rewritten.
    for (const [prop, source] of Object.entries(c.dynamicProps ?? {})) {
      if (/services\s*\.\s*page\s*\.\s*open/i.test(source)) out.unresolved.push(`${where} ${prop}: names services.page.open outside a callback — rewrite it by hand`);
    }
    slotConfigs[slot] = next;
  }
  out.def = { ...def, slotConfigs };
  return out;
}

// ── The plan ──────────────────────────────────────────────────────────────────

/** Plan every solution, reading only. */
export async function planStep6(db: Db): Promise<SolutionPlan[]> {
  const plans: SolutionPlan[] = [];
  const operations = await listOperations(db);
  const ids = (await db.select({ id: solutions.id }).from(solutions)).map((r) => r.id);
  for (const solutionId of ids.sort()) {
    const published = await listPublishedPages(db, solutionId);
    if (published.length === 0) continue;
    const drafts = await db.select({ path: pages.path, def: pages.def }).from(pages).where(eq(pages.solutionId, solutionId));
    const latest = await db
      .select({ path: pageVersions.path, version: sql<number>`max(${pageVersions.version})` })
      .from(pageVersions)
      .where(eq(pageVersions.solutionId, solutionId))
      .groupBy(pageVersions.path);
    const versionOf = new Map(latest.map((r) => [r.path, Number(r.version)]));

    const keys = keysFor([...published, ...drafts].flatMap((p) => linkedPages(p.def as StoredPage)));
    const plan: SolutionPlan = { solutionId, keys, pages: [], definitions: [], unresolved: [] };
    plans.push(plan);

    // Pages, in path order: the latest published version and the draft.
    const paths = [...new Set([...published.map((p) => p.path), ...drafts.map((d) => d.path)])].sort();
    const linksOf = new Map<string, Set<string>>(); // page → pages it opens
    for (const path of paths) {
      const pub = published.find((p) => p.path === path);
      const draft = drafts.find((d) => d.path === path);
      const pubRewrite = pub ? rewritePage(pub.def as StoredPage, keys) : null;
      const draftRewrite = draft ? rewritePage(draft.def as StoredPage, keys) : null;
      const page: PagePlan = {
        path,
        published: pubRewrite && pubRewrite.rewrites.length > 0 ? { ...pubRewrite, version: versionOf.get(path) ?? 0 } : null,
        draft: draftRewrite && draftRewrite.rewrites.length > 0 ? draftRewrite : null,
      };
      const unresolved = new Set([...(pubRewrite?.unresolved ?? []), ...(draftRewrite?.unresolved ?? [])]);
      for (const u of unresolved) plan.unresolved.push(`${path} — ${u}`);
      const targets = new Set([...(pubRewrite?.targets ?? []), ...(draftRewrite?.targets ?? [])]);
      if (targets.size > 0) linksOf.set(path, targets);
      if (page.published || page.draft) plan.pages.push(page);
    }

    // Definitions: each operation of the solution, each app made from a page that links.
    for (const op of operations.filter((o) => o.solutionId === solutionId).sort((a, b) => a.id.localeCompare(b.id))) {
      const apps = await listApps(db, op.id);
      const byPage = new Map<string, App[]>();
      for (const a of apps) byPage.set(a.pageId, [...(byPage.get(a.pageId) ?? []), a]);
      for (const app of apps) {
        const targets = linksOf.get(app.pageId);
        if (!targets) continue;
        let existing: Record<string, unknown>;
        try {
          const parsed = JSON.parse(app.definition.trim() || '{}');
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
          existing = parsed as Record<string, unknown>;
        } catch {
          plan.unresolved.push(`${op.id} · "${app.label}": its definition is not a JSON object — fill its keys by hand`);
          continue;
        }
        const added: Record<string, string> = {};
        for (const target of [...targets].sort()) {
          const key = keys[target];
          const made = byPage.get(target) ?? [];
          if (made.length !== 1) {
            plan.unresolved.push(`${op.id} · "${app.label}": ${made.length === 0 ? `no app is made from ${target}` : `${made.length} apps are made from ${target} (${made.map((a) => `"${a.label}"`).join(', ')})`} — set ${key} in its definition by hand`);
            continue;
          }
          const held = Object.entries(existing).find(([k]) => k.toLowerCase() === key.toLowerCase());
          if (held) {
            if (held[1] !== made[0].id) plan.unresolved.push(`${op.id} · "${app.label}": ${held[0]} is ${JSON.stringify(held[1])} already, not "${made[0].label}" (${made[0].id}) — kept`);
            continue;
          }
          added[key] = made[0].id;
        }
        if (Object.keys(added).length === 0) continue;
        plan.definitions.push({ operationId: op.id, app, before: app.definition, after: JSON.stringify({ ...existing, ...added }, null, 2) });
      }
    }
  }
  return plans;
}

/** Write one solution's plan: definitions first, then pages. */
export async function applySolutionPlan(db: Db, plan: SolutionPlan): Promise<string[]> {
  const written: string[] = [];
  if (plan.definitions.length > 0) {
    const config = await getSolutionConfig(db, plan.solutionId);
    const publishedPages = new Set((await listPublishedPages(db, plan.solutionId)).map((p) => p.path));
    for (const d of plan.definitions) {
      try {
        await putApp(db, d.operationId, { ...d.app, definition: d.after }, { publishedPages, config }, 'migration', MIGRATION_EDIT);
        written.push(`definition: ${d.operationId} · "${d.app.label}"`);
      } catch (err) {
        if (!(err instanceof AppValidationError)) throw err;
        written.push(`NOT WRITTEN — ${d.operationId} · "${d.app.label}": ${err.message}`);
      }
    }
  }
  for (const page of plan.pages) {
    if (page.published) {
      await db.insert(pageVersions).values({
        solutionId: plan.solutionId,
        path: page.path,
        version: page.published.version + 1,
        def: page.published.def,
        readme: 'Links open apps by their id, read from the app\'s definition (apps Part 2 step 6)',
        publishedBy: 'migration',
      });
      written.push(`published: ${page.path} v${page.published.version + 1}`);
    }
    if (page.draft) {
      const [draft] = await db.select({ def: pages.def }).from(pages)
        .where(and(eq(pages.solutionId, plan.solutionId), eq(pages.path, page.path)));
      if (draft) {
        await putPage(db, plan.solutionId, page.path, page.draft.def);
        written.push(`draft: ${page.path}`);
      }
    }
  }
  return written;
}

function print(plans: SolutionPlan[]): void {
  for (const plan of plans) {
    console.log(`\n=== ${plan.solutionId}`);
    const keys = Object.entries(plan.keys);
    if (keys.length === 0 && plan.unresolved.length === 0) { console.log('  no links between pages — nothing to do'); continue; }
    if (keys.length > 0) {
      console.log('  keys:');
      for (const [path, key] of keys) console.log(`    ${path}  →  ${key}`);
    }
    for (const page of plan.pages) {
      const same = page.published && page.draft && JSON.stringify(page.published.def) === JSON.stringify(page.draft.def);
      const what = [page.published ? `published v${page.published.version} → v${page.published.version + 1}` : null, page.draft ? (same ? 'draft (the same)' : 'draft') : null].filter(Boolean).join(', ');
      console.log(`\n  ${page.path}  — ${what}`);
      for (const r of (page.published ?? page.draft)!.rewrites) console.log(`    ${r.where}\n      ${r.from}\n      → ${r.to}`);
      if (page.published && page.draft && !same) {
        console.log('    the draft, which differs from what is published:');
        for (const r of page.draft.rewrites) console.log(`    ${r.where}\n      ${r.from}\n      → ${r.to}`);
      }
    }
    if (plan.definitions.length > 0) {
      console.log('\n  definitions:');
      for (const d of plan.definitions) {
        console.log(`    ${d.operationId} · "${d.app.label}" (${d.app.pageId}, ${d.app.id})`);
        console.log(`      ${d.before.replace(/\s+/g, ' ')}  →  ${d.after.replace(/\s+/g, ' ')}`);
      }
    }
    for (const u of plan.unresolved) console.log(`  UNRESOLVED: ${u}`);
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
  }
  const apply = process.argv.includes('--apply');
  const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus', applyMigrations: false });
  console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL' : 'PGlite'} — ${apply ? 'WRITING' : 'dry run, nothing is written'}`);
  const plans = await planStep6(db);
  print(plans);
  if (!apply) {
    console.log('\nNothing written. Run again with --apply to write it.');
  } else {
    console.log('');
    for (const plan of plans) for (const line of await applySolutionPlan(db, plan)) console.log(`written: ${plan.solutionId} — ${line}`);
  }
  await closeDb(db);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
