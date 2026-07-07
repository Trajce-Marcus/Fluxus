// Startup validation of every FluxScript expression in the SDM config —
// datasources and show conditions checked against the schema. This is the
// config-save-time check (DSL_SPEC §9); with the SDM still hand-edited as
// files, "save time" is app start, and diagnostics land on the console.

import { validateExpression, lintSchema, type Diagnostic } from '@fluxus/dsl';
import type { ConfigRaw } from '../types';
import { buildDslSchema, shortName } from './bridge';

interface Finding {
  where: string;
  diagnostic: Diagnostic;
}

export function validateConfig(config: ConfigRaw): Finding[] {
  const schema = buildDslSchema(config);
  const findings: Finding[] = [];

  const collect = (where: string, source: string, anchorType?: string) => {
    for (const diagnostic of validateExpression(source, schema, { anchorType })) {
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
        if (attr?.type_config?.datasource) {
          collect(`${activity.id} → '${usage.attribute_ref}' datasource`, attr.type_config.datasource, anchorType);
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
