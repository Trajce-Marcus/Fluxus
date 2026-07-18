// Headless submission validation (DSL Phase 4). The workbench capture form
// enforces the attribute trio (show_condition / required / validation)
// interactively; headless callers skip the UI entirely, so the same semantics
// are applied here as one payload check, per DSL_SPEC §5: "in headless mode
// the datasource doubles as validation" and the trio "defines the parameter
// contract". Semantics deliberately mirror AttributesForm:
//   - attribute show_conditions FAIL OPEN (a broken condition must not make a
//     value unreachable) — the activity-level gate inside runActivity is the
//     fail-closed one;
//   - hidden attributes are exempt from `required`; headless-strict addition:
//     supplying a value (or waiver) for a hidden attribute is an error, where
//     the form simply never offers the input;
//   - waived attributes trade the value for a mandatory reason (can_waive only);
//   - validation rules run on non-empty values with the typed value as `value`
//     (empties are required's job); rule errors count as failures;
//   - list datasource membership and reference existence are checked — the
//     form guarantees these by construction (picker/select), headless must not
//     accept what the UI could never produce.
// runActivity remains the enforcement point for the availability gate and
// hooks; this guards only the captured payload, before the pipeline runs.

import type { Engine } from './engine';
import type { ActivityDef, AttributeDef, RecordInstance } from './types';
import { coerceCaptured, coerceCapturedValue, compositeSubs, flattenCaptured, fullId, isBlank, shortName } from './bridge';
import { descriptorShapeIssues, isDescriptorType } from './attributeTypes';

export interface SubmissionIssue {
  /** The attribute at fault; null for payload-shape issues. */
  attribute: string | null;
  message: string;
}

/** Same value extraction as the form's option mapping (AttributesForm.toOption). */
function optionValue(item: unknown, keyField: string): string {
  if (item !== null && typeof item === 'object') {
    const record = item as { id?: unknown; fields?: Record<string, unknown> };
    const bag = record.fields ?? (item as Record<string, unknown>);
    const value = keyField === 'id' && record.id !== undefined ? record.id : bag[keyField];
    return String(value ?? '');
  }
  return String(item ?? '');
}

export function validateSubmission(
  engine: Engine,
  activity: ActivityDef,
  captured: Record<string, unknown>,
  anchorRecord: RecordInstance | null,
  waived: Record<string, string> = {},
): SubmissionIssue[] {
  const issues: SubmissionIssue[] = [];
  const byKey = new Map(activity.attributes.map(a => [a.key, a]));

  // Composite cells may arrive nested or as dotted flat keys — normalise to
  // flat, then a valid key is a scalar attribute or a declared cell path.
  const flat = flattenCaptured(activity.attributes, captured);
  const isCellPath = (key: string): boolean => {
    const [head, subKey, ...rest] = key.split('.');
    const subs = compositeSubs(byKey.get(head));
    if (!subs || rest.length > 0 || !subKey) return false;
    return subs.some(s => s.key === subKey);
  };

  // Payload shape first — unknown keys mean the caller misread the signature.
  // Section pseudo-attributes carry no value; a captured one is unknown.
  for (const key of Object.keys(flat)) {
    if (byKey.get(key)?.type === 'section') {
      issues.push({ attribute: key, message: `'${key}' is a section marker — it takes no value` });
    } else if (byKey.has(key) && compositeSubs(byKey.get(key))) {
      issues.push({ attribute: key, message: `'${key}' is a composite — send its cells as an object of sub-attributes, not a single value` });
    } else if (!byKey.has(key) && !isCellPath(key)) {
      issues.push({ attribute: key, message: `Unknown attribute '${key}' for activity '${activity.id}'` });
    }
  }
  for (const key of Object.keys(waived)) {
    if (!byKey.has(key) && !isCellPath(key)) {
      issues.push({ attribute: key, message: `Unknown waived attribute '${key}' for activity '${activity.id}'` });
    }
  }
  if (issues.length > 0) return issues;

  const typed = coerceCaptured(activity.attributes, flat);
  const scriptBase = {
    liveAttributes: typed,
    anchorRecord,
    activity: { id: activity.id, name: activity.name },
  };

  const isVisible = (attr: AttributeDef): boolean => {
    if (!attr.show_condition) return true;
    try {
      return engine.evaluate(attr.show_condition, scriptBase) === true;
    } catch {
      return true; // fail open — mirrors the form
    }
  };

  const checkListMembership = (label: string, key: string, datasource: string, keyField: string, submitted: string[]) => {
    try {
      const result = engine.evaluate(datasource, scriptBase);
      if (!Array.isArray(result)) {
        issues.push({ attribute: key, message: `'${key}' datasource did not return a list` });
        return;
      }
      const allowed = new Set(result.map(item => optionValue(item, keyField)));
      for (const value of submitted) {
        if (!allowed.has(value)) issues.push({ attribute: key, message: `'${value}' is not in the datasource for '${label}'` });
      }
    } catch (err) {
      issues.push({ attribute: key, message: `'${key}' datasource failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  for (const attr of activity.attributes) {
    // Section markers are presentation-only.
    if (attr.type === 'section') continue;

    // Composite: the same required / waive / validation semantics, per cell.
    const subs = compositeSubs(attr);
    if (subs) {
      if (!isVisible(attr)) {
        for (const k of Object.keys(flat)) {
          if (k.startsWith(`${attr.key}.`) && !isBlank(flat[k])) {
            issues.push({ attribute: k, message: `'${k}' is not applicable for this submission` });
          }
        }
        for (const k of Object.keys(waived)) {
          if (k.startsWith(`${attr.key}.`)) issues.push({ attribute: k, message: `'${k}' is not applicable and cannot be waived` });
        }
        continue;
      }
      for (const sub of subs) {
        const path = `${attr.key}.${sub.key}`;
        const cellLabel = `${attr.label} — ${sub.label}`;
        const cellVal = flat[path];
        const cellFilled = !isBlank(cellVal);
        const cellStr = typeof cellVal === 'string' ? cellVal.trim() : '';
        if (!isVisible(sub)) {
          if (cellFilled) issues.push({ attribute: path, message: `'${path}' is not applicable for this submission` });
          if (path in waived) issues.push({ attribute: path, message: `'${path}' is not applicable and cannot be waived` });
          continue;
        }
        if (path in waived) {
          if (!sub.can_waive) {
            issues.push({ attribute: path, message: `'${path}' cannot be waived` });
            continue;
          }
          if (cellFilled) issues.push({ attribute: path, message: `'${path}' is waived — it must not also carry a value` });
          if (!String(waived[path] ?? '').trim()) issues.push({ attribute: path, message: `A reason is needed for '${cellLabel}'` });
          continue;
        }
        if (!cellFilled) {
          if (sub.required) issues.push({ attribute: path, message: `${cellLabel} is required` });
          continue;
        }
        for (const m of descriptorShapeIssues(sub.type, cellVal, cellLabel)) issues.push({ attribute: path, message: m });
        if (sub.validation) {
          try {
            const ok = engine.evaluate(sub.validation, { ...scriptBase, extras: { value: coerceCapturedValue(sub.type, cellVal) } });
            if (ok !== true) issues.push({ attribute: path, message: sub.validation_message ?? `${cellLabel} is invalid` });
          } catch (err) {
            issues.push({ attribute: path, message: `${cellLabel}: ${err instanceof Error ? err.message : String(err)}` });
          }
        }
        if (sub.type === 'list') {
          const datasource = sub.type_config?.datasource;
          if (!datasource) issues.push({ attribute: path, message: `'${path}' has no datasource` });
          else checkListMembership(cellLabel, path, datasource, sub.type_config?.key_field ?? 'id', [cellStr]);
        }
      }
      continue;
    }

    const value = flat[attr.key];
    const filled = !isBlank(value);
    const raw = typeof value === 'string' ? value.trim() : '';
    const isWaived = attr.key in waived;

    if (!isVisible(attr)) {
      if (filled) issues.push({ attribute: attr.key, message: `'${attr.key}' is not applicable for this submission` });
      if (isWaived) issues.push({ attribute: attr.key, message: `'${attr.key}' is not applicable and cannot be waived` });
      continue;
    }

    if (isWaived) {
      if (!attr.can_waive) {
        issues.push({ attribute: attr.key, message: `'${attr.key}' cannot be waived` });
        continue;
      }
      if (filled) issues.push({ attribute: attr.key, message: `'${attr.key}' is waived — it must not also carry a value` });
      if (!String(waived[attr.key] ?? '').trim()) issues.push({ attribute: attr.key, message: `A reason is needed for '${attr.label}'` });
      continue;
    }

    if (!filled) {
      if (attr.required) issues.push({ attribute: attr.key, message: `${attr.label} is required` });
      continue;
    }

    // Photo/file: server-authoritative descriptor shape, count, and per-file
    // size (§5/§7). A single-valued attribute must not carry an array; a multi
    // one is length-checked against max_count; each descriptor is shape- and
    // size-checked (max_size_mb re-checked here after the presign gate).
    if (isDescriptorType(attr.type)) {
      const cfg = attr.type_config ?? {};
      const isMulti = cfg.multi === true;
      const items = Array.isArray(value) ? value : [value];
      if (!isMulti && Array.isArray(value)) {
        issues.push({ attribute: attr.key, message: `${attr.label} takes a single ${attr.type}` });
      }
      if (isMulti && typeof cfg.max_count === 'number' && items.length > cfg.max_count) {
        issues.push({ attribute: attr.key, message: `${attr.label}: at most ${cfg.max_count} allowed` });
      }
      items.forEach((item, i) => {
        const lbl = isMulti ? `${attr.label} #${i + 1}` : attr.label;
        for (const m of descriptorShapeIssues(attr.type, item, lbl)) issues.push({ attribute: attr.key, message: m });
        const size = item && typeof item === 'object' ? (item as Record<string, unknown>).size : undefined;
        if (typeof cfg.max_size_mb === 'number' && typeof size === 'number' && size > cfg.max_size_mb * 1024 * 1024) {
          issues.push({ attribute: attr.key, message: `${lbl} exceeds ${cfg.max_size_mb} MB` });
        }
      });
    }

    // Attribute-level validation rule (FluxScript; the captured value is `value`)
    if (attr.validation) {
      try {
        const ok = engine.evaluate(attr.validation, { ...scriptBase, extras: { value: typed[attr.key] } });
        if (ok !== true) issues.push({ attribute: attr.key, message: attr.validation_message ?? `${attr.label} is invalid` });
      } catch (err) {
        issues.push({ attribute: attr.key, message: `${attr.label}: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    // Datasource membership — headless-only, fail closed: the datasource IS
    // the validation here, so an evaluation error must not wave values through.
    if (attr.type === 'list') {
      const datasource = attr.type_config?.datasource;
      if (!datasource) {
        issues.push({ attribute: attr.key, message: `'${attr.key}' has no datasource` });
        continue;
      }
      try {
        const result = engine.evaluate(datasource, scriptBase);
        if (!Array.isArray(result)) {
          issues.push({ attribute: attr.key, message: `'${attr.key}' datasource did not return a list` });
          continue;
        }
        const keyField = attr.type_config?.key_field ?? 'id';
        const allowed = new Set(result.map(item => optionValue(item, keyField)));
        const submitted = Array.isArray(typed[attr.key])
          ? (typed[attr.key] as unknown[]).map(v => String(v ?? ''))
          : [raw];
        for (const value of submitted) {
          if (!allowed.has(value)) issues.push({ attribute: attr.key, message: `'${value}' is not in the datasource for '${attr.label}'` });
        }
      } catch (err) {
        issues.push({ attribute: attr.key, message: `'${attr.key}' datasource failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    // Reference existence — the form's picker guarantees this by construction.
    if (attr.type === 'reference') {
      const fkType = attr.type_config?.fk_record_type;
      if (fkType) {
        let found: RecordInstance | null = null;
        try {
          found = engine.store.getRecord(raw);
        } catch {
          found = null;
        }
        if (!found || found.typeRef !== (fkType.startsWith('rt_') ? fkType : fullId(fkType))) {
          issues.push({ attribute: attr.key, message: `${attr.label}: no ${shortName(fkType)} record '${raw}'` });
        }
      }
    }
  }

  return issues;
}
