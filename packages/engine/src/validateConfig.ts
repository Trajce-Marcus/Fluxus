// Startup validation of every FluxScript script in the SDM config —
// datasources, show conditions, validation rules, hooks, and named functions
// checked against the schema. This is the config-save-time check (DSL_SPEC §9);
// with the SDM still hand-edited as files, "save time" is app start, and
// diagnostics land on the console.

import { validateExpression, validateScript, validateFunction, parseFunction, lintSchema, type Diagnostic, type ServiceModuleDef } from '@fluxus/dsl';
import type { ConfigRaw } from './types';
import { buildDslSchema, joinScript, shortName } from './bridge';
import { buildLoggerModule } from './services/logger';

export interface Finding {
  where: string;
  diagnostic: Diagnostic;
}

export function validateConfig(config: ConfigRaw, services: ServiceModuleDef[] = []): Finding[] {
  // services.logger is engine-owned and part of every host's registry
  // (createEngine appends it, name reserved) — validation must see the same
  // registry the engine runs with, whoever is validating.
  const registry = services.some((m) => m.name.toLowerCase() === 'logger')
    ? services
    : [...services, buildLoggerModule(() => {})];
  const schema = buildDslSchema(config, registry);
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

  const collect = (where: string, source: string, anchorType?: string, extraRoots?: string[], bannedRoots?: string[]) => {
    for (const diagnostic of validateExpression(source, schema, { anchorType, extraRoots, bannedRoots, functions })) {
      findings.push({ where, diagnostic });
    }
  };

  for (const diagnostic of lintSchema(schema)) {
    findings.push({ where: 'schema', diagnostic });
  }

  const attrByKey = new Map(config.attributes.map((a) => [a.key, a]));
  const rtByWorkflow = new Map(config.recordTypes.map((rt) => [rt.workflow_ref, rt]));

  // '.' is reserved as the composite cell path separator (attr.item.column) —
  // ban it from every key namespace so a dotted path is always unambiguous.
  const checkKey = (where: string, key: string) => {
    if (key.includes('.')) note(where, `key '${key}' contains '.' — reserved as the composite path separator`);
  };
  for (const rt of config.recordTypes) {
    for (const cf of rt.custom_fields) checkKey(`record type '${rt.id}'`, cf.key);
  }

  for (const attr of config.attributes) {
    checkKey(`attribute '${attr.key}'`, attr.key);
    if (attr.type_config?.datasource) {
      collect(`attribute '${attr.key}' datasource`, attr.type_config.datasource);
    }
    if (attr.type !== 'composite') continue;

    // Composite structure: sub-usages pointing at real pool attributes (the
    // same wrapper shape an activity uses) — reuse, not inline definitions.
    const where = `composite attribute '${attr.key}'`;
    const subs = attr.type_config?.attributes ?? [];
    if (subs.length === 0) note(where, 'a composite needs at least one sub-attribute (type_config.attributes)');
    const seenSubs = new Set<string>();
    for (const sub of subs) {
      const target = attrByKey.get(sub.attribute_ref);
      if (!target) {
        note(where, `sub-attribute '${sub.attribute_ref}' not found in the attribute pool`);
        continue;
      }
      if (seenSubs.has(sub.attribute_ref)) note(where, `duplicate sub-attribute '${sub.attribute_ref}'`);
      seenSubs.add(sub.attribute_ref);
      if (target.type === 'composite') note(where, `sub-attribute '${sub.attribute_ref}': composites cannot nest`);
      if (target.type === 'reference') note(where, `sub-attribute '${sub.attribute_ref}': reference sub-attributes are not supported yet`);
      if (sub.show_condition) {
        collect(`${where} → '${sub.attribute_ref}' show_condition`, sub.show_condition);
      }
      const validation = sub.validation ?? target.validation;
      if (validation) {
        collect(`${where} → '${sub.attribute_ref}' validation`, validation, undefined, ['value']);
      }
    }
  }

  for (const workflow of config.workflows) {
    const anchorType = rtByWorkflow.has(workflow.id) ? shortName(rtByWorkflow.get(workflow.id)!.id) : undefined;
    for (const activity of workflow.activities) {
      // Availability condition: evaluated before capture, so `attributes` is banned
      if (activity.show_condition) {
        collect(`${activity.id} show_condition`, activity.show_condition, anchorType, undefined, ['attributes']);
      }
      for (const usage of activity.attributes) {
        // Section markers are presentation-only entries — no ref to validate.
        if (!('attribute_ref' in usage)) {
          if (!usage.section?.trim()) note(`${activity.id} section marker`, 'a section marker needs a non-empty label');
          continue;
        }
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
      // Hooks (scripts tier): before = gate (validate only), after = effects.
      // `callbackData` is legal in any hook — every activity may be
      // app-triggered (Extraction stage 2); it is null on direct runs.
      for (const phase of ['before', 'after'] as const) {
        const source = joinScript(phase === 'before' ? activity.before_hook : activity.after_hook);
        if (!source) continue;
        for (const diagnostic of validateScript(source, schema, { anchorType, mode: phase, functions, extraRoots: ['callbackData'] })) {
          findings.push({ where: `${activity.id} ${phase}_hook`, diagnostic });
        }
      }
    }
  }

  return findings;
}

export function reportConfigFindings(config: ConfigRaw, services: ServiceModuleDef[] = []): void {
  const findings = validateConfig(config, services);
  for (const { where, diagnostic } of findings) {
    const log = diagnostic.severity === 'error' ? console.error : console.warn;
    log(`[SDM config ${diagnostic.severity}] ${where}: ${diagnostic.message}`);
  }
  if (findings.length === 0) {
    console.info('[SDM config] all FluxScript expressions validated clean');
  }
}
