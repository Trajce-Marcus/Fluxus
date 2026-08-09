// The shared activity engine: one pipeline, host-agnostic. A host (workbench,
// page builder) constructs an Engine from its Store + config + service modules
// and drives all record mutation through runActivity — no write path bypasses
// activities — and all model-defined reads through runQuery. Extracted from
// the sdm workbench at the Extraction milestone; UI concerns (selection,
// toasts, console channels) stay with the host.

import { evaluateExpression, executeScript, FluxFailError, type ServiceModuleDef } from '@fluxus/dsl';
import type { ActivityDef, ClientSolutionConfig, ContextUser, QueryActivityResult, RecordInstance, RunActivityResult } from './types';
import type { Store } from './store';
import { buildEvalHost, coerceCaptured, compositeSubs, flattenCaptured, nestComposite, serializeFields, toComponentValue, type ScriptContext } from './bridge';
import { validateConfig, reportConfigFindings, type Finding } from './validateConfig';
import { buildLoggerModule } from './services/logger';

export interface EngineOptions {
  store: Store;
  /**
   * Either grade of the model (CLIENT_TRUST_BOUNDARY §2). The server passes the
   * full one, a browser host the trimmed one; the engine reads hooks off the
   * Store's resolved activities, never off the config, so the pipeline is the
   * same either way — a browser simply has no hook bodies to run, which is the
   * point.
   */
  config: ClientSolutionConfig;
  services?: ServiceModuleDef[];
  /**
   * The identity every evaluation sees as `context.user` and every committed
   * entry records as `author`. The server passes the per-request verified
   * user; absent → the demo stub (auth unconfigured, tests, browser hosts
   * that only evaluate).
   */
  user?: ContextUser;
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
   * The read path: run a GET activity's `returns` with the captured
   * attributes as its parameters (DSL_SPEC §5a). Same gate and same before
   * hook as a write; nothing persists.
   */
  runQuery(
    activity: ActivityDef,
    captured: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
  ): QueryActivityResult;
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

/** Drop null cells from a composite's live value. */
function stripNullCells(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== null));
}

export function createEngine({ store, config, services: hostServices = [], user }: EngineOptions): Engine {
  // services.logger — engine-owned (see services/logger.ts): lines noted
  // during a run land on the entry as the reserved `system_log` attribute —
  // only if the run commits an entry (rejected submissions leave no trace,
  // DELETEs have no entry).
  if (hostServices.some((m) => m.name.toLowerCase() === 'logger')) {
    throw new Error("Service module name 'logger' is reserved by the engine");
  }
  let runLog: string[] = [];
  const loggerModule = buildLoggerModule((line) => {
    runLog.push(line);
  });
  const services = [...hostServices, loggerModule];

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
        buildEvalHost(store, config, { anchorRecord, activity: { id: activity.id, name: activity.name }, user }, services)
      );
      return { available: result === true };
    } catch (err) {
      console.warn(`show_condition failed for activity '${activity.id}' — failing closed:`, err);
      return { available: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // `invoke(activityId, params)` — the hook-facing read door (DSL_SPEC §5a).
  // Read-only by construction: it can only reach a GET, so it carries none of
  // the cascade risk that keeps hooks from starting other workflows (a
  // workflow triggers another by creating a record, never by calling an
  // activity — CLIENT_TRUST_BOUNDARY §1).
  //
  // The in-flight set stops a GET whose gate invokes itself from hanging the
  // request. Recursion is the only way a read can run away, since nothing it
  // does changes what the next read sees.
  const inFlight = new Set<string>();

  function findActivity(activityId: string): ActivityDef | null {
    for (const rt of store.listRecordTypes()) {
      const found = store.getRecordTypeDef(rt.id).workflow.activities.find((a) => a.id === activityId);
      if (found) return found;
    }
    return null;
  }

  function invoke(activityId: string, params: Record<string, unknown>, anchorRecord: RecordInstance | null): unknown {
    const activity = findActivity(activityId);
    if (!activity) throw new Error(`invoke('${activityId}') — no such activity`);
    if (activity.record_map !== 'GET') {
      throw new Error(`invoke('${activityId}') — only GET activities can be invoked; this one is ${activity.record_map ?? 'log-only'}`);
    }
    if (inFlight.has(activityId)) {
      throw new Error(`invoke('${activityId}') — already running; a GET cannot invoke itself`);
    }
    inFlight.add(activityId);
    try {
      // The invoking run's anchor carries through: a guard asks its question
      // about the record it is guarding.
      return runQuery(activity, params, anchorRecord).data;
    } finally {
      inFlight.delete(activityId);
    }
  }

  // Availability gate — first step of every pipeline, read or write, before
  // the before hook. The UI hides unavailable activities, but the gate is the
  // enforcement point (headless callers skip the UI entirely).
  function enforceAvailability(activity: ActivityDef, anchorRecord: RecordInstance | null): void {
    const availability = activityAvailability(activity, anchorRecord);
    if (!availability.available) {
      throw new Error(
        availability.error
          ? `'${activity.name}' availability check failed — blocked: ${availability.error}`
          : `'${activity.name}' is not available for this record`
      );
    }
  }

  // before hook = gate (DSL_SPEC §6): read-only; fail() rejects the run before
  // anything persists. A runtime error in the hook also blocks — a broken gate
  // must not wave submissions through. Returns the warnings it raised; what a
  // caller does with them differs (a write offers a soft stop, a read cannot).
  function runGate(activity: ActivityDef, scriptContext: ScriptContext): string[] {
    if (!activity.before_hook) return [];
    try {
      const result = executeScript(activity.before_hook, buildEvalHost(store, config, scriptContext, services), { mode: 'read' });
      return result.warnings;
    } catch (err) {
      if (err instanceof FluxFailError) throw new Error(err.message);
      throw new Error(`Before hook error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * The read path (DSL_SPEC §5a, DATA_THROUGH_ACTIVITIES step 1). Shares the
   * front of the pipeline with `runActivity` — availability gate, then the
   * before hook as a gate — and then answers with the `returns` expression
   * instead of touching storage. Nothing persists, so there is no entry, no
   * record_map and no soft stop: gate warnings ride back with the answer
   * rather than asking for confirmation, because re-running a read that
   * changed nothing would only run it again.
   *
   * Logging is step 3. Today a GET leaves no trace, which is the one promise
   * of "the pipeline is the log" this does not yet keep.
   */
  function runQuery(
    activity: ActivityDef,
    captured: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
  ): QueryActivityResult {
    if (activity.record_map !== 'GET') {
      throw new Error(`'${activity.name}' is not a GET activity — run it through runActivity`);
    }
    if (!activity.returns) {
      throw new Error(`GET activity '${activity.id}' has no 'returns' expression`);
    }
    enforceAvailability(activity, anchorRecord);
    runLog = [];

    // Parameters are attributes, so they arrive and coerce exactly as a
    // capture form's values do (DATA_THROUGH_ACTIVITIES §2).
    const stringValues = flattenCaptured(activity.attributes, captured);
    const liveAttributes = { ...coerceCaptured(activity.attributes, stringValues) };
    const scriptContext: ScriptContext = {
      liveAttributes,
      anchorRecord,
      activity: { id: activity.id, name: activity.name },
      user,
      // Defence in depth under the validator's purity check: a mutation that
      // slipped past config-save throws here rather than writing.
      readonlyRecords: true,
      invoke: (id, params) => invoke(id, params, anchorRecord),
    };

    const warnings = runGate(activity, scriptContext);
    const answer = evaluateExpression(
      activity.returns,
      buildEvalHost(store, config, scriptContext, services),
    );
    // Callers are SDM-blind (an app page, another host's fetch), so records
    // flatten to plain data on the way out — the same shaping a component gets.
    return { data: toComponentValue(answer), warnings };
  }

  function runActivity(
    activity: ActivityDef,
    captured: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
    options?: RunActivityOptions
  ): RunActivityResult {
    if (activity.record_map === 'GET') {
      throw new Error(`'${activity.name}' is a GET activity — read it through runQuery`);
    }
    enforceAvailability(activity, anchorRecord);

    const warnings: string[] = [];
    // Attributes declared unavailable: scripts see them as null, they never
    // write to record fields, and the waiver lands on the history entry.
    const waived = options?.waived ?? {};
    // Fresh system log per run (sync evaluator — runs never interleave).
    runLog = [];

    // Hooks see captured values coerced to their attribute's declared type (DSL_SPEC §5).
    // The live bag is shared across both hooks WITHOUT copying: hooks may write
    // attributes (`attributes.crew = …`) and the writes land on the history
    // entry below. coerceCaptured already maps empty strings to null.
    // Composite cells are normalised first: payloads may carry them nested or
    // as dotted flat keys; scripts always see them nested under the attribute.
    const stringValues = flattenCaptured(activity.attributes, captured);
    const liveAttributes = { ...coerceCaptured(activity.attributes, stringValues) };
    const initialAttributes = { ...liveAttributes };
    // Composite values are objects, so reference identity can't detect hook
    // writes into their cells — snapshot their JSON instead.
    const initialCompositeJson = new Map<string, string>();
    for (const attr of activity.attributes) {
      if (compositeSubs(attr)) initialCompositeJson.set(attr.key, JSON.stringify(liveAttributes[attr.key]));
    }
    const scriptContext: ScriptContext = {
      liveAttributes,
      anchorRecord,
      activity: { id: activity.id, name: activity.name },
      user,
      invoke: (id, params) => invoke(id, params, anchorRecord),
    };

    warnings.push(...runGate(activity, scriptContext));
    // Gate warnings are a soft stop: hand them back for the user to confirm.
    // Nothing has persisted (the gate is read-only), so cancelling is free.
    if (warnings.length > 0 && !options?.acknowledgedWarnings) {
      return { status: 'needs-confirmation', warnings };
    }
    // Acknowledged gate warnings ride the entry; after-hook warnings are
    // execution outcome and only travel in the result.
    const gateWarnings = [...warnings];

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

    // after hook = effects (DSL_SPEC §6–§7): mutations stage during the run and
    // commit atomically; queued service calls dispatch only after the commit.
    // It runs before the entry is appended so hook-written attributes and the
    // system log land in the same single write — but a failing after hook
    // still gets the entry appended (the activity is recorded; no changes
    // were applied).
    let afterHookError: string | null = null;
    if (activity.after_hook) {
      try {
        const result = executeScript(
          activity.after_hook,
          buildEvalHost(store, config, { ...scriptContext, anchorRecord: store.getRecord(targetRecordId) }, services),
          { mode: 'mutate' },
        );
        warnings.push(...result.warnings);
      } catch (err) {
        afterHookError = err instanceof Error ? err.message : String(err);
      }
    }

    // Entry attributes: what the user entered, plus what hooks wrote into the
    // live bag (new or changed keys; skipped when the after hook failed —
    // "no changes applied" covers its attribute writes too), plus the run's
    // system log under the reserved `system_log` key.
    const hookWritten: Record<string, unknown> = {};
    if (afterHookError === null) {
      for (const [k, v] of Object.entries(liveAttributes)) {
        const compositeBefore = initialCompositeJson.get(k);
        if (compositeBefore !== undefined) {
          // Composite: JSON compare (cells mutate in place); store without null cells
          if (compositeBefore !== JSON.stringify(v)) hookWritten[k] = stripNullCells(v);
        } else if (!(k in initialAttributes) || initialAttributes[k] !== v) {
          hookWritten[k] = v;
        }
      }
    }
    // Entry shape: scalar attributes raw as captured; composite attributes
    // nested attr → sub with only non-empty, non-waived cells (their flat
    // dotted / nested raw forms never appear alongside).
    const compositeKeys = new Set(initialCompositeJson.keys());
    const scalarCaptured = Object.fromEntries(
      Object.entries(captured).filter(
        ([k]) => !compositeKeys.has(k) && !(k.includes('.') && compositeKeys.has(k.split('.')[0]))
      )
    );
    const entryAttributes: Record<string, unknown> = { ...scalarCaptured };
    for (const attr of activity.attributes) {
      const subs = compositeSubs(attr);
      if (!subs) continue;
      const nested = nestComposite(attr.key, subs, stringValues, waived);
      if (Object.keys(nested).length > 0) entryAttributes[attr.key] = nested;
    }
    Object.assign(entryAttributes, serializeFields(hookWritten));
    if (runLog.length > 0) entryAttributes['system_log'] = [...runLog];

    store.appendActivity(targetRecordId, {
      activityId: activity.id,
      activityName: activity.name,
      ...(user ? { author: user.id } : {}),
      capturedAttributes: entryAttributes,
      ...(gateWarnings.length > 0 ? { warnings: gateWarnings } : {}),
      ...(Object.keys(waived).length > 0 ? { waived: { ...waived } } : {}),
      timestamp: new Date().toISOString(),
    });

    if (afterHookError !== null) {
      throw new Error(`After hook failed — the activity was recorded but no changes were applied: ${afterHookError}`);
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
    runQuery,
    evaluate: (source, script) => evaluateExpression(source, buildEvalHost(store, config, { user, ...script }, services)),
    validateConfig: () => validateConfig(config, services),
    reportConfigFindings: () => reportConfigFindings(config, services),
  };
}
