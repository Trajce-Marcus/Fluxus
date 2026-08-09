// ── SDM config types (shape of the hand-edited JSON) ─────────────────────────
//
// Every config type comes in two grades (docs/CLIENT_TRUST_BOUNDARY.md §2):
// a `Client*` grade — what a browser on the RUNTIME plane is given — and the
// full grade, which **extends** it with the fields only the server and the
// design plane may see. The narrow one is declared first and the full one
// extends it, deliberately: code typed against the narrow grade cannot compile
// a reference to a stripped field, so the trim is structurally unreachable
// rather than merely filtered at runtime. `projectConfig` (server) is the one
// place that turns the full grade into the narrow one.

export interface ClientCustomFieldDef {
  key: string;
  /**
   * What a person is shown where the field appears — grid headings, the record
   * view, the schema navigator. **Optional, and the key is the fallback**: the
   * key was the only name a field had until 2026-08-09, so every stored field
   * predates this and a missing label must read as "use the key". Go through
   * `fieldLabel(cf)` rather than reading it directly, so the fallback is one
   * rule rather than a habit.
   */
  label?: string;
  type: string; // "text" | "int" | "bool" | "date" | "fk_ref" | ...
  fk_record_type?: string;   // required when type === "fk_ref"
  fk_display_field?: string; // required when type === "fk_ref"
}

/** Storage constraints are the server's business — nothing client-side builds
 *  a record, so a browser is given the field's identity and its FK wiring
 *  (which it needs to display and to traverse) and nothing else. */
export interface CustomFieldDef extends ClientCustomFieldDef {
  default?: string;
  required?: boolean;
  unique?: boolean;
  immutable?: boolean;
  indexed?: boolean;
}

export interface ClientAttributeTypeConfig {
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
  /** 'file' only: file-dialog filter — a list of extensions/MIME types. */
  accept?: string[];
  /**
   * Per-attribute file-count ceiling for a multi value. Ships to the client so
   * the widget can stop the user at the add tile — **validation, never
   * enforcement**: `validateSubmission` holds the real ceiling at submit.
   */
  max_count?: number;
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

/** The presign gate (CLIENT_TRUST_BOUNDARY §2): this ceiling is applied before
 *  any bytes move, so the browser is not told it. */
export interface AttributeTypeConfig extends ClientAttributeTypeConfig {
  /** Per-attribute byte ceiling (MB); enforced at presign, re-checked at submit. */
  max_size_mb?: number;
}

export interface ClientAttributeDef {
  key: string;
  label: string;
  description: string;
  type: string; // "text" | "reference" | "list" | "composite" | "section" (resolved marker) | ...
  type_config?: ClientAttributeTypeConfig;
  /**
   * Resolved sub-attributes of a composite (pool defs merged with the usage
   * overrides from type_config.attributes). Populated at resolution time by
   * the adapter; absent on raw pool defs and non-composite types.
   */
  sub_attributes?: ClientAttributeDef[];
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

/** An attribute is the same thing on both planes — validation expressions ship
 *  deliberately (the client validates inline, the server revalidates) — so all
 *  the full grade adds is the storage gate inside `type_config`. */
export interface AttributeDef extends ClientAttributeDef {
  type_config?: AttributeTypeConfig;
  sub_attributes?: AttributeDef[];
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
export interface ClientActivityRawDef {
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
}

/**
 * Hooks are the prize (CLIENT_TRUST_BOUNDARY §2): business logic and every
 * effect never leave the server, so they are absent — not null — from the
 * client's grade. Read them through `activityHooks` wherever a config may be
 * either grade.
 */
export interface ActivityRawDef extends ClientActivityRawDef {
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

export interface ClientWorkflowRawDef {
  id: string;
  name: string;
  description: string;
  activities: ClientActivityRawDef[];
}

export interface WorkflowRawDef extends ClientWorkflowRawDef {
  activities: ActivityRawDef[];
}

export interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  activities: ActivityDef[];
}

export interface ClientRecordTypeDef {
  id: string;
  name: string;
  description: string;
  workflow_ref: string;
  id_field?: string;
  custom_fields: ClientCustomFieldDef[];
}

export interface RecordTypeDef extends ClientRecordTypeDef {
  custom_fields: CustomFieldDef[];
  /** RBAC read surface (RBAC_COMPACT): role ids that may read this type.
   *  **Default deny** — absent/empty means no role reads it, not "open". The
   *  only open posture is a solution that declares no `access.roles` at all,
   *  which switches RBAC off wholesale. Enforced server-side (partition
   *  filter), never in script env. */
  access?: { read?: string[] };
}

// A runtime role, declared per solution (RBAC_COMPACT "Roles"): id `role_<plural>`,
// display name plural. Definitions live here; assignments live in the
// governance store, never in the config.
export interface RoleDef {
  id: string;
  name: string;
  /** What the role is for — shown in the Console's roles table (2026-08-01).
   *  Documentation only; nothing resolves against it. */
  description?: string;
}

// Named reusable FluxScript function (stored in the SDM's functions collection).
// body is canonically a string; an array of lines is accepted and joined on load.
export interface FunctionDef {
  id: string;
  name: string;
  description: string;
  body: string | string[];
}

/**
 * The model as a browser on the runtime plane receives it — the output of
 * `projectConfig` and the input every client-side host is typed against
 * (CLIENT_TRUST_BOUNDARY §2). Trimmed two ways: field by field (no hooks, no
 * storage gate, no read rules) and row by row (no unreadable record type, no
 * unrunnable activity, no unreferenced attribute or function).
 *
 * `access` is absent entirely — the client learns its own roles from `me`, and
 * has no business knowing the rules that exclude it.
 */
export interface ClientSolutionConfig {
  attributes: ClientAttributeDef[];
  recordTypes: ClientRecordTypeDef[];
  workflows: ClientWorkflowRawDef[];
  functions?: FunctionDef[];
}

// One solution's model, exactly as stored: the six `sdm_*` tables assembled by
// `getSolutionConfig`, and every snapshot in `sdm_config_versions`. Renamed from
// `ConfigRaw` 2026-08-07 — the `Raw` suffix paired with nothing (there is no
// cooked top-level config), while the inner `*RawDef` types still do carry the
// unresolved-vs-resolved distinction.
export interface SolutionConfig extends ClientSolutionConfig {
  attributes: AttributeDef[];
  recordTypes: RecordTypeDef[];
  workflows: WorkflowRawDef[];
  /** Solution-scoped RBAC role definitions (RBAC_COMPACT). Absent ⇒ RBAC
   *  dormant (adoption posture): all record types/pages read open. */
  access?: { roles?: RoleDef[] };
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
