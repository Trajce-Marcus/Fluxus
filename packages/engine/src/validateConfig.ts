// Startup validation of every FluxScript script in the SDM config —
// datasources, show conditions, validation rules, hooks, and named functions
// checked against the schema. This is the config-save-time check (DSL_SPEC §9);
// with the SDM still hand-edited as files, "save time" is app start, and
// diagnostics land on the console.

import { RESERVED_IDS } from './platformApps';
import { attributeFieldRef } from './attributeTypes';
import { validateExpression, validateScript, validateFunction, parseFunction, parseScript, lintSchema, type Diagnostic, type ServiceModuleDef, type Stmt } from '@fluxus/dsl';
import type { ActivityRawDef, ClientActivityRawDef, ClientSolutionConfig } from './types';
import { attributeTypeSpec } from './attributeTypes';
import { activityHooks, buildDslSchema, joinScript, shortName } from './bridge';
import { buildLoggerModule } from './services/logger';
import { includedActivityIds, recordTypesByActivity } from './activityPool';
import { datasourceInvokes, walkCalls } from './formGets';

export interface Finding {
  where: string;
  diagnostic: Diagnostic;
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

/** What a model save knows beyond the model itself. */
export interface ValidateConfigOptions {
  /**
   * The workflows pages name as their app's list (`PageDef.workflowId`,
   * drafts and latest published versions; APPS_AND_INSTANCES §2.2). The rules
   * for an app's list apply to these only, so ordinary editing of a record
   * type's workflow is untouched. The server knows them; a host without pages
   * passes none.
   */
  appLists?: ReadonlySet<string>;
}

export function validateConfig(config: ClientSolutionConfig, services: ServiceModuleDef[] = [], options: ValidateConfigOptions = {}): Finding[] {
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

  // The platform's own ids (an operation's apps, their history entries) are
  // not a solution's to use (APPS_AND_INSTANCES §2.4).
  for (const [kind, ids] of [
    ['record type', config.recordTypes.map((rt) => rt.id)],
    ['workflow', config.workflows.map((wf) => wf.id)],
    ['activity', (config.activities ?? []).map((a) => a.id)],
  ] as const) {
    for (const id of ids) if (RESERVED_IDS.has(id)) note(`${kind} '${id}'`, `'${id}' is reserved by the platform`);
  }

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

  // ── The activity pool (APPS_AND_INSTANCES §1.4) ────────────────────────────
  const pool = config.activities ?? [];
  const poolIds = new Set<string>();
  for (const activity of pool) {
    if (poolIds.has(activity.id)) note(`activity '${activity.id}'`, 'duplicate activity id in the pool');
    poolIds.add(activity.id);
  }
  for (const workflow of config.workflows) {
    const listed = new Set<string>();
    for (const usage of workflow.activities) {
      if (!poolIds.has(usage.activity_ref)) {
        note(`workflow '${workflow.id}'`, `activity '${usage.activity_ref}' is not in the activity pool`);
      }
      if (listed.has(usage.activity_ref)) {
        note(`workflow '${workflow.id}'`, `lists activity '${usage.activity_ref}' twice`);
      }
      listed.add(usage.activity_ref);
    }
  }
  const typesByActivity = recordTypesByActivity(config);
  const included = includedActivityIds(config);

  // ── An app's list (APPS_AND_INSTANCES §2.2) ───────────────────────────────
  // Only for workflows pages name. An activity on one that no record type's
  // workflow lists is the app's own: it may only log or read (a CREATE would
  // have no type to make, an UPDATE or DELETE would change the app itself).
  // An item's condition is checked as the activity's own is, against each
  // record type the activity runs on — untyped for the app's own until step 5
  // gives `rt_sys_apps` its definition. A condition on any other workflow is an
  // error, and so is a record type pointing at a page's list.
  const appLists = options.appLists ?? new Set<string>();
  const poolById = new Map(pool.map((a) => [a.id, a]));
  for (const rt of config.recordTypes) {
    if (appLists.has(rt.workflow_ref)) {
      note(`record type '${rt.id}'`, `points at '${rt.workflow_ref}', which a page names as its app's list — a record type needs a workflow of its own`);
    }
  }
  for (const workflow of config.workflows) {
    const isList = appLists.has(workflow.id);
    for (const usage of workflow.activities) {
      if (usage.show_condition !== undefined && !isList) {
        note(`workflow '${workflow.id}'`, `'${usage.activity_ref}' carries a condition, which only an app's list may (a workflow a page names)`);
      }
      const activity = poolById.get(usage.activity_ref);
      if (!isList || !activity) continue;
      const types = typesByActivity.get(activity.id) ?? [];
      if (types.length === 0 && activity.record_map !== undefined && activity.record_map !== 'GET') {
        note(`workflow '${workflow.id}'`, `'${activity.id}' is the app's own (in no record type's workflow), so it may only log or read — not ${activity.record_map}`);
      }
      if (!usage.show_condition?.trim()) continue;
      const anchors = types.length > 0 ? types : [undefined];
      for (const typeId of anchors) {
        const diagnostics = validateExpression(usage.show_condition, schema, {
          anchorType: typeId ? shortName(typeId) : undefined,
          bannedRoots: ['attributes'],
          functions,
        });
        for (const diagnostic of diagnostics) {
          findings.push({
            where: `workflow '${workflow.id}' → '${activity.id}' condition${anchors.length > 1 ? ` (on ${typeId})` : ''}`,
            diagnostic,
          });
        }
      }
    }
  }

  // The engine works out which type a CREATE makes from the one record type
  // whose workflow lists it. Reached through two, it could not say.
  for (const activity of pool) {
    const types = typesByActivity.get(activity.id) ?? [];
    if (activity.record_map === 'CREATE' && types.length > 1) {
      note(activity.id, `a CREATE belongs to one record type; this one is reached through ${types.join(', ')}`);
    }
  }

  // Every runnable activity's record_map, so a literal invoke('act_…') can be
  // resolved to a real GET below. Only activities some workflow lists can run,
  // so only they are here — matching validatePage and the engine.
  const recordMapById = new Map<string, string | undefined>();
  for (const activity of pool) {
    if (included.has(activity.id)) recordMapById.set(activity.id, activity.record_map);
  }

  /** What is wrong with `invoke('<id>')`, if anything: the id must be a
   *  runnable activity and must be a GET. */
  const invokeProblem = (id: string): string | null => {
    if (!recordMapById.has(id)) {
      return poolIds.has(id)
        ? `invoke('${id}') — no workflow includes this activity, so it cannot run`
        : `invoke('${id}') — no such activity`;
    }
    return recordMapById.get(id) !== 'GET' ? `invoke('${id}') — only GET activities can be invoked` : null;
  };

  /**
   * Resolve literal ids passed to `invoke(...)` against the model. A
   * non-literal first argument is left to runtime — same posture as
   * validatePage's activity-id check. Not so on a datasource's path, below.
   */
  const checkInvokes = (where: string, source: string, out: Finding[]) => {
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
      const problem = invokeProblem(first.value);
      if (problem) out.push({ where, diagnostic: { severity: 'error', message: problem, line: 1, col: 1 } });
    });
  };

  // A datasource's GETs (APPS_AND_INSTANCES §2.2): what a form calls counts as
  // on an app's list, worked out from the literal ids in `invoke('…')` — in the
  // datasource and in every named function it reaches. So on that path an id
  // must be literal, and must name a GET. Every datasource is checked, not only
  // those of activities on a list today: any activity can be put on one later.
  // A function several datasources reach is reported once. A browser's copy
  // leaves out the workflows of record types its user may not read, so a GET
  // it lacks is unknown only on the full model (the grade rule above).
  const fullModel = pool.some(serverGrade);
  const reportedOnPath = new Set<string>();
  for (const [key, invokes] of datasourceInvokes(config)) {
    for (const { where, activityId } of invokes) {
      if (activityId !== null && !recordMapById.has(activityId) && !fullModel) continue;
      const problem = activityId === null
        ? `invoke() with a computed activity id — a form's GET must be named literally, so an app can tell it is on its list`
        : invokeProblem(activityId);
      if (!problem) continue;
      const at = where.startsWith('function') ? `${where} (reached from attribute '${key}' datasource)` : where;
      const once = `${where}\u0000${problem}`;
      if (reportedOnPath.has(once)) continue;
      reportedOnPath.add(once);
      note(at, problem);
    }
  }

  /** Every script an activity carries, checked with `context.record` typed as
   *  `anchorType` (untyped when undefined). */
  const activityScripts = (activity: ClientActivityRawDef, anchorType: string | undefined): Finding[] => {
    const out: Finding[] = [];
    const check = (where: string, source: string, extraRoots?: string[], bannedRoots?: string[]) => {
      for (const diagnostic of validateExpression(source, schema, { anchorType, extraRoots, bannedRoots, functions })) {
        out.push({ where, diagnostic });
      }
    };
    // Availability condition: evaluated before capture, so `attributes` is
    // banned. Server grade only (ACTIONS_OFFERED_BY_SERVER), so absent on a
    // client config, which simply has none to check.
    const availability = (activity as Partial<ActivityRawDef>).show_condition;
    if (availability) {
      check(`${activity.id} show_condition`, availability, undefined, ['attributes']);
    }
    for (const usage of activity.attributes) {
      if (!('attribute_ref' in usage)) continue;
      if (usage.show_condition) {
        check(`${activity.id} → '${usage.attribute_ref}' show_condition`, usage.show_condition);
      }
      const attr = attrByKey.get(usage.attribute_ref);
      const validation = usage.validation ?? attr?.validation;
      if (validation) {
        check(`${activity.id} → '${usage.attribute_ref}' validation`, validation, ['value']);
      }
      if (attr?.type_config?.datasource) {
        check(`${activity.id} → '${usage.attribute_ref}' datasource`, attr.type_config.datasource, DATASOURCE_ROOTS);
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
        out.push({ where: `${activity.id} ${phase}_hook`, diagnostic });
      }
      checkInvokes(`${activity.id} ${phase}_hook`, source, out);
    }
    const returns = joinScript((activity as { returns?: string | string[] }).returns);
    if (activity.record_map === 'GET' && returns) {
      check(`${activity.id} returns`, returns);
      checkInvokes(`${activity.id} returns`, returns, out);
    }
    return out;
  };

  for (const activity of pool) {
    for (const usage of activity.attributes) {
      // Section markers are presentation-only entries — no ref to validate.
      if (!('attribute_ref' in usage) && !usage.section?.trim()) {
        note(`${activity.id} section marker`, 'a section marker needs a non-empty label');
      }
    }

    // **Scripts are checked per record type** (§1.4): a shared activity must
    // fit every type that uses it, so `context.record` is typed as each in
    // turn. A problem every type has (syntax, an unknown function, a bad
    // invoke id) does not depend on the type and is reported once; the rest
    // name the type they fail on. An activity no record type reaches is
    // checked untyped, so field typos surface once a workflow includes it.
    const types = typesByActivity.get(activity.id) ?? [];
    if (types.length === 0) {
      findings.push(...activityScripts(activity, undefined));
    } else {
      const perType = types.map((typeId) => ({ typeId, found: activityScripts(activity, shortName(typeId)) }));
      const keyOf = (f: Finding) => `${f.where}\u0000${f.diagnostic.severity}\u0000${f.diagnostic.message}\u0000${f.diagnostic.line}:${f.diagnostic.col}`;
      const everyType = (f: Finding) => perType.every((t) => t.found.some((g) => keyOf(g) === keyOf(f)));
      const reported = new Set<string>();
      for (const { typeId, found } of perType) {
        for (const f of found) {
          if (types.length > 1 && !everyType(f)) {
            findings.push({ where: `${f.where} (on ${typeId})`, diagnostic: f.diagnostic });
          } else if (!reported.has(keyOf(f))) {
            reported.add(keyOf(f));
            findings.push(f);
          }
        }
      }
    }

    // GET activities (DSL_SPEC §5a): the `returns` expression IS the
    // activity, so it is required — and it is only meaningful on a GET.
    // Validated as an expression (above), which is what gives purity for free:
    // the 'expression' mode already rejects create()/update() and unqueued
    // service effects, so a read cannot write.
    const returns = joinScript((activity as { returns?: string | string[] }).returns);
    if (activity.record_map === 'GET') {
      if (!returns && serverGrade(activity)) {
        note(activity.id, "a GET activity needs a 'returns' expression — that is what it answers with");
      }
      // Nothing persists, so there is nothing to react to. An after hook here
      // is either dead code or an attempt to make a read write.
      if (activityHooks(activity).after) {
        note(activity.id, 'a GET activity cannot have an after hook — reads never write');
      }
    } else if (returns) {
      note(activity.id, `'returns' belongs to GET activities; this one is ${activity.record_map ?? 'log-only'}`);
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
