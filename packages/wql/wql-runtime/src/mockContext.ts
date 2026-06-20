import type {
  AttributeList,
  MockContextConfig,
  WQLWorkOrder,
  WQLContext,
  LogLine,
} from '@wql/types';

// ─── Attribute factory ────────────────────────────────────────────────────────

function makeAttrValue(raw: string | number | boolean) {
  return {
    _raw: raw,
    toInt()   { return parseInt(String(this._raw)) || 0; },
    toDate()  { return new Date(String(this._raw)); },
    toBool()  { return this._raw === 'true' || this._raw === true; },
    toString(){ return String(this._raw); },
  };
}

function makeAttrList(items: { code: string; value: string | number | boolean }[]): AttributeList {
  const raw = items.map(i => ({
    code: i.code,
    value: makeAttrValue(i.value),
  }));

  const arr: AttributeList = {
    ...raw,
    length: raw.length,
    find:   (fn) => raw.filter(fn),
    filter: (fn) => raw.filter(fn),
  };

  return arr;
}

// ─── Build mock context ───────────────────────────────────────────────────────

export function buildMockContext(
  config: MockContextConfig,
  addLog: (level: LogLine['level'], msg: string) => void
): { wo: WQLWorkOrder; wf: WQLContext } {

  const attrData: Record<string, unknown> = {
    'KPI missed': false,
    'high_risk': false,
  };

  // Proxy job attributes so bracket assignment is intercepted and logged
  const jobAttributesProxy = new Proxy(
    {
      _data: attrData,
      find(fn: (a: { code: string; value: unknown }) => boolean) {
        return Object.entries(attrData)
          .map(([code, value]) => ({ code, value }))
          .filter(fn);
      },
    },
    {
      set(target, key: string, value) {
        attrData[key] = value;
        addLog('action', `wo.job.attributes["${key}"] = ${JSON.stringify(value)}`);
        return true;
      },
      get(target, key) {
        if (typeof key === 'string' && key in target) return (target as Record<string, unknown>)[key];
        if (typeof key === 'string') return attrData[key];
        return undefined;
      },
    }
  );

  const wo: WQLWorkOrder = {
    woId: config.woId,
    status: config.status,
    activityType: config.activityType,
    dueDate: new Date(config.dueDate),
    assignedTo: null,
    asset: {
      assetId: 'asset-55',
      assetNo: 'AST-055',
      assetType: 'equipment',
      status: config.assetStatus,
      attributes: makeAttrList([]),
    },
    attributes: makeAttrList([
      { code: 'riskScore',   value: config.riskScore },
      { code: 'priority',    value: config.priority },
      { code: 'KPI missed',  value: 'false' },
    ]),
    job: {
      jobId: 'job-901',
      jobNo: 'JOB-2024-0042',
      status: 'active',
      attributes: jobAttributesProxy as WQLWorkOrder['job']['attributes'],
      workOrders: [
        { woId: 'wo-4820', status: 'completed' } as WQLWorkOrder,
        { woId: config.woId, status: config.status } as WQLWorkOrder,
      ],
      project: {
        projectId: 'proj-12',
        name: 'Infrastructure Q2',
        users: [
          { userId: 'user-001', name: 'Alex Chen',  role: 'supervisor' },
          { userId: 'user-112', name: 'Jordan Lee', role: 'field_tech' },
        ],
      },
    },
  };

  const wf: WQLContext = {
    now: new Date('2026-04-03'),
    trigger: 'wo.updated',
    owner: { userId: 'user-001', name: 'Alex Chen', role: 'supervisor' },
    log(msg)    { addLog('action',  'wf.log: ' + msg); },
    error(msg)  { addLog('error',   'wf.error: ' + msg); },
    notify(user){ addLog('success', 'wf.notify → ' + (user?.name ?? user?.userId ?? String(user))); },
  };

  return { wo, wf };
}
