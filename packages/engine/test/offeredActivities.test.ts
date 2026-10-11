// Which actions a record offers — the server's answer to "may I do this?"
// (ACTIONS_OFFERED_BY_SERVER). Moved here from page-runtime's
// availableActivities when the rule moved to the server: the browser no longer
// has the conditions, so the engine's own gate answers, with the real user.

import { describe, expect, it, vi } from 'vitest';
import { MemoryAdapter } from '../src/memoryAdapter';
import { createEngine } from '../src/engine';
import type { ActivityDef, ClientSolutionConfig, ContextUser } from '../src/types';

const act = (id: string, record_map: string | undefined, show_condition?: string) => ({
  id, name: id.replace('act_', ''), description: '', ...(record_map ? { record_map } : {}),
  ...(show_condition ? { show_condition } : {}),
  before_hook: null, after_hook: null, attributes: [],
  ...(record_map === 'GET' ? { returns: 'records.jobs' } : {}),
});

const config = {
  attributes: [],
  recordTypes: [
    { id: 'rt_jobs', name: 'Jobs', workflow_ref: 'wf_jobs',
      custom_fields: [
        { key: 'status', type: 'text', label: 'Status', default: '' },
        { key: 'inspector_email', type: 'text', label: 'Inspector', default: '' },
      ] },
  ],
  activities: [
    act('act_create_jobs', 'CREATE', 'context.record is null'),
    act('act_list_jobs', 'GET'),
    act('act_start_jobs', 'UPDATE', "context.record.inspector_email = context.user.email"),
    act('act_cancel_jobs', 'UPDATE', "'role_admin' in context.user.roles"),
    act('act_note_jobs', 'UPDATE'),
    act('act_raise_jobs', 'CREATE', "context.record.status = 'Inspected'"),
    act('act_quote_jobs', 'UPDATE', 'context.record.status'),
    act('act_broken_jobs', 'UPDATE', 'nosuch_function()'),
  ],
  workflows: [
    { id: 'wf_jobs', name: 'Jobs', activities: [
      'act_create_jobs', 'act_list_jobs', 'act_start_jobs', 'act_cancel_jobs',
      'act_note_jobs', 'act_raise_jobs', 'act_quote_jobs', 'act_broken_jobs',
    ].map((activity_ref) => ({ activity_ref })) },
  ],
} as unknown as ClientSolutionConfig;

const nick: ContextUser = { id: 'u1', name: 'Nick', email: 'nick@example.com', roles: ['role_inspector'] };
const ann: ContextUser = { id: 'u2', name: 'Ann', email: 'ann@example.com', roles: ['role_inspector'] };
const boss: ContextUser = { id: 'u3', name: 'Boss', email: 'boss@example.com', roles: ['role_admin'] };

function build(user: ContextUser) {
  const adapter = new MemoryAdapter(config);
  const job = adapter.createRecord('rt_jobs', { status: 'Scheduled', inspector_email: 'nick@example.com' });
  const engine = createEngine({ store: adapter, config, user });
  const activities = adapter.getRecordTypeDef('rt_jobs').workflow.activities as ActivityDef[];
  const byId = (id: string) => activities.find((a) => a.id === id)!;
  return { adapter, engine, activities, byId, job };
}

const ids = (offered: { id: string }[]) => offered.map((a) => a.id);

// The broken condition logs on purpose; keep the test output quiet.
vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('about a record', () => {
  it('offers a condition about the user to that user, and not to another', async () => {
    const forNick = build(nick);
    expect(ids(await forNick.engine.offeredActivities(forNick.activities, forNick.job))).toContain('act_start_jobs');
    const forAnn = build(ann);
    expect(ids(await forAnn.engine.offeredActivities(forAnn.activities, forAnn.job))).not.toContain('act_start_jobs');
  });

  // One rule: what is not offered is also refused when run.
  it('refuses the other user when run', async () => {
    const { engine, byId, job } = build(ann);
    await expect(engine.runActivity(byId('act_start_jobs'), {}, job)).rejects.toThrow(/not available/);
  });

  it('offers a condition about a role only to its holders', async () => {
    const forBoss = build(boss);
    expect(ids(await forBoss.engine.offeredActivities(forBoss.activities, forBoss.job))).toContain('act_cancel_jobs');
    const forNick = build(nick);
    expect(ids(await forNick.engine.offeredActivities(forNick.activities, forNick.job))).not.toContain('act_cancel_jobs');
  });

  it('offers an action with no condition', async () => {
    const { engine, activities, job } = build(ann);
    expect(ids(await engine.offeredActivities(activities, job))).toContain('act_note_jobs');
  });

  // Strictly true: a non-empty string is not a yes.
  it('hides an action whose condition answers anything but true', async () => {
    const { engine, activities, job } = build(boss);
    expect(ids(await engine.offeredActivities(activities, job))).not.toContain('act_quote_jobs');
  });

  // Fails closed, like the run gate: a broken access rule never waves an
  // action through, and one bad condition does not take the others down.
  it('hides an action whose condition errors, and logs it', async () => {
    const warn = vi.mocked(console.warn);
    warn.mockClear();
    const { engine, activities, job } = build(boss);
    const offered = ids(await engine.offeredActivities(activities, job));
    expect(offered).not.toContain('act_broken_jobs');
    expect(offered).toContain('act_note_jobs');
    expect(warn.mock.calls.some((call) => String(call[0]).includes('act_broken_jobs'))).toBe(true);
  });

  it('never offers a GET', async () => {
    const { engine, activities, job } = build(boss);
    expect(ids(await engine.offeredActivities(activities, job))).not.toContain('act_list_jobs');
  });

  // A CREATE's condition sees the record it is offered on, as a page always
  // did — `context.record is null` keeps a create action off a record's page.
  it('lets a CREATE condition see the record it is offered on', async () => {
    const { adapter, engine, activities, job } = build(boss);
    expect(ids(await engine.offeredActivities(activities, job))).not.toContain('act_create_jobs');
    const inspected = adapter.createRecord('rt_jobs', { status: 'Inspected' });
    expect(ids(await engine.offeredActivities(activities, inspected))).toContain('act_raise_jobs');
  });

  // The workflow's list is the order — nothing re-sorts it.
  it('keeps the workflow order', async () => {
    const { engine, activities, job } = build(nick);
    expect(ids(await engine.offeredActivities(activities, job))).toEqual(['act_start_jobs', 'act_note_jobs']);
  });
});

describe('with no record — a record type\'s create button', () => {
  it('offers only CREATEs, each seeing context.record null', async () => {
    const { engine, activities } = build(boss);
    expect(await engine.offeredActivities(activities, null)).toEqual([{ id: 'act_create_jobs', name: 'create_jobs' }]);
  });
});
