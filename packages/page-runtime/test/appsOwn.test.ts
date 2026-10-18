// An app's own activities in the browser (APPS_AND_INSTANCES step 5, §2.11).
// The model a Runtime user receives carries them in their app's list — a
// workflow no record type points to — and the page runtime finds them there,
// with no record type: they run on the app, which the server decides.

import { describe, expect, it } from 'vitest';
import { MemoryAdapter, type ClientSolutionConfig } from '@fluxus/engine';
import type { FluxusClient } from '@fluxus/client';
import { createPageRuntime } from '../src/runtime';

const act = (id: string, record_map?: 'CREATE') => ({ id, name: id, description: '', ...(record_map ? { record_map } : {}), attributes: [] });

const CONFIG: ClientSolutionConfig = {
  attributes: [],
  recordTypes: [{ id: 'rt_jobs', name: 'Jobs', description: '', workflow_ref: 'wf_jobs', custom_fields: [] }],
  activities: [act('act_create_jobs', 'CREATE'), act('act_plan_day')],
  workflows: [
    { id: 'wf_jobs', name: 'Jobs', description: '', activities: [{ activity_ref: 'act_create_jobs' }] },
    // As projectConfig sends a list: only the app's own.
    { id: 'wf_app_board', name: 'Board', description: '', activities: [{ activity_ref: 'act_plan_day' }] },
  ],
};

const runtime = createPageRuntime({ client: { adapter: new MemoryAdapter(CONFIG), config: CONFIG } as unknown as FluxusClient });

describe("finding an app's own activity", () => {
  it('finds it in its list, with no record type', () => {
    const found = runtime.findActivity('act_plan_day');
    expect(found?.activity.id).toBe('act_plan_day');
    expect(found?.typeDef).toBeNull();
  });

  it("still finds a record type's activity with its type", () => {
    expect(runtime.findActivity('act_create_jobs')?.typeDef?.id).toBe('rt_jobs');
  });

  it('finds nothing for an activity the model did not send', () => {
    expect(runtime.findActivity('act_nope')).toBeNull();
  });
});
