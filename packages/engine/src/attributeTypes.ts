// The attribute type registry (ATTRIBUTE_TYPES_FILES_SCALARS §5). One entry per
// attribute type, declared once in engine code — the machine-readable companion
// the SDM baseline (SDM_Change_Attribute_Type_System §7) asked for once
// type_config shapes stopped self-documenting as table columns.
//
// A type declares:
//   - `descriptor`: the FIXED sub-fields of a by-value bag (photo/file). These
//     are system-written (uploader/EXIF), never user-captured, identical
//     everywhere — a photo is NOT a user-composable composite (§4/§5).
//   - `configKeys`: the capture-shaping type_config keys the type accepts
//     (§3 "config vs validation" — a closed set; no format mini-language). Any
//     other key is an error at config-save time.
//   - `multi`: whether `type_config.multi: true` is legal (every type except
//     composite — repeating composites are deferred, §11).
//
// Three consumers read it: the client upload core (what descriptor fields to
// write), validateSubmission (server-authoritative descriptor shape check), and
// validateConfig (which config keys / multi a type accepts). `multi` itself is
// handled globally, so it is never listed in a type's configKeys.

/** Scalar kind of a descriptor sub-field — mirrors coerceValue's cases. */
export type DescriptorFieldType = 'string' | 'int' | 'decimal' | 'datetime';

/** One descriptor sub-field: its scalar kind, and whether it may be absent. */
export interface DescriptorField {
  type: DescriptorFieldType;
  /** EXIF/derived fields that may legitimately be missing (e.g. an ungeotagged photo). */
  optional?: boolean;
}

export interface AttributeTypeSpec {
  /**
   * Sub-fields of the by-value descriptor bag, fixed by the type. Present only
   * for descriptor-valued types (photo/file); absent for scalar/string types.
   */
  descriptor?: Record<string, DescriptorField>;
  /** Capture-shaping type_config keys this type accepts, besides `multi`. */
  configKeys: readonly string[];
  /** Whether `type_config.multi: true` is legal for this type. */
  multi: boolean;
}

// Descriptor field sets (§4). `file` is the base; `photo` extends it with
// image dimensions, a thumbnail key, and EXIF geo/time. lat/lng/taken_at are
// optional — a photo may carry no geotag or timestamp (§8 integrity story).
const FILE_DESCRIPTOR = {
  storage_key: { type: 'string' },
  name: { type: 'string' },
  mime: { type: 'string' },
  size: { type: 'int' },
  hash: { type: 'string' },
} as const satisfies Record<string, DescriptorField>;

const PHOTO_DESCRIPTOR = {
  ...FILE_DESCRIPTOR,
  width: { type: 'int' },
  height: { type: 'int' },
  thumb_key: { type: 'string' },
  lat: { type: 'decimal', optional: true },
  lng: { type: 'decimal', optional: true },
  taken_at: { type: 'datetime', optional: true },
} as const satisfies Record<string, DescriptorField>;

export const ATTRIBUTE_TYPES: Record<string, AttributeTypeSpec> = {
  // ── This build (§1) ──────────────────────────────────────────────────────
  photo: { descriptor: PHOTO_DESCRIPTOR, configKeys: ['max_count', 'max_size_mb'], multi: true },
  file: { descriptor: FILE_DESCRIPTOR, configKeys: ['accept', 'max_count', 'max_size_mb'], multi: true },
  text: { configKeys: ['multiline'], multi: true },
  datetime: { configKeys: [], multi: true },
  time: { configKeys: [], multi: true },
  int: { configKeys: [], multi: true },
  decimal: { configKeys: ['decimal_places'], multi: true },
  // ── Pre-existing types (declared here so validateConfig knows their keys) ──
  reference: { configKeys: ['fk_record_type'], multi: true },
  list: { configKeys: ['datasource', 'key_field', 'display_field', 'columns'], multi: true },
  // Repeating composites (multi) are deferred (§11) — multi is rejected here.
  composite: { configKeys: ['attributes'], multi: false },
};

/** Registry entry for a type, or undefined for an unknown/custom type. */
export function attributeTypeSpec(type: string | undefined): AttributeTypeSpec | undefined {
  return type ? ATTRIBUTE_TYPES[type] : undefined;
}

/** Descriptor field schema for a type (photo/file), else null. */
export function descriptorFields(type: string | undefined): Record<string, DescriptorField> | null {
  return attributeTypeSpec(type)?.descriptor ?? null;
}

/** Whether a type's value is a by-value descriptor bag (photo/file). */
export function isDescriptorType(type: string | undefined): boolean {
  return descriptorFields(type) !== null;
}

/**
 * Server-authoritative shape check for one descriptor value (§5). Returns
 * human-readable problems: a non-object, a missing required sub-field, or a
 * sub-field of the wrong scalar kind. Optional (EXIF) fields may be absent or
 * null. `label` names the offending value in messages.
 */
export function descriptorShapeIssues(type: string | undefined, value: unknown, label: string): string[] {
  const fields = descriptorFields(type);
  if (!fields) return [];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [`${label} is not a valid ${type}`];
  }
  const bag = value as Record<string, unknown>;
  const out: string[] = [];
  for (const [name, field] of Object.entries(fields)) {
    const v = bag[name];
    if (v === undefined || v === null) {
      if (!field.optional) out.push(`${label} is missing '${name}'`);
      continue;
    }
    const wanted = field.type === 'string' ? 'string' : 'number';
    if (field.type === 'datetime') {
      if (typeof v !== 'string') out.push(`${label} field '${name}' must be an ISO datetime string`);
    } else if (typeof v !== wanted) {
      out.push(`${label} field '${name}' must be a ${wanted}`);
    }
  }
  return out;
}
