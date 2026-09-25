// Read-only. Runs the save check for record-query filters (SERVER_DATA_LOADING
// §5.6) over every stored model and page — page drafts and the latest
// published version of each — and lists what it would refuse. SELECTs only:
// migrations are not applied, nothing is written.
//
//   DATABASE_URL=… npx tsx scripts/check-query-filters.ts

import { fileURLToPath } from 'node:url';
import { desc } from 'drizzle-orm';
import { validateExpression, validateScript, type Diagnostic } from '@fluxus/dsl';
import { buildDslSchema, createEngine, functionSignatures, MemoryAdapter, buildGeoModule, buildTimeModule, buildMathModule } from '@fluxus/engine';
import { createDb, closeDb } from '../src/db/client';
import { getSolutionConfig, listOrgs, listSolutions } from '../src/host';
import { pages, pageVersions } from '../src/db/schema';
import { buildNotifyModule, consoleNotifySink } from '../src/services/notify';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus', applyMigrations: false });
const endpoint = process.env.DATABASE_URL?.match(/@([^/.]+)/)?.[1] ?? 'PGlite';
console.log(`database: ${endpoint}\n`);

/** The save check's own findings — what step 3 adds to validation. */
const isRefusal = (d: Diagnostic) => /query filter/.test(d.message);

let offenders = 0;
const fieldTypes = new Map<string, number>();
const configs = new Map<string, Awaited<ReturnType<typeof getSolutionConfig>>>();

for (const org of await listOrgs(db)) {
  for (const sol of await listSolutions(db, org.id)) {
    if (configs.has(sol.id)) continue;
    const config = await getSolutionConfig(db, sol.id);
    configs.set(sol.id, config);
    for (const rt of config.recordTypes) {
      for (const cf of rt.custom_fields) fieldTypes.set(cf.type, (fieldTypes.get(cf.type) ?? 0) + 1);
    }
    const adapter = new MemoryAdapter(config);
    const engine = createEngine({
      store: adapter,
      config,
      services: [buildNotifyModule(consoleNotifySink), buildGeoModule(adapter), buildTimeModule(), buildMathModule()],
    });
    const found = engine.validateConfig().filter((f) => isRefusal(f.diagnostic));
    console.log(`── model ${sol.id}: ${found.length === 0 ? 'clean' : `${found.length} refused`}`);
    for (const f of found) console.log(`   ${f.where} [${f.diagnostic.line}:${f.diagnostic.col}] ${f.diagnostic.message}`);
    offenders += found.length;
  }
}

type SlotConfig = {
  componentName?: string;
  staticConfig?: Record<string, unknown>;
  dynamicProps?: Record<string, string>;
  callbacks?: Record<string, string>;
};

function checkPage(solutionId: string, label: string, def: { slotConfigs?: Record<string, SlotConfig | null> }): number {
  const config = configs.get(solutionId);
  if (!config) {
    console.log(`── page ${solutionId} · ${label}: no model for this solution — skipped`);
    return 0;
  }
  const schema = buildDslSchema(config);
  const functions = functionSignatures(config);
  const found: string[] = [];
  for (const [slot, sc] of Object.entries(def.slotConfigs ?? {})) {
    if (!sc) continue;
    const at = (part: string, d: Diagnostic) => found.push(`${slot} (${sc.componentName}) ${part} [${d.line}:${d.col}] ${d.message}`);
    for (const [prop, source] of Object.entries(sc.dynamicProps ?? {})) {
      for (const d of validateExpression(source, schema, { bannedRoots: ['attributes'], functions })) if (isRefusal(d)) at(`prop '${prop}'`, d);
    }
    for (const [key, value] of Object.entries(sc.staticConfig ?? {})) {
      if (typeof value !== 'string') continue;
      for (const match of value.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
        for (const d of validateExpression(match[1].trim(), schema, { bannedRoots: ['attributes'], functions })) if (isRefusal(d)) at(`text '${key}'`, d);
      }
    }
    for (const [name, source] of Object.entries(sc.callbacks ?? {})) {
      for (const d of validateScript(source, schema, { mode: 'callback', bannedRoots: ['attributes'], extraRoots: ['callbackData'], functions })) {
        if (isRefusal(d)) at(`callback '${name}'`, d);
      }
    }
  }
  console.log(`── page ${solutionId} · ${label}: ${found.length === 0 ? 'clean' : `${found.length} refused`}`);
  for (const line of found) console.log(`   ${line}`);
  return found.length;
}

const drafts = await db.select().from(pages);
for (const row of drafts) offenders += checkPage(row.solutionId, `${row.path} (draft)`, row.def as never);

const published = await db.select().from(pageVersions).orderBy(desc(pageVersions.version));
const latest = new Set<string>();
for (const row of published) {
  const key = `${row.solutionId}\u0000${row.path}`;
  if (latest.has(key)) continue;
  latest.add(key);
  offenders += checkPage(row.solutionId, `${row.path} (published v${row.version})`, row.def as never);
}

console.log(`\n${configs.size} models, ${drafts.length} page drafts, ${latest.size} published pages — ${offenders} refused.`);
console.log(`field types in use: ${[...fieldTypes].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', ')}`);
await closeDb(db);
process.exit(0);
