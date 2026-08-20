// Save-time checks on a page that names a GET activity for a dynamic prop
// (DATA_THROUGH_ACTIVITIES step 2). The reference check is the one part of
// validation that knows which surface a source came from — an `invoke` is the
// point of a dynamic prop and impossible in a callback — so it is worth its
// own tests.
//
// The host is a stub: `validatePage` asks it a handful of questions and this
// file answers them, which keeps these tests about the checks and not about the
// model behind them. Step 3 added one more question — what record type is this
// page about, and how does one come into being — so the stub answers that too.

import { describe, expect, it } from 'vitest';
import { validatePage, type PageValidationHost } from '../src/validatePage';
import type { PageDef } from '../src/pageDef';

const ACTIVITIES: Record<string, { record_map?: string }> = {
  act_get_work_orders: { record_map: 'GET' },
  act_dispatch_work_orders: { record_map: 'UPDATE' },
};

type StubType = { workflow: { activities: { record_map?: string; attributes: { key: string; required?: boolean }[] }[] } };

const RECORD_TYPES: Record<string, StubType> = {
  rt_dispatch_boards: {
    workflow: { activities: [{ record_map: 'CREATE', attributes: [] }] },
  },
  // A type whose create asks for something: nobody is there to answer when a
  // page opens its own record.
  rt_projects: {
    workflow: { activities: [{ record_map: 'CREATE', attributes: [{ key: 'name', required: true }] }] },
  },
  // A type raised only by other workflows — no way in from a page.
  rt_notifications: {
    workflow: { activities: [{ record_map: 'UPDATE', attributes: [] }] },
  },
};

const HOST: PageValidationHost = {
  validateExpression: () => [],
  // Stands in for the real records-banned pass: the parser answers this in
  // production, so the stub answers the same question the cheap way.
  validateExpressionWithoutRecords: (source) =>
    /(^|[^\w.])records\./.test(source)
      ? [{ severity: 'error' as const, message: "'records' is not available here", line: 1, col: 1 }]
      : [],
  validateCallback: () => [],
  findActivity: (id) => (ACTIVITIES[id] ? { activity: ACTIVITIES[id] } : null),
  findRecordType: (id) => RECORD_TYPES[id] ?? null,
};

const BOARD: PageDef['record'] = { type: 'rt_dispatch_boards', instances: 'one' };

const page = (dynamicProps: Record<string, string>, callbacks: Record<string, string> = {}): PageDef => ({
  record: BOARD,
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

  it('warns when a prop reads records directly — the Runtime app holds none', () => {
    expect(messages(page({ workOrders: 'records.work_orders' })))
      .toEqual(['This reads records directly, so it shows nothing in the Runtime app — name a GET activity instead']);
  });

  it('says nothing about a prop that names a GET, however it filters', () => {
    expect(messages(page({ workOrders: "invoke('act_get_work_orders', { status: context.page.status })" })))
      .toEqual([]);
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

// The other half of step 3: a page that acts needs a record to act about, and
// the two ways it can be stranded — no such type, no way to create one — are
// worth catching where they can still be fixed.
describe('validatePage — the record a page is about', () => {
  const reads = { workOrders: "invoke('act_get_work_orders', { status: 'Raised' })" };
  const about = (record: PageDef['record']): PageDef => ({ ...page(reads), record });

  it('accepts a page about a one-instance type it can create', () => {
    expect(messages(about(BOARD))).toEqual([]);
  });

  it('accepts a page about one of many, which creates nothing', () => {
    expect(messages(about({ type: 'rt_projects', instances: 'many' }))).toEqual([]);
  });

  it('rejects a record type the model does not have', () => {
    expect(messages(about({ type: 'rt_gone', instances: 'one' })))
      .toEqual(["'rt_gone' is not a record type in this model"]);
  });

  it('rejects a one-instance page whose type has no create activity', () => {
    expect(messages(about({ type: 'rt_notifications', instances: 'one' })))
      .toEqual(["'rt_notifications' has no create activity, so this page cannot open its record"]);
  });

  it('warns when the create needs values nobody can supply at page open', () => {
    expect(messages(about({ type: 'rt_projects', instances: 'one' })))
      .toEqual(['the create activity requires name, which nobody can supply when the page opens it']);
  });

  it('warns that a page reading without a record leaves no trace', () => {
    const def: PageDef = { ...page(reads) };
    delete def.record;
    expect(messages(def)).toEqual(['This page names a GET but is about no record, so its reads are not logged']);
  });

  it('says nothing about a pure view that reads nothing', () => {
    expect(messages({ slotConfigs: {} })).toEqual([]);
  });
});
