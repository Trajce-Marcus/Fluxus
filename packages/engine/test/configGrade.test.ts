// validateConfig runs on both grades of config, and one rule cannot be written
// blind to which (2026-09-12).
//
// A GET's `returns` is required on the server grade and **absent by design**
// from the client's — the query never reaches the browser. Before this, every
// browser host reported every GET in the model as a config error at boot,
// which is both wrong and the kind of noise that trains people to ignore the
// console.
//
// The grade is legible because the trim omits the server-only keys rather than
// nulling them: a hook that is explicitly `null` still says "this is the full
// model, and there is no hook".

import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/validateConfig';
import type { ClientSolutionConfig, SolutionConfig } from '../src/types';

const RETURNS = 'records.jobs.select(id, name)';

/** A one-GET model. `grade: 'client'` drops what the trim drops. */
function buildConfig({ grade, returns }: { grade: 'server' | 'client'; returns?: string }) {
  const hooks = grade === 'server' ? { before_hook: null, after_hook: null } : {};
  return {
    attributes: [],
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
            id: 'act_list_jobs',
            name: 'List Jobs',
            description: '',
            sort_order: 0,
            record_map: 'GET',
            attributes: [],
            ...hooks,
            ...(returns ? { returns } : {}),
          },
        ],
      },
    ],
  } as unknown as SolutionConfig & ClientSolutionConfig;
}

const missingReturns = (config: ClientSolutionConfig) =>
  validateConfig(config).filter((f) => f.diagnostic.message.includes("needs a 'returns'"));

describe('a GET with no returns', () => {
  it('is an error on the server grade — the expression IS the activity', () => {
    expect(missingReturns(buildConfig({ grade: 'server' }))).toHaveLength(1);
  });

  it('is silent on the client grade, where the trim removed it on purpose', () => {
    expect(missingReturns(buildConfig({ grade: 'client' }))).toHaveLength(0);
  });
});

describe('a GET with a returns', () => {
  it('says nothing on either grade', () => {
    expect(missingReturns(buildConfig({ grade: 'server', returns: RETURNS }))).toHaveLength(0);
    expect(missingReturns(buildConfig({ grade: 'client', returns: RETURNS }))).toHaveLength(0);
  });

  it('still validates the expression itself', () => {
    const findings = validateConfig(buildConfig({ grade: 'server', returns: 'records.nope.select(id)' }));
    expect(findings.length).toBeGreaterThan(0);
  });
});
