// Bridge between the SDM runtime and @fluxus/dsl: maps the config to the
// validator's DslSchema, the Store to the evaluator's RecordsHost, and builds
// EvalHosts for script execution. Scripts use short type names (records.assets),
// the store uses prefixed ids (rt_assets) — the bridge owns that translation.

import { withModelTypes, resolvedCaptureLists } from './modelProjection';
import { FkPointer, parseFunction, servicesSchema, type DslRecord, type DslSchema, type EvalHost, type Quotas, type RecordsHost, type ServiceModuleDef } from '@fluxus/dsl';
import type {
  ActivityRawDef,
  AttributeDef,
  ClientActivityRawDef,
  ClientCustomFieldDef,
  ClientSolutionConfig,
  ContextUser,
  SolutionConfig,
  RecordInstance,
} from './types';
import type { Store } from './store';

/**
 * `context.user` when no authenticated user is injected — the auth-unconfigured
 * posture (fresh clone, tests, local dev). roles [] so role expressions
 * evaluate uniformly either way.
 */
export const DEMO_USER: ContextUser = { id: 'demo', name: 'Demo User', email: null, roles: [] };

export const shortName = (rtId: string): string => rtId.replace(/^rt_/, '');
export const fullId = (short: string): string => `rt_${short}`;

/**
 * What to show a person for a custom field. `label` is optional and arrived
 * late (2026-08-09), so the key is the fallback — every field stored before it
 * has no label, and none of them should suddenly render blank. One helper so
 * that fallback is stated once instead of at each display site.
 */
export const fieldLabel = (field: ClientCustomFieldDef): string => field.label?.trim() || field.key;

/**
 * Scripts in the SDM JSON (hooks, function bodies) are canonically strings; an
 * array of lines is a hand-editing convenience, joined on load (DSL_SPEC §8).
 */
export function joinScript(script: string | string[] | null | undefined): string | null {
  if (script === null || script === undefined) return null;
  return Array.isArray(script) ? script.join('\n') : script;
}

/**
 * An activity's two hooks, joined, from a config of either grade — absent on
 * the client's grade (CLIENT_TRUST_BOUNDARY §2), where they read as null. The
 * one place that widens `ClientActivityRawDef` back to the full def, so the
 * assumption "hooks may simply not be here" is stated once instead of at every
 * hook-reading site.
 */
export function activityHooks(activity: ClientActivityRawDef): { before: string | null; after: string | null } {
  const full = activity as Partial<ActivityRawDef>;
  return { before: joinScript(full.before_hook), after: joinScript(full.after_hook) };
}

/**
 * Flatten an evaluation result to plain data. Expression results carry DSL
 * shapes — DslRecord (`{id, type, fields}`), FkPointer field values — and
 * every consumer outside the DSL is SDM-blind: a page component, and now a
 * GET activity's caller. Records flatten to `{ id, ...fields }`, pointers to
 * their raw id. Moved here from page-runtime when GET landed, so the server
 * and the page host shape results identically.
 */
export function toComponentValue(value: unknown): unknown {
  if (value instanceof FkPointer) return value.id;
  if (Array.isArray(value)) return value.map(toComponentValue);
  if (value !== null && typeof value === 'object') {
    const maybe = value as { id?: unknown; type?: unknown; fields?: unknown };
    if (typeof maybe.type === 'string' && maybe.fields !== null && typeof maybe.fields === 'object') {
      const flat: Record<string, unknown> = { id: maybe.id };
      for (const [k, v] of Object.entries(maybe.fields as Record<string, unknown>)) {
        flat[k] = toComponentValue(v);
      }
      return flat;
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toComponentValue(v)]),
    );
  }
  return value;
}

/** Named function sources for the evaluator/validator (bodies joined). */
export function resolveFunctions(config: ClientSolutionConfig): string[] {
  return (config.functions ?? []).map((fn) => joinScript(fn.body) ?? '');
}

/**
 * Signature map for ValidateOptions.functions, parsed from the bodies.
 * Unparseable bodies are skipped — validateConfig reports those.
 */
export function functionSignatures(config: ClientSolutionConfig): Record<string, { params: string[] }> {
  const out: Record<string, { params: string[] }> = {};
  for (const fn of config.functions ?? []) {
    try {
      const decl = parseFunction(joinScript(fn.body) ?? '');
      out[decl.name] = { params: decl.params };
    } catch {
      // reported by validateConfig
    }
  }
  return out;
}

/**
 * Script values → stored field values. Dates persist as strings: date-only for
 * local midnight (matching hand-entered form values), full ISO otherwise.
 */
function serializeFieldValue(value: unknown): unknown {
  if (value instanceof Date) {
    if (value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0) {
      const mm = String(value.getMonth() + 1).padStart(2, '0');
      const dd = String(value.getDate()).padStart(2, '0');
      return `${value.getFullYear()}-${mm}-${dd}`;
    }
    return value.toISOString();
  }
  if (Array.isArray(value)) return value.map(serializeFieldValue);
  if (value !== null && typeof value === 'object') {
    // Nested bags (composite attribute values) — serialize each cell
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serializeFieldValue(v)]));
  }
  return value;
}

export function serializeFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, serializeFieldValue(v)]));
}

export function buildDslSchema(config: ClientSolutionConfig, services: ServiceModuleDef[] = []): DslSchema {
  const types: DslSchema['types'] = {};
  for (const rt of config.recordTypes) {
    const fields: DslSchema['types'][string]['fields'] = {};
    for (const cf of rt.custom_fields) {
      fields[cf.key] = {
        type: cf.type,
        ...(cf.type === 'fk_ref' && cf.fk_record_type
          ? { fkTarget: shortName(cf.fk_record_type) }
          : {}),
      };
    }
    types[shortName(rt.id)] = { fields };
  }
  return { types, services: servicesSchema(services) };
}

export function toDslRecord(record: RecordInstance): DslRecord {
  return { id: record.id, type: shortName(record.typeRef), fields: record.customFields };
}

export function buildRecordsHost(adapter: Store, config: ClientSolutionConfig): RecordsHost {
  const byShortName = new Map(config.recordTypes.map((rt) => [shortName(rt.id), rt]));

  return {
    hasType: (type) => byShortName.has(type),
    getAll: (type) => {
      const rt = byShortName.get(type);
      if (!rt) return [];
      return adapter.getRecordTypeData(rt.id).map(toDslRecord);
    },
    getById: (type, id) => {
      try {
        const record = adapter.getRecord(String(id));
        return record.typeRef === fullId(type) ? toDslRecord(record) : null;
      } catch {
        return null;
      }
    },
    fkTarget: (type, field) => {
      const cf = byShortName.get(type)?.custom_fields.find((c) => c.key === field);
      return cf?.type === 'fk_ref' && cf.fk_record_type ? shortName(cf.fk_record_type) : null;
    },
    reverseRef: (type, name) => {
      const source = byShortName.get(name);
      if (!source) return null;
      const fk = source.custom_fields.find(
        (c) => c.type === 'fk_ref' && c.fk_record_type === fullId(type),
      );
      return fk ? { sourceType: name, field: fk.key } : null;
    },
    // Staged mutations (DSL Phase 2): validate/shape now, persist on commit.
    mutate: {
      prepareCreate: (type, fields) => {
        const rt = byShortName.get(type);
        if (!rt) throw new Error(`Unknown record type '${type}'`);
        return toDslRecord(adapter.buildRecord(rt.id, serializeFields(fields)));
      },
      prepareUpdate: (type, id, fields) => {
        adapter.validateUpdate(String(id), serializeFields(fields));
      },
      prepareDelete: (type, id) => {
        // Reads the record to prove it exists (getRecord throws if not) and to
        // check it is the type the script named — a script that deleted a
        // record of the wrong type would be silently destructive.
        const record = adapter.getRecord(String(id));
        if (record.typeRef !== fullId(type)) {
          throw new Error(`Record '${id}' is not a ${type}`);
        }
      },
      apply: (ops) => {
        // Referential integrity, checked across the WHOLE staged set before a
        // single op lands (2026-09-21, the user's rule: a delete is refused
        // while something still points at the record).
        //
        // Why here and not in prepareDelete: a script deleting a subtree stages
        // the parent and its children together, and a per-record check against
        // the store would see the children still present and refuse the parent
        // — the script blocking itself. A reference only counts if the record
        // holding it is not itself on the way out, which is knowable only once
        // the set is complete. Nothing has been written at this point, so
        // throwing here leaves the store untouched.
        const going = new Set(ops.filter((op) => op.op === 'delete').map((op) => op.id));
        for (const id of going) {
          const blocked = blockingReferences(adapter, id, going);
          if (blocked) throw new Error(blocked);
        }
        for (const op of ops) {
          if (op.op === 'create') {
            adapter.insertRecord({
              id: op.record.id,
              typeRef: fullId(op.type),
              customFields: serializeFields(op.record.fields),
              activityHistory: [],
            });
          } else if (op.op === 'update') {
            adapter.updateRecord(op.id, serializeFields(op.fields));
          } else {
            // The row and its embedded history both go. The reporting rows
            // projected from that history are NOT touched here — deciding
            // their fate is deferred (2026-09-21), and leaving them is the
            // behaviour a DELETE record map already has.
            adapter.deleteRecord(op.id);
          }
        }
      },
    },
  };
}

export interface ScriptContext {
  attributes?: Record<string, unknown>;
  /**
   * When set, used directly (not copied) as the `attributes` root, so member
   * assignments made by hook scripts (`attributes.crew = …`) are visible to
   * the caller afterwards — how hook-written attributes land on the history
   * entry. Values must already be normalised (no empty strings).
   */
  liveAttributes?: Record<string, unknown>;
  anchorRecord?: RecordInstance | null;
  activity?: { id: string; name: string };
  workflow?: { id: string; name: string };
  /** Embedding-point extra roots, e.g. { value } for attribute validation rules. */
  extras?: Record<string, unknown>;
  /**
   * Extra members merged into the `context` root itself (not new roots) —
   * how the page host injects `context.page` and `context.app` (page wiring
   * redesign: page context IS the ctx root, not a parallel construct).
   */
  contextExtras?: Record<string, unknown>;
  /**
   * The identity behind `context.user`. Engines created with a user inject it
   * into every evaluation; absent → the demo stub (auth unconfigured / tests).
   */
  user?: ContextUser;
  /**
   * Omit the records mutation host, so record writes fail at runtime even in
   * 'mutate'-mode scripts. Page callbacks run this way: service effects
   * allowed, direct record writes never — mutations flow through activities.
   */
  readonlyRecords?: boolean;
  /**
   * Backs the `invoke(activityId, params)` built-in. Supplied by the engine,
   * which is the only thing that can run an activity; a host that only
   * evaluates leaves it absent and `invoke` fails loudly.
   */
  invoke?: (activityId: string, params: Record<string, unknown>) => unknown;
  /**
   * Per-call interpreter limits, merged over DEFAULT_QUOTAS. Absent → the
   * defaults, which is what hooks and page evaluation use. The DSL editor
   * raises them: its host has already loaded the whole partition into memory,
   * so the row cap is not protecting anything there, and a 1s budget is too
   * short to be interactive.
   */
  quotas?: Partial<Quotas>;
  /**
   * Answer `model.*` from this config as well as `records.*` from the store
   * (docs/QUERYING_THE_MODEL.md). Absent — which is every hook, page binding
   * and datasource — means the model collections are not in the host at all,
   * so naming one fails as an unknown collection. That absence is how exposure
   * stays opt-in.
   */
  modelTypes?: boolean;
}

// ── Composite attributes (one question's row of sub-fields) ──────────────────
// One capture value per sub-attribute, addressed by the dotted path
// `attr.sub` ('.' is reserved in keys for exactly this). Hosts and payloads
// carry cells FLAT (dotted string keys); scripts and the history entry see
// the composite NESTED (attr → sub). The helpers below own that translation.

/** The resolved sub-attributes of a composite; null for other types. */
export function compositeSubs(def: AttributeDef | undefined): AttributeDef[] | null {
  if (def?.type !== 'composite') return null;
  return def.sub_attributes ?? [];
}

/**
 * Whether a captured value counts as "not provided". Scalars: empty/whitespace
 * string. Multi: empty array. Descriptor bags (photo/file, §4) and any other
 * object are present. Shared by the emptiness/required checks across the
 * capture pipeline so structured values aren't mistaken for filled scalars.
 */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * One captured leaf → its flat form. Structured values (descriptor bags and
 * multi arrays, §2/§4) pass through by-value — they must never be stringified
 * to "[object Object]". Primitives become strings, matching the form's inputs.
 */
function normalizeCaptured(value: unknown): unknown {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return value; // descriptor bag or array — by-value
  return String(value);
}

/**
 * Normalise a captured payload to flat values: scalar attributes as strings,
 * descriptor/multi attributes as by-value objects/arrays, composite cells as
 * dotted keys — whether the caller sent a composite nested
 * (`{ access_permission: { ok: 'TT' } }`) or already dotted
 * (`{ 'access_permission.ok': 'TT' }`). Unknown keys pass through untouched so
 * the payload checks downstream still see them.
 */
export function flattenCaptured(defs: AttributeDef[], captured: Record<string, unknown>): Record<string, unknown> {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(captured)) {
    if (compositeSubs(byKey.get(key)) && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [subKey, cell] of Object.entries(value as Record<string, unknown>)) {
        out[`${key}.${subKey}`] = normalizeCaptured(cell);
      }
    } else {
      out[key] = normalizeCaptured(value);
    }
  }
  return out;
}

/**
 * The nested raw form of a composite's cells from a flat value bag — what the
 * history entry stores. Only non-blank, non-waived cells appear; descriptor
 * cells are kept by-value.
 */
export function nestComposite(
  attrKey: string,
  subs: AttributeDef[],
  flat: Record<string, unknown>,
  waived: Record<string, string> = {},
): Record<string, unknown> {
  const nested: Record<string, unknown> = {};
  for (const sub of subs) {
    const path = `${attrKey}.${sub.key}`;
    const raw = flat[path];
    if (isBlank(raw) || path in waived) continue;
    nested[sub.key] = raw;
  }
  return nested;
}

/**
 * Coerce captured form values (strings) into typed script values using each
 * attribute's declared type — so `value <= now()` works on a date attribute.
 * Empty strings become null; unparseable values stay as the raw string so the
 * rule fails visibly rather than silently.
 *
 * Composite cells arrive as dotted flat keys and come out NESTED under the
 * attribute key, with every declared sub-attribute present (empty → null) so
 * script access like `attributes.access_permission.ok` is total. Section
 * pseudo-defs carry no value and are skipped.
 */
export function coerceCaptured(defs: AttributeDef[], values: Record<string, unknown>): Record<string, unknown> {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    const subs = compositeSubs(def);
    if (!subs) continue;
    const row: Record<string, unknown> = {};
    for (const sub of subs) {
      row[sub.key] = coerceCapturedValue(sub.type, values[`${def.key}.${sub.key}`]);
    }
    out[def.key] = row;
  }
  for (const [key, raw] of Object.entries(values)) {
    if (key.includes('.')) continue; // composite cells — handled above
    const def = byKey.get(key);
    if (def?.type === 'section') continue;
    out[key] = coerceCapturedValue(def?.type, raw);
  }
  return out;
}

/**
 * Coerce one captured value by its attribute's type. Multi values (arrays) map
 * element-wise; descriptor bags (photo/file, §4) are typed JSON already and
 * pass through by-value. Everything else falls to coerceValue on its string.
 */
export function coerceCapturedValue(type: string | undefined, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => coerceCapturedValue(type, item));
  if (value !== null && value !== undefined && typeof value === 'object') return value;
  return coerceValue(type, value === null || value === undefined ? '' : String(value));
}

export function coerceValue(type: string | undefined, raw: string): unknown {
  if (raw === '') return null;
  switch (type) {
    case 'date':
    case 'datetime': {
      // datetime carries a local offset (§1); Date preserves the instant so
      // `value <= now()` works. The raw ISO string is what persists — the entry
      // and record field keep the wall-clock the user saw (offset intact).
      const parsed = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
      return Number.isNaN(parsed.getTime()) ? raw : parsed;
    }
    case 'int':
    case 'decimal':
    case 'number': {
      const n = Number(raw);
      return Number.isNaN(n) ? raw : n;
    }
    case 'bool':
      return raw === 'true';
    // 'time' ('HH:MM', zone-less) stays a string — comparisons are lexical.
    default:
      return raw;
  }
}

export function buildEvalHost(
  adapter: Store,
  config: ClientSolutionConfig,
  script: ScriptContext,
  services: ServiceModuleDef[] = [],
): EvalHost {
  // Empty-string form values read as null in scripts, so `attributes.city is not null`
  // behaves before anything is selected.
  let attributes: Record<string, unknown>;
  if (script.liveAttributes) {
    attributes = script.liveAttributes;
  } else {
    attributes = {};
    for (const [key, value] of Object.entries(script.attributes ?? {})) {
      attributes[key] = value === '' ? null : value;
    }
  }

  let records = buildRecordsHost(adapter, config);
  if (script.readonlyRecords) delete records.mutate;
  if (script.modelTypes) {
    records = withModelTypes(records, config as SolutionConfig, {
      resolvedAttributes: resolvedCaptureLists(adapter),
    });
  }

  return {
    records,
    context: {
      user: script.user ?? DEMO_USER,
      record: script.anchorRecord ? toDslRecord(script.anchorRecord) : null,
      activity: script.activity ?? null,
      workflow: script.workflow ?? null,
      ...script.contextExtras,
    },
    attributes,
    services,
    functions: resolveFunctions(config),
    invoke: script.invoke,
    // Async queue dispatch failures land after the script returned — console
    // is the workbench's channel for them (a toast slot may take over later).
    onQueuedFailure: (label, message) => console.warn(`[queued ${label}] failed: ${message}`),
    extras: script.extras,
    quotas: script.quotas,
  };
}

/**
 * Why a record may not be deleted, or null when it may: the records still
 * pointing at it through an fk_ref, named so the author can work bottom-up
 * (2026-09-21, the user's rule).
 *
 * `alsoGoing` are ids being deleted in the same act. A reference held by one of
 * those does not count — otherwise deleting a subtree would refuse itself, the
 * children blocking the parent they are leaving with.
 *
 * Shared by both delete paths: a hook's `delete()` (through the mutate
 * surface) and an activity's DELETE record map. One act, one rule.
 */
export function blockingReferences(
  store: Store,
  recordId: string,
  alsoGoing: ReadonlySet<string> = new Set(),
): string | null {
  const record = store.getRecord(recordId);
  for (const ref of store.getReverseRefs(record.typeRef)) {
    const holders = store
      .getRecordsByField(ref.sourceTypeId, ref.fieldKey, recordId)
      .filter((r) => !alsoGoing.has(r.id));
    if (holders.length === 0) continue;
    const names = holders.slice(0, 3).map((r) => r.id).join(', ');
    const more = holders.length > 3 ? `, and ${holders.length - 3} more` : '';
    return `'${recordId}' cannot be deleted — ${ref.sourceTypeId}.${ref.fieldKey} still points at it (${names}${more})`;
  }
  return null;
}
