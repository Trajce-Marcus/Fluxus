// One-off, 2026-08-25. Two writes to the demo solution's navigation:
//
//   1. drops the `demo/sdm` operation's menu override, so it inherits the
//      solution default (what "Revert to solution default" does in the
//      Console). The override was three items that opened nothing.
//   2. points the default menu's "My Jobs" at pages/work-orders-demo — the
//      page it was pointed at in the Console on 2026-08-21, in a save the
//      server rejected for other items, so the choice never persisted.
//
// Writes straight to the rows rather than through config.putDefaultMenu,
// because that validates the whole menu and the other two items still open
// nothing — which is the author's call, not this script's.
//
// Pass --dry to print without writing.

import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { operations, sdmMenus } from '../src/db/schema';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const OPERATION = 'demo/sdm';
const SOLUTION = 'demo/sdm';
const TARGET_LABEL = 'My Jobs';
const TARGET_PAGE = 'pages/work-orders-demo';
const dry = process.argv.includes('--dry');

interface Item { id?: string; label: string; page?: string; roles?: string[]; items?: Item[] }

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

// ── 1. the operation's override ───────────────────────────────────────────────
const [op] = await db.select().from(operations).where(eq(operations.id, OPERATION));
if (!op) {
  console.log(`no such operation: ${OPERATION}`);
} else {
  const config = { ...(op.config as Record<string, unknown>) };
  if (!('menu' in config)) {
    console.log(`${OPERATION}: no override — already inheriting.`);
  } else {
    console.log(`${OPERATION} override dropped:\n  was: ${JSON.stringify(config.menu)}`);
    delete config.menu;
    if (!dry) await db.update(operations).set({ config }).where(eq(operations.id, OPERATION));
  }
}

// ── 2. "My Jobs" in the solution default ──────────────────────────────────────
const [menuRow] = await db.select().from(sdmMenus).where(eq(sdmMenus.solutionId, SOLUTION));
if (!menuRow) {
  console.log(`\n${SOLUTION}: no default menu.`);
} else {
  const def = structuredClone(menuRow.def) as Item[];
  let hit = false;
  const walk = (items: Item[]) => {
    for (const it of items) {
      if (it.label === TARGET_LABEL && !it.page && it.items === undefined) {
        it.page = TARGET_PAGE;
        hit = true;
        console.log(`\n"${TARGET_LABEL}" → ${TARGET_PAGE}`);
      }
      if (it.items) walk(it.items);
    }
  };
  walk(def);
  if (!hit) console.log(`\n"${TARGET_LABEL}": nothing to change.`);
  else if (!dry) await db.update(sdmMenus).set({ def }).where(eq(sdmMenus.solutionId, SOLUTION));

  const dead = (items: Item[], out: string[] = []): string[] => {
    for (const it of items) {
      if (!it.page && it.items === undefined) out.push(it.label);
      if (it.items) dead(it.items, out);
    }
    return out;
  };
  const left = dead(def);
  if (left.length > 0) {
    console.log(`\nStill opening nothing (yours to fix or remove): ${left.join(', ')}.`);
    console.log('The Console will refuse to save this menu until they are.');
  }
}

console.log(dry ? '\ndry run — nothing written.' : '\nwritten.');
await closeDb(db);
