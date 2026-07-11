// The shared activity engine: one pipeline, host-agnostic. A host (workbench,
// page builder) constructs an Engine from its Store + config + service modules
// and drives all record mutation through runActivity — no write path bypasses
// activities. Extracted from the sdm workbench at the Extraction milestone;
// UI concerns (selection, toasts, console channels) stay with the host.

import { evaluateExpression, executeScript, FluxFailError, type ServiceModuleDef } from '@fluxus/dsl';
import type { ActivityDef, ConfigRaw, RecordInstance, RunActivityResult } from './types';
import type { Store } from './store';
import { buildEvalHost, coerceCaptured, type ScriptContext } from './bridge';
import { validateConfig, reportConfigFindings, type Finding } from './validateConfig';

export interface EngineOptions {
  store: Store;
  config: ConfigRaw;
  services?: ServiceModuleDef[];
}

export interface ActivityAvailability {
  available: boolean;
  error?: string;
}

export interface RunActivityOptions {
  acknowledgedWarnings?: boolean;
  waived?: Record<string, string>;
}

export interface Engine {
  readonly store: Store;
  /** Availability gate result — see ActivityRawDef.show_condition. */
  activityAvailability(activity: ActivityDef, anchorRecord: RecordInstance | null): ActivityAvailability;
  isActivityAvailable(activity: ActivityDef, anchorRecord: RecordInstance | null): boolean;
  runActivity(
    activity: ActivityDef,
    captured: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
    options?: RunActivityOptions
  ): RunActivityResult;
  /**
   * Evaluate a FluxScript expression (datasource, show condition) against the
   * live store, with the given script context injected as the four roots.
   */
  evaluate(source: string, script: ScriptContext): unknown;
  /** Config-save-time validation of every FluxScript script in the config. */
  validateConfig(): Finding[];
  /** validateConfig with diagnostics reported to the console. */
  reportConfigFindings(): void;
}

export function createEngine({ store, config, services = [] }: EngineOptions): Engine {
  // A CREATE activity targets the record type whose workflow declares it —
  // derived from config here so hosts never have to say which type is
  // "selected" (the pipeline must work headless).
  const createTypeByActivity = new Map<string, string>();
  for (const rt of config.recordTypes) {
    const wf = config.workflows.find(w => w.id === rt.workflow_ref);
    for (const act of wf?.activities ?? []) {
      if (act.record_map === 'CREATE') createTypeByActivity.set(act.id, rt.id);
    }
  }

  // Activity-level show_condition — the availability gate. Strict boolean: only
  // `true` makes the activity available. Evaluation errors FAIL CLOSED (unlike
  // attribute show_conditions, which leave the input visible): this is an access
  // rule, and a broken gate must not wave the activity through.
  function activityAvailability(
    activity: ActivityDef,
    anchorRecord: RecordInstance | null
  ): ActivityAvailability {
    if (!activity.show_condition) return { available: true };
    try {
      const result = evaluateExpression(
        activity.show_condition,
        buildEvalHost(store, config, { anchorRecord, activity: { id: activity.id, name: activity.name } }, services)
      );
      return { available: result === true };
    } catch (err) {
      console.warn(`show_condition failed for activity '${activity.id}' — failing closed:`, err);
      return { available: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  function runActivity(
    activity: ActivityDef,
    captured: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
    options?: RunActivityOptions
  ): RunActivityResult {
    // Availability gate — first step of the pipeline, before the before hook.
    // The UI hides unavailable activities, but the gate is the enforcement
    // point (headless callers skip the UI entirely).
    const availability = activityAvailability(activity, anchorRecord);
    if (!availability.available) {
      throw new Error(
        availability.error
          ? `'${activity.name}' availability check failed — blocked: ${availability.error}`
          : `'${activity.name}' is not available for this record`
      );
    }

    const warnings: string[] = [];
    // Attributes declared unavailable: scripts see them as null, they never
    // write to record fields, and the waiver lands on the history entry.
    const waived = options?.waived ?? {};

    // Hooks see captured values coerced to their attribute's declared type (DSL_SPEC §5)
    const stringValues = Object.fromEntries(
      Object.entries(captured).map(([k, v]) => [k, String(v ?? '')])
    );
    const typedAttributes = coerceCaptured(activity.attributes, stringValues);
    const scriptContext: ScriptContext = {
      attributes: typedAttributes,
      anchorRecord,
      activity: { id: activity.id, name: activity.name },
    };

    // before hook = gate (DSL_SPEC §6): read-only; fail() rejects the activity
    // before anything persists. A runtime error in the hook also blocks — a
    // broken gate must not wave submissions through.
    if (activity.before_hook) {
      try {
        const result = executeScript(activity.before_hook, buildEvalHost(store, config, scriptContext, services), { mode: 'read' });
        warnings.push(...result.warnings);
      } catch (err) {
        if (err instanceof FluxFailError) throw new Error(err.message);
        throw new Error(`Before hook error: ${err instanceof Error ? err.message : String(err)}`);
      }
      // Gate warnings are a soft stop: hand them back for the user to confirm.
      // Nothing has persisted (the gate is read-only), so cancelling is free.
      if (warnings.length > 0 && !options?.acknowledgedWarnings) {
        return { status: 'needs-confirmation', warnings };
      }
    }

    let targetRecordId: string;

    if (activity.record_map === 'CREATE') {
      const typeId = createTypeByActivity.get(activity.id);
      if (!typeId) throw new Error(`No record type's workflow creates via activity '${activity.id}'`);
      // Exact-key matching: only attributes whose key matches a custom_field key are written.
      // Unmatched attributes (e.g. 'raise_notes' on the sample Raise activity) are silently dropped.
      // This is SDM §1.9.3 rule 2 — DO NOT treat it as a bug.
      const cfKeys = new Set(
        store.getRecordTypeDef(typeId).custom_fields.map(cf => cf.key)
      );
      const mappedFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(captured)) {
        if (cfKeys.has(k) && !(k in waived)) mappedFields[k] = v; // waived: field seeds from default
      }
      const newRecord = store.createRecord(typeId, mappedFields);
      targetRecordId = newRecord.id;
    } else if (activity.record_map === 'UPDATE') {
      // Exact-key matching against the anchor record's custom fields — SDM §1.9.5.
      const cfKeys = new Set(
        store.getRecordTypeDef(anchorRecord!.typeRef).custom_fields.map(cf => cf.key)
      );
      const mappedFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(captured)) {
        // Waived = "can't provide it now" — it must never blank a value
        // someone captured earlier
        if (cfKeys.has(k) && !(k in waived)) mappedFields[k] = v;
      }
      store.updateRecord(anchorRecord!.id, mappedFields);
      targetRecordId = anchorRecord!.id;
    } else if (activity.record_map === 'DELETE') {
      if (String(captured['confirm'] ?? '').trim() !== 'DELETE') return { status: 'done', warnings };
      const recordId = anchorRecord!.id;
      store.deleteRecord(recordId);
      return { status: 'done', warnings, recordId };
    } else {
      // ordinary capture — append against the anchor record
      targetRecordId = anchorRecord!.id;
    }

    // append an entry to the Record's activity history; acknowledged gate
    // warnings are part of the submission's story (audit), captured separately
    // from user input
    store.appendActivity(targetRecordId, {
      activityId: activity.id,
      activityName: activity.name,
      capturedAttributes: captured,
      ...(warnings.length > 0 ? { warnings: [...warnings] } : {}),
      ...(Object.keys(waived).length > 0 ? { waived: { ...waived } } : {}),
      timestamp: new Date().toISOString(),
    });

    // after hook = effects (DSL_SPEC §6–§7): mutations stage during the run and
    // commit atomically; queued service calls dispatch only after the commit.
    // The activity itself has already persisted — a failing after hook applies
    // no changes but does not un-record the activity.
    if (activity.after_hook) {
      try {
        const result = executeScript(
          activity.after_hook,
          buildEvalHost(store, config, { ...scriptContext, anchorRecord: store.getRecord(targetRecordId) }, services),
          { mode: 'mutate' },
        );
        warnings.push(...result.warnings);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`After hook failed — the activity was recorded but no changes were applied: ${message}`);
      }
    }

    // After-hook warnings are informational (the commit already happened);
    // surfacing them is the host's job — the engine has no UI channel.
    return { status: 'done', warnings, recordId: targetRecordId };
  }

  return {
    store,
    activityAvailability,
    isActivityAvailable: (activity, anchorRecord) => activityAvailability(activity, anchorRecord).available,
    runActivity,
    evaluate: (source, script) => evaluateExpression(source, buildEvalHost(store, config, script, services)),
    validateConfig: () => validateConfig(config, services),
    reportConfigFindings: () => reportConfigFindings(config, services),
  };
}
