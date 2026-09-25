// Every evaluator and script test runs through both drivers
// (SERVER_DATA_LOADING §7, step 2): the immediate one against the test's own
// host, and the waiting one against the same host answering with promises —
// records reads, mutations, read-service calls and `invoke`. Results must be
// identical; the few tests about the difference itself branch on `waiting`.

import { evaluateExpression, evaluateExpressionAsync, executeScript, executeScriptAsync, type ScriptOptions, type ScriptResult } from '../src/evaluator';
import type { EvalHost, RecordsHost, RecordsMutationHost, ServiceModuleDef } from '../src/host';

export interface Driver {
  name: string;
  waiting: boolean;
  evaluate(source: string, host?: EvalHost): Promise<unknown>;
  execute(source: string, host?: EvalHost, options?: ScriptOptions): Promise<ScriptResult>;
}

const later = <T>(value: () => T | Promise<T>): Promise<T> => Promise.resolve().then(value);

function promisedRecords(records: RecordsHost): RecordsHost {
  const out: RecordsHost = {
    ...records,
    getAll: (type) => later(() => records.getAll(type)),
    getById: (type, id) => later(() => records.getById(type, id)),
  };
  const mutate = records.mutate as RecordsMutationHost | undefined;
  if (mutate && !('writesThrough' in mutate)) {
    out.mutate = {
      prepareCreate: (type, fields) => later(() => mutate.prepareCreate(type, fields)),
      prepareUpdate: (type, id, fields) => later(() => mutate.prepareUpdate(type, id, fields)),
      prepareDelete: (type, id) => later(() => mutate.prepareDelete(type, id)),
      apply: (ops) => later(() => mutate.apply(ops)),
    };
  }
  return out;
}

// Read functions only: an effect function is what `queue` dispatches, and a
// promise there changes where a failure is reported (onQueuedFailure rather
// than warnings) — a difference of `queue`, not of the driver.
function promisedServices(services: ServiceModuleDef[]): ServiceModuleDef[] {
  return services.map((module) => ({
    ...module,
    functions: Object.fromEntries(
      Object.entries(module.functions).map(([key, def]) => [
        key,
        def.kind === 'read' ? { ...def, fn: (...args: unknown[]) => later(() => def.fn(...args)) } : def,
      ]),
    ),
  }));
}

/** The same host, answering every host call with a promise. */
export function promised(host: EvalHost): EvalHost {
  return {
    ...host,
    ...(host.records ? { records: promisedRecords(host.records) } : {}),
    ...(host.services ? { services: promisedServices(host.services) } : {}),
    ...(host.invoke ? { invoke: (id: string, params: Record<string, unknown>) => later(() => host.invoke!(id, params)) } : {}),
  };
}

export const DRIVERS: Driver[] = [
  {
    name: 'immediate',
    waiting: false,
    evaluate: async (source, host) => evaluateExpression(source, host),
    execute: async (source, host, options) => executeScript(source, host, options),
  },
  {
    name: 'waiting',
    waiting: true,
    evaluate: (source, host = {}) => evaluateExpressionAsync(source, promised(host)),
    execute: (source, host = {}, options) => executeScriptAsync(source, promised(host), options),
  },
];
