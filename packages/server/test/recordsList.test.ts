// `records.list` for the Console's workbench (CONSOLE_RECORD_FETCHING §2):
// one type's rows with no history, the labels their references show instead
// of the records behind them, and a filter on one reference field for the
// related records panel.

import { beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client';
import { ensureOperation, ensureSolution, putModel } from '../src/host';
import { appRouter } from '../src/router';
import { records } from '../src/db/schema';
import { APPS_RECORD_TYPE, type SolutionModel } from '@fluxus/engine';

const SOL = 'test/records-list';
const OP = 'test/records-list';

const fk = (key: string, target: string) => ({ key, type: 'fk_ref', fk_record_type: target, fk_display_field: 'name' });
const type = (id: string, fields: object[]) =>
  ({ id, name: id, description: '', workflow_ref: `wf_${id}`, custom_fields: [{ key: 'name', type: 'text' }, ...fields] });

const config: SolutionModel = {
  attributes: [],
  activities: [],
  recordTypes: [
    type('rt_areas', []),
    type('rt_jobs', []),
    type('rt_findings', [fk('area', 'rt_areas'), fk('job', 'rt_jobs'), fk('app', APPS_RECORD_TYPE)]),
  ] as never,
  workflows: ['rt_areas', 'rt_jobs', 'rt_findings']
    .map((id) => ({ id: `wf_${id}`, name: id, description: '', activities: [] })),
};

let db: Db;
const open = () => appRouter.createCaller({ db });
const row = (id: string, typeRef: string, customFields: Record<string, unknown>) =>
  ({ operationId: OP, id, typeRef, customFields, activityHistory: [{ activityId: 'act_x', activityName: 'X', timestamp: '2026-11-09T00:00:00Z', author: 'a', attributes: {} }] as never });

beforeAll(async () => {
  db = await createDb();
  await ensureSolution(db, SOL, 'Records list');
  await putModel(db, SOL, config);
  await ensureOperation(db, OP, SOL, 'Records list');
  await db.insert(records).values([
    row('K1', 'rt_areas', { name: 'Kitchen' }),
    row('J1', 'rt_jobs', { name: 'J-0001' }),
    row('APP1', APPS_RECORD_TYPE, { label: 'Secret app' }),
    // F1 points at an area, a job and an app; F2 at a missing area and, by
    // the wrong field, a job; F3 at nothing.
    row('F1', 'rt_findings', { name: 'F1', area: 'K1', job: 'J1', app: 'APP1' }),
    row('F2', 'rt_findings', { name: 'F2', area: 'NO_SUCH', job: 'K1' }),
    row('F3', 'rt_findings', { name: 'F3' }),
  ]);
});

describe('records.list — one type, for the workbench', () => {
  it('sends rows without their history', async () => {
    const { rows } = await open().records.list({ operationId: OP, typeId: 'rt_findings' });
    expect(rows.map((r) => r.id).sort()).toEqual(['F1', 'F2', 'F3']);
    for (const r of rows) expect(r.activityHistory).toEqual([]);
  });

  it('labels each reference with its target\'s display field, and only where the target is the field\'s type and no app', async () => {
    const { labels } = await open().records.list({ operationId: OP, typeId: 'rt_findings' });
    expect(labels).toEqual(expect.arrayContaining([
      { id: 'K1', typeRef: 'rt_areas', field: 'name', label: 'Kitchen' },
      { id: 'J1', typeRef: 'rt_jobs', field: 'name', label: 'J-0001' },
    ]));
    // No label for a missing target (F2.area), one of the wrong type (F2.job →
    // an area), or an operation's app (F1.app).
    expect(labels).toHaveLength(2);
  });

  it('narrows to the rows whose reference field holds a value', async () => {
    const { rows } = await open().records.list({ operationId: OP, typeId: 'rt_findings', fieldKey: 'area', value: 'K1' });
    expect(rows.map((r) => r.id)).toEqual(['F1']);
  });

  it('refuses a filter on a field that is not a reference of the type', async () => {
    await expect(open().records.list({ operationId: OP, typeId: 'rt_findings', fieldKey: 'name', value: 'F1' }))
      .rejects.toThrow(/not a reference field/);
    await expect(open().records.list({ operationId: OP, typeId: 'rt_findings', fieldKey: 'nope', value: 'x' }))
      .rejects.toThrow(/not a reference field/);
  });
});
