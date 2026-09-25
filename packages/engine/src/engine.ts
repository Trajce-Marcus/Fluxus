// The shared activity engine: one pipeline, host-agnostic. A host (workbench,
// page builder) constructs an Engine from its Store + config + service modules
// and drives all record mutation through runActivity — no write path bypasses
// activities — and all model-defined reads through runQuery. Extracted from
// the sdm workbench at the Extraction milestone; UI concerns (selection,
// toasts, console channels) stay with the host.

import { evaluateExpression, evaluateExpressionAsync, executeScriptAsync, FluxFailError, type ServiceModuleDef } from '@fluxus/dsl';
import type { ActivityDef, ClientSolutionConfig, ContextUser, QueryActivityResult, RecordInstance, RunActivityResult } from './types';
import type { Store, WaitingStore } from './store';
import { blockingReferences, buildEvalHost, coerceCaptured, compositeSubs, flattenCaptured, nestComposite, serializeFields, toComponentValue, type ScriptContext } from './bridge';
import { validateConfig, reportConfigFindings, type Finding } from './validateConfig';
import { buildLoggerModule } from './services/logger';
import { attributeFieldRef } from './attributeTypes';

export interface EngineOptions<S extends WaitingStore = Store> {
  store: S;
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

/**
 * The after hook failed: the activity was recorded — its record map's change
 * and its entry stand — but none of the hook's changes were applied. A caller
 * that holds the writes in a transaction commits them and then reports this.
 */
export class AfterHookFailedError extends Error {
  constructor(message: string, readonly reason: unknown) {
    super(`After hook failed — the activity was recorded but no changes were applied: ${message}`);
  }
}

export interface RunActivityOptions {
  acknowledgedWarnings?: boolean;
  waived?: Record<string, string>;
}

/**
 * Which field each captured attribute lands in, where the attribute says so
 * (`type_config.field`, `rt_type.field_key`). Attributes that name no field are
 * absent from the map and keep the exact-key rule — the key is the field key.
 *
 * An attribute naming a field on **another** record type is absent too: it did
 * not mean this record, so its value drops the way an unmatched attribute
 * always has.
 */
function landingFields(activity: ActivityDef, typeId: string): Map<string, string> {
  const landing = new Map<string, string>();
  for (const attr of activity.attributes) {
    const ref = attributeFieldRef(attr.type_config as Record<string, unknown> | undefined);
    if (ref && ref.typeId === typeId) landing.set(attr.key, ref.fieldKey);
  }
  return landing;
}

/**
 * One engine per request, never shared: it holds per-run state (the system
 * log, the `invoke` in-flight set) that relies on runs not interleaving.
 *
 * Two kinds of function (SERVER_DATA_LOADING §4.2). **Immediate** — the
 * browser's: `activityAvailability`, `isActivityAvailable`, `evaluate`; they
 * need a store that answers immediately. **Waiting** — the server's, and its
 * scripts' and tests': everything returning a promise; they take either store.
 */
export interface Engine<S extends WaitingStore = Store> {
  readonly store: S;
  /** Availability gate result — see ActivityRawDef.show_condition. */
  activityAvailability(activity: ActivityDef, anchorRecord: RecordInstance | null): ActivityAvailability;
  isActivityAvailable(activity: ActivityDef, anchorRecord: RecordInstance | null): boolean;
  /** `activityAvailability`, waiting on the store — the server's gate. */
  activityAvailabilityAsync(activity: ActivityDef, anchorRecord: RecordInstance | null): Promise<ActivityAvailability>;
  isActivityAvailableAsync(activity: ActivityDef, anchorRecord: RecordInstance | null): Promise<boolean>;
  runActivity(
    activity: ActivityDef,
    captured: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
    options?: RunActivityOptions
  ): Promise<RunActivityResult>;
  /**
   * The read path: run a GET activity's `returns` with the captured
   * attributes as its parameters (DSL_SPEC §5a). Same gate and same before
   * hook as a write; no record changes — but the run is logged light on the
   * anchor record, like every other activity (step 3).
   */
  runQuery(
    activity: ActivityDef,
    captured: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
  ): Promise<QueryActivityResult>;
  /**
   * The read door `invoke(activityId, params)` opens, exposed so a caller can
   * put it in a `ScriptContext` and let an expression name a GET — which is
   * what `validateSubmission` does to re-run a producer at submission
   * (DATA_THROUGH_ACTIVITIES step 4). Hooks and `returns` get it injected
   * already; nothing else has to.
   *
   * It evaluates **here**, in this engine, against this store — so a host that
   * must not answer reads locally (a browser) must not hand this to an
   * expression. Today only the server does.
   */
  invoke(
    activityId: string,
    params: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
  ): Promise<unknown>;
  /**
   * Evaluate a FluxScript expression (datasource, show condition) against the
   * live store, with the given script context injected as the four roots.
   */
  evaluate(source: string, script: ScriptContext): unknown;
  /** `evaluate`, waiting on the store, services and `invoke`. */
  evaluateAsync(source: string, script: ScriptContext): Promise<unknown>;
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

// Reserved entry keys a run produces about itself, beside the existing
// `system_log` / `system_warnings` (runtime SPEC, "entry shape rulings"). Both
// are written on a logged read: a write says how it went by persisting, a read
// has only what it can state.
const SYSTEM_OUTCOME = 'system_outcome';
const SYSTEM_DURATION = 'system_duration_ms';

/**
 * The entry's attribute bag as the caller supplied it — shared by both
 * pipelines, because a GET's parameters are attributes and land on its entry
 * exactly as a capture form's values land on a write's. Scalars stay raw as
 * captured; composites are nested attr → sub with only non-empty, non-waived
 * cells, so their flat dotted / nested raw forms never appear alongside.
 */
function capturedEntryAttributes(
  activity: ActivityDef,
  captured: Record<string, unknown>,
  stringValues: Record<string, unknown>,
  waived: Record<string, string>,
): Record<string, unknown> {
  const compositeKeys = new Set(
    activity.attributes.filter((attr) => compositeSubs(attr)).map((attr) => attr.key),
  );
  const entryAttributes: Record<string, unknown> = Object.fromEntries(
    Object.entries(captured).filter(
      ([k]) => !compositeKeys.has(k) && !(k.includes('.') && compositeKeys.has(k.split('.')[0])),
    ),
  );
  for (const attr of activity.attributes) {
    const subs = compositeSubs(attr);
    if (!subs) continue;
    const nested = nestComposite(attr.key, subs, stringValues, waived);
    if (Object.keys(nested).length > 0) entryAttributes[attr.key] = nested;
  }
  return entryAttributes;
}

export function createEngine<S extends WaitingStore = Store>({ store, config, services: hostServices = [], user }: EngineOptions<S>): Engine<S> {
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
      const result = evaluateExpression(activity.show_condition, availabilityHost(activity, anchorRecord));
      return { available: result === true };
    } catch (err) {
      return failedClosed(activity, err);
    }
  }

  async function activityAvailabilityAsync(
    activity: ActivityDef,
    anchorRecord: RecordInstance | null
  ): Promise<ActivityAvailability> {
    if (!activity.show_condition) return { available: true };
    try {
      const result = await evaluateExpressionAsync(activity.show_condition, availabilityHost(activity, anchorRecord));
      return { available: result === true };
    } catch (err) {
      return failedClosed(activity, err);
    }
  }

  function availabilityHost(activity: ActivityDef, anchorRecord: RecordInstance | null) {
    return buildEvalHost(store, config, { anchorRecord, activity: { id: activity.id, name: activity.name }, user }, services);
  }

  function failedClosed(activity: ActivityDef, err: unknown): ActivityAvailability {
    console.warn(`show_condition failed for activity '${activity.id}' — failing closed:`, err);
    return { available: false, error: err instanceof Error ? err.message : String(err) };
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

  async function invoke(activityId: string, params: Record<string, unknown>, anchorRecord: RecordInstance | null): Promise<unknown> {
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
      // about the record it is guarding. It is not logged as a run of its own —
      // a read reached from inside a hook is part of the run that triggered it
      // (runtime SPEC: reads are subsumed by the activity that triggered them),
      // and a separate entry would also mean a read persisting inside a write
      // the gate went on to reject.
      return (await executeQuery(activity, params, anchorRecord, { log: false })).data;
    } finally {
      inFlight.delete(activityId);
    }
  }

  // Availability gate — first step of every pipeline, read or write, before
  // the before hook. The UI hides unavailable activities, but the gate is the
  // enforcement point (headless callers skip the UI entirely).
  async function enforceAvailability(activity: ActivityDef, anchorRecord: RecordInstance | null): Promise<void> {
    const availability = await activityAvailabilityAsync(activity, anchorRecord);
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
  async function runGate(activity: ActivityDef, scriptContext: ScriptContext): Promise<string[]> {
    if (!activity.before_hook) return [];
    try {
      const result = await executeScriptAsync(activity.before_hook, buildEvalHost(store, config, scriptContext, services), { mode: 'read' });
      return result.warnings;
    } catch (err) {
      if (err instanceof FluxFailError) throw new Error(err.message);
      throw new Error(`Before hook error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * The read path (DSL_SPEC §5a, DATA_THROUGH_ACTIVITIES steps 1 and 3).
   * Shares the front of the pipeline with `runActivity` — availability gate,
   * then the before hook as a gate — and then answers with the `returns`
   * expression instead of touching storage. No record changes, so there is no
   * record_map and no soft stop: gate warnings ride back with the answer
   * rather than asking for confirmation, because re-running a read that
   * changed nothing would only run it again.
   *
   * A GET is an activity, so its run is recorded like every other: one entry
   * on the anchor record, **logged light** — the parameters (which are its
   * attributes), the caller, how long it took and how it ended, and never the
   * answer (runtime SPEC, "the pipeline is the log"). An anchorless read has
   * nowhere to land and stays untraced; a page supplies its app record, which
   * is the other half of step 3.
   */
  function runQuery(
    activity: ActivityDef,
    captured: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
  ): Promise<QueryActivityResult> {
    return executeQuery(activity, captured, anchorRecord, { log: true });
  }

  async function executeQuery(
    activity: ActivityDef,
    captured: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
    { log }: { log: boolean },
  ): Promise<QueryActivityResult> {
    if (activity.record_map !== 'GET') {
      throw new Error(`'${activity.name}' is not a GET activity — run it through runActivity`);
    }
    if (!activity.returns) {
      throw new Error(`GET activity '${activity.id}' has no 'returns' expression`);
    }
    await enforceAvailability(activity, anchorRecord);

    // A nested read logs nothing of its own, so it must not disturb the run it
    // belongs to: its logger lines join that run's system log rather than
    // replacing it.
    const outerLog = runLog;
    if (log) runLog = [];
    const startedAt = Date.now();

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

    // A gate rejection leaves no trace, exactly as a rejected submission does:
    // the entry is the record of a run that happened.
    const warnings = await runGate(activity, scriptContext);

    // The light entry, written whichever way the answer goes. `outcome` is the
    // one thing a read has to say about itself that a write says by persisting;
    // an error's message rides the system log rather than earning a key.
    const record = async (outcome: string) => {
      if (!log || !anchorRecord) return;
      const entryAttributes = capturedEntryAttributes(activity, captured, stringValues, {});
      entryAttributes[SYSTEM_OUTCOME] = outcome;
      entryAttributes[SYSTEM_DURATION] = Date.now() - startedAt;
      if (runLog.length > 0) entryAttributes['system_log'] = [...runLog];
      await store.appendActivity(anchorRecord.id, {
        activityId: activity.id,
        activityName: activity.name,
        ...(user ? { author: user.id } : {}),
        capturedAttributes: entryAttributes,
        ...(warnings.length > 0 ? { warnings: [...warnings] } : {}),
        timestamp: new Date().toISOString(),
      });
    };

    let answer: unknown;
    try {
      answer = await evaluateExpressionAsync(
        activity.returns,
        buildEvalHost(store, config, scriptContext, services),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      runLog.push(`returns failed: ${message}`);
      try {
        await record('error');
      } finally {
        if (log) runLog = outerLog;
      }
      throw err;
    }
    try {
      await record('ok');
      // Callers are SDM-blind (an app page, another host's fetch), so records
      // flatten to plain data on the way out — the same shaping a component gets.
      return { data: toComponentValue(answer), warnings };
    } finally {
      if (log) runLog = outerLog;
    }
  }

  async function runActivity(
    activity: ActivityDef,
    captured: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
    options?: RunActivityOptions
  ): Promise<RunActivityResult> {
    if (activity.record_map === 'GET') {
      throw new Error(`'${activity.name}' is a GET activity — read it through runQuery`);
    }
    await enforceAvailability(activity, anchorRecord);

    const warnings: string[] = [];
    // Attributes declared unavailable: scripts see them as null, they never
    // write to record fields, and the waiver lands on the history entry.
    const waived = options?.waived ?? {};
    // Fresh system log per run (one engine per request — runs never interleave).
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

    warnings.push(...(await runGate(activity, scriptContext)));
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
      const landing = landingFields(activity, typeId);
      const mappedFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(captured)) {
        const field = landing.get(k) ?? k;
        if (cfKeys.has(field) && !(k in waived)) mappedFields[field] = v; // waived: field seeds from default
      }
      const newRecord = await store.createRecord(typeId, mappedFields);
      targetRecordId = newRecord.id;
    } else if (activity.record_map === 'UPDATE') {
      // Exact-key matching against the anchor record's custom fields — SDM §1.9.5.
      const cfKeys = new Set(
        store.getRecordTypeDef(anchorRecord!.typeRef).custom_fields.map(cf => cf.key)
      );
      const landing = landingFields(activity, anchorRecord!.typeRef);
      const mappedFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(captured)) {
        const field = landing.get(k) ?? k;
        // Waived = "can't provide it now" — it must never blank a value
        // someone captured earlier
        if (cfKeys.has(field) && !(k in waived)) mappedFields[field] = v;
      }
      await store.updateRecord(anchorRecord!.id, mappedFields);
      targetRecordId = anchorRecord!.id;
    } else if (activity.record_map === 'DELETE') {
      // Four steps, the user's sequence (2026-09-21): initiate, confirm, the
      // record and its history go, the caller is told what happened.
      //
      // **Confirm** is the platform's existing soft-stop, not a hidden
      // attribute. Until this date the engine looked for a captured attribute
      // literally named `confirm` holding the string 'DELETE' — a contract
      // stated nowhere in the model, and worse, a run that did not satisfy it
      // returned 'done' having deleted nothing. Now a delete always raises the
      // stop, so the confirmation is guaranteed rather than left to whether an
      // author remembered to ask; an author wanting their own wording adds a
      // `warn()` in the before hook and it is shown alongside.
      const recordId = anchorRecord!.id;
      if (!options?.acknowledgedWarnings) {
        return {
          status: 'needs-confirmation',
          warnings: [...warnings, `Deleting '${recordId}' also deletes its history. This cannot be undone.`],
        };
      }
      // **Referential integrity**, the same rule a hook's delete() obeys: a
      // record other records point at is refused, and the message names them.
      const blocked = await blockingReferences(store, recordId);
      if (blocked) throw new Error(blocked);
      await store.deleteRecord(recordId);
      // **The result.** `deleted` is what tells a caller the record is gone
      // rather than merely changed — the id alone cannot say which.
      return { status: 'done', warnings, recordId, deleted: true };
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
    //
    // On a write-through store (the server's) the hook's writes land as they
    // happen, inside a savepoint; a failing hook rolls back to it, so what
    // stands is exactly what stands here — the record map's change and the
    // entry. Its queued calls wait for the request's commit.
    let afterHookError: { message: string; reason: unknown } | null = null;
    if (activity.after_hook) {
      try {
        const result = await executeScriptAsync(
          activity.after_hook,
          buildEvalHost(store, config, { ...scriptContext, anchorRecord: await store.getRecord(targetRecordId) }, services),
          { mode: 'mutate' },
        );
        warnings.push(...result.warnings);
      } catch (err) {
        afterHookError = { message: err instanceof Error ? err.message : String(err), reason: err };
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
    const entryAttributes = capturedEntryAttributes(activity, captured, stringValues, waived);
    Object.assign(entryAttributes, serializeFields(hookWritten));
    if (runLog.length > 0) entryAttributes['system_log'] = [...runLog];

    await store.appendActivity(targetRecordId, {
      activityId: activity.id,
      activityName: activity.name,
      ...(user ? { author: user.id } : {}),
      capturedAttributes: entryAttributes,
      ...(gateWarnings.length > 0 ? { warnings: gateWarnings } : {}),
      ...(Object.keys(waived).length > 0 ? { waived: { ...waived } } : {}),
      timestamp: new Date().toISOString(),
    });

    if (afterHookError !== null) {
      throw new AfterHookFailedError(afterHookError.message, afterHookError.reason);
    }

    // After-hook warnings are informational (the commit already happened);
    // surfacing them is the host's job — the engine has no UI channel.
    return { status: 'done', warnings, recordId: targetRecordId };
  }

  return {
    store,
    activityAvailability,
    isActivityAvailable: (activity, anchorRecord) => activityAvailability(activity, anchorRecord).available,
    activityAvailabilityAsync,
    isActivityAvailableAsync: async (activity, anchorRecord) => (await activityAvailabilityAsync(activity, anchorRecord)).available,
    runActivity,
    runQuery,
    invoke: (activityId, params, anchorRecord) => invoke(activityId, params, anchorRecord),
    evaluate: (source, script) => evaluateExpression(source, buildEvalHost(store, config, { user, ...script }, services)),
    evaluateAsync: (source, script) => evaluateExpressionAsync(source, buildEvalHost(store, config, { user, ...script }, services)),
    validateConfig: () => validateConfig(config, services),
    reportConfigFindings: () => reportConfigFindings(config, services),
  };
}
