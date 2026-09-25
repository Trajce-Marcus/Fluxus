// An attribute filled from context rather than asked for.
//
// Hiding says two different things and only one of them means "not captured":
// an attribute the model rules out does not apply to this run, while a sourced
// one is already answered. Dropping the second created a WBS node with no
// project.

import { describe, it, expect } from 'vitest';
import { MemoryAdapter } from '../src/memoryAdapter';
import { createEngine } from '../src/engine';
import { validateSubmission } from '../src/validateSubmission';
import type { ActivityDef, ClientSolutionConfig } from '../src/types';

const config = {
  attributes: [
    { key: 'wbs_project', type: 'reference', label: 'Project', type_config: { field: 'rt_wbs_nodes.project_id' } },
    { key: 'ruled_out', type: 'text', label: 'Ruled out' },
    { key: 'code', type: 'text', label: 'Code' },
  ],
  recordTypes: [
    { id: 'rt_projects', name: 'Projects', workflow_ref: 'wf_projects',
      custom_fields: [{ key: 'code', type: 'text', label: 'Code', default: '' }] },
    { id: 'rt_wbs_nodes', name: 'WBS', workflow_ref: 'wf_wbs_nodes',
      custom_fields: [
        { key: 'code', type: 'text', label: 'Code', default: '' },
        { key: 'project_id', type: 'fk_ref', label: 'Project', default: '', fk_record_type: 'rt_projects', fk_display_field: 'code' },
      ] },
  ],
  workflows: [
    { id: 'wf_projects', name: 'Projects', activities: [] },
    { id: 'wf_wbs_nodes', name: 'WBS', activities: [{
      id: 'act_create_wbs_nodes', name: 'Create', description: '', sort_order: 0, record_map: 'CREATE',
      before_hook: null, after_hook: null,
      attributes: [
        { attribute_ref: 'wbs_project', source: 'context.page.record.id' },
        { attribute_ref: 'ruled_out', show_condition: 'false' },
        { attribute_ref: 'code' },
      ],
    }] },
  ],
} as unknown as ClientSolutionConfig;

// The platform issues every id (2026-09-18), so the project's is whatever the
// create returned — the fixture reads it back rather than assuming its code.
const build = () => {
  const adapter = new MemoryAdapter(config);
  const project = adapter.createRecord('rt_projects', { code: 'P26-011' });
  const engine = createEngine({ store: adapter, config, user: { id: 'u', name: 'u', email: null, roles: [] } });
  const activity = adapter.getRecordTypeDef('rt_wbs_nodes').workflow.activities[0] as ActivityDef;
  return { adapter, engine, activity, projectId: project.id };
};

describe('a sourced attribute', () => {
  it('may carry a value even though the form never showed it', async () => {
    const { engine, activity, projectId } = build();
    const issues = await validateSubmission(engine, activity, { wbs_project: projectId, code: 'T1' }, null);
    expect(issues).toEqual([]);
  });

  it('lands in the field it names', async () => {
    const { engine, adapter, activity, projectId } = build();
    const result = await engine.runActivity(activity, { wbs_project: projectId, code: 'T1' }, null);
    expect(result.status).toBe('done');
    expect(adapter.getRecord(result.recordId!).customFields.project_id).toBe(projectId);
  });

  it('is still checked against the target its field names', async () => {
    const { engine, activity } = build();
    const issues = await validateSubmission(engine, activity, { wbs_project: 'NOPE', code: 'T1' }, null);
    expect(issues.map(i => i.attribute)).toEqual(['wbs_project']);
  });
});

describe('an attribute the model rules out', () => {
  // Unchanged: a value for one of those means the caller misread the signature.
  it('is still refused when a value arrives for it', async () => {
    const { engine, activity, projectId } = build();
    const issues = await validateSubmission(engine, activity, { wbs_project: projectId, ruled_out: 'x', code: 'T1' }, null);
    expect(issues.map(i => i.message)).toEqual(["'ruled_out' is not applicable for this submission"]);
  });
});
