// Which activities apply to a record — the model's answer to "may I do this?".

import { describe, it, expect, vi } from 'vitest';
import { availableActivities } from '../src/availableActivities';
import type { ActivityDef } from '@fluxus/engine';

const activity = (over: Partial<ActivityDef>): ActivityDef => ({
  id: 'act_x', name: 'X', description: '', sort_order: 0, record_map: 'UPDATE',
  attributes: [], before_hook: null, after_hook: null, ...over,
});

const always = async () => true;

describe('what is offered', () => {
  it('offers an activity with no condition', async () => {
    const found = await availableActivities([activity({ id: 'act_edit', name: 'Edit' })], always);
    expect(found).toEqual([{ id: 'act_edit', name: 'Edit' }]);
  });

  it('leaves out the ones whose condition says no', async () => {
    const acts = [
      activity({ id: 'act_start', name: 'Start', show_condition: "context.record.status = 'Created'" }),
      activity({ id: 'act_done', name: 'Complete', show_condition: "context.record.status = 'Active'" }),
    ];
    const found = await availableActivities(acts, async (src) => src.includes('Created'));
    expect(found.map((a) => a.id)).toEqual(['act_start']);
  });

  // A GET answers a question rather than being an act anyone takes.
  it('leaves out GET whatever its condition says', async () => {
    const acts = [
      activity({ id: 'act_list', record_map: 'GET' }),
      activity({ id: 'act_edit', name: 'Edit' }),
    ];
    const found = await availableActivities(acts, always);
    expect(found.map((a) => a.id)).toEqual(['act_edit']);
  });

  // Whether a CREATE belongs on this record is the author's call, made with
  // its show_condition — not assumed away here.
  it('offers a CREATE, subject to its condition like any other', async () => {
    const acts = [
      activity({ id: 'act_raise', name: 'Raise', record_map: 'CREATE', sort_order: 1, show_condition: "context.record.status = 'Approved'" }),
      activity({ id: 'act_new', name: 'New', record_map: 'CREATE', sort_order: 2, show_condition: "context.record.status = 'Draft'" }),
    ];
    const found = await availableActivities(acts, async (src) => src.includes('Approved'));
    expect(found).toEqual([{ id: 'act_raise', name: 'Raise' }]);
  });

  it('keeps the workflow order', async () => {
    const acts = [
      activity({ id: 'act_third', sort_order: 3 }),
      activity({ id: 'act_first', sort_order: 1 }),
      activity({ id: 'act_second', sort_order: 2 }),
    ];
    const found = await availableActivities(acts, always);
    expect(found.map((a) => a.id)).toEqual(['act_first', 'act_second', 'act_third']);
  });
});

describe('when a condition cannot be answered', () => {
  // Fails closed, like the engine's own gate: a broken access rule must never
  // wave an activity through.
  it('hides the activity and says why, once', async () => {
    const warn = vi.fn();
    const acts = [activity({ id: 'act_start', show_condition: 'context.record.nope.deep' })];
    const found = await availableActivities(acts, async () => { throw new Error('no field'); }, warn);
    expect(found).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('act_start');
  });

  it('does not let one bad condition take the others down', async () => {
    const acts = [
      activity({ id: 'act_bad', show_condition: 'boom' }),
      activity({ id: 'act_good', name: 'Good', sort_order: 1 }),
    ];
    const found = await availableActivities(acts, async (src) => {
      if (src === 'boom') throw new Error('boom');
      return true;
    }, () => {});
    expect(found.map((a) => a.id)).toEqual(['act_good']);
  });
});
