// Headless acceptance tests for the DSL ↔ SDM wiring:
// real config, real LocalStorageAdapter (localStorage shimmed), real evaluator.
// Phase 1: the city → suburb dependent datasource.
// Phase 2: the Complete Work Order hook pair (before gate, after effects).

import { describe, it, expect, beforeAll } from 'vitest';
import { evaluateExpression, executeScript, FluxFailError } from '@fluxus/dsl';

// LocalStorageAdapter touches localStorage at construction — shim before import
beforeAll(() => {
  const bag = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => bag.get(k) ?? null,
    setItem: (k: string, v: string) => void bag.set(k, v),
    removeItem: (k: string) => void bag.delete(k),
    clear: () => bag.clear(),
    key: (i: number) => [...bag.keys()][i] ?? null,
    get length() { return bag.size; },
  } as Storage;
});

async function setup() {
  const { config } = await import('../src/config');
  const { LocalStorageAdapter } = await import('../src/store/LocalStorageAdapter');
  const { buildEvalHost } = await import('../src/dsl/bridge');
  const { validateConfig } = await import('../src/dsl/validateConfig');
  const adapter = new LocalStorageAdapter(config);
  return { config, adapter, buildEvalHost, validateConfig };
}

describe('DSL ↔ SDM wiring', () => {
  it('every FluxScript expression in the shipped config validates clean', async () => {
    const { config, validateConfig } = await setup();
    expect(validateConfig(config)).toEqual([]);
  });

  it('seeds load cities and suburbs into an empty store', async () => {
    const { config, adapter } = await setup();
    expect(adapter.getRecordTypeData('rt_cities').length).toBe(3);
    expect(adapter.getRecordTypeData('rt_suburbs').length).toBe(6);
    expect(config.seeds?.length).toBe(2);
  });

  it('city datasource lists all cities ordered by name', async () => {
    const { config, adapter, buildEvalHost } = await setup();
    const host = buildEvalHost(adapter, config, { attributes: {} });
    const names = evaluateExpression(
      'records.cities.orderBy(name).top(50).values(name)', host);
    expect(names).toEqual(['Brisbane', 'Melbourne', 'Sydney']);
  });

  it('ACCEPTANCE: suburb datasource depends on the selected city via attrs', async () => {
    const { config, adapter, buildEvalHost } = await setup();
    const datasource = "records.suburbs.where(city_id = attributes.city).orderBy(name).top(50)";

    const sydney = evaluateExpression(datasource,
      buildEvalHost(adapter, config, { attributes: { city: 'c_syd' } })) as { fields: { name: string } }[];
    expect(sydney.map(s => s.fields.name)).toEqual(['Manly', 'Newtown', 'Parramatta']);

    const melbourne = evaluateExpression(datasource,
      buildEvalHost(adapter, config, { attributes: { city: 'c_mel' } })) as { fields: { name: string } }[];
    expect(melbourne.map(s => s.fields.name)).toEqual(['Fitzroy', 'St Kilda']);
  });

  it('show_condition: suburb hidden until a city is chosen (empty string reads as null)', async () => {
    const { config, adapter, buildEvalHost } = await setup();
    const condition = 'attributes.city is not null';
    expect(evaluateExpression(condition, buildEvalHost(adapter, config, { attributes: { city: '' } }))).toBe(false);
    expect(evaluateExpression(condition, buildEvalHost(adapter, config, { attributes: { city: 'c_syd' } }))).toBe(true);
  });

  it('attribute validation rule: completed_date must not be in the future', async () => {
    const { config, adapter, buildEvalHost } = await setup();
    const { coerceValue } = await import('../src/dsl/bridge');
    const rule = 'value <= now()';
    const check = (raw: string) =>
      evaluateExpression(rule, buildEvalHost(adapter, config, {
        attributes: {},
        extras: { value: coerceValue('date', raw) },
      }));
    expect(check('2020-01-01')).toBe(true);
    expect(check('2099-01-01')).toBe(false);
  });

  it('FK auto-deref works through the bridge (suburb → city name)', async () => {
    const { config, adapter, buildEvalHost } = await setup();
    const host = buildEvalHost(adapter, config, { attributes: {} });
    expect(evaluateExpression(
      "records.suburbs.where(name = 'Manly').first.city_id.name", host)).toBe('Sydney');
  });

  it('reverse-FK navigation works through the bridge (city → suburbs)', async () => {
    const { config, adapter, buildEvalHost } = await setup();
    const host = buildEvalHost(adapter, config, { attributes: {} });
    expect(evaluateExpression(
      "records.cities.where(name = 'Sydney').first.suburbs.count", host)).toBe(3);
  });
});

describe('DSL Phase 2 — hooks through the SDM wiring', () => {
  it('ACCEPTANCE: Complete Work Order — before gate warns/fails, after hook moves status', async () => {
    const { config, adapter, buildEvalHost } = await setup();
    const workflow = adapter.getRecordTypeDef('rt_work_orders').workflow;
    const complete = workflow.activities.find(a => a.id === 'act_complete_work_orders')!;
    expect(typeof complete.before_hook).toBe('string'); // line arrays joined on load
    expect(typeof complete.after_hook).toBe('string');

    const wo = adapter.createRecord('rt_work_orders', {
      id: 'WO-P2', job_id: 'j1', activity_code: 'AC1', status: 'Raised',
    });

    // before hook (gate, read-only): passes but warns — the WO was never started
    const gate = executeScript(
      complete.before_hook!,
      buildEvalHost(adapter, config, { attributes: {}, anchorRecord: wo }),
      { mode: 'read' },
    );
    expect(gate.warnings).toEqual(['Completing a work order that was never started']);

    // after hook (effects): status moves via the staged, atomic commit;
    // the captured date attribute persists as a plain date string
    executeScript(
      complete.after_hook!,
      buildEvalHost(adapter, config, {
        attributes: { completed_date: new Date('2026-07-01T00:00:00') },
        anchorRecord: wo,
      }),
      { mode: 'mutate' },
    );
    const updated = adapter.getRecord('WO-P2');
    expect(updated.customFields.status).toBe('Completed');
    expect(updated.customFields.completed_date).toBe('2026-07-01');

    // "already completed" is availability, not payload validation: the
    // activity's show_condition (not the before hook) now says no
    expect(evaluateExpression(
      complete.show_condition!,
      buildEvalHost(adapter, config, { anchorRecord: updated }),
    )).toBe(false);
  });

  it('before hooks cannot mutate, even if a script tries', async () => {
    const { config, adapter, buildEvalHost } = await setup();
    const wo = adapter.createRecord('rt_work_orders', {
      id: 'WO-P2-RO', job_id: 'j1', activity_code: 'AC1', status: 'Raised',
    });
    expect(() =>
      executeScript(
        "context.record.update({ status: 'Hacked' })",
        buildEvalHost(adapter, config, { attributes: {}, anchorRecord: wo }),
        { mode: 'read' },
      ),
    ).toThrow(/after hooks only/);
    expect(adapter.getRecord('WO-P2-RO').customFields.status).toBe('Raised');
  });

  it('a failing after hook applies nothing (transaction)', async () => {
    const { config, adapter, buildEvalHost } = await setup();
    const wo = adapter.createRecord('rt_work_orders', {
      id: 'WO-P2-TX', job_id: 'j1', activity_code: 'AC1', status: 'Raised',
    });
    expect(() =>
      executeScript(
        `context.record.update({ status: 'Half done' })
         fail('abort')`,
        buildEvalHost(adapter, config, { attributes: {}, anchorRecord: wo }),
        { mode: 'mutate' },
      ),
    ).toThrow(FluxFailError);
    expect(adapter.getRecord('WO-P2-TX').customFields.status).toBe('Raised');
  });

  it('can_waive carries through usage resolution (serial_no on Create Asset)', async () => {
    const { adapter } = await setup();
    const create = adapter.getRecordTypeDef('rt_assets').workflow.activities
      .find(a => a.id === 'act_create_assets')!;
    const serial = create.attributes.find(a => a.key === 'serial_no')!;
    expect(serial.required).toBe(true);
    expect(serial.can_waive).toBe(true);
    // and only where the usage asks for it
    const update = adapter.getRecordTypeDef('rt_assets').workflow.activities
      .find(a => a.id === 'act_update_assets')!;
    expect(update.attributes.find(a => a.key === 'serial_no')!.can_waive).toBeUndefined();
  });

  it('activity-level show_condition: availability flips on record state', async () => {
    const { config, adapter, buildEvalHost } = await setup();
    const workflow = adapter.getRecordTypeDef('rt_work_orders').workflow;

    // carried through workflow resolution onto the ActivityDef
    const complete = workflow.activities.find(a => a.id === 'act_complete_work_orders')!;
    const update = workflow.activities.find(a => a.id === 'act_update_work_orders')!;
    expect(complete.show_condition).toBe("context.record.status <> 'Completed'");
    expect(update.show_condition).toBe("context.record.status <> 'Completed'");

    const wo = adapter.createRecord('rt_work_orders', {
      id: 'WO-AVAIL', job_id: 'j1', activity_code: 'AC1', status: 'Raised',
    });
    const available = (anchorRecord: typeof wo) =>
      evaluateExpression(complete.show_condition!, buildEvalHost(adapter, config, { anchorRecord })) === true;

    expect(available(wo)).toBe(true);
    adapter.updateRecord('WO-AVAIL', { status: 'Completed' });
    expect(available(adapter.getRecord('WO-AVAIL'))).toBe(false);
  });

  it('activity show_condition may not reference attributes (validated at config load)', async () => {
    const { config, validateConfig } = await setup();
    const broken = structuredClone(config);
    const wf = broken.workflows.find(w => w.id === 'wf_work_orders')!;
    wf.activities.find(a => a.id === 'act_update_work_orders')!.show_condition =
      'attributes.status is not null';
    const findings = validateConfig(broken);
    expect(findings.map(f => `${f.where}: ${f.diagnostic.message}`)).toEqual([
      "act_update_work_orders show_condition: 'attributes' is not available at this embedding point",
    ]);
  });

  it('named functions from the config are callable in expressions', async () => {
    const { config, adapter, buildEvalHost } = await setup();
    adapter.createRecord('rt_work_orders', {
      id: 'WO-P2-FN', job_id: 'j1', activity_code: 'AC1', status: 'Raised', workgroup_id: 'wg_fn',
    });
    const host = buildEvalHost(adapter, config, { attributes: {} });
    expect(evaluateExpression("openWorkOrders('wg_fn').count", host)).toBe(1);
    expect(evaluateExpression("openWorkOrders('wg_other').count", host)).toBe(0);
  });
});
