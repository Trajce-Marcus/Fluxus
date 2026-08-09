import { useState, useEffect, createElement, useCallback, useMemo } from 'react';
import type { ActivityDef, RecordInstance } from '@fluxus/engine';
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
}

export function ComponentContainer({ runtime, manifest, config, pageCtx, onContextChange, onError }: Props) {
  const [dynamicData, setDynamicData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [pendingForm, setPendingForm] = useState<PendingForm | null>(null);
  // Bumped after a run-activity completes so dynamic props re-evaluate — how
  // activity outcomes flow back to the app (locked ROADMAP behaviour).
  const [refreshTick, setRefreshTick] = useState(0);

  // Runs the pipeline server-side for an app-triggered activity (the client
  // refreshes the snapshot after); the platform (not the component) owns the
  // warn soft-stop confirmation.
  const runNow = useCallback(async (
    activity: ActivityDef,
    captured: Record<string, string>,
    anchorRecord: RecordInstance | null,
  ): Promise<boolean> => {
    const input = {
      activityId: activity.id,
      recordId: anchorRecord?.id,
      attributes: captured,
    };
    let result = await runtime.client.runActivity(input);
    if (result.status === 'needs-confirmation') {
      const ok = window.confirm(`${result.warnings.join('\n')}\n\nContinue anyway?`);
      if (!ok) return false;
      result = await runtime.client.runActivity({ ...input, acknowledgedWarnings: true });
    }
    setRefreshTick((t) => t + 1);
    return true;
  }, [runtime]);

  // services.activities.run — the callback contract is the anchor record
  // alone: UI activity (has attributes) → standard capture form; attribute-less
  // → straight to the hooks. Values reach the hooks only as declared
  // attributes (DATA_THROUGH_ACTIVITIES §4).
  const launchActivity = useCallback((activityId: string, record: unknown) => {
    const found = runtime.findActivity(activityId);
    if (!found) throw new Error(`Unknown activity '${activityId}'`);
    const anchorRecord = record === null || record === undefined || record === ''
      ? null
      : runtime.store.getRecord(String(record));
    if (found.activity.attributes.length > 0) {
      setPendingForm({ activity: found.activity, anchorRecord });
    } else {
      // Async now (server round trip): the callback script has already
      // returned, so failures surface through the host error channel.
      runNow(found.activity, {}, anchorRecord).catch((err: unknown) => {
        onError(err instanceof Error ? err : new Error(String(err)), manifest.name);
      });
    }
  }, [runtime, runNow, onError, manifest.name]);

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
    if (!source) continue;
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
          onSubmit={(captured) => runNow(pendingForm.activity, captured, pendingForm.anchorRecord)}
          onClose={() => setPendingForm(null)}
        />
      )}
    </>
  );
}
