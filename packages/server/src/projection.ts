// The model's client projection (docs/CLIENT_TRUST_BOUNDARY.md §2): one pure
// function turning the stored model into the copy a browser on the runtime
// plane is given. One place to audit, one place to test.
//
// The rule the whole file rests on: **it builds its output by naming each field
// that goes in.** Removing fields instead (`delete config.hooks`) leaks every
// field added to the model later, until somebody remembers; naming what goes in
// makes new fields invisible until somebody deliberately exposes them. If you
// add a field to the SDM and it does not appear here, it does not reach the
// browser — which is the correct default.

import type {
  ClientActivityRawDef,
  ClientAttributeDef,
  ClientAttributeTypeConfig,
  ClientCustomFieldDef,
  ClientRecordTypeDef,
  ClientSolutionConfig,
  ClientWorkflowRawDef,
  AttributeUsageDef,
  FunctionDef,
  SectionMarkerDef,
  SolutionConfig,
} from '@fluxus/engine';
import type { MenuItem } from './db/schema';

/**
 * The record-type read surface (RBAC_COMPACT: role list, default deny, server
 * partition filter). Returns the set of type ids readable to the caller in the
 * operation, or `null` when RBAC is dormant/off (everything readable):
 *   - auth unconfigured (env stub) ⇒ null (open), OR
 *   - the solution declares no `access.roles` ⇒ null (adoption posture).
 * Otherwise **default deny**: a type is readable only if its `access.read`
 * lists a role the user holds. A held role set comes from `runtimeRoles`.
 *
 * The same answer governs both halves of a snapshot — which records ship
 * (`records.partition`) and which of the model ships (`projectConfig`) — which
 * is why it lives here rather than in either caller.
 */
export function computeReadable(
  authConfigured: boolean | undefined,
  config: SolutionConfig,
  roles: string[] | undefined,
): Set<string> | null {
  if (!authConfigured) return null; // env stub ⇒ everything open
  if (!config.access?.roles?.length) return null; // solution opted out ⇒ open (adoption)
  const held = new Set(roles ?? []);
  const readable = new Set<string>();
  for (const rt of config.recordTypes) {
    if ((rt.access?.read ?? []).some((r) => held.has(r))) readable.add(rt.id); // default deny
  }
  return readable;
}

/** A field's identity, what it is called, and its FK wiring — enough to display
 *  a value and to traverse a relationship. Storage constraints stay
 *  server-side; nothing in a browser builds a record. */
function clientCustomField(cf: ClientCustomFieldDef): ClientCustomFieldDef {
  return {
    key: cf.key,
    ...(cf.label !== undefined ? { label: cf.label } : {}),
    type: cf.type,
    ...(cf.fk_record_type !== undefined ? { fk_record_type: cf.fk_record_type } : {}),
    ...(cf.fk_display_field !== undefined ? { fk_display_field: cf.fk_display_field } : {}),
  };
}

/**
 * Everything that decides how a value is captured and displayed — including
 * `max_count`, which the widget checks so the user is stopped at the add tile
 * rather than at submit. It is client-side **validation**, never enforcement:
 * `validateSubmission` is what actually holds the ceiling.
 *
 * `max_size_mb` stays server-side: it gates the presign, before any bytes move.
 */
function clientTypeConfig(cfg: ClientAttributeTypeConfig): ClientAttributeTypeConfig {
  const out: ClientAttributeTypeConfig = {};
  if (cfg.fk_record_type !== undefined) out.fk_record_type = cfg.fk_record_type;
  if (cfg.values !== undefined) out.values = cfg.values;
  if (cfg.expression !== undefined) out.expression = cfg.expression;
  if (cfg.multi !== undefined) out.multi = cfg.multi;
  if (cfg.datasource !== undefined) out.datasource = cfg.datasource;
  if (cfg.key_field !== undefined) out.key_field = cfg.key_field;
  if (cfg.display_field !== undefined) out.display_field = cfg.display_field;
  if (cfg.columns !== undefined) out.columns = cfg.columns;
  if (cfg.multiline !== undefined) out.multiline = cfg.multiline;
  if (cfg.decimal_places !== undefined) out.decimal_places = cfg.decimal_places;
  if (cfg.accept !== undefined) out.accept = cfg.accept;
  if (cfg.max_count !== undefined) out.max_count = cfg.max_count;
  if (cfg.attributes !== undefined) out.attributes = cfg.attributes.map(clientUsage);
  return out;
}

/** A usage wrapper is client-facing in full — every field on it decides what
 *  the form does. */
function clientUsage(usage: AttributeUsageDef): AttributeUsageDef {
  return {
    attribute_ref: usage.attribute_ref,
    ...(usage.show_condition !== undefined ? { show_condition: usage.show_condition } : {}),
    ...(usage.required !== undefined ? { required: usage.required } : {}),
    ...(usage.validation !== undefined ? { validation: usage.validation } : {}),
    ...(usage.validation_message !== undefined ? { validation_message: usage.validation_message } : {}),
    ...(usage.can_waive !== undefined ? { can_waive: usage.can_waive } : {}),
  };
}

/**
 * Validation expressions ship deliberately: the client needs them for inline
 * validation, they are not secret (the user discovers the rule by hitting it
 * anyway), and the server revalidates regardless.
 */
function clientAttribute(attr: ClientAttributeDef): ClientAttributeDef {
  return {
    key: attr.key,
    label: attr.label,
    description: attr.description,
    type: attr.type,
    ...(attr.type_config !== undefined ? { type_config: clientTypeConfig(attr.type_config) } : {}),
    ...(attr.show_condition !== undefined ? { show_condition: attr.show_condition } : {}),
    ...(attr.required !== undefined ? { required: attr.required } : {}),
    ...(attr.validation !== undefined ? { validation: attr.validation } : {}),
    ...(attr.validation_message !== undefined ? { validation_message: attr.validation_message } : {}),
    ...(attr.can_waive !== undefined ? { can_waive: attr.can_waive } : {}),
  };
}

/** The form definition and what decides whether it is offered — never the
 *  hooks, which are the whole prize (§2). */
function clientActivity(act: ClientActivityRawDef): ClientActivityRawDef {
  return {
    id: act.id,
    name: act.name,
    description: act.description,
    sort_order: act.sort_order,
    ...(act.record_map !== undefined ? { record_map: act.record_map } : {}),
    ...(act.show_condition !== undefined ? { show_condition: act.show_condition } : {}),
    attributes: act.attributes.map((entry) =>
      'attribute_ref' in entry
        ? clientUsage(entry)
        : ({ section: entry.section, ...(entry.description !== undefined ? { description: entry.description } : {}) } satisfies SectionMarkerDef),
    ),
  };
}

function clientRecordType(rt: ClientRecordTypeDef): ClientRecordTypeDef {
  return {
    id: rt.id,
    name: rt.name,
    description: rt.description,
    workflow_ref: rt.workflow_ref,
    ...(rt.id_field !== undefined ? { id_field: rt.id_field } : {}),
    custom_fields: rt.custom_fields.map(clientCustomField),
  };
}

/** Every FluxScript source that survives the trim — the reachability roots for
 *  named functions below. */
function shippedExpressions(
  workflows: ClientWorkflowRawDef[],
  attributes: ClientAttributeDef[],
): string[] {
  const sources: string[] = [];
  const push = (source: string | undefined) => {
    if (source) sources.push(source);
  };
  for (const wf of workflows) {
    for (const act of wf.activities) {
      push(act.show_condition);
      for (const entry of act.attributes) {
        if (!('attribute_ref' in entry)) continue;
        push(entry.show_condition);
        push(entry.validation);
      }
    }
  }
  for (const attr of attributes) {
    push(attr.show_condition);
    push(attr.validation);
    push(attr.type_config?.datasource);
  }
  return sources;
}

/** Bare-name calls, the only way FluxScript reaches a named function. Matching
 *  is deliberately loose — an over-inclusive scan ships a function nobody
 *  calls, an under-inclusive one breaks an expression at runtime. */
const CALLS = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

function calledNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const [, name] of source.matchAll(CALLS)) names.add(name.toLowerCase());
  return names;
}

/**
 * Functions reachable from a shipped expression, transitively — a shipped
 * function may call another. First cut per §2: no further pruning inside a
 * body. Hook-only helpers never ship, which is the point: they are hook logic
 * living under another name.
 */
function reachableFunctions(all: FunctionDef[], sources: string[]): FunctionDef[] {
  if (all.length === 0) return [];
  const byName = new Map(all.map((fn) => [fn.name.toLowerCase(), fn]));
  const kept = new Map<string, FunctionDef>();
  const queue = sources.flatMap((source) => [...calledNames(source)]);
  while (queue.length > 0) {
    const name = queue.pop()!;
    const fn = byName.get(name);
    if (!fn || kept.has(name)) continue;
    kept.set(name, fn);
    const body = Array.isArray(fn.body) ? fn.body.join('\n') : fn.body;
    queue.push(...calledNames(body));
  }
  return all.filter((fn) => kept.has(fn.name.toLowerCase()));
}

/**
 * The stored model → the copy this caller gets, trimmed by role.
 *
 * Two cuts are described in §2; this is the first, the security one. The second
 * — trimming by page, the larger payload win — waits on the page declaration
 * (§7) and lands as a second option on this same function.
 *
 * `default_menu` rides through untouched: it is the operation's navigation, the
 * runtime cannot render without it, and the operation's own override (which
 * usually wins) arrives untrimmed from `operations.get` anyway. It is not part
 * of `ClientSolutionConfig` because the engine is menu-blind.
 */
export function projectConfig(
  config: SolutionConfig,
  { roles, enforced }: { roles: string[] | undefined; enforced: boolean | undefined },
): ClientSolutionConfig & { default_menu?: MenuItem[] } {
  const readable = computeReadable(enforced, config, roles);

  // Unreadable record types go entirely, and their workflows and activities
  // with them — an activity you could never run on a record you could never
  // read is not "unrunnable" by a second rule, it is the same rule.
  const recordTypes = config.recordTypes.filter((rt) => readable === null || readable.has(rt.id));
  const shippedWorkflowIds = new Set(recordTypes.map((rt) => rt.workflow_ref));
  const workflows: ClientWorkflowRawDef[] = config.workflows
    .filter((wf) => shippedWorkflowIds.has(wf.id))
    .map((wf) => ({
      id: wf.id,
      name: wf.name,
      description: wf.description,
      activities: wf.activities.map(clientActivity),
    }));

  // The attribute pool ships by reference, not wholesale: an attribute reached
  // only by a workflow that did not survive describes a form this caller can
  // never open. Composites reach further pool attributes through their
  // sub-usages, so the walk is transitive.
  const pool = new Map(config.attributes.map((a) => [a.key, a]));
  const referenced = new Set<string>();
  const reach = (key: string) => {
    if (referenced.has(key)) return;
    const attr = pool.get(key);
    if (!attr) return; // dangling refs are a save-time error, not this function's business
    referenced.add(key);
    for (const sub of attr.type_config?.attributes ?? []) reach(sub.attribute_ref);
  };
  for (const wf of workflows) {
    for (const act of wf.activities) {
      for (const entry of act.attributes) {
        if ('attribute_ref' in entry) reach(entry.attribute_ref);
      }
    }
  }
  const attributes = config.attributes.filter((a) => referenced.has(a.key)).map(clientAttribute);

  const functions = reachableFunctions(config.functions ?? [], shippedExpressions(workflows, attributes));
  const defaultMenu = (config as { default_menu?: MenuItem[] }).default_menu;

  return {
    attributes,
    recordTypes: recordTypes.map(clientRecordType),
    workflows,
    // Absent stays absent, as everywhere else in the model.
    ...(functions.length > 0 ? { functions } : {}),
    ...(defaultMenu !== undefined ? { default_menu: defaultMenu } : {}),
  };
}
