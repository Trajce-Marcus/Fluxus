// Startup validation of every FluxScript script in the SDM config —
// datasources, show conditions, validation rules, hooks, and named functions
// checked against the schema. This is the config-save-time check (DSL_SPEC §9);
// with the SDM still hand-edited as files, "save time" is app start, and
// diagnostics land on the console.

import { validateExpression, validateScript, validateFunction, parseFunction, lintSchema, type Diagnostic } from '@fluxus/dsl';
import type { ConfigRaw } from '../types';
import { buildDslSchema, joinScript, shortName } from './bridge';

interface Finding {
  where: string;
  diagnostic: Diagnostic;
}

export function validateConfig(config: ConfigRaw): Finding[] {
  const schema = buildDslSchema(config);
  const findings: Finding[] = [];

  const note = (where: string, message: string) => {
    findings.push({ where, diagnostic: { severity: 'error', message, line: 1, col: 1 } });
  };

  // Named functions first — their signatures feed every other check.
  // Governance (DSL_SPEC §8): mandatory description, flat namespace, declared
  // name must match the collection entry.
  const functions: Record<string, { params: string[] }> = {};
  for (const fn of config.functions ?? []) {
    const where = `function '${fn.name}'`;
    if (!fn.description?.trim()) note(where, 'description is mandatory for named functions');
    try {
      const decl = parseFunction(joinScript(fn.body) ?? '');
      if (decl.name !== fn.name.toLowerCase()) {
        note(where, `declared name '${decl.name}' does not match the collection entry '${fn.name}'`);
      }
      if (decl.name in functions) {
        note(where, `duplicate function name '${decl.name}' — the namespace is flat`);
      }
      functions[decl.name] = { params: decl.params };
    } catch {
      // parse failure is reported by validateFunction below
    }
  }
  // Bodies validated once every signature is known — functions may call each other
  for (const fn of config.functions ?? []) {
    for (const diagnostic of validateFunction(joinScript(fn.body) ?? '', schema, { functions })) {
      findings.push({ where: `function '${fn.name}'`, diagnostic });
    }
  }

  const collect = (where: string, source: string, anchorType?: string, extraRoots?: string[]) => {
    for (const diagnostic of validateExpression(source, schema, { anchorType, extraRoots, functions })) {
      findings.push({ where, diagnostic });
    }
  };

  for (const diagnostic of lintSchema(schema)) {
    findings.push({ where: 'schema', diagnostic });
  }

  const attrByKey = new Map(config.attributes.map((a) => [a.key, a]));
  const rtByWorkflow = new Map(config.recordTypes.map((rt) => [rt.workflow_ref, rt]));

  for (const attr of config.attributes) {
    if (attr.type_config?.datasource) {
      collect(`attribute '${attr.key}' datasource`, attr.type_config.datasource);
    }
  }

  for (const workflow of config.workflows) {
    const anchorType = rtByWorkflow.has(workflow.id) ? shortName(rtByWorkflow.get(workflow.id)!.id) : undefined;
    for (const activity of workflow.activities) {
      for (const usage of activity.attributes) {
        if (usage.show_condition) {
          collect(`${activity.id} → '${usage.attribute_ref}' show_condition`, usage.show_condition, anchorType);
        }
        const attr = attrByKey.get(usage.attribute_ref);
        const validation = usage.validation ?? attr?.validation;
        if (validation) {
          collect(`${activity.id} → '${usage.attribute_ref}' validation`, validation, anchorType, ['value']);
        }
        if (attr?.type_config?.datasource) {
          collect(`${activity.id} → '${usage.attribute_ref}' datasource`, attr.type_config.datasource, anchorType);
        }
      }
      // Hooks (scripts tier): before = gate (validate only), after = effects
      for (const phase of ['before', 'after'] as const) {
        const source = joinScript(phase === 'before' ? activity.before_hook : activity.after_hook);
        if (!source) continue;
        for (const diagnostic of validateScript(source, schema, { anchorType, mode: phase, functions })) {
          findings.push({ where: `${activity.id} ${phase}_hook`, diagnostic });
        }
      }
    }
  }

  return findings;
}

export function reportConfigFindings(config: ConfigRaw): void {
  const findings = validateConfig(config);
  for (const { where, diagnostic } of findings) {
    const log = diagnostic.severity === 'error' ? console.error : console.warn;
    log(`[SDM config ${diagnostic.severity}] ${where}: ${diagnostic.message}`);
  }
  if (findings.length === 0) {
    console.info('[SDM config] all FluxScript expressions validated clean');
  }
}
