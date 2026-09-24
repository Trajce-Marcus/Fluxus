import { useState, useEffect, createElement, useCallback, useMemo } from 'react';
import type { ActivityDef, RecordInstance, RunActivityResult } from '@fluxus/engine';
import type { ComponentManifest } from './manifest';
import type { SlotConfig } from './pageDef';
import type { PageRuntime } from './runtime';
import { ActivityFormModal } from './ActivityFormModal';
import { fill, hasHoles, holes } from './interpolate';
import { availableActivities } from './availableActivities';
import { NO_TABS, type PageTabs } from './pageTabs';
import {
  packCallbackData,
  type AttributeSeed,
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
  /**
   * Bumped by the page whenever ANY component's activity run lands, so every
   * component's dynamic props re-evaluate — not only those of the one that
   * launched it. It was this component's own `useState` until 2026-09-18,
   * which is why "New node" never refreshed the table beside it.
   */
  refreshTick: number;
  /** The page's tab names and the scroll to one (pageTabs.ts). */
  tabs?: PageTabs;
  /** Tell the page a run landed. */
  onActivityRun: () => void;
}

interface PendingForm {
  activity: ActivityDef;
  anchorRecord: RecordInstance | null;
  /** The activity's owning record type — the form resolves reference labels
   *  against it. */
  recordTypeId: string;
  /** Records the control was about, filling one named attribute. */
  seed?: AttributeSeed;
  /**
   * The anchor record is still being fetched. The dialog opens on the click and
   * says so, rather than the click doing nothing visible until the round trip
   * lands (2026-09-21, the user's call: the indicator belongs in the dialog,
   * not on the button).
   */
  loading?: boolean;
}

export function ComponentContainer({ runtime, manifest, config, pageCtx, onContextChange, onError, refreshTick, onActivityRun, tabs = NO_TABS }: Props) {
  const [dynamicData, setDynamicData] = useState<Record<string, unknown>>({});
  // Typed-in text with `{{ }}` holes in it, filled. Kept apart from the static
  // config it came from so the author's own words are never overwritten.
  const [filledText, setFilledText] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [pendingForm, setPendingForm] = useState<PendingForm | null>(null);

  // Runs the pipeline server-side (the client refreshes the snapshot after).
  // A run that lands tells the page, which bumps the tick every component
  // reads — how an activity's outcome reaches the page's dynamic props.
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
    if (result.status === 'done') onActivityRun();
    return result;
  }, [runtime, onActivityRun]);

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
  const launchActivity = useCallback((activityId: string, record: unknown, seed?: AttributeSeed) => {
    const found = runtime.findActivity(activityId);
    if (!found) throw new Error(`Unknown activity '${activityId}'`);
    // A named attribute that the activity does not declare is an authoring
    // mistake, and a silent one would look like the ticks never happened —
    // the attribute mapping drops what it cannot match by design, so the
    // complaint has to be made here, before the run.
    if (seed && !found.activity.attributes.some((a) => a.key === seed.attribute)) {
      onError(new Error(`'${activityId}' has no attribute '${seed.attribute}'`), manifest.name);
      return;
    }
    // What the run is *about* — which is not the same as what it carries.
    //
    // A row action is about its row, so it names one. A bulk action names
    // none: the ticked rows are the data it carries, and what it is about is
    // the **page's own record** — the app record `resolvePageAnchor` resolved
    // at page open, which every GET the page fires is already logged against.
    // A page that fires activities has one of its own precisely so the entry
    // lands somewhere.
    //
    // A CREATE is the exception in the other direction: it is about the record
    // it is bringing into being, so the server refuses an anchor outright, and
    // the record a control was about reaches it as the seeded attribute
    // instead. That is what lets a row action open "add a child here".
    const named = record === null || record === undefined || record === '' ? null : String(record);
    const anchorId = found.activity.record_map === 'CREATE' ? null : named ?? pageCtx.record?.id ?? null;
    // The callback script has already returned by the time any of this
    // resolves, so failures surface through the host error channel rather than
    // as a throw nobody is left to catch.
    // Whether a dialog opens at all is known before the fetch — it depends on
    // the activity's attributes, not on the record — so an activity with a form
    // shows its dialog immediately and fills it when the anchor lands.
    const opensDialog = found.activity.attributes.length > 0;
    if (opensDialog) {
      setPendingForm({
        activity: found.activity,
        anchorRecord: null,
        recordTypeId: found.typeDef.id,
        seed,
        loading: anchorId !== null,
      });
    }
    void (async () => {
      try {
        // The anchor is fetched, not read out of the snapshot (2026-08-16): a
        // pages-only host holds no records, and the id the component emitted
        // came from a GET's answer rather than from anything local. The fetch
        // is also the authorisation check — a record the caller may not read
        // comes back as not-found.
        const anchorRecord = anchorId ? await runtime.client.fetchRecord(anchorId) : null;
        if (opensDialog) {
          setPendingForm({ activity: found.activity, anchorRecord, recordTypeId: found.typeDef.id, seed });
        } else {
          await runWithConfirm(found.activity, anchorRecord);
        }
      } catch (err: unknown) {
        // The dialog cannot stay open on a record that never arrived — the form
        // would read an anchor it does not have.
        if (opensDialog) setPendingForm(null);
        onError(err instanceof Error ? err : new Error(String(err)), manifest.name);
      }
    })();
  }, [runtime, runWithConfirm, onError, manifest.name, pageCtx.record?.id]);

  // services.page.open — the host decides what navigating means, so an absent
  // seam is an error the author should see, not a click that does nothing.
  const openPage = useCallback((page: string, record: unknown) => {
    if (!runtime.openPage) {
      onError(new Error(`This host cannot open pages — '${page}' was not opened`), manifest.name);
      return;
    }
    const recordId = record === null || record === undefined || record === '' ? null : String(record);
    runtime.openPage(page, recordId);
  }, [runtime, onError, manifest.name]);

  // Which activities apply to a record — asked by a component that draws them,
  // never by a script (pageHost, `listActivities`). The record is fetched the
  // same way a run's anchor is: the browser may hold no records at all, and the
  // fetch is also the authorisation check.
  const listActivities = useCallback(async (record: unknown) => {
    const id = record === null || record === undefined || record === '' ? null : String(record);
    const anchor = id === (pageCtx.record?.id ?? null) && pageCtx.record
      ? pageCtx.record
      : id ? await runtime.client.fetchRecord(id) : null;
    if (!anchor) return [];
    const found = runtime.findRecordType(anchor.typeRef);
    if (!found) return [];
    return availableActivities(
      found.workflow.activities,
      (source) => runtime.evaluateExpression(source, { ...pageCtx, record: anchor }),
    );
  }, [runtime, pageCtx]);

  // Handlers behind services.page (UI-local effects) and services.activities
  // (host-neutral activity runs) for this component instance.
  const serviceHandlers = useMemo<PageServiceHandlers>(() => ({
    setContext: onContextChange,
    hideComponent: () => setHidden(true),
    runActivity: launchActivity,
    openPage,
    listActivities,
    // A stored key → a presigned address, so a component can draw a photo
    // (COMPONENT_PHOTOS §2). Like `listActivities` it is on the handler set but
    // in no service module, so a component may call it and a script may not.
    resolveUrl: (storageKey: string) => runtime.client.uploads.resolveUrl(storageKey),
    // The host's history (PageHeader's back arrow). No history, no back — a
    // greyed arrow, not an error: unlike opening a page, going back is never
    // something the author asked for that the host then failed to do.
    goBack: () => runtime.goBack?.(),
    canGoBack: () => runtime.canGoBack?.() ?? false,
    tabs: tabs.names,
    selectTab: tabs.select,
  }), [onContextChange, launchActivity, openPage, listActivities, runtime, tabs]);

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
        // Typed-in text may carry `{{ expression }}` holes (2026-09-13), and
        // they are filled here, in the same pass as the dynamic props: the
        // braces are a delimiter, so what is inside one is an ordinary
        // expression read by the ordinary evaluator. **Any** static string may
        // have them — a table's title as much as a text box — which is why
        // this asks the config rather than the component what to fill.
        const texts = await Promise.all(
          Object.entries(config.staticConfig)
            .filter(([, value]) => hasHoles(value))
            .map(async ([propName, template]) => {
              const answers = await Promise.all(
                holes(template as string).map((hole) => runtime.evaluateExpression(hole.expression, pageCtx)),
              );
              return [propName, fill(template as string, answers)] as const;
            }),
        );
        if (cancelled) return;
        setDynamicData(Object.fromEntries(entries));
        setFilledText(Object.fromEntries(texts));
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
  const resolvedProps: Record<string, unknown> = { ...config.staticConfig, ...filledText };


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
      // Said to the console, not to the page (2026-09-12). An unwired callback
      // is an authoring gap, not a failure of the run: nothing was attempted
      // and nothing went wrong, so a red banner in front of an end user
      // reports someone else's unfinished work as if it were their problem.
      // The author hears it where it can be fixed — `validatePage` warns at
      // save — and here, where the click happens, in the console.
      resolvedProps[prop.name] = () => {
        console.warn(`[page] ${manifest.name}: '${prop.name}' is not wired on this page`);
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

  // The one prop the host supplies rather than the author (step 2): the same
  // four verbs already handed to callback scripts. It adds no capability — a
  // script could always call all four, and the server authorises every run
  // whatever the browser asked for — but it lets a component *be* an act
  // (RunActivity, OpenPage) instead of needing a script wired behind it.
  // Assigned last so nothing declared can shadow it.
  resolvedProps.services = serviceHandlers;

  return (
    <>
      {manifest.css && <style>{manifest.css}</style>}
      {createElement(manifest.component, resolvedProps)}
      {pendingForm && (
        <ActivityFormModal
          activity={pendingForm.activity}
          anchorRecord={pendingForm.anchorRecord}
          recordTypeId={pendingForm.recordTypeId}
          loading={pendingForm.loading}
          pageRecord={pageCtx.record ?? null}
          seed={pendingForm.seed}
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
