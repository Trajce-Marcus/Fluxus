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
  // ── 'list' attributes (DSL-driven) ──
  /** FluxScript expression yielding a list: literal, records query, or service call. */
  datasource?: string;
  selection?: 'single' | 'multi';
  /** Field used as the stored value (default 'id' for record datasources). */
  key_field?: string;
  /** Field shown to the user (default 'name'). */
  display_field?: string;
  columns?: string[];
}

export interface AttributeDef {
  key: string;
  label: string;
  description: string;
  type: string; // "text" | "reference" | "list" | ...
  type_config?: AttributeTypeConfig;
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
  attributes: AttributeUsageDef[];
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
}

// ── Runtime types (store reads/writes these) ──────────────────────────────────

export interface ActivityHistoryEntry {
  activityId: string;
  activityName: string;
  /** Exactly what the user entered — never touched by scripts or the system. */
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
