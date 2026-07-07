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
}

// Raw activity shape (as it appears in the JSON config)
export interface ActivityRawDef {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  record_map?: 'CREATE' | 'UPDATE' | 'DELETE';
  attributes: AttributeUsageDef[];
  before_hook: object | null;
  after_hook: object | null;
}

// Resolved activity (attributes fully resolved from the standalone collection)
export interface ActivityDef {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  record_map?: 'CREATE' | 'UPDATE' | 'DELETE';
  attributes: AttributeDef[];
  before_hook: object | null;
  after_hook: object | null;
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

// ── Runtime types (store reads/writes these) ──────────────────────────────────

export interface ActivityHistoryEntry {
  activityId: string;
  activityName: string;
  capturedAttributes: Record<string, unknown>;
  timestamp: string;
}

export interface RecordInstance {
  id: string;
  typeRef: string;
  customFields: Record<string, unknown>;
  activityHistory: ActivityHistoryEntry[];
}
