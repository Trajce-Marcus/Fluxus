// The capture form's evaluation seam (2026-08-16), from the page host's side.
//
// What is under test is what the form relies on and React cannot show: a
// capture expression speaks `attributes`, and a dropdown's datasource may name
// a GET whose parameters come from what has been typed so far — which is the
// pairing that makes a dependent dropdown work without the browser holding
// records. The form's rendering is not tested here (no DOM harness in this
// package); the rounds loop itself is the engine's and is tested there.

import { describe, expect, it, vi } from 'vitest';
import { MemoryAdapter, evaluateWithGets, type ClientSolutionConfig, type GetQueryFn } from '@fluxus/engine';
import { evaluateCapture } from '../src/pageHost';
import type { CaptureScript } from '../src/capture/host';

const CONFIG: ClientSolutionConfig = {
  attributes: [
    { key: 'region', label: 'Region', description: 'Where the job is', type: 'text' },
    {
      key: 'crew',
      label: 'Crew',
      description: 'Who is going',
      type: 'list',
      type_config: { datasource: "invoke('act_get_crews', { region: attributes.region })" },
    },
  ],
  recordTypes: [
    {
      id: 'rt_work_orders',
      name: 'Work Orders',
      description: 'Jobs in the field',
      workflow_ref: 'wf_work_orders',
      custom_fields: [{ key: 'region', label: 'Region', description: 'Where', type: 'text' }],
    },
  ],
  workflows: [
    {
      id: 'wf_work_orders',
      name: 'Work Orders',
      description: 'The work order lifecycle',
      activities: [
        {
          id: 'act_dispatch',
          name: 'Dispatch',
          description: 'Send a crew',
          sort_order: 1,
          record_map: 'UPDATE',
          attributes: [{ attribute_ref: 'region' }, { attribute_ref: 'crew' }],
        },
        {
          id: 'act_get_crews',
          name: 'Get Crews',
          description: 'The crews working a region',
          sort_order: 2,
          record_map: 'GET',
          attributes: [{ attribute_ref: 'region', required: true }],
        },
      ],
    },
  ],
};

const script = (attributes: Record<string, unknown>): Omit<CaptureScript, 'invoke'> => ({
  attributes,
  anchorRecord: null,
  activity: { id: 'act_dispatch', name: 'Dispatch' },
});

const evaluate = (source: string, attributes: Record<string, unknown>, query?: GetQueryFn) =>
  evaluateWithGets(
    (invoke) => evaluateCapture(new MemoryAdapter(CONFIG), CONFIG, source, { ...script(attributes), invoke }),
    { query, label: 'Datasource' },
  );

describe('a capture expression', () => {
  it('reads what has been typed into the form', async () => {
    expect(await evaluate('attributes.region', { region: 'North' })).toBe('North');
  });

  it('reads an empty field as null, so `is not null` behaves before anything is filled', async () => {
    expect(await evaluate('attributes.region is null', { region: '' })).toBe(true);
  });
});

describe("a dropdown's datasource naming a GET", () => {
  it('asks the named activity with the parameters the form has so far', async () => {
    const query = vi.fn(async () => [{ id: 'crew_a', name: 'Crew A' }]);
    const options = await evaluate(
      CONFIG.attributes[1].type_config!.datasource!,
      { region: 'North' },
      query,
    );

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('act_get_crews', { region: 'North' }, undefined);
    expect(options).toEqual([{ id: 'crew_a', name: 'Crew A' }]);
  });

  it('re-asks with the new answer when the field it depends on changes', async () => {
    const query = vi.fn(async (_id: string, params: Record<string, unknown>) =>
      params.region === 'North' ? [{ id: 'crew_a' }] : [{ id: 'crew_z' }],
    );
    const source = CONFIG.attributes[1].type_config!.datasource!;

    expect(await evaluate(source, { region: 'North' }, query)).toEqual([{ id: 'crew_a' }]);
    expect(await evaluate(source, { region: 'South' }, query)).toEqual([{ id: 'crew_z' }]);
  });

  it('fails loudly on a host that cannot run activities, rather than showing an empty list', async () => {
    await expect(evaluate(CONFIG.attributes[1].type_config!.datasource!, { region: 'North' }))
      .rejects.toThrow(/cannot run activities/);
  });
});
