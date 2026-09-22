// One-off, 2026-09-23. Moves P26-011's cost-code budgets off the seven roots
// and onto their twenty children, and raises the project's approved budget to
// match.
//
// The rule (the user's, settled 2026-09-22): **a cost code with children holds
// no amount of its own — it is the sum of its children.** Only a code with no
// children carries a figure. Before this, the roots held the whole 30,000,000
// between them and every child was blank, which is the rule upside down: the
// budget sat where nothing is ever spent.
//
// An amount left on a code with children is a data-integrity problem, not a
// fallback — the total function ignores it. That is why the roots are emptied
// here rather than left as a duplicate copy of the sum below them.
//
// The figures are invented. P26-011 is a demonstration, not a real project,
// and the splits are guesses from each code's description, with skilled wages
// and general civil labour weighted to dominate as they do on a pipeline. That
// weighting takes the project past its old 30,000,000, so `approved_budget`
// moves to 40,620,000 — the user's call, made when the arithmetic was shown.
//
// Written straight to the records, per the standing ruling for demonstration
// data. Idempotent. Pass --dry to print and write nothing.

import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createDb, closeDb } from '../src/db/client';
import { records } from '../src/db/schema';

if (!process.env.DATABASE_URL) {
  try { process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch { /* PGlite */ }
}

const OPERATION = 'projects-dev';
const PROJECT = 'P26-011';
const APPROVED_BUDGET = 40_620_000;
const dry = process.argv.includes('--dry');

/** code → budget. Every child of a root; the roots are emptied. */
const LEAF_BUDGETS: Record<string, number> = {
  1100: 700_000, 1200: 520_000, 1300: 8_800_000, 1400: 3_000_000,
  2100: 10_600_000, 2200: 1_500_000, 2300: 500_000,
  3100: 1_050_000, 3200: 560_000, 3300: 190_000,
  4100: 2_700_000, 4200: 1_300_000, 4300: 500_000,
  5100: 4_900_000, 5200: 800_000,
  6100: 520_000, 6200: 430_000, 6300: 250_000,
  7100: 1_100_000, 7200: 700_000,
};

const db = await createDb({ dataDir: process.env.PGLITE_DATA_DIR ?? '.data/fluxus' });
console.log(`database: ${process.env.DATABASE_URL ? 'DATABASE_URL (Neon)' : 'PGlite'}${dry ? ' — DRY RUN' : ''}\n`);

const rows = await db.select().from(records).where(eq(records.operationId, OPERATION));
const cbs = rows.filter((r) => r.typeRef === 'rt_cbs_nodes'
  && (r.customFields as Record<string, unknown>).project_id === PROJECT);

const byCode = new Map<string, typeof cbs[number]>();
for (const r of cbs) byCode.set(String((r.customFields as Record<string, unknown>).code), r);

const hasChildren = new Set(
  cbs.map((r) => String((r.customFields as Record<string, unknown>).parent_id ?? '')).filter(Boolean),
);

// Refuse rather than guess: a code named here that is not in the database, or
// a code with children that is not being emptied, means the tree has moved.
const missing = Object.keys(LEAF_BUDGETS).filter((code) => !byCode.has(code));
if (missing.length > 0) throw new Error(`cost codes not found: ${missing.join(', ')}`);
for (const code of Object.keys(LEAF_BUDGETS)) {
  const row = byCode.get(code)!;
  if (hasChildren.has(row.id)) throw new Error(`${code} has children — it may not hold an amount`);
}

const write = async (row: typeof cbs[number], fields: Record<string, unknown>) => {
  if (dry) return;
  await db.update(records).set({ customFields: fields })
    .where(and(eq(records.operationId, row.operationId), eq(records.id, row.id)));
};

let changed = 0;
for (const [code, amount] of Object.entries(LEAF_BUDGETS)) {
  const row = byCode.get(code)!;
  const fields = { ...(row.customFields as Record<string, unknown>) };
  if (fields.budget_cost === amount) continue;
  console.log(`   ${code}  ${String(fields.name).padEnd(42)} ${String(fields.budget_cost ?? '').padStart(12)} → ${amount.toLocaleString()}`);
  fields.budget_cost = amount;
  await write(row, fields);
  changed += 1;
}

console.log();
for (const row of cbs) {
  if (!hasChildren.has(row.id)) continue;
  const fields = { ...(row.customFields as Record<string, unknown>) };
  if (fields.budget_cost === '' || fields.budget_cost === undefined) continue;
  console.log(`   ${String(fields.code)}  ${String(fields.name).padEnd(42)} ${String(fields.budget_cost).padStart(12)} → (emptied, sums from below)`);
  fields.budget_cost = '';
  await write(row, fields);
  changed += 1;
}

const project = rows.find((r) => r.typeRef === 'rt_projects' && r.id === PROJECT);
if (!project) throw new Error(`${PROJECT} not found in ${OPERATION}`);
const pf = { ...(project.customFields as Record<string, unknown>) };
if (pf.approved_budget !== APPROVED_BUDGET) {
  console.log(`\n   ${PROJECT} approved budget ${String(pf.approved_budget)} → ${APPROVED_BUDGET.toLocaleString()}`);
  pf.approved_budget = APPROVED_BUDGET;
  await write(project as typeof cbs[number], pf);
  changed += 1;
}

const total = Object.values(LEAF_BUDGETS).reduce((a, b) => a + b, 0);
console.log(`\n${changed} records ${dry ? 'would change' : 'changed'}. Leaf codes now total ${total.toLocaleString()}` +
  `${total === APPROVED_BUDGET ? ' — matches the approved budget.' : ` — does NOT match the approved budget ${APPROVED_BUDGET.toLocaleString()}.`}`);

await closeDb(db);
