// DSL Phase 4 acceptance: the demo SDM served headless over the real stack —
// tRPC router → validateSubmission → the one engine pipeline → PGlite
// (in-memory Postgres) with the synchronous reporting projection. The
// acceptance case mirrors the workbench's: create a work order, complete it
// (warn soft-stop → acknowledge → status moves, notify queues), and the
// normalized reporting rows exist.

import { beforeAll, describe, expect, it } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createDb, type Db } from '../src/db/client';
import { putConfig } from '../src/host';
import { appRouter, DEFAULT_SCOPE } from '../src/router';
import { records, rptActivities, rptAttributes } from '../src/db/schema';
import type { NotificationEvent, NotifySink } from '../src/services/notify';
import { config } from '../../sdm/src/config';

let db: Db;
const notifications: NotificationEvent[] = [];
const sink: NotifySink = { append: (event) => notifications.push(event) };
const caller = () => appRouter.createCaller({ db, sink });

// queue-dispatched service effects resolve on the microtask queue after the
// mutation returns — drain it before asserting on the sink.
const drainQueue = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(async () => {
  db = await createDb(); // in-memory PGlite
  // The demo SDM ships no job/workgroup seeds, and a work order's job_id is a
  // required FK — seed the anchors the acceptance flow hangs off (seeds are
  // config, not a write path around activities).
  const cfg = structuredClone(config);
  cfg.seeds = [
    ...(cfg.seeds ?? []),
    {
      typeId: 'rt_jobs',
      records: [{
        id: 'JOB-1',
        fields: { id: 'JOB-1', job_no: 'J-100', job_type: 'Inspection', status: 'Raised', location: 'Depot', due_date: '2026-08-01', contract_id: '' },
      }],
    },
    {
      typeId: 'rt_workgroups',
      records: [{ id: 'WG-1', fields: { id: 'WG-1', name: 'Crew A' } }],
    },
  ];
  await putConfig(db, DEFAULT_SCOPE, cfg, sink);
});

describe('config storage', () => {
  it('serves the stored config back', async () => {
    const stored = await caller().config.get({});
    expect(stored.recordTypes.map((rt) => rt.id)).toContain('rt_work_orders');
  });

  it('seeded the demo records for empty types', async () => {
    const cities = await caller().records.list({ typeId: 'rt_cities' });
    expect(cities.length).toBeGreaterThan(0);
  });

  it('rejects an invalid SDM at save time', async () => {
    const broken = structuredClone(config);
    broken.workflows[0].activities[0].before_hook = 'records.nonexistent_type.count() > 0';
    await expect(caller().config.put({ scope: 'demo/broken', config: broken })).rejects.toThrow(/SDM config rejected/);
  });
});

describe('page storage (opaque defs on the config pipeline)', () => {
  it('put/list/delete round-trips a page def, upsert included', async () => {
    expect(await caller().pages.list({})).toEqual([]);
    await caller().pages.put({ path: 'pages/a', def: { contextSchema: [] } });
    await caller().pages.put({ path: 'pages/a', def: { contextSchema: [{ key: 'k', type: 'string' }] } });
    await caller().pages.put({ path: 'pages/b', def: {} });
    const listed = await caller().pages.list({});
    expect(listed.map((p) => p.path).sort()).toEqual(['pages/a', 'pages/b']);
    expect(listed.find((p) => p.path === 'pages/a')?.def).toEqual({ contextSchema: [{ key: 'k', type: 'string' }] });
    await caller().pages.delete({ path: 'pages/b' });
    expect((await caller().pages.list({})).map((p) => p.path)).toEqual(['pages/a']);
  });

  it('partitions pages by scope', async () => {
    expect(await caller().pages.list({ scope: 'demo/other' })).toEqual([]);
  });
});

describe('headless activity invocation', () => {
  const woId = 'WO-9001';

  it('CREATE: the attribute list is the parameter signature', async () => {
    const result = await caller().activities.run({
      activityId: 'act_create_work_orders',
      attributes: {
        id: woId,
        job_id: 'JOB-1',
        workgroup_id: 'WG-1',
        activity_code: 'MNT',
        problem_code: 'LEAK',
        location: 'Pump station 4',
        due_date: '2026-08-01',
      },
    });
    expect(result.status).toBe('done');
    expect(result.recordId).toBe(woId);

    const stored = await caller().records.get({ recordId: woId });
    expect(stored.customFields.location).toBe('Pump station 4');
    expect(stored.activityHistory).toHaveLength(1);
  });

  it('rejects an unknown attribute key', async () => {
    await expect(
      caller().activities.run({
        activityId: 'act_create_work_orders',
        attributes: { id: 'WO-9002', bogus_key: 'x' },
      }),
    ).rejects.toThrow(/Unknown attribute 'bogus_key'/);
  });

  it('rejects a dangling reference (no such job)', async () => {
    await expect(
      caller().activities.run({
        activityId: 'act_create_work_orders',
        attributes: { id: 'WO-9003', job_id: 'JOB-NOPE', activity_code: 'MNT' },
      }),
    ).rejects.toThrow(/no jobs record 'JOB-NOPE'/);
  });

  it('rejects a validation-rule breach (completed date in the future)', async () => {
    await expect(
      caller().activities.run({
        activityId: 'act_complete_work_orders',
        recordId: woId,
        attributes: { completed_date: '2999-01-01' },
      }),
    ).rejects.toThrow(/Completed date cannot be in the future/);
  });

  it('rejects a datasource miss (suburb not in the selected city)', async () => {
    const cities = await caller().records.list({ typeId: 'rt_cities' });
    const suburbs = await caller().records.list({ typeId: 'rt_suburbs' });
    const city = cities[0];
    const foreignSuburb = suburbs.find((s) => s.customFields.city_id !== city.id);
    expect(foreignSuburb).toBeDefined();
    await expect(
      caller().activities.run({
        activityId: 'act_set_location_work_orders',
        recordId: woId,
        attributes: { city: city.id, suburb: foreignSuburb!.id },
      }),
    ).rejects.toThrow(/is not in the datasource/);
  });

  it('accepts a datasource hit and writes both fields', async () => {
    const cities = await caller().records.list({ typeId: 'rt_cities' });
    const city = cities[0];
    const suburbs = await caller().records.list({ typeId: 'rt_suburbs' });
    const suburb = suburbs.find((s) => s.customFields.city_id === city.id);
    expect(suburb).toBeDefined();
    const result = await caller().activities.run({
      activityId: 'act_set_location_work_orders',
      recordId: woId,
      attributes: { city: city.id, suburb: suburb!.id },
    });
    expect(result.status).toBe('done');
    const stored = await caller().records.get({ recordId: woId });
    expect(stored.customFields.suburb).toBe(suburb!.id);
  });

  it('soft-stops on a gate warn() without persisting, then completes on acknowledgement', async () => {
    // Never started → the before hook warns.
    const first = await caller().activities.run({
      activityId: 'act_complete_work_orders',
      recordId: woId,
      attributes: { completed_date: '2026-07-12' },
    });
    expect(first.status).toBe('needs-confirmation');
    expect(first.warnings.join(' ')).toMatch(/never started/);

    // Nothing persisted: no new history entry.
    const before = await caller().records.get({ recordId: woId });
    expect(before.activityHistory.filter((e) => e.activityId === 'act_complete_work_orders')).toHaveLength(0);
    expect(before.customFields.status).not.toBe('Completed');

    const second = await caller().activities.run({
      activityId: 'act_complete_work_orders',
      recordId: woId,
      attributes: { completed_date: '2026-07-12' },
      acknowledgedWarnings: true,
    });
    expect(second.status).toBe('done');
    await drainQueue();

    // Records are never edited directly — status moved via the after hook.
    const after = await caller().records.get({ recordId: woId });
    expect(after.customFields.status).toBe('Completed');
    expect(after.customFields.completed_date).toBe('2026-07-12');

    // queue services.notify.user dispatched post-commit into the server sink.
    expect(notifications.some((n) => n.channel === 'user' && n.message.includes(woId))).toBe(true);

    // Acknowledged gate warnings ride the entry.
    const entry = after.activityHistory.find((e) => e.activityId === 'act_complete_work_orders');
    expect(entry?.warnings?.join(' ')).toMatch(/never started/);
  });

  it('enforces the availability gate headless (completed work orders cannot re-complete)', async () => {
    await expect(
      caller().activities.run({
        activityId: 'act_complete_work_orders',
        recordId: woId,
        attributes: { completed_date: '2026-07-12' },
        acknowledgedWarnings: true,
      }),
    ).rejects.toThrow(/not available/);
  });
});

describe('composite attributes (MR014 checklist, staged)', () => {
  const clId = 'etp_001'; // seeded with status 'Raised'

  it('enforces stage order: pre-start is unavailable while status is Raised', async () => {
    // Payload is valid (validateSubmission passes) — the availability gate
    // inside runActivity is what rejects the out-of-order stage.
    await expect(
      caller().activities.run({
        activityId: 'act_complete_prestart_inspection_checklists',
        recordId: clId,
        attributes: {
          'fixtures_removed.ok': 'TT',
          'prestart_protection.ok': 'TT',
          'temp_power_installed.ok': 'TT',
          signoff_name: 'T',
          signoff_signature: 'T',
          signoff_date: '2026-07-18',
        },
      }),
    ).rejects.toThrow(/not available/);
  });

  it('rejects a missing required cell, an unknown cell path, and a value for a section marker', async () => {
    await expect(
      caller().activities.run({
        activityId: 'act_complete_preliminaries_inspection_checklists',
        recordId: clId,
        attributes: { signoff_name: 'T', signoff_signature: 'T', signoff_date: '2026-07-18' },
      }),
    ).rejects.toThrow(/Access permission obtained — Initialled\/OK is required/);

    await expect(
      caller().activities.run({
        activityId: 'act_complete_preliminaries_inspection_checklists',
        recordId: clId,
        attributes: { 'access_permission.bogus': 'x' },
      }),
    ).rejects.toThrow(/Unknown attribute 'access_permission.bogus'/);
  });

  it('accepts nested cells with a per-cell waiver; entry nests, status advances', async () => {
    const result = await caller().activities.run({
      activityId: 'act_complete_preliminaries_inspection_checklists',
      recordId: clId,
      attributes: {
        access_permission: { ok: 'TT', ref: 'SWMS-04' },
        access_obtained: { ok: 'TT' },
        equip_scaffold: { ok: 'TT' },
        equip_signage: { ok: 'TT' },
        materials_approved: { ok: 'TT', comment: 'All on site' },
        signoff_name: 'T. Tosevski',
        signoff_signature: 'TT',
        signoff_date: '2026-07-18',
      },
      waived: { 'equip_other.ok': 'No other equipment required' },
    });
    expect(result.status).toBe('done');

    const stored = await caller().records.get({ recordId: clId });
    expect(stored.customFields.status).toBe('Preliminaries Complete');
    const entry = stored.activityHistory.at(-1)!;
    expect(entry.capturedAttributes.access_permission).toEqual({ ok: 'TT', ref: 'SWMS-04' });
    expect(entry.capturedAttributes.equip_other).toBeUndefined(); // waived cell, no others captured
    expect(entry.waived).toEqual({ 'equip_other.ok': 'No other equipment required' });
  });

  it('accepts dotted-flat cells too, and projects one rpt row per cell', async () => {
    const result = await caller().activities.run({
      activityId: 'act_complete_prestart_inspection_checklists',
      recordId: clId,
      attributes: {
        'fixtures_removed.ok': 'TT',
        'prestart_protection.ok': 'TT',
        signoff_name: 'T. Tosevski',
        signoff_signature: 'TT',
        signoff_date: '2026-07-18',
      },
      waived: { 'temp_power_installed.ok': 'No temporary power needed' },
    });
    expect(result.status).toBe('done');

    const runs = await db
      .select()
      .from(rptActivities)
      .where(and(eq(rptActivities.scope, DEFAULT_SCOPE), eq(rptActivities.recordId, clId)));
    const prelim = runs.find((r) => r.activityId === 'act_complete_preliminaries_inspection_checklists')!;
    const attrs = await db.select().from(rptAttributes).where(eq(rptAttributes.activityRowId, prelim.id));
    const byKey = new Map(attrs.map((a) => [a.key, a]));
    // One row per cell, dotted path key, uniform text value column.
    expect(byKey.get('access_permission.ok')?.value).toBe('TT');
    expect(byKey.get('materials_approved.comment')?.value).toBe('All on site');
    // The waived cell is the same-shaped row: value null + waive_desc.
    const waivedRow = byKey.get('equip_other.ok')!;
    expect(waivedRow.value).toBeNull();
    expect(waivedRow.waiveDesc).toBe('No other equipment required');
  });
});

describe('reporting projection (synchronous, normalized)', () => {
  it('wrote one rpt_activities row per committed run with rpt_attributes rows', async () => {
    const runs = await db
      .select()
      .from(rptActivities)
      .where(and(eq(rptActivities.scope, DEFAULT_SCOPE), eq(rptActivities.recordId, 'WO-9001')));
    // create + set_location + complete — the rejected/soft-stopped runs left no rows.
    expect(runs.map((r) => r.activityId).sort()).toEqual([
      'act_complete_work_orders',
      'act_create_work_orders',
      'act_set_location_work_orders',
    ]);

    const complete = runs.find((r) => r.activityId === 'act_complete_work_orders')!;
    const attrs = await db.select().from(rptAttributes).where(eq(rptAttributes.activityRowId, complete.id));
    const byKey = new Map(attrs.map((a) => [a.key, a]));
    // Uniform text values: key = 'completed_date' AND value = '2026-07-12'.
    expect(byKey.get('completed_date')?.value).toBe('2026-07-12');
    // Acknowledged gate warnings are a system-produced attribute row.
    expect(byKey.get('system_warnings')?.value).toMatch(/never started/);
  });

  it('kept the transactional row in the RecordInstance shape (history embedded)', async () => {
    const rows = await db
      .select()
      .from(records)
      .where(and(eq(records.scope, DEFAULT_SCOPE), eq(records.id, 'WO-9001')));
    expect(rows).toHaveLength(1);
    expect(rows[0].activityHistory.length).toBe(3);
  });
});
