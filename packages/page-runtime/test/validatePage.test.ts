// Save-time checks on a page that names a GET activity for a dynamic prop
// (DATA_THROUGH_ACTIVITIES step 2). The reference check is the one part of
// validation that knows which surface a source came from — an `invoke` is the
// point of a dynamic prop and impossible in a callback — so it is worth its
// own tests.
//
// The host is a stub: `validatePage` asks it three questions and this file
// answers them, which keeps these tests about the checks and not about the
// model behind them.

import { describe, expect, it } from 'vitest';
import { validatePage, type PageValidationHost } from '../src/validatePage';
import type { PageDef } from '../src/pageDef';

const ACTIVITIES: Record<string, { record_map?: string }> = {
  act_get_work_orders: { record_map: 'GET' },
  act_dispatch_work_orders: { record_map: 'UPDATE' },
};

const HOST: PageValidationHost = {
  validateExpression: () => [],
  validateCallback: () => [],
  findActivity: (id) => (ACTIVITIES[id] ? { activity: ACTIVITIES[id] } : null),
};

const page = (dynamicProps: Record<string, string>, callbacks: Record<string, string> = {}): PageDef => ({
  slotConfigs: {
    main: { componentName: 'WorkOrderList', staticConfig: {}, dynamicProps, callbacks },
  },
});

const messages = (def: PageDef) => validatePage(HOST, def).map((f) => f.diagnostic.message);

describe('validatePage — a prop naming its producer', () => {
  it('accepts a dynamic prop that names a GET activity', () => {
    expect(messages(page({ workOrders: "invoke('act_get_work_orders', { status: 'Raised' })" }))).toEqual([]);
  });

  it('rejects an activity that does not exist', () => {
    expect(messages(page({ workOrders: "invoke('act_get_nothing', { status: 'Raised' })" })))
      .toEqual(["Unknown activity 'act_get_nothing'"]);
  });

  it('rejects an activity that is not a GET — only a GET can answer', () => {
    expect(messages(page({ workOrders: "invoke('act_dispatch_work_orders')" })))
      .toEqual(["'act_dispatch_work_orders' is not a GET activity — only a GET can answer invoke()"]);
  });

  it('finds an invoke nested inside a larger expression', () => {
    expect(messages(page({ workOrders: "invoke('act_get_nothing').first" })))
      .toEqual(["Unknown activity 'act_get_nothing'"]);
  });

  it('leaves a non-literal activity id to runtime', () => {
    expect(messages(page({ workOrders: 'invoke(context.page.which)' }))).toEqual([]);
  });

  it('rejects invoke in a callback, where the host has no door to the model', () => {
    const findings = messages(page({}, { onDispatch: "invoke('act_get_work_orders')" }));
    expect(findings).toContain('invoke() is not available in a callback — name the GET from a dynamic prop instead');
  });

  it('still resolves activity ids passed to services.activities.run', () => {
    expect(messages(page({}, { onDispatch: "services.activities.run('act_gone', callbackData.value)" })))
      .toContain("Unknown activity 'act_gone'");
  });
});
