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
import { coerceCaptured, fullId, shortName } from './bridge';

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
  captured: Record<string, string>,
  anchorRecord: RecordInstance | null,
  waived: Record<string, string> = {},
): SubmissionIssue[] {
  const issues: SubmissionIssue[] = [];
  const byKey = new Map(activity.attributes.map(a => [a.key, a]));

  // Payload shape first — unknown keys mean the caller misread the signature.
  for (const key of Object.keys(captured)) {
    if (!byKey.has(key)) issues.push({ attribute: key, message: `Unknown attribute '${key}' for activity '${activity.id}'` });
  }
  for (const key of Object.keys(waived)) {
    if (!byKey.has(key)) issues.push({ attribute: key, message: `Unknown waived attribute '${key}' for activity '${activity.id}'` });
  }
  if (issues.length > 0) return issues;

  const typed = coerceCaptured(activity.attributes, captured);
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

  for (const attr of activity.attributes) {
    const raw = String(captured[attr.key] ?? '').trim();
    const isWaived = attr.key in waived;

    if (!isVisible(attr)) {
      if (raw) issues.push({ attribute: attr.key, message: `'${attr.key}' is not applicable for this submission` });
      if (isWaived) issues.push({ attribute: attr.key, message: `'${attr.key}' is not applicable and cannot be waived` });
      continue;
    }

    if (isWaived) {
      if (!attr.can_waive) {
        issues.push({ attribute: attr.key, message: `'${attr.key}' cannot be waived` });
        continue;
      }
      if (raw) issues.push({ attribute: attr.key, message: `'${attr.key}' is waived — it must not also carry a value` });
      if (!String(waived[attr.key] ?? '').trim()) issues.push({ attribute: attr.key, message: `A reason is needed for '${attr.label}'` });
      continue;
    }

    if (!raw) {
      if (attr.required) issues.push({ attribute: attr.key, message: `${attr.label} is required` });
      continue;
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
