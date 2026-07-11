import { useState, useEffect, createElement, useCallback } from 'react';
import type { ActivityDef, RecordInstance } from '@fluxus/engine';
import type { ComponentManifest } from './manifest';
import type { SlotConfig, CallbackAction, ContextKeyDef } from './persistence';
import { mockRegistry } from './mockFunctions';
import { sdmEngine, sdmStore, findActivity } from '../../sdm-runtime/engine';
import { ActivityFormModal } from '../../sdm-runtime/ActivityFormModal';

interface Props {
  manifest: ComponentManifest;
  config: SlotConfig;
  context: Record<string, unknown>;
  contextSchema: ContextKeyDef[];
  onContextChange: (key: string, value: unknown) => void;
  onError: (error: Error, componentName: string) => void;
}

interface PendingForm {
  activity: ActivityDef;
  anchorRecord: RecordInstance | null;
  callbackData: unknown;
}

export function ComponentContainer({ manifest, config, context, onContextChange, onError }: Props) {
  const [dynamicData, setDynamicData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [pendingForm, setPendingForm] = useState<PendingForm | null>(null);
  // Bumped after a run-activity completes so dynamic props re-fetch — how
  // activity outcomes flow back to the app (locked ROADMAP behaviour).
  const [refreshTick, setRefreshTick] = useState(0);

  // Runs the engine pipeline for an app-triggered activity; the platform
  // (not the component) owns the warn soft-stop confirmation.
  const runNow = useCallback((
    activity: ActivityDef,
    captured: Record<string, unknown>,
    anchorRecord: RecordInstance | null,
    callbackData: unknown,
  ): boolean => {
    let result = sdmEngine.runActivity(activity, captured, anchorRecord, { callbackData });
    if (result.status === 'needs-confirmation') {
      const ok = window.confirm(`${result.warnings.join('\n')}\n\nContinue anyway?`);
      if (!ok) return false;
      result = sdmEngine.runActivity(activity, captured, anchorRecord, { callbackData, acknowledgedWarnings: true });
    }
    setRefreshTick((t) => t + 1);
    return true;
  }, []);

  // The run-activity callback contract: (record, data object). UI activity →
  // standard capture form; non-UI → straight to the hooks.
  const launchActivity = useCallback((activityId: string, record: unknown, data: unknown) => {
    try {
      const found = findActivity(activityId);
      if (!found) throw new Error(`Unknown activity '${activityId}'`);
      const anchorRecord = record === null || record === undefined || record === ''
        ? null
        : sdmStore.getRecord(String(record));
      if (found.activity.attributes.length > 0) {
        setPendingForm({ activity: found.activity, anchorRecord, callbackData: data ?? null });
      } else {
        runNow(found.activity, {}, anchorRecord, data ?? null);
      }
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)), manifest.name);
    }
  }, [runNow, onError, manifest.name]);

  // Re-fetch whenever context keys that feed dynamic props change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function fetchAll() {
      const result: Record<string, unknown> = {};
      try {
        const entries = Object.entries(config.dynamicProps);
        await Promise.all(
          entries.map(async ([propName, dynConfig]) => {
            if (dynConfig.source === 'context') {
              result[propName] = context[dynConfig.contextKey];
            } else {
              const fn = mockRegistry[dynConfig.procedureName];
              if (!fn) return;
              const resolvedArgs: Record<string, unknown> = {};
              for (const [argName, src] of Object.entries(dynConfig.args)) {
                resolvedArgs[argName] = context[src.contextKey];
              }
              result[propName] = await fn(resolvedArgs);
            }
          })
        );
        if (!cancelled) setDynamicData(result);
      } catch (err) {
        if (!cancelled) onError(err instanceof Error ? err : new Error(String(err)), manifest.name);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  // Re-run when any context value that a dynamic prop depends on changes,
  // or after a run-activity completes (refreshTick).
  // We build a stable dependency string from the relevant context values.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(buildContextSlice(config, context)), config, refreshTick]);

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

  // Wire callbacks
  for (const prop of manifest.schema) {
    if (prop.kind !== 'callback') continue;
    const action = config.callbackActions[prop.name];
    if (!action) continue;
    resolvedProps[prop.name] = buildCallbackHandler(action, onContextChange, setHidden, launchActivity);
  }

  return (
    <>
      {manifest.css && <style>{manifest.css}</style>}
      {createElement(manifest.component, resolvedProps)}
      {pendingForm && (
        <ActivityFormModal
          activity={pendingForm.activity}
          anchorRecord={pendingForm.anchorRecord}
          onSubmit={(captured) => runNow(pendingForm.activity, captured, pendingForm.anchorRecord, pendingForm.callbackData)}
          onClose={() => setPendingForm(null)}
        />
      )}
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildContextSlice(config: SlotConfig, context: Record<string, unknown>): Record<string, unknown> {
  const slice: Record<string, unknown> = {};
  for (const dynConfig of Object.values(config.dynamicProps)) {
    if (dynConfig.source === 'context') {
      slice[dynConfig.contextKey] = context[dynConfig.contextKey];
    } else {
      for (const src of Object.values(dynConfig.args)) {
        slice[src.contextKey] = context[src.contextKey];
      }
    }
  }
  return slice;
}

function buildCallbackHandler(
  action: CallbackAction,
  onContextChange: (key: string, value: unknown) => void,
  setHidden: (hidden: boolean) => void,
  launchActivity: (activityId: string, record: unknown, data: unknown) => void,
): (value: unknown, data?: unknown) => void {
  switch (action.type) {
    case 'set-context':
      return (value) => onContextChange(action.key, value);
    case 'hide-component':
      return () => setHidden(true);
    case 'show-overlay':
      return () => onContextChange(`__overlay_${action.overlayId}`, true);
    case 'run-activity':
      // Callback contract (Extraction stage 2): (record, data object).
      return (record, data) => launchActivity(action.activityId, record, data);
  }
}
