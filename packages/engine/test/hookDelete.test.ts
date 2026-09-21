// `delete` from a hook, end to end — the DSL verb through the engine's mutate
// surface to the store (built 2026-09-21, the user's ruling).
//
// The platform's position on deleting, which this encodes: a delete is for a
// record that should never have existed. It destroys the record and the history
// with it, because anything worth keeping is marked instead — which is what the
// WBS does with `expired`. The audit of the deletion lives on the record the
// deleting activity was anchored to, never on the record it destroyed.
//
// Not yet guarded: nothing stops an author running this against a production
// operation. The operation lifecycle state that would (build vs production) is
// the next piece, and was deferred deliberately.

import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/memoryAdapter';
import { createEngine } from '../src/engine';
import { buildEvalHost } from '../src/bridge';
import { executeScript } from '@fluxus/dsl';
import type { ActivityDef, ClientSolutionConfig } from '../src/types';

const config = {
  attributes: [{ key: 'reason', type: 'text', label: 'Reason' }],
  recordTypes: [
    { id: 'rt_projects', name: 'Projects', workflow_ref: 'wf_projects',
      custom_fields: [{ key: 'project_no', type: 'text', label: 'No', default: '' }] },
    { id: 'rt_wbs_nodes', name: 'WBS', workflow_ref: 'wf_wbs_nodes',
      custom_fields: [
        { key: 'code', type: 'text', label: 'Code', default: '' },
        { key: 'project_id', type: 'fk_ref', label: 'Project', default: '', fk_record_type: 'rt_projects', fk_display_field: 'project_no' },
      ] },
  ],
  workflows: [
    { id: 'wf_projects', name: 'Projects', activities: [{
      // Anchored on the project, not on what it deletes — the entry has to
      // outlive the records it names.
      id: 'act_purge_wbs_projects', name: 'Purge WBS', description: '', sort_order: 0, record_map: 'UPDATE',
      before_hook: null,
      after_hook: "records.wbs_nodes.where(project_id = context.record.id).delete()",
      attributes: [{ attribute_ref: 'reason' }],
    }] },
    { id: 'wf_wbs_nodes', name: 'WBS', activities: [] },
  ],
} as unknown as ClientSolutionConfig;

function build() {
  const adapter = new MemoryAdapter(config);
  const project = adapter.createRecord('rt_projects', { project_no: 'P24-042' });
  const other = adapter.createRecord('rt_projects', { project_no: 'P26-011' });
  const nodes = ['AAA', 'AAA111', 'AAA222'].map((code) =>
    adapter.createRecord('rt_wbs_nodes', { code, project_id: project.id }));
  const keep = adapter.createRecord('rt_wbs_nodes', { code: '5.0', project_id: other.id });
  const engine = createEngine({ store: adapter, config, user: { id: 'u', name: 'u', email: null, roles: [] } });
  const activity = adapter.getRecordTypeDef('rt_projects').workflow.activities[0] as ActivityDef;
  return { adapter, engine, activity, project, nodes, keep };
}

describe('a hook that deletes', () => {
  it('destroys the records it selected, and only those', () => {
    const { adapter, engine, activity, project, nodes, keep } = build();
    const result = engine.runActivity(activity, { reason: 'test data' }, adapter.getRecord(project.id));
    expect(result.status).toBe('done');
    for (const node of nodes) expect(() => adapter.getRecord(node.id)).toThrow(/Record not found/);
    expect(adapter.getRecord(keep.id).customFields.code).toBe('5.0');
  });

  it('takes the deleted records\' history with them', () => {
    const { adapter, engine, activity, project, nodes } = build();
    expect(adapter.getRecord(nodes[0].id).activityHistory).toBeDefined();
    engine.runActivity(activity, { reason: 'test data' }, adapter.getRecord(project.id));
    expect(adapter.allRecords().map((r) => r.id)).not.toContain(nodes[0].id);
  });

  // The whole audit design in one assertion: what was deleted is recorded on
  // the record that ran the deletion, which is still there to be read.
  it('leaves its own entry on the anchor, carrying the reason', () => {
    const { adapter, engine, activity, project } = build();
    engine.runActivity(activity, { reason: 'duplicate import' }, adapter.getRecord(project.id));
    const entry = adapter.getRecord(project.id).activityHistory.at(-1)!;
    expect(entry.activityId).toBe('act_purge_wbs_projects');
    expect(entry.capturedAttributes.reason).toBe('duplicate import');
  });

  it('frees the code the deleted record held', () => {
    const { adapter, engine, activity, project } = build();
    engine.runActivity(activity, { reason: 'test data' }, adapter.getRecord(project.id));
    const again = adapter.createRecord('rt_wbs_nodes', { code: 'AAA', project_id: project.id });
    expect(again.customFields.code).toBe('AAA');
  });

  it('refuses to delete a record of a type the script did not name', () => {
    const { adapter, engine, project } = build();
    const host = buildEvalHost(adapter, config, { anchorRecord: adapter.getRecord(project.id) });
    // `wbs_nodes` addressed, a project's id handed to it: the id resolves to no
    // WBS node, so the filter simply matches nothing rather than destroying it.
    executeScript(`records.wbs_nodes.where(id = '${project.id}').delete()`, host, { mode: 'mutate' });
    expect(adapter.getRecord(project.id).customFields.project_no).toBe('P24-042');
    void engine;
  });

  it('is refused in a before hook', () => {
    const { adapter, project } = build();
    const host = buildEvalHost(adapter, config, { anchorRecord: adapter.getRecord(project.id) });
    expect(() => executeScript('context.record.delete()', host, { mode: 'read' })).toThrow(/after hooks only/);
  });
});
