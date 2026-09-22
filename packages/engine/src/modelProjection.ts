// The SDM, projected as record types (docs/QUERYING_THE_MODEL.md).
//
// The model's collections are ordinary record types named `sdm_*`, answered
// from the SolutionConfig instead of the record store. That is the whole of
// the design: no new root environment, no second type table, no new shapes —
// `model.record_types` resolves `sdm_record_types` and everything the chain
// already does applies unchanged.
//
// Two rules this file exists to obey:
//
//  1. **Every declared field is materialized, nulls included.** The evaluator's
//     bare-field scope tests `name in obj`, so a merely-absent key falls
//     through to the outer scope and raises "Unknown name" inside
//     where/select. Config objects come from JSON, where optionals are simply
//     missing. `row()` below is what guarantees this.
//  2. **Names are the ones scripts use.** `records.<type>` takes the short
//     name, so a projection answering `rt_projects` hands back something that
//     cannot be pasted after `records.` — hence `query_name`.

import { parseFunction } from '@fluxus/dsl';
import type { DslRecord, FieldSchema, RecordsHost, TypeSchema } from '@fluxus/dsl';
import type {
  ActivityRawDef,
  AttributeDef,
  ClientAttributeDef,
  CustomFieldDef,
  RecordTypeDef,
  SolutionConfig,
  WorkflowRawDef,
} from './types';
import type { Store } from './store';
import { shortName } from './bridge';

/** The prefix model collections live under. Never written in a script. */
const P = 'sdm_';

/**
 * One collection's column list. `fk` names the collection a column points at,
 * which is what gives the model dereference for free — the validator reads
 * `FieldSchema.fkTarget` and the evaluator reads `RecordsHost.fkTarget`, and
 * both are fed from here.
 */
interface Collection {
  name: string;
  columns: Record<string, { type: string; fk?: string }>;
}

const T = (type: string) => ({ type });
const FK = (fk: string) => ({ type: 'fk_ref', fk: P + fk });

const COLLECTIONS: Collection[] = [
  {
    name: P + 'record_types',
    columns: {
      query_name: T('text'),
      name: T('text'),
      description: T('text'),
      workflow_ref: FK('workflows'),
    },
  },
  {
    name: P + 'fields',
    columns: {
      record_type_ref: FK('record_types'),
      key: T('text'),
      label: T('text'),
      type: T('text'),
      // Two columns, because they answer two questions and one value cannot do
      // both: `target` is the name you paste after `records.`, `target_ref`
      // dereferences into model.record_types.
      target: T('text'),
      target_ref: FK('record_types'),
      target_display_field: T('text'),
      required: T('boolean'),
      unique: T('boolean'),
      immutable: T('boolean'),
      default: T('text'),
    },
  },
  {
    name: P + 'attributes',
    columns: {
      key: T('text'),
      label: T('text'),
      description: T('text'),
      type: T('text'),
      config: T('text'),
      sub_attributes: T('text'),
      source: T('text'),
      show_condition: T('text'),
      required: T('boolean'),
      validation: T('text'),
      validation_message: T('text'),
      can_waive: T('boolean'),
    },
  },
  {
    name: P + 'workflows',
    columns: { name: T('text'), description: T('text') },
  },
  {
    name: P + 'activities',
    columns: {
      name: T('text'),
      description: T('text'),
      workflow_ref: FK('workflows'),
      record_type_ref: FK('record_types'),
      sort_order: T('number'),
      record_map: T('text'),
      show_condition: T('text'),
      before_hook: T('text'),
      after_hook: T('text'),
      returns: T('text'),
    },
  },
  {
    name: P + 'activity_attributes',
    columns: {
      activity_ref: FK('activities'),
      position: T('number'),
      kind: T('text'),
      key: T('text'),
      label: T('text'),
      type: T('text'),
      required: T('boolean'),
      source: T('text'),
      show_condition: T('text'),
      validation: T('text'),
      validation_message: T('text'),
      can_waive: T('boolean'),
    },
  },
  {
    name: P + 'functions',
    columns: { name: T('text'), description: T('text'), body: T('text'), params: T('text') },
  },
  {
    name: P + 'roles',
    columns: { name: T('text'), description: T('text') },
  },
];

/** The model collections as schema entries, to merge into `DslSchema.types`. */
export function modelSchemaTypes(): Record<string, TypeSchema> {
  const out: Record<string, TypeSchema> = {};
  for (const c of COLLECTIONS) {
    const fields: Record<string, FieldSchema> = {};
    for (const [key, col] of Object.entries(c.columns)) {
      fields[key] = col.fk ? { type: col.type, fkTarget: col.fk } : { type: col.type };
    }
    out[c.name] = { fields };
  }
  return out;
}

/** Rule 1: every column present, absent ones as explicit null. */
function row(collection: string, id: string, values: Record<string, unknown>): DslRecord {
  const def = COLLECTIONS.find((c) => c.name === collection)!;
  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(def.columns)) {
    fields[key] = values[key] ?? null;
  }
  return { id, type: collection, fields };
}

/** JSON in a text column — `config` and `sub_attributes` are structures, and a
 *  script reads them as text rather than the projection inventing a shape for
 *  every attribute type. */
/** The label a display surface would show: `fieldLabel`'s rule, which treats a
 *  blank label as none at all. */
const labelOr = (label: string | undefined, key: string): string => label?.trim() || key;

const asText = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));

/** `type_config` minus the server-only presign gate, which is deliberately
 *  absent from the client grade and must not re-enter through here. */
function safeConfig(def: AttributeDef | ClientAttributeDef): string | null {
  const cfg = def.type_config as Record<string, unknown> | undefined;
  if (!cfg) return null;
  const { max_size_mb: _dropped, ...rest } = cfg;
  return asText(rest);
}

function fieldRows(config: SolutionConfig): DslRecord[] {
  const out: DslRecord[] = [];
  for (const rt of config.recordTypes) {
    for (const f of rt.custom_fields as CustomFieldDef[]) {
      out.push(
        // A custom field has no id of its own — identity is (type, key).
        row(P + 'fields', `${rt.id}.${f.key}`, {
          record_type_ref: rt.id,
          key: f.key,
          // What every display surface shows: `fieldLabel` treats a blank
          // label as no label, so `?? key` alone would project '   '.
          label: labelOr(f.label, f.key),
          type: f.type,
          target: f.fk_record_type ? shortName(f.fk_record_type) : null,
          target_ref: f.fk_record_type ?? null,
          target_display_field: f.fk_display_field ?? null,
          required: f.required ?? false,
          unique: f.unique ?? false,
          immutable: f.immutable ?? false,
          default: f.default ?? null,
        }),
      );
    }
  }
  return out;
}

/**
 * Which record type an activity belongs to. Activities carry no such field —
 * the link runs record type → workflow — and **nothing enforces one record
 * type per workflow**. So: null when none points at it, and the first by
 * config order when several do, rather than pretending it is single.
 */
function recordTypeByWorkflow(config: SolutionConfig): Map<string, RecordTypeDef> {
  const m = new Map<string, RecordTypeDef>();
  for (const rt of config.recordTypes) {
    if (!m.has(rt.workflow_ref)) m.set(rt.workflow_ref, rt);
  }
  return m;
}

function activityRows(config: SolutionConfig): DslRecord[] {
  const byWorkflow = recordTypeByWorkflow(config);
  const out: DslRecord[] = [];
  for (const wf of config.workflows as WorkflowRawDef[]) {
    for (const act of wf.activities as ActivityRawDef[]) {
      out.push(
        row(P + 'activities', act.id, {
          name: act.name,
          description: act.description ?? null,
          // Derived from nesting: an activity is stored inside its workflow.
          workflow_ref: wf.id,
          record_type_ref: byWorkflow.get(wf.id)?.id ?? null,
          sort_order: act.sort_order ?? null,
          record_map: act.record_map ?? null,
          show_condition: act.show_condition ?? null,
          before_hook: joinLines(act.before_hook),
          after_hook: joinLines(act.after_hook),
          returns: joinLines((act as { returns?: string | string[] | null }).returns),
        }),
      );
    }
  }
  return out;
}

/** Hooks and `returns` may be stored as arrays of lines — a hand-editing
 *  convenience the loader joins. The projection answers the joined text. */
function joinLines(v: string | string[] | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? v.join('\n') : v;
}

/**
 * The resolved capture list per activity, read off the store.
 *
 * Resolution — merging a usage's overrides onto its pool definition, and
 * turning section markers into uniform definitions of type 'section' — belongs
 * to the adapter and is not re-implemented here. The raw stored list is
 * heterogeneous, and a marker carries no attribute reference at all, so
 * projecting it directly would break every query over it on the first activity
 * with a heading.
 */
export function resolvedCaptureLists(store: Store): Map<string, ClientAttributeDef[]> {
  const out = new Map<string, ClientAttributeDef[]>();

  // Every workflow when the store can list them — an activity in a workflow no
  // record type points at is still listed by `model.activities`, so its
  // capture list must be there too or a count over the collection is silently
  // short.
  for (const wf of store.listWorkflows?.() ?? []) {
    for (const act of wf.activities) {
      if (!out.has(act.id)) out.set(act.id, (act.attributes ?? []) as ClientAttributeDef[]);
    }
  }

  for (const rt of store.listRecordTypes()) {
    let def;
    try {
      def = store.getRecordTypeDef(rt.id);
    } catch {
      // A record type bound to a workflow that is not there. `validateConfig`
      // refuses such a config at save, so this is an already-stored
      // inconsistency — it must cost that type its capture lists, not take the
      // whole host down and turn every query into a 500.
      continue;
    }
    for (const act of def.workflow.activities) {
      // Two record types can point at one workflow. First wins, and the list is
      // identical either way: the adapter resolves each workflow once, into a
      // map keyed by id, so both types hand back the same object.
      if (!out.has(act.id)) out.set(act.id, (act.attributes ?? []) as ClientAttributeDef[]);
    }
  }
  return out;
}

export interface ModelProjectionOptions {
  /**
   * Resolved capture lists, keyed by activity id. Supplied by the host, because
   * resolution (merging usage overrides, turning section markers into uniform
   * definitions) belongs to the adapter and is not re-implemented here. Absent
   * ⇒ `sdm_activity_attributes` is empty rather than wrong.
   */
  resolvedAttributes?: Map<string, ClientAttributeDef[]>;
}

function activityAttributeRows(options: ModelProjectionOptions): DslRecord[] {
  const out: DslRecord[] = [];
  const resolved = options.resolvedAttributes ?? new Map<string, ClientAttributeDef[]>();
  for (const [activityId, list] of resolved) {
    list.forEach((def: ClientAttributeDef, position: number) => {
      const isSection = def.type === 'section';
      out.push(
        row(P + 'activity_attributes', `${activityId}.${position}`, {
          activity_ref: activityId,
          position,
          // A heading is a row you filter out, not a shape that breaks the
          // query — which is why the resolved list is projected and not the
          // raw one, where markers carry no attribute reference at all.
          kind: isSection ? 'section' : 'attribute',
          key: def.key,
          label: labelOr(def.label, def.key),
          type: def.type,
          required: (def as { required?: boolean }).required ?? false,
          source: (def as { source?: string }).source ?? null,
          show_condition: (def as { show_condition?: string }).show_condition ?? null,
          validation: (def as { validation?: string }).validation ?? null,
          validation_message: (def as { validation_message?: string }).validation_message ?? null,
          can_waive: (def as { can_waive?: boolean }).can_waive ?? false,
        }),
      );
    });
  }
  return out;
}

/** Every model collection's rows, built from one solution's config. */
export function modelRows(
  config: SolutionConfig,
  options: ModelProjectionOptions = {},
): Map<string, DslRecord[]> {
  const rows = new Map<string, DslRecord[]>();

  rows.set(
    P + 'record_types',
    config.recordTypes.map((rt) =>
      row(P + 'record_types', rt.id, {
        // What you type after `records.` — the stored id minus `rt_`.
        query_name: shortName(rt.id),
        name: rt.name,
        description: rt.description ?? null,
        workflow_ref: rt.workflow_ref,
      }),
    ),
  );

  rows.set(P + 'fields', fieldRows(config));

  rows.set(
    P + 'attributes',
    config.attributes.map((a) =>
      // The pool is keyed by key, not by an id column.
      row(P + 'attributes', a.key, {
        key: a.key,
        label: labelOr(a.label, a.key),
        description: a.description ?? null,
        type: a.type,
        config: safeConfig(a),
        // A composite's real sub-list lives in type_config; the field of that
        // name is populated only at resolution time and is absent on the pool.
        sub_attributes: asText((a.type_config as { attributes?: unknown } | undefined)?.attributes),
        source: (a as { source?: string }).source ?? null,
        show_condition: (a as { show_condition?: string }).show_condition ?? null,
        // The pool's value, NOT the effective one: a usage does not fall back
        // to it (see the defect in this package's SPEC).
        required: (a as { required?: boolean }).required ?? false,
        validation: (a as { validation?: string }).validation ?? null,
        validation_message: (a as { validation_message?: string }).validation_message ?? null,
        can_waive: (a as { can_waive?: boolean }).can_waive ?? false,
      }),
    ),
  );

  rows.set(
    P + 'workflows',
    config.workflows.map((wf) =>
      row(P + 'workflows', wf.id, { name: wf.name, description: wf.description ?? null }),
    ),
  );

  rows.set(P + 'activities', activityRows(config));
  rows.set(P + 'activity_attributes', activityAttributeRows(options));

  rows.set(
    P + 'functions',
    (config.functions ?? []).map((fn) =>
      row(P + 'functions', fn.id, {
        name: fn.name,
        description: fn.description ?? null,
        body: joinLines(fn.body as string | string[]),
        // Derived by parsing the body. A body that does not parse answers null,
        // never an empty list — "no parameters" and "could not tell" are
        // different answers and must not look alike.
        params: asText(paramsOf(fn.body as string | string[])),
      }),
    ),
  );

  rows.set(
    P + 'roles',
    (config.access?.roles ?? []).map((r) =>
      row(P + 'roles', r.id, { name: r.name, description: r.description ?? null }),
    ),
  );

  return rows;
}

/**
 * Parameter names off a function body, or null when it will not parse.
 *
 * The real parser, not a regex: a body the DSL accepts must not be reported as
 * unparseable. A leading comment was enough to defeat the pattern this
 * replaced, which then answered null — the value §5 reserves for "could not
 * tell", making a wrong answer look like an honest one.
 */
function paramsOf(body: string | string[] | undefined): string[] | null {
  const text = joinLines(body);
  if (!text) return null;
  try {
    return parseFunction(text).params.slice();
  } catch {
    return null;
  }
}

/**
 * Wrap a records host so the model collections answer from the config while
 * everything else falls through to the real store.
 *
 * `mutate` is deliberately not forwarded when the caller is read-only; the
 * evaluator additionally refuses mutation through the `model` root.
 */
export function withModelTypes(
  base: RecordsHost,
  config: SolutionConfig,
  options: ModelProjectionOptions = {},
): RecordsHost {
  const rows = modelRows(config, options);
  const fkByType = new Map<string, Record<string, string>>();
  for (const c of COLLECTIONS) {
    const fks: Record<string, string> = {};
    for (const [key, col] of Object.entries(c.columns)) {
      if (col.fk) fks[key] = col.fk;
    }
    fkByType.set(c.name, fks);
  }

  return {
    ...base,
    hasType: (type) => rows.has(type) || base.hasType(type),
    getAll: (type) => (rows.has(type) ? rows.get(type)!.map(copy) : base.getAll(type)),
    getById: (type, id) => (rows.has(type) ? findCopy(rows.get(type)!, id) : base.getById(type, id)),
    fkTarget: (type, field) => fkByType.get(type)?.[field] ?? (rows.has(type) ? null : base.fkTarget(type, field)),
    reverseRef: (type, name) => (rows.has(type) ? null : base.reverseRef(type, name)),
  };
}

function copy(r: DslRecord): DslRecord {
  return { id: r.id, type: r.type, fields: { ...r.fields } };
}

function findCopy(list: DslRecord[], id: unknown): DslRecord | null {
  const found = list.find((r) => r.id === String(id));
  return found ? copy(found) : null;
}
