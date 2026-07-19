// ── SDM config types (shape of the hand-edited JSON) ─────────────────────────

export interface CustomFieldDef {
  key: string;
  type: string; // "text" | "int" | "bool" | "date" | "fk_ref" | ...
  default?: string;
  required?: boolean;
  unique?: boolean;
  immutable?: boolean;
  indexed?: boolean;
  fk_record_type?: string;   // required when type === "fk_ref"
  fk_display_field?: string; // required when type === "fk_ref"
}

export interface AttributeTypeConfig {
  fk_record_type?: string;
  values?: string[];
  expression?: unknown;
  /**
   * Cardinality flag (ATTRIBUTE_TYPES_FILES_SCALARS §2): when true the captured
   * value is always an array and `required` means ≥ 1 item. Legal on every type
   * except composite (repeating composites deferred, §11). Replaces the former
   * `list`-only `selection: 'multi'` — one spelling of cardinality platform-wide.
   */
  multi?: boolean;
  // ── 'list' attributes (DSL-driven) ──
  /** FluxScript expression yielding a list: literal, records query, or service call. */
  datasource?: string;
  /** Field used as the stored value (default 'id' for record datasources). */
  key_field?: string;
  /** Field shown to the user (default 'name'). */
  display_field?: string;
  columns?: string[];
  // ── 'text' attributes ──
  /** Render as a textarea — one value with many lines (§1); NOT the multi mechanism. */
  multiline?: boolean;
  // ── 'decimal' attributes ──
  /** Input step + display rounding — presentation only, like `multiline` (§1). */
  decimal_places?: number;
  // ── 'photo' / 'file' attributes (§1) ──
  /** Per-attribute file-count ceiling for a multi value; enforced at presign + submit. */
  max_count?: number;
  /** Per-attribute byte ceiling (MB); enforced at presign, re-checked at submit. */
  max_size_mb?: number;
  /** 'file' only: file-dialog filter — a list of extensions/MIME types. */
  accept?: string[];
  // ── 'composite' attributes (one question's row of sub-fields) ──
  /**
   * The sub-attributes of a composite: usage wrappers pointing at REAL pool
   * attributes (same shape an activity's attribute list uses, overrides
   * included) — reuse over inline definitions (ruled 2026-07-18). Any type
   * except 'composite' (no nesting) and 'reference' (parked). A captured cell
   * is addressed `attr.sub` — one dot.
   */
  attributes?: AttributeUsageDef[];
}

export interface AttributeDef {
  key: string;
  label: string;
  description: string;
  type: string; // "text" | "reference" | "list" | "composite" | "section" (resolved marker) | ...
  type_config?: AttributeTypeConfig;
  /**
   * Resolved sub-attributes of a composite (pool defs merged with the usage
   * overrides from type_config.attributes). Populated at resolution time by
   * the adapter; absent on raw pool defs and non-composite types.
   */
  sub_attributes?: AttributeDef[];
  /** FluxScript expression; carried over from the usage wrapper during resolution. */
  show_condition?: string;
  /** Must be captured before the activity can submit; carried over from the usage wrapper. */
  required?: boolean;
  /** FluxScript rule; must evaluate true for the captured value (`value` root available). */
  validation?: string;
  /** Shown when validation fails; defaults to "<label> is invalid". */
  validation_message?: string;
  /**
   * The user may declare the value unavailable ("can't provide") with a
   * mandatory reason instead of entering it — no fake data to satisfy
   * `required`. The waiver is recorded on the history entry; the record field
   * is never written. Carried over from the usage wrapper.
   */
  can_waive?: boolean;
}

/**
 * Presentation-only marker in an activity's attribute list: renders as a
 * section heading over the usages that follow it. No key, no value, no
 * storage — headless callers ignore it. Resolved to a pseudo-AttributeDef of
 * type 'section' so the ordered list keeps one shape.
 */
export interface SectionMarkerDef {
  section: string;
  description?: string;
}

// Usage wrapper in a raw activity — resolved to AttributeDef at runtime by the adapter
export interface AttributeUsageDef {
  attribute_ref: string;
  /** FluxScript expression deciding whether this attribute is presented. */
  show_condition?: string;
  /** Must be captured before the activity can submit. Hidden attributes are exempt. */
  required?: boolean;
  /** FluxScript rule; must evaluate true for the captured value (`value` root available). */
  validation?: string;
  validation_message?: string;
  /** "Can't provide" escape hatch — see AttributeDef.can_waive. */
  can_waive?: boolean;
}

// Raw activity shape (as it appears in the JSON config).
// Hooks are FluxScript scripts; an array of lines is a hand-editing convenience
// (joined on load), same as function bodies.
export interface ActivityRawDef {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  record_map?: 'CREATE' | 'UPDATE' | 'DELETE';
  /**
   * FluxScript availability condition: whether this activity is offered (UI)
   * or invocable (pipeline gate — server-authoritative once the backend
   * lands). Evaluated before capture begins, so `attributes` is not available;
   * `context.record` is the anchor (null for CREATE). Unlike the attribute
   * setting of the same name, evaluation errors FAIL CLOSED — a broken access
   * rule must not wave the activity through.
   */
  show_condition?: string;
  /** Ordered capture list: attribute usages plus presentation section markers. */
  attributes: (AttributeUsageDef | SectionMarkerDef)[];
  /** FluxScript, validate-only: may fail()/warn(), never mutates (DSL_SPEC §6). */
  before_hook: string | string[] | null;
  /** FluxScript, effects: mutations staged and committed atomically (DSL_SPEC §7). */
  after_hook: string | string[] | null;
}

// Resolved activity (attributes resolved from the standalone collection, hook lines joined)
export interface ActivityDef {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  record_map?: 'CREATE' | 'UPDATE' | 'DELETE';
  /** Availability condition — see ActivityRawDef.show_condition. */
  show_condition?: string;
  attributes: AttributeDef[];
  before_hook: string | null;
  after_hook: string | null;
}

export interface WorkflowRawDef {
  id: string;
  name: string;
  description: string;
  activities: ActivityRawDef[];
}

export interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  activities: ActivityDef[];
}

export interface RecordTypeDef {
  id: string;
  name: string;
  description: string;
  workflow_ref: string;
  id_field?: string;
  custom_fields: CustomFieldDef[];
}

// Named reusable FluxScript function (stored in the SDM's functions collection).
// body is canonically a string; an array of lines is accepted and joined on load.
export interface FunctionDef {
  id: string;
  name: string;
  description: string;
  body: string | string[];
}

// Demo/sample records shipped with an entity file; loaded only when the store
// has no records of that type yet.
export interface SeedGroup {
  typeId: string;
  records: { id: string; fields: Record<string, unknown> }[];
}

// Raw config — matches the JSON on disk exactly
export interface ConfigRaw {
  attributes: AttributeDef[];
  recordTypes: RecordTypeDef[];
  workflows: WorkflowRawDef[];
  functions?: FunctionDef[];
  seeds?: SeedGroup[];
}

// Reverse-FK index entry — one per (sourceType, fieldKey) pair that points at a given target type
export interface ReverseRefEntry {
  sourceTypeId: string;
  fieldKey: string;
}

// Outcome of running an activity. 'needs-confirmation': the before hook raised
// warn()ings and nothing was persisted — re-run with acknowledgedWarnings to
// proceed, or drop it to cancel (the gate is read-only, so cancelling is free).
export interface RunActivityResult {
  status: 'done' | 'needs-confirmation';
  warnings: string[];
  /**
   * The record the activity acted on (created, updated, appended to, or
   * deleted). Absent when nothing persisted: needs-confirmation, or a DELETE
   * whose confirm text didn't match.
   */
  recordId?: string;
}

// ── Runtime types (store reads/writes these) ──────────────────────────────────

/**
 * The authenticated identity scripts see as `context.user` (RBAC_COMPACT
 * "Auth"). The server builds it per request from the verified session (or the
 * demo stub when auth is unconfigured) and passes it via EngineOptions.user.
 * `roles` are the role ids held in the current operation — resolved outside
 * the engine (roles-resolver seam); scripts stay scope-blind.
 */
export interface ContextUser {
  id: string;
  name: string;
  email?: string | null;
  roles?: string[];
}

export interface ActivityHistoryEntry {
  activityId: string;
  activityName: string;
  /**
   * The user id that ran the activity (RBAC_COMPACT: Neon Auth user id;
   * 'demo' under the unconfigured stub). Ids are stable where names aren't —
   * display names resolve at render; entries are never edited. Absent on
   * entries recorded before auth existed.
   */
  author?: string;
  /**
   * The activity's attributes: what the user entered, plus attributes hook
   * logic wrote (`attributes.crew = …`), plus the run's system log under the
   * reserved `system_log` key. Immutable means users never edit them; hooks
   * legitimately write them (ruled 2026-07-11, Extraction stage 2).
   */
  capturedAttributes: Record<string, unknown>;
  /**
   * Gate warnings the user acknowledged to proceed ("warned X, continued
   * anyway") — audit, kept separate from capturedAttributes. After-hook
   * warnings are execution outcome, not part of the entry (they belong to the
   * future activity log stream).
   */
  warnings?: string[];
  /**
   * Attributes declared unavailable at capture time, keyed by attribute →
   * the user's reason. Presence of a key is the flag; only waived attributes
   * appear. Waived attributes never write to record fields.
   */
  waived?: Record<string, string>;
  timestamp: string;
}

export interface RecordInstance {
  id: string;
  typeRef: string;
  customFields: Record<string, unknown>;
  activityHistory: ActivityHistoryEntry[];
}
