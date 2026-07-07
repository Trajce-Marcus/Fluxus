// Headless acceptance test for the DSL ↔ SDM wiring (Phase 1 final step):
// real config, real LocalStorageAdapter (localStorage shimmed), real evaluator.
// The city → suburb dependent datasource is the acceptance case.

import { describe, it, expect, beforeAll } from 'vitest';
import { evaluateExpression } from '@fluxus/dsl';

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
