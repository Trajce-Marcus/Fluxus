// A page names a GET activity for a dynamic prop instead of carrying the query
// itself (DATA_THROUGH_ACTIVITIES step 2). What is under test is the page
// host's half: `invoke` reaches the model over an async door from inside a
// synchronous evaluator, and the parameters it sends are the ones the
// expression computed.
//
// The GET's own machinery (gate, `returns`, purity) is the engine's and is
// tested there; here the server is a stub function, so what it answers is
// whatever the test says the model said.

import { describe, expect, it, vi } from 'vitest';
import { MemoryAdapter, type ClientSolutionConfig } from '@fluxus/engine';
import { evaluatePageExpression, type PageContext, type PageQueryFn } from '../src/pageHost';

// The client's grade of a tiny model: one record type whose workflow declares
// the GET a page would name. `returns` is absent by design — the query lives on
// the server, which is the whole point of the step.
const CONFIG: ClientSolutionConfig = {
  attributes: [
    { key: 'status', label: 'Status', description: 'Work order status', type: 'text' },
  ],
  recordTypes: [
    {
      id: 'rt_work_orders',
      name: 'Work Orders',
      description: 'Jobs in the field',
      workflow_ref: 'wf_work_orders',
      custom_fields: [
        { key: 'status', label: 'Status', description: 'Where it is up to', type: 'text' },
      ],
    },
  ],
  workflows: [
    {
      id: 'wf_work_orders',
      name: 'Work Orders',
      description: 'The work order lifecycle',
      activities: [
        {
          id: 'act_get_work_orders',
          name: 'Get Work Orders',
          description: 'Answer with the work orders in a given status',
          sort_order: 1,
          record_map: 'GET',
          attributes: [{ attribute_ref: 'status', required: true }],
        },
      ],
    },
  ],
};

const PAGE_CTX: PageContext = { app: { name: 'Test' }, page: { status: 'Raised' } };

const adapter = () => new MemoryAdapter(CONFIG);

const evaluate = (source: string, query?: PageQueryFn, pageCtx: PageContext = PAGE_CTX) =>
  evaluatePageExpression(adapter(), CONFIG, source, pageCtx, query);

describe('a dynamic prop naming a GET activity', () => {
  it('asks the named activity and answers with what it returned', async () => {
    const query = vi.fn<PageQueryFn>().mockResolvedValue([{ id: 'WO-1', status: 'Raised' }]);

    const value = await evaluate("invoke('act_get_work_orders', { status: 'Raised' })", query);

    expect(value).toEqual([{ id: 'WO-1', status: 'Raised' }]);
    expect(query).toHaveBeenCalledExactlyOnceWith('act_get_work_orders', { status: 'Raised' }, undefined);
  });

  it('computes its parameters from the page context — the page asks, the model answers', async () => {
    const query = vi.fn<PageQueryFn>().mockResolvedValue([]);

    await evaluate('invoke(\'act_get_work_orders\', { status: context.page.status })', query);

    expect(query).toHaveBeenCalledWith('act_get_work_orders', { status: 'Raised' }, undefined);
  });

  // Step 3: the page's own record goes with the ask, because that is where the
  // server lands the read's light entry. It is the anchor, not the subject —
  // the question is still whatever the parameters say.
  it('sends the page record as the anchor the read is logged against', async () => {
    const query = vi.fn<PageQueryFn>().mockResolvedValue([]);
    const board = { id: 'BOARD-1', typeRef: 'rt_work_orders', customFields: {}, activityHistory: [] };

    await evaluate("invoke('act_get_work_orders', { status: 'Raised' })", query, { ...PAGE_CTX, record: board });

    expect(query).toHaveBeenCalledWith('act_get_work_orders', { status: 'Raised' }, 'BOARD-1');
  });

  it('lets the expression work on the answer', async () => {
    const query = vi.fn<PageQueryFn>().mockResolvedValue([
      { id: 'WO-1', status: 'Raised' },
      { id: 'WO-2', status: 'Raised' },
    ]);

    expect(await evaluate("invoke('act_get_work_orders', { status: 'Raised' }).count", query)).toBe(2);
  });

  it('asks once for a GET named twice with the same parameters', async () => {
    const query = vi.fn<PageQueryFn>().mockResolvedValue([{ id: 'WO-1' }]);
    const source =
      "invoke('act_get_work_orders', { status: 'Raised' }).count + " +
      "invoke('act_get_work_orders', { status: 'Raised' }).count";

    expect(await evaluate(source, query)).toBe(2);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('asks separately for different parameters, in one round', async () => {
    const query = vi.fn<PageQueryFn>().mockImplementation(async (_id, params) =>
      params.status === 'Raised' ? [{ id: 'WO-1' }] : [],
    );
    const source =
      "invoke('act_get_work_orders', { status: 'Raised' }).count + " +
      "invoke('act_get_work_orders', { status: 'Completed' }).count";

    expect(await evaluate(source, query)).toBe(1);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('resolves a GET whose parameters come from another GET, and never asks with a placeholder', async () => {
    const query = vi.fn<PageQueryFn>().mockImplementation(async (_id, params) => {
      if (params.status === 'Raised') return [{ id: 'WO-1', status: 'Dispatched' }];
      if (params.status === 'Dispatched') return [{ id: 'WO-9' }];
      throw new Error(`asked with a parameter nobody meant: ${JSON.stringify(params)}`);
    });
    const source =
      "invoke('act_get_work_orders', " +
      "{ status: invoke('act_get_work_orders', { status: 'Raised' }).first.status })";

    expect(await evaluate(source, query)).toEqual([{ id: 'WO-9' }]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('fails loudly rather than hammering the server when the chain never settles', async () => {
    // Each answer feeds the next question a *different* parameter, so the chain
    // really is six rounds deep — one more than the budget allows.
    const query = vi.fn<PageQueryFn>().mockImplementation(async (_id, params) => [
      { id: 'WO-1', status: `${params.status}+` },
    ]);
    let source = "'Raised'";
    for (let i = 0; i < 6; i++) {
      source = `invoke('act_get_work_orders', { status: ${source} }).first.status`;
    }

    await expect(evaluate(source, query)).rejects.toThrow(/still asking for GET activities after 4 rounds/);
  });

  it('fails loudly in a host with no door to the model', async () => {
    await expect(evaluate("invoke('act_get_work_orders', { status: 'Raised' })")).rejects.toThrow(
      /cannot run activities/,
    );
  });

  it('reports the expression\'s own error once nothing is left to fetch', async () => {
    const query = vi.fn<PageQueryFn>().mockResolvedValue([{ id: 'WO-1' }]);

    await expect(evaluate("invoke('act_get_work_orders', { status: 'Raised' }).nonsense()", query))
      .rejects.toThrow();
  });
});

describe('a dynamic prop carrying its own query — unchanged', () => {
  it('still evaluates against the client snapshot without asking the server', async () => {
    const store = adapter();
    store.insertRecord({ ...store.buildRecord('rt_work_orders', { status: 'Raised' }), id: 'WO-1' });
    const query = vi.fn<PageQueryFn>();

    const value = await evaluatePageExpression(
      store, CONFIG, "records.work_orders.where(status = 'Raised').select(id, status)", PAGE_CTX, query,
    );

    expect(value).toEqual([{ id: 'WO-1', status: 'Raised' }]);
    expect(query).not.toHaveBeenCalled();
  });
});
