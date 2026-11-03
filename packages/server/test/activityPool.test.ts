// The activity pool (docs/APPS_AND_INSTANCES.md Part 1): activities stored once
// per solution, workflows listing them by reference — so one activity serves
// several record types. Covers §1.9's "done when" items that the server owns,
// and the rule that the migration's SQL and `toActivityPool` agree.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { toActivityPool, type SolutionModel } from '@fluxus/engine';
import { createDb, type Db } from '../src/db/client';
import { sdmActivities, sdmModelVersions, sdmWorkflows } from '../src/db/schema';
import { ensureOperation, ensureOrg, ensureSolution, getSolutionModel, listModelVersions, putModel, rollbackModel } from '../src/host';
import { appRouter } from '../src/router';

const SOL = 'test/pool';
const OP = 'test/pool';

const field = (key: string) => ({ key, type: 'text' });
const act = (id: string, record_map: 'CREATE' | 'UPDATE' | undefined, attributes: string[], extra: Record<string, unknown> = {}) => ({
  id, name: id, description: '', ...(record_map ? { record_map } : {}),
  attributes: attributes.map((attribute_ref) => ({ attribute_ref })),
  before_hook: null, after_hook: null, ...extra,
});

/** Two record types sharing one UPDATE (`act_note_items`), each with its own
 *  CREATE, and one activity in the pool that no workflow lists. */
const config = {
  attributes: [
    { key: 'name', label: 'Name', description: '', type: 'text' },
    { key: 'note', label: 'Note', description: '', type: 'text' },
  ],
  activities: [
    act('act_create_pumps', 'CREATE', ['name']),
    act('act_create_valves', 'CREATE', ['name']),
    act('act_note_items', 'UPDATE', ['note']),
    act('act_pool_only', 'UPDATE', ['note']),
  ],
  recordTypes: [
    { id: 'rt_pumps', name: 'Pumps', description: '', workflow_ref: 'wf_pumps', custom_fields: [field('name'), field('note')] },
    { id: 'rt_valves', name: 'Valves', description: '', workflow_ref: 'wf_valves', custom_fields: [field('name'), field('note')] },
    { id: 'rt_sites', name: 'Sites', description: '', workflow_ref: 'wf_sites', custom_fields: [field('name')] },
  ],
  workflows: [
    { id: 'wf_pumps', name: 'Pumps', description: '', activities: [{ activity_ref: 'act_create_pumps' }, { activity_ref: 'act_note_items' }] },
    { id: 'wf_valves', name: 'Valves', description: '', activities: [{ activity_ref: 'act_create_valves' }, { activity_ref: 'act_note_items' }] },
    { id: 'wf_sites', name: 'Sites', description: '', activities: [] },
  ],
} as unknown as SolutionModel;

let db: Db;
const caller = () => appRouter.createCaller({ db });

beforeEach(async () => {
  db = await createDb();
  await ensureOrg(db, 'default', 'Pool Org');
  await ensureSolution(db, SOL, 'Pool');
  await putModel(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Pool');
});

const run = (activityId: string, attributes: Record<string, unknown>, recordId?: string) =>
  caller().activities.run({ operationId: OP, activityId, attributes, recordId });

describe('one activity, two record types', () => {
  it('runs on a record of each, filling each type\'s field by exact key', async () => {
    const pump = (await run('act_create_pumps', { name: 'P1' })).recordId!;
    const valve = (await run('act_create_valves', { name: 'V1' })).recordId!;
    await run('act_note_items', { note: 'greased' }, pump);
    await run('act_note_items', { note: 'tightened' }, valve);
    const p = await caller().records.get({ operationId: OP, recordId: pump });
    const v = await caller().records.get({ operationId: OP, recordId: valve });
    expect(p.customFields.note).toBe('greased');
    expect(v.customFields.note).toBe('tightened');
    expect(p.activityHistory.at(-1)?.activityId).toBe('act_note_items');
  });

  it('is stored once, and each workflow keeps its reference', async () => {
    const stored = await getSolutionModel(db, SOL);
    expect(stored.activities.filter((a) => a.id === 'act_note_items')).toHaveLength(1);
    expect(stored.workflows.find((w) => w.id === 'wf_valves')?.activities)
      .toEqual([{ activity_ref: 'act_create_valves' }, { activity_ref: 'act_note_items' }]);
  });
});

describe('an activity no workflow lists', () => {
  it('is "not found" when run', async () => {
    const pump = (await run('act_create_pumps', { name: 'P2' })).recordId!;
    await expect(run('act_pool_only', { note: 'x' }, pump)).rejects.toThrow(/Activity not found: act_pool_only/);
  });

  it('cannot be invoked, which save says', async () => {
    const withInvoke = structuredClone(config);
    withInvoke.activities.find((a) => a.id === 'act_note_items')!.before_hook = "invoke('act_pool_only', {})";
    await expect(caller().model.put({ solutionId: SOL, model: withInvoke }))
      .rejects.toThrow(/invoke\('act_pool_only'\) — no workflow includes this activity/);
  });
});

// APPS_AND_INSTANCES §1.5, Part 2 step 1: only an activity that belongs to the
// record may run on it.
describe('the record-type check', () => {
  async function withSites() {
    await caller().model.putActivity({ solutionId: SOL, def: act('act_create_sites', 'CREATE', ['name']) });
    await caller().model.putActivity({ solutionId: SOL, def: act('act_log_pumps', undefined, []) });
    await caller().model.putWorkflow({ solutionId: SOL, def: { id: 'wf_sites', name: 'Sites', description: '', activities: [{ activity_ref: 'act_create_sites' }] } });
    await caller().model.putWorkflow({ solutionId: SOL, def: { id: 'wf_pumps', name: 'Pumps', description: '', activities: [{ activity_ref: 'act_create_pumps' }, { activity_ref: 'act_note_items' }, { activity_ref: 'act_log_pumps' }] } });
  }

  it('refuses an UPDATE on a record whose type\'s workflow does not list it, and writes nothing', async () => {
    await withSites();
    const site = (await run('act_create_sites', { name: 'S1' })).recordId!;
    await expect(run('act_note_items', { note: 'x' }, site))
      .rejects.toThrow(/'act_note_items' is not in rt_sites's workflow, so it cannot run on this record/);
    const s = await caller().records.get({ operationId: OP, recordId: site });
    expect(s.activityHistory.map((e) => e.activityId)).toEqual(['act_create_sites']);
  });

  it('refuses a log-only activity on a record of another type', async () => {
    await withSites();
    const valve = (await run('act_create_valves', { name: 'V3' })).recordId!;
    await expect(run('act_log_pumps', {}, valve)).rejects.toThrow(/'act_log_pumps' is not in rt_valves's workflow/);
  });

  it('still runs a shared activity on each type that lists it, and a log-only one on its own type', async () => {
    await withSites();
    const pump = (await run('act_create_pumps', { name: 'P3' })).recordId!;
    const valve = (await run('act_create_valves', { name: 'V4' })).recordId!;
    await run('act_note_items', { note: 'a' }, pump);
    await run('act_note_items', { note: 'b' }, valve);
    await run('act_log_pumps', {}, pump);
    const p = await caller().records.get({ operationId: OP, recordId: pump });
    expect(p.activityHistory.map((e) => e.activityId)).toEqual(['act_create_pumps', 'act_note_items', 'act_log_pumps']);
  });
});

describe('save refuses what the pool cannot mean', () => {
  it('a CREATE added to a second record type\'s workflow', async () => {
    await expect(caller().model.putWorkflow({
      solutionId: SOL,
      def: { id: 'wf_valves', name: 'Valves', description: '', activities: [{ activity_ref: 'act_create_valves' }, { activity_ref: 'act_create_pumps' }] },
    })).rejects.toThrow(/act_create_pumps: a CREATE belongs to one record type; this one is reached through rt_pumps, rt_valves/);
  });

  it('a shared activity whose script uses a field one of its types lacks, naming that type', async () => {
    const shared = structuredClone(config);
    shared.activities.find((a) => a.id === 'act_note_items')!.show_condition = "context.record.note != 'locked'";
    shared.workflows.find((w) => w.id === 'wf_sites')!.activities.push({ activity_ref: 'act_note_items' });
    const err = await caller().model.put({ solutionId: SOL, model: shared }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toMatch(/act_note_items show_condition \(on rt_sites\)/);
    expect(message).not.toMatch(/on rt_pumps|on rt_valves/);
  });

  it('a workflow listing one activity twice', async () => {
    await expect(caller().model.putWorkflow({
      solutionId: SOL,
      def: { id: 'wf_sites', name: 'Sites', description: '', activities: [{ activity_ref: 'act_pool_only' }, { activity_ref: 'act_pool_only' }] },
    })).rejects.toThrow(/lists activity 'act_pool_only' twice/);
  });
});

describe('putActivity / deleteActivity', () => {
  it('a new pool activity, then a workflow that lists it, runs', async () => {
    await caller().model.putActivity({ solutionId: SOL, def: act('act_rename_sites', 'UPDATE', ['name']) });
    await caller().model.putWorkflow({
      solutionId: SOL,
      def: { id: 'wf_sites', name: 'Sites', description: '', activities: [{ activity_ref: 'act_rename_sites' }] },
    });
    expect((await getSolutionModel(db, SOL)).activities.map((a) => a.id)).toContain('act_rename_sites');
  });

  it('refuses to delete one a workflow still lists, naming each workflow', async () => {
    const err = await caller().model.deleteActivity({ solutionId: SOL, id: 'act_note_items' }).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/workflow 'wf_pumps': activity 'act_note_items' is not in the activity pool/);
    expect((err as Error).message).toMatch(/workflow 'wf_valves'/);
    expect((await getSolutionModel(db, SOL)).activities.map((a) => a.id)).toContain('act_note_items');
  });

  it('deletes one no workflow lists', async () => {
    await caller().model.deleteActivity({ solutionId: SOL, id: 'act_pool_only' });
    expect((await getSolutionModel(db, SOL)).activities.map((a) => a.id)).not.toContain('act_pool_only');
  });
});

// ── The shape before the pool ────────────────────────────────────────────────

/** The same model as stored before 2026-10-04: activities nested in their
 *  workflows, ordered by sort_order — deliberately out of array order here —
 *  and the shared one present in both workflows, identically. */
const nested = {
  attributes: config.attributes,
  recordTypes: config.recordTypes,
  workflows: [
    { id: 'wf_pumps', name: 'Pumps', description: '', activities: [
      { ...act('act_note_items', 'UPDATE', ['note']), sort_order: 2 },
      { ...act('act_create_pumps', 'CREATE', ['name']), sort_order: 1 },
    ] },
    { id: 'wf_valves', name: 'Valves', description: '', activities: [
      { ...act('act_create_valves', 'CREATE', ['name']), sort_order: 0 },
      // No sort_order: sorts last.
      act('act_note_items', 'UPDATE', ['note']),
    ] },
    { id: 'wf_sites', name: 'Sites', description: '', activities: [] },
  ],
};

const conflicting = structuredClone(nested);
(conflicting.workflows[1].activities[1] as { name: string }).name = 'Something else';

const byId = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));

describe('a model in the old shape', () => {
  it('imports, converted: one pool activity per id, references in sort_order order', async () => {
    await caller().model.put({ solutionId: SOL, model: nested });
    const stored = await getSolutionModel(db, SOL);
    expect(stored.activities.map((a) => a.id).sort()).toEqual(['act_create_pumps', 'act_create_valves', 'act_note_items']);
    expect(stored.activities.some((a) => 'sort_order' in a)).toBe(false);
    expect(stored.workflows.find((w) => w.id === 'wf_pumps')?.activities)
      .toEqual([{ activity_ref: 'act_create_pumps' }, { activity_ref: 'act_note_items' }]);
  });

  it('is refused on import when one id has two definitions, naming the id', async () => {
    await expect(caller().model.put({ solutionId: SOL, model: conflicting }))
      .rejects.toThrow(/Activity 'act_note_items' is defined differently in two workflows/);
  });

  it('rolls back from a version published before the pool, storing the converted model', async () => {
    await db.insert(sdmModelVersions).values({ solutionId: SOL, version: 1, model: nested as never, readme: 'old', publishedBy: 'x' });
    const { version } = await rollbackModel(db, SOL, 1, 'Rollback to v1', 'x');
    expect(version).toBe(2);
    const [v2] = await db.select().from(sdmModelVersions).where(sql`${sdmModelVersions.solutionId} = ${SOL} AND ${sdmModelVersions.version} = 2`);
    expect((v2.model as SolutionModel).activities.map((a) => a.id).sort()).toEqual(['act_create_pumps', 'act_create_valves', 'act_note_items']);
    expect((await getSolutionModel(db, SOL)).workflows.find((w) => w.id === 'wf_valves')?.activities)
      .toEqual([{ activity_ref: 'act_create_valves' }, { activity_ref: 'act_note_items' }]);
  });

  it('refuses a rollback whose old snapshot defines one id two ways', async () => {
    await db.insert(sdmModelVersions).values({ solutionId: SOL, version: 1, model: conflicting as never, readme: 'old', publishedBy: 'x' });
    await expect(rollbackModel(db, SOL, 1, 'Rollback to v1', 'x')).rejects.toThrow(/act_note_items/);
    expect((await listModelVersions(db, SOL)).map((v) => v.version)).toEqual([1]);
  });
});

// The migration's SQL and `toActivityPool` state the same rules twice
// (APPS_AND_INSTANCES §1.2); one fixture runs through both.
describe('migration 0022 and toActivityPool agree', () => {
  const migration = readFileSync(fileURLToPath(new URL('../migrations/0022_activity_pool.sql', import.meta.url)), 'utf8');
  const moveStatement = migration.split('--> statement-breakpoint')[1];

  async function seedNested(model: typeof nested) {
    await ensureSolution(db, 'test/old', 'Old');
    for (const wf of model.workflows) {
      await db.insert(sdmWorkflows).values({ solutionId: 'test/old', id: wf.id, def: wf as never });
    }
  }

  it('produces the same pool and the same references', async () => {
    await seedNested(nested);
    await db.execute(sql.raw(moveStatement));

    const pool = (await db.select().from(sdmActivities).where(eq(sdmActivities.solutionId, 'test/old'))).map((r) => r.def);
    const workflows = (await db.select().from(sdmWorkflows).where(eq(sdmWorkflows.solutionId, 'test/old'))).map((r) => r.def);
    const converted = toActivityPool(nested as unknown as SolutionModel);

    expect(byId(pool)).toEqual(byId(converted.activities));
    expect(byId(workflows)).toEqual(byId(converted.workflows));
  });

  it('both refuse one id defined two ways', async () => {
    await seedNested(conflicting);
    const err = await db.execute(sql.raw(moveStatement)).then(() => null, (e: Error) => e);
    expect(String((err as { cause?: unknown })?.cause ?? err)).toMatch(/act_note_items/);
    expect(() => toActivityPool(conflicting as unknown as SolutionModel)).toThrow(/act_note_items/);
  });
});
