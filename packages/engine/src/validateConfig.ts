// Startup validation of every FluxScript script in the SDM config —
// datasources, show conditions, validation rules, hooks, and named functions
// checked against the schema. This is the config-save-time check (DSL_SPEC §9);
// with the SDM still hand-edited as files, "save time" is app start, and
// diagnostics land on the console.

import { attributeFieldRef } from './attributeTypes';
import { validateExpression, validateScript, validateFunction, parseFunction, parseScript, lintSchema, type Call, type Diagnostic, type ServiceModuleDef, type Stmt } from '@fluxus/dsl';
import type { ClientActivityRawDef, ClientSolutionConfig } from './types';
import { attributeTypeSpec } from './attributeTypes';
import { activityHooks, buildDslSchema, joinScript, shortName } from './bridge';
import { buildLoggerModule } from './services/logger';

export interface Finding {
  where: string;
  diagnostic: Diagnostic;
}

/** Visit every Call node reachable from a parsed script (statements, args). */
function walkCalls(node: unknown, visit: (call: Call) => void): void {
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

// Either grade of config: the design plane validates the full model at save,
// while a browser host re-reports its trimmed copy as a version-drift net. The
// hook pass below simply finds nothing to check on the trimmed one.
//
// One rule cannot be written that way, though, and 2026-09-12 is when it bit:
// a GET's `returns` is *required* on the server grade and *absent by design*
// on the client's — the query never reaches the browser (CLIENT_TRUST_BOUNDARY
// / DATA_THROUGH_ACTIVITIES). Demanding it of a trimmed config reported every
// GET in the model as an error at boot. So a rule about something the trim
// removes has to know which grade it is looking at, and the grade is legible:
// hooks are **absent, not null**, from the client's copy.
/**
 * Which grade of config this activity came from. The client's copy omits the
 * server-only keys rather than nulling them, so their **presence** is the
 * signal — a hook that is explicitly `null` still says "this is the full
 * model, and there is no hook".
 */
const serverGrade = (activity: ClientActivityRawDef): boolean =>
  'before_hook' in activity || 'after_hook' in activity;

/**
 * The extra roots a datasource may name. `term` is the record picker's search
 * box (RECORD_PICKER §4): it lives in its own state, debounced, and reaches the
 * expression as a root — putting it in the form's values would collide
 * silently, since those are unknown-shaped and `attributes.term` would simply
 * read as blank at runtime.
 */
const DATASOURCE_ROOTS = ['term'];

export function validateConfig(config: ClientSolutionConfig, services: ServiceModuleDef[] = []): Finding[] {
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
    for (const cf of rt.custom_fields) {
      checkKey(`record type '${rt.id}'`, cf.key);
      // A reference field has to say what to SHOW, not only what it points at
      // (2026-09-23). `fk_display_field` has been documented as required on an
      // fk_ref since it was written and enforced nowhere, which was harmless
      // while a reference was drawn as its raw id. The record picker made it
      // matter: with no display field there is nothing readable to put in the
      // list, and the alternative to this rule is a silent fallback — guessing
      // `name`, or drawing blanks — that hides a modelling gap from the one
      // person who can fix it. Measured before adding: every reference field in
      // every solution already declares one, so nothing existing fails.
      if (cf.type === 'fk_ref' && !cf.fk_display_field) {
        note(
          `record type '${rt.id}'`,
          `reference field '${cf.key}' declares no fk_display_field — a picker has nothing readable to show`,
        );
      }
    }
    // The SDM's own collections are record types under this prefix, reached as
    // `model.<collection>` (docs/QUERYING_THE_MODEL.md). A solution type whose
    // stripped name starts with it would collide in the one type table, so the
    // clash is refused where it is authored rather than discovered in a query.
    if (shortName(rt.id).toLowerCase().startsWith('sdm_')) {
      note(
        `record type '${rt.id}'`,
        `'sdm_' is reserved for the model's own collections — rename this record type`,
      );
    }
  }

  for (const attr of config.attributes) {
    checkKey(`attribute '${attr.key}'`, attr.key);
    // type_config keys are a closed, per-type set (registry §5, §3): reject
    // unknown keys and `multi` where it is not legal (composite, §11). Types
    // absent from the registry (custom/experimental) are left unchecked.
    const spec = attributeTypeSpec(attr.type);
    if (spec && attr.type_config) {
      for (const cfgKey of Object.keys(attr.type_config)) {
        if (attr.type_config[cfgKey as keyof typeof attr.type_config] === undefined) continue;
        if (cfgKey === 'multi') {
          if (!spec.multi) note(`attribute '${attr.key}'`, `'${attr.type}' attributes cannot be multi`);
        } else if (!spec.configKeys.includes(cfgKey)) {
          note(`attribute '${attr.key}'`, `unknown type_config key '${cfgKey}' for type '${attr.type}'`);
        }
      }
    }
    // A declared landing field has to exist and has to be a reference, or the
    // value goes nowhere and nothing checks it — the two things the
    // declaration is for. Caught at save, where it can still be fixed.
    const fieldRef = attributeFieldRef(attr.type_config as Record<string, unknown> | undefined);
    if (fieldRef) {
      const target = config.recordTypes.find((rt) => rt.id === fieldRef.typeId);
      const field = target?.custom_fields.find((cf) => cf.key === fieldRef.fieldKey);
      if (!target) {
        note(`attribute '${attr.key}'`, `field '${fieldRef.typeId}.${fieldRef.fieldKey}' names no record type`);
      } else if (!field) {
        note(`attribute '${attr.key}'`, `'${fieldRef.typeId}' has no field '${fieldRef.fieldKey}'`);
      } else if (field.type !== 'fk_ref' || !field.fk_record_type) {
        note(`attribute '${attr.key}'`, `'${fieldRef.typeId}.${fieldRef.fieldKey}' is not a reference field`);
      }
    }
    if (attr.type_config?.datasource) {
      // `term` is the record picker's search box, injected as an extra root
      // rather than riding in the form's values (RECORD_PICKER §10) — without
      // it here every reference datasource that searches would save as an
      // error. Harmless on a list attribute, which simply never names it.
      collect(`attribute '${attr.key}' datasource`, attr.type_config.datasource, undefined, DATASOURCE_ROOTS);
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

  // Every activity's record_map, so a literal invoke('act_…') can be resolved
  // to a real GET below.
  const recordMapById = new Map<string, string | undefined>();
  for (const workflow of config.workflows) {
    for (const activity of workflow.activities) recordMapById.set(activity.id, activity.record_map);
  }

  /**
   * Resolve literal ids passed to `invoke(...)` against the model: the id must
   * exist and must be a GET. A non-literal first argument is left to runtime —
   * same posture as validatePage's activity-id check.
   */
  const checkInvokes = (where: string, source: string) => {
    let body: Stmt[];
    try {
      body = parseScript(source).body;
    } catch {
      return; // syntax errors are already reported by the validator
    }
    walkCalls(body, (call) => {
      if (call.callee.kind !== 'ident' || call.callee.name !== 'invoke') return;
      const first = call.args[0]?.value;
      if (first?.kind !== 'string') return;
      if (!recordMapById.has(first.value)) {
        note(where, `invoke('${first.value}') — no such activity`);
      } else if (recordMapById.get(first.value) !== 'GET') {
        note(where, `invoke('${first.value}') — only GET activities can be invoked`);
      }
    });
  };

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
          collect(`${activity.id} → '${usage.attribute_ref}' datasource`, attr.type_config.datasource, anchorType, DATASOURCE_ROOTS);
        }
      }
      // Hooks (scripts tier): before = gate (validate only), after = effects.
      // No extra roots: values reach a hook as declared attributes, never as a
      // free-form object off the wire (DATA_THROUGH_ACTIVITIES §4).
      const hooks = activityHooks(activity);
      for (const phase of ['before', 'after'] as const) {
        const source = phase === 'before' ? hooks.before : hooks.after;
        if (!source) continue;
        for (const diagnostic of validateScript(source, schema, { anchorType, mode: phase, functions })) {
          findings.push({ where: `${activity.id} ${phase}_hook`, diagnostic });
        }
        checkInvokes(`${activity.id} ${phase}_hook`, source);
      }

      // GET activities (DSL_SPEC §5a): the `returns` expression IS the
      // activity, so it is required — and it is only meaningful on a GET.
      // Validated as an expression, which is what gives purity for free: the
      // 'expression' mode already rejects create()/update() and unqueued
      // service effects, so a read cannot write.
      const returns = joinScript((activity as { returns?: string | string[] }).returns);
      if (activity.record_map === 'GET') {
        if (!returns && serverGrade(activity)) {
          note(activity.id, "a GET activity needs a 'returns' expression — that is what it answers with");
        } else if (returns) {
          collect(`${activity.id} returns`, returns, anchorType);
          checkInvokes(`${activity.id} returns`, returns);
        }
        // Nothing persists, so there is nothing to react to. An after hook here
        // is either dead code or an attempt to make a read write.
        if (hooks.after) {
          note(activity.id, 'a GET activity cannot have an after hook — reads never write');
        }
      } else if (returns) {
        note(activity.id, `'returns' belongs to GET activities; this one is ${activity.record_map ?? 'log-only'}`);
      }
    }
  }

  return findings;
}

export function reportConfigFindings(config: ClientSolutionConfig, services: ServiceModuleDef[] = []): void {
  const findings = validateConfig(config, services);
  for (const { where, diagnostic } of findings) {
    const log = diagnostic.severity === 'error' ? console.error : console.warn;
    log(`[SDM config ${diagnostic.severity}] ${where}: ${diagnostic.message}`);
  }
  if (findings.length === 0) {
    console.info('[SDM config] all FluxScript expressions validated clean');
  }
}
