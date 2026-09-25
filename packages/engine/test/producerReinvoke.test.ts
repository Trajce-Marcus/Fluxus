// DATA_THROUGH_ACTIVITIES step 4 — an input names a GET as its producer, and
// the engine re-runs that GET when the submission arrives.
//
// The mechanism is not new: a list attribute's `datasource` has always been
// re-evaluated server-side by validateSubmission, and failing closed there is
// the established posture ("the datasource IS the validation here"). What step
// 4 adds is that the datasource may now be `invoke('act_get_…', …)` — so the
// set comes from an activity, with the activity's own gate deciding it, rather
// than from an expression spelled out beside the input.

import { describe, expect, it } from 'vitest';
import { createEngine } from '../src/engine';
import { MemoryAdapter } from '../src/MemoryAdapter';
import { validateSubmission } from '../src/validateSubmission';
import type { ActivityDef, SolutionConfig } from '../src/types';

/** A model whose dispatch activity takes its crew list from a GET. */
function buildConfig(overrides: { returns?: string; gate?: string | null } = {}): SolutionConfig {
  return {
    attributes: [
      { key: 'region', label: 'Region', description: '', type: 'text' },
      {
        key: 'crew',
        label: 'Crew',
        description: '',
        type: 'list',
        // The producer, named rather than spelled out.
        type_config: { datasource: "invoke('act_get_crews', { region: attributes.region })" },
      },
    ],
    recordTypes: [
      {
        id: 'rt_jobs',
        name: 'Jobs',
        description: '',
        workflow_ref: 'wf_jobs',
        custom_fields: [{ key: 'name', type: 'text', default: '' }],
      },
    ],
    workflows: [
      {
        id: 'wf_jobs',
        name: 'Jobs',
        description: '',
        activities: [
          {
            id: 'act_create_jobs',
            name: 'Create Job',
            description: '',
            sort_order: 0,
            record_map: 'CREATE',
            attributes: [],
            before_hook: null,
            after_hook: null,
          },
          {
            id: 'act_get_crews',
            name: 'Get Crews',
            description: '',
            sort_order: 1,
            record_map: 'GET',
            attributes: [{ attribute_ref: 'region', required: true }],
            before_hook: overrides.gate ?? null,
            // The region asked for is in the answer, so a test can prove the
            // parameter reached the GET rather than being ignored.
            returns: overrides.returns ?? "[attributes.region, 'Crew Z']",
          },
          {
            id: 'act_dispatch_jobs',
            name: 'Dispatch Job',
            description: '',
            sort_order: 2,
            record_map: 'UPDATE',
            attributes: [
              { attribute_ref: 'region', required: true },
              { attribute_ref: 'crew', required: true },
            ],
            before_hook: null,
            after_hook: null,
          },
        ],
      },
    ],
  } as unknown as SolutionConfig;
}

/** The adapter is what resolves `attribute_ref` into a real attribute, so the
 *  activity has to come back out of it rather than off the raw config. */
function setup(overrides?: { returns?: string; gate?: string | null; datasource?: string }) {
  const config = buildConfig(overrides);
  if (overrides?.datasource) {
    (config.attributes[1] as { type_config: { datasource: string } }).type_config.datasource = overrides.datasource;
  }
  const adapter = new MemoryAdapter(config);
  const engine = createEngine({ store: adapter, config, services: [] });
  const dispatch = adapter
    .getRecordTypeDef('rt_jobs')
    .workflow.activities.find((a) => a.id === 'act_dispatch_jobs') as ActivityDef;
  return { engine, dispatch };
}

const messages = (issues: { message: string }[]) => issues.map((i) => i.message);

describe('a producer that names a GET is re-run at submission (step 4)', () => {
  it('accepts a value the GET answered with', async () => {
    const { engine, dispatch } = setup();
    const issues = await validateSubmission(engine, dispatch, { region: 'north', crew: 'north' }, null);
    expect(issues).toEqual([]);
  });

  it('rejects a value the GET did not answer with', async () => {
    const { engine, dispatch } = setup();
    const issues = await validateSubmission(engine, dispatch, { region: 'north', crew: 'Crew Q' }, null);
    expect(messages(issues)).toContain("'Crew Q' is not in the datasource for 'Crew'");
  });

  it('sends the GET the parameters the submission carries', async () => {
    // 'south' is only ever in the answer when region=south was passed through,
    // so accepting it here is the proof the parameter arrived.
    const { engine, dispatch } = setup();
    expect(await validateSubmission(engine, dispatch, { region: 'south', crew: 'south' }, null)).toEqual([]);
    expect(messages(await validateSubmission(engine, dispatch, { region: 'north', crew: 'south' }, null)))
      .toContain("'south' is not in the datasource for 'Crew'");
  });

  it('fails closed when the GET rejects the caller', async () => {
    // The GET's own gate is what decides the set, so a gate that says no must
    // not wave the submitted value through.
    const { engine, dispatch } = setup({ gate: "fail('not your region')" });
    const issues = await validateSubmission(engine, dispatch, { region: 'north', crew: 'north' }, null);
    expect(messages(issues).join(' ')).toMatch(/datasource failed/);
  });

  it('fails closed when the producer names an activity that does not exist', async () => {
    const { engine, dispatch } = setup({ datasource: "invoke('act_get_nobody', {})" });
    const issues = await validateSubmission(engine, dispatch, { region: 'north', crew: 'north' }, null);
    expect(messages(issues).join(' ')).toMatch(/no such activity/);
  });

  it('rejects a producer that names a write activity', async () => {
    const { engine, dispatch } = setup({ datasource: "invoke('act_dispatch_jobs', {})" });
    const issues = await validateSubmission(engine, dispatch, { region: 'north', crew: 'north' }, null);
    expect(messages(issues).join(' ')).toMatch(/only GET activities can be invoked/);
  });
});
