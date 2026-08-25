import { useState, useEffect, createElement, useCallback, useMemo } from 'react';
import type { ActivityDef, RecordInstance, RunActivityResult } from '@fluxus/engine';
import type { ComponentManifest } from './manifest';
import type { SlotConfig } from './pageDef';
import type { PageRuntime } from './runtime';
import { ActivityFormModal } from './ActivityFormModal';
import {
  packCallbackData,
  type PageContext,
  type PageServiceHandlers,
} from './pageHost';

interface Props {
  runtime: PageRuntime;
  manifest: ComponentManifest;
  config: SlotConfig;
  pageCtx: PageContext;
  onContextChange: (key: string, value: unknown) => void;
  onError: (error: Error, componentName: string) => void;
}

interface PendingForm {
  activity: ActivityDef;
  anchorRecord: RecordInstance | null;
  /** The activity's owning record type — the form resolves reference labels
   *  against it. */
  recordTypeId: string;
}

export function ComponentContainer({ runtime, manifest, config, pageCtx, onContextChange, onError }: Props) {
  const [dynamicData, setDynamicData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [pendingForm, setPendingForm] = useState<PendingForm | null>(null);
  // Bumped after a run-activity completes so dynamic props re-evaluate — how
  // activity outcomes flow back to the app (locked ROADMAP behaviour).
  const [refreshTick, setRefreshTick] = useState(0);

  // Runs the pipeline server-side (the client refreshes the snapshot after).
  // A run that lands bumps the refresh tick, which is how an activity's
  // outcome reaches the page's dynamic props.
  const runOnce = useCallback(async (
    activity: ActivityDef,
    captured: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
    options?: { acknowledgedWarnings?: boolean; waived?: Record<string, string> },
  ): Promise<RunActivityResult> => {
    const result = await runtime.client.runActivity({
      activityId: activity.id,
      recordId: anchorRecord?.id,
      attributes: captured,
      waived: options?.waived,
      acknowledgedWarnings: options?.acknowledgedWarnings,
    });
    if (result.status === 'done') setRefreshTick((t) => t + 1);
    return result;
  }, [runtime]);

  // An attribute-less activity has no form to carry the soft stop, so the
  // platform (not the component) asks here. A form activity's warnings go to
  // the form's own Continue/Cancel instead.
  const runWithConfirm = useCallback(async (
    activity: ActivityDef,
    anchorRecord: RecordInstance | null,
  ): Promise<void> => {
    const result = await runOnce(activity, {}, anchorRecord);
    if (result.status !== 'needs-confirmation') return;
    if (!window.confirm(`${result.warnings.join('\n')}\n\nContinue anyway?`)) return;
    await runOnce(activity, {}, anchorRecord, { acknowledgedWarnings: true });
  }, [runOnce]);

  // services.activities.run — the callback contract is the anchor record
  // alone: UI activity (has attributes) → standard capture form; attribute-less
  // → straight to the hooks. Values reach the hooks only as declared
  // attributes (DATA_THROUGH_ACTIVITIES §4).
  const launchActivity = useCallback((activityId: string, record: unknown) => {
    const found = runtime.findActivity(activityId);
    if (!found) throw new Error(`Unknown activity '${activityId}'`);
    const anchorId = record === null || record === undefined || record === '' ? null : String(record);
    // The callback script has already returned by the time any of this
    // resolves, so failures surface through the host error channel rather than
    // as a throw nobody is left to catch.
    void (async () => {
      try {
        // The anchor is fetched, not read out of the snapshot (2026-08-16): a
        // pages-only host holds no records, and the id the component emitted
        // came from a GET's answer rather than from anything local. The fetch
        // is also the authorisation check — a record the caller may not read
        // comes back as not-found.
        const anchorRecord = anchorId ? await runtime.client.fetchRecord(anchorId) : null;
        if (found.activity.attributes.length > 0) {
          setPendingForm({ activity: found.activity, anchorRecord, recordTypeId: found.typeDef.id });
        } else {
          await runWithConfirm(found.activity, anchorRecord);
        }
      } catch (err: unknown) {
        onError(err instanceof Error ? err : new Error(String(err)), manifest.name);
      }
    })();
  }, [runtime, runWithConfirm, onError, manifest.name]);

  // Handlers behind services.page (UI-local effects) and services.activities
  // (host-neutral activity runs) for this component instance.
  const serviceHandlers = useMemo<PageServiceHandlers>(() => ({
    setContext: onContextChange,
    hideComponent: () => setHidden(true),
    runActivity: launchActivity,
  }), [onContextChange, launchActivity]);

  // Re-evaluate dynamic-prop expressions whenever the page context changes or
  // an activity run completes. Expressions are opaque (ruled: ctx.page.* is
  // permissive), so the trigger is the whole page layer, not a declared slice.
  //
  // Async since a prop may name a GET activity (DATA_THROUGH_ACTIVITIES step
  // 2): the props of one component are evaluated together so two GET-backed
  // props cost one wait, not two, and a re-run that overtakes an in-flight one
  // discards the stale answer rather than painting it.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const entries = await Promise.all(
          Object.entries(config.dynamicProps).map(
            async ([propName, source]) => [propName, await runtime.evaluateExpression(source, pageCtx)] as const,
          ),
        );
        if (cancelled) return;
        setDynamicData(Object.fromEntries(entries));
      } catch (err) {
        if (cancelled) return;
        onError(err instanceof Error ? err : new Error(String(err)), manifest.name);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(pageCtx.page), config, refreshTick]);

  if (hidden) return null;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: '#999', fontSize: '0.75rem' }}>
        Loading…
      </div>
    );
  }

  // Build the full props object to pass to the component
  const resolvedProps: Record<string, unknown> = { ...config.staticConfig };

  // Merge dynamic data
  for (const [propName, value] of Object.entries(dynamicData)) {
    resolvedProps[propName] = value;
  }

  // Wire callbacks: each named callback binds to a FluxScript script that
  // receives the emitted payload as the `callbackData` root.
  for (const prop of manifest.schema) {
    if (prop.kind !== 'callback') continue;
    const source = config.callbacks[prop.name];
    // Every declared callback gets a function, wired or not (ruled
    // 2026-08-26). A control that disappears because nobody wired it is
    // indistinguishable from one hidden by access control or a show
    // condition — and only those two are answers to "may I do this?".
    // Whether a control is visible is the model's business; whether it is
    // wired is the author's, and an unwired one is a gap that should say so
    // when used rather than hide.
    if (!source) {
      resolvedProps[prop.name] = () => {
        onError(new Error(`'${prop.name}' is not wired on this page`), manifest.name);
      };
      continue;
    }
    resolvedProps[prop.name] = (value: unknown) => {
      try {
        runtime.runCallback(source, packCallbackData(value), pageCtx, serviceHandlers);
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)), manifest.name);
      }
    };
  }

  return (
    <>
      {manifest.css && <style>{manifest.css}</style>}
      {createElement(manifest.component, resolvedProps)}
      {pendingForm && (
        <ActivityFormModal
          activity={pendingForm.activity}
          anchorRecord={pendingForm.anchorRecord}
          recordTypeId={pendingForm.recordTypeId}
          host={runtime.captureHost}
          onSubmit={async (captured, options) => {
            const result = await runOnce(pendingForm.activity, captured, pendingForm.anchorRecord, options);
            if (result.status === 'done') setPendingForm(null);
            return result;
          }}
          onClose={() => setPendingForm(null)}
        />
      )}
    </>
  );
}
