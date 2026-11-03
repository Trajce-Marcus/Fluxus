// A form's GETs (APPS_AND_INSTANCES Part 2 §2.2). A dropdown's datasource is
// the one capture expression allowed a round trip, and it reaches a GET with
// `invoke('act_…')` — directly, or through a named function it calls. An app
// counts the GETs its listed activities' forms call as on its list without
// their being added, so the server must be able to work them out from the
// model alone: from the literal ids on that path. A computed id there is
// refused at model save (`validateModel`), so what is worked out here is the
// whole answer.

import { parseExpression, parseFunction, type Call } from '@fluxus/dsl';
import { joinScript } from './bridge';
import type { ClientSolutionModel } from './types';

/** Visit every Call node reachable from a parsed script (statements, args). */
export function walkCalls(node: unknown, visit: (call: Call) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkCalls(item, visit);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  if (rec.kind === 'call') visit(node as Call);
  for (const [key, value] of Object.entries(rec)) {
    if (key === 'pos') continue;
    walkCalls(value, visit);
  }
}

/** One `invoke` on a datasource's path, and where it is: the datasource
 *  itself, or a named function it reaches. */
export interface DatasourceInvoke {
  where: string;
  /** The literal id, or null when the id is computed. */
  activityId: string | null;
}

/**
 * Every `invoke` an attribute's datasource makes, following the named
 * functions it calls, and the functions those call. Keyed by attribute key;
 * attributes with no datasource are absent. A source that does not parse is
 * skipped — the validator reports it.
 */
export function datasourceInvokes(config: Pick<ClientSolutionModel, 'attributes' | 'functions'>): Map<string, DatasourceInvoke[]> {
  const bodies = new Map((config.functions ?? []).map((fn) => [fn.name.toLowerCase(), fn]));
  const out = new Map<string, DatasourceInvoke[]>();
  for (const attr of config.attributes) {
    const datasource = attr.type_config?.datasource;
    if (!datasource) continue;
    const found: DatasourceInvoke[] = [];
    const visited = new Set<string>();
    const visit = (node: unknown, where: string) => {
      walkCalls(node, (call) => {
        if (call.callee.kind !== 'ident') return;
        const name = call.callee.name.toLowerCase();
        if (name === 'invoke') {
          const first = call.args[0]?.value;
          found.push({ where, activityId: first?.kind === 'string' ? first.value : null });
          return;
        }
        const fn = bodies.get(name);
        if (!fn || visited.has(name)) return;
        visited.add(name);
        try {
          visit(parseFunction(joinScript(fn.body) ?? '').body, `function '${fn.name}'`);
        } catch {
          // reported by validateFunction
        }
      });
    };
    try {
      visit(parseExpression(datasource), `attribute '${attr.key}' datasource`);
    } catch {
      // reported by the datasource's own check
    }
    out.set(attr.key, found);
  }
  return out;
}

/**
 * The GETs the forms of `activityIds` call: the literal ids their attributes'
 * datasources invoke — composite cells included — and the named functions
 * those datasources reach. What counts as on an app's list besides the list
 * itself (§2.2).
 */
export function formGetIds(config: ClientSolutionModel, activityIds: Iterable<string>): Set<string> {
  const invokes = datasourceInvokes(config);
  const attrByKey = new Map(config.attributes.map((a) => [a.key, a]));
  const poolById = new Map((config.activities ?? []).map((a) => [a.id, a]));
  const ids = new Set<string>();
  const add = (key: string) => {
    for (const { activityId } of invokes.get(key) ?? []) if (activityId !== null) ids.add(activityId);
  };
  for (const id of activityIds) {
    for (const usage of poolById.get(id)?.attributes ?? []) {
      if (!('attribute_ref' in usage)) continue;
      add(usage.attribute_ref);
      const attr = attrByKey.get(usage.attribute_ref);
      if (attr?.type === 'composite') for (const cell of attr.type_config?.attributes ?? []) add(cell.attribute_ref);
    }
  }
  return ids;
}
