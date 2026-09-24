import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { RecordInstance } from '@fluxus/engine';
import type { Panel } from './layout';
import type { SlotConfig, ContextKeyDef } from './pageDef';
import type { PageRuntime } from './runtime';
import { componentManifests } from './componentManifests';
import { ComponentContainer } from './ComponentContainer';
import type { PageContext } from './pageHost';
import { resolvePageAnchor } from './pageAnchor';
import { collectTabNames, scrollToTab, watchTabs, type PageTabs } from './pageTabs';

// ── The ctx root ──────────────────────────────────────────────────────────────
// Page context IS the DSL's `context` root (PAGE_WIRING_DESIGN decision 1):
// the platform supplies built-ins (context.user comes from the engine bridge;
// context.app here; route params arrive with app-level navigation), and
// page-local UI state lives under context.page — seeded from the page's
// declared keys, written via services.page.setContext.

const APP_CONTEXT = { name: 'Fluxus' };

// ── Panel layout rendering ───────────────────────────────────────────────────

// `panel.overflow` decides, and the default depends on what the panel holds
// (2026-08-20). A panel holding other panels **clips** — that is what keeps a
// split layout from growing when one side is full. A panel holding a component
// **scrolls**: clipping a leaf makes whatever does not fit unreachable, with no
// scrollbar to say so — a work order list wider than its slot simply lost its
// action buttons off the right-hand edge. Same rule the workbench's panel-body
// follows. The property was in LAYOUT_EDITOR_SPEC from the start and had never
// been read; `'scroll'` renders as `auto`, so scrollbars appear when there is
// something to scroll and not before.
// Exported for its test: the size/overflow rules are the layout, and they are
// checkable without a DOM.
export function panelStyle(panel: Panel): React.CSSProperties {
  const style: React.CSSProperties = {
    overflow: panel.overflow ? (panel.overflow === 'scroll' ? 'auto' : 'hidden') : (panel.children.length > 0 ? 'hidden' : 'auto'),
    display: 'flex',
    flexDirection: panel.direction === 'vertical' ? 'column' : 'row',
  };
  if (panel.size.type === 'flex') style.flex = panel.size.value;
  // `auto` is content-sized: never grow, never shrink, be as tall as what is
  // inside. The one size that can make a column longer than its container,
  // which is what gives a page a scrollbar of its own (layout.ts).
  else if (panel.size.type === 'auto') style.flex = '0 0 auto';
  else style.flexBasis = panel.size.value;
  if (panel.background) style.background = panel.background;
  if (panel.gap) style.gap = panel.gap;
  if (panel.padding) {
    const { top, right, bottom, left } = panel.padding;
    style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
  if (panel.borderRadius) style.borderRadius = panel.borderRadius;
  return style;
}

interface PanelNodeProps {
  runtime: PageRuntime;
  panel: Panel;
  slotConfigs: Record<string, SlotConfig | null>;
  pageCtx: PageContext;
  onContextChange: (key: string, value: unknown) => void;
  onError: (error: Error, componentName: string) => void;
  /** Bumped when any component's activity run lands — see PageRenderer. */
  refreshTick: number;
  onActivityRun: () => void;
  tabs: PageTabs;
}

function PanelNode({ runtime, panel, slotConfigs, pageCtx, onContextChange, onError, refreshTick, onActivityRun, tabs }: PanelNodeProps) {
  if (panel.children.length > 0) {
    return (
      <div style={panelStyle(panel)}>
        {panel.children.map((child) => (
          <PanelNode
            key={child.id}
            runtime={runtime}
            panel={child}
            slotConfigs={slotConfigs}
            pageCtx={pageCtx}
            onContextChange={onContextChange}
            onError={onError}
            refreshTick={refreshTick}
            onActivityRun={onActivityRun}
            tabs={tabs}
          />
        ))}
      </div>
    );
  }

  const config = slotConfigs[panel.id] ?? null;
  const manifest = config ? componentManifests[config.componentName] : null;
  // A named slot says so on its element — what a tab click scrolls to.
  const tabName = config?.tabName?.trim() || undefined;

  return (
    <div style={{ ...panelStyle(panel), position: 'relative' }} data-tab-name={tabName}>
      {manifest && config ? (
        <ComponentContainer
          runtime={runtime}
          manifest={manifest}
          config={config}
          pageCtx={pageCtx}
          onContextChange={onContextChange}
          onError={onError}
          refreshTick={refreshTick}
          onActivityRun={onActivityRun}
          tabs={tabs}
        />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: '0.75rem', fontStyle: 'italic' }}>
          Empty slot
        </div>
      )}
    </div>
  );
}

// ── PageRunner ────────────────────────────────────────────────────────────────

interface Props {
  runtime: PageRuntime;
  pagePath: string;
  slotConfigs: Record<string, SlotConfig | null>;
  contextSchema: ContextKeyDef[];
  /**
   * The record this page is about, when the page declares `many` instances —
   * the host reads it off the URL. A `one`-instance page finds or creates its
   * own and ignores this; a pure view has none.
   */
  recordId?: string;
  /** Show the collapsible context.page debug strip (the editor preview turns this on). */
  debug?: boolean;
}

export function PageRenderer({ runtime, pagePath, slotConfigs, contextSchema, recordId, debug }: Props) {
  const [pageState, setPageState] = useState<Record<string, unknown>>({});
  // Which page, about which record. The anchor and the errors are each held
  // against the key they belong to (2026-09-23): the renderer is not remounted
  // when one page opens another, so for one frame the new page's slots were
  // drawn against the *old* page's record — every `context.record.<field>` of
  // a shift report evaluated against a project — and the errors that produced,
  // like any the old page raised, stayed on the list after the page changed.
  const pageKey = `${pagePath}\u0000${recordId ?? ''}`;
  const [errors, setErrors] = useState<{ pageKey: string; componentName: string; message: string }[]>([]);
  // The page's own record, resolved before the first frame: a run's history
  // entry has to land somewhere, so a page that acts must know what it is
  // about before anything on it can act (CLIENT_TRUST_BOUNDARY §7).
  const [resolved, setAnchor] = useState<{ pageKey: string; anchor: { status: 'ready'; record: RecordInstance | null } | { status: 'failed'; message: string } } | null>(null);
  const anchor = resolved && resolved.pageKey === pageKey ? resolved.anchor : { status: 'resolving' as const };
  const pageErrors = errors.filter((e) => e.pageKey === pageKey);

  const def = runtime.getPage(pagePath);
  const layout = def?.layout ?? null;
  const declaredRecord = def?.record;

  // The page's tabs: its slots' `tabName`s, and a click scrolling to one
  // inside this page's own element (pageTabs.ts).
  const rootRef = useRef<HTMLDivElement>(null);
  const tabNames = useMemo(() => collectTabNames(layout?.root, slotConfigs), [layout, slotConfigs]);
  // While a click's scroll runs it passes other sections, and the one after
  // the target may come into view at the bottom — so sections coming into view
  // are ignored until it settles, and the clicked tab stays the one lit.
  const clickScrollUntil = useRef(0);
  const tabs = useMemo<PageTabs>(
    () => ({
      names: tabNames,
      select: (name) => {
        clickScrollUntil.current = Date.now() + 1000;
        scrollToTab(rootRef.current, name);
      },
      watch: (onEnter) => watchTabs(rootRef.current, (name) => {
        if (Date.now() >= clickScrollUntil.current) onEnter(name);
      }),
    }),
    [tabNames],
  );

  useEffect(() => {
    const pageDefaults: Record<string, unknown> = {};
    for (const def of contextSchema) {
      pageDefaults[def.key] = def.defaultValue ?? null;
    }
    setPageState(pageDefaults);
  }, [pagePath, contextSchema]);

  useEffect(() => {
    let cancelled = false;
    setAnchor(null);
    setErrors((prev) => prev.filter((e) => e.pageKey === pageKey));
    void (async () => {
      try {
        const record = await resolvePageAnchor(runtime, { record: declaredRecord }, recordId);
        if (!cancelled) setAnchor({ pageKey, anchor: { status: 'ready', record } });
      } catch (err) {
        if (!cancelled) setAnchor({ pageKey, anchor: { status: 'failed', message: err instanceof Error ? err.message : String(err) } });
      }
    })();
    return () => { cancelled = true; };
  }, [runtime, pageKey, recordId, declaredRecord?.type, declaredRecord?.instances]);

  const anchorRecord = anchor.status === 'ready' ? anchor.record : null;
  const pageCtx = useMemo<PageContext>(
    () => ({ app: APP_CONTEXT, page: pageState, record: anchorRecord }),
    [pageState, anchorRecord],
  );

  const handleContextChange = useCallback((key: string, value: unknown) => {
    setPageState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleError = useCallback((error: Error, componentName: string) => {
    setErrors((prev) => [...prev, { pageKey, componentName, message: error.message }]);
  }, [pageKey]);

  // An activity run refreshes the WHOLE page, not the component that launched
  // it (2026-09-18). The tick lived in `ComponentContainer`, so a run only
  // re-evaluated the props of the component it started from: pressing "New
  // node" — a button in its own slot — left the WBS table next to it showing
  // the list as it was before the node existed, until the page was reloaded.
  // Nothing scopes an activity's effects to one slot: a CREATE lands in
  // records any component's GET may be reading, so the page is the honest
  // blast radius. Every component's dynamic props re-evaluate, which for a
  // GET-backed prop is one round trip each.
  //
  // The page's own record is re-read first (2026-09-23): the tick re-evaluated
  // every prop, but against the record as it was when the page opened, so a
  // photo added by Modify — or any field it changed — showed only after a
  // reload. The fresh record and the tick land in one render, so each prop
  // re-evaluates once, against the new record. If the re-read fails (the run
  // removed the record, say) the page keeps what it had and still refreshes.
  const [refreshTick, setRefreshTick] = useState(0);
  const handleActivityRun = useCallback(() => {
    const current = resolved && resolved.pageKey === pageKey && resolved.anchor.status === 'ready' ? resolved.anchor.record : null;
    if (!current) {
      setRefreshTick((t) => t + 1);
      return;
    }
    void (async () => {
      try {
        const record = await runtime.client.fetchRecord(current.id);
        setAnchor((prev) => (prev && prev.pageKey === pageKey ? { pageKey, anchor: { status: 'ready', record } } : prev));
      } catch {
        // keep the record the page has
      }
      setRefreshTick((t) => t + 1);
    })();
  }, [runtime, pageKey, resolved]);

  if (!layout) {
    return <div className="pr-empty">No layout defined for this page.</div>;
  }

  // Nothing renders until the page knows its record: a component that read
  // before the anchor arrived would fire an untraceable GET and then have to
  // re-fire it, which is worse than one wait.
  if (anchor.status === 'resolving') {
    return <div className="pr-empty">Opening…</div>;
  }
  if (anchor.status === 'failed') {
    return <div className="pr-empty pr-anchor-failed">{anchor.message}</div>;
  }

  return (
    <div className="pr-root" ref={rootRef}>
      {/*
        `display: flex` is load-bearing, not decoration. The root panel asks for
        `flex: 1`, and flex is only meaningful inside a flex container — in a
        plain block this div was, the root panel fell back to `height: auto` and
        sized itself to its content. Every panel below it then had an indefinite
        height to resolve against, so `flex: 1` bottomed out at content height
        too, and the overflow landed here, where it was clipped with no
        scrollbar to say so. That is why no page could scroll however its panels
        were declared (found 2026-09-14, after `auto` alone did not fix it).
        `minHeight: 0` lets this shrink below its content, which is what gives
        the panel that declares `overflow: 'scroll'` something to scroll.
      */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <PanelNode
          runtime={runtime}
          panel={layout.root}
          slotConfigs={slotConfigs}
          pageCtx={pageCtx}
          onContextChange={handleContextChange}
          onError={handleError}
          refreshTick={refreshTick}
          onActivityRun={handleActivityRun}
          tabs={tabs}
        />
      </div>

      {pageErrors.length > 0 && (
        <div className="pr-errors">
          {pageErrors.map((e, i) => (
            <div key={i} className="pr-error-item">
              <strong>{e.componentName}:</strong> {e.message}
              <button onClick={() => setErrors((prev) => prev.filter((x) => x !== e))}>✕</button>
            </div>
          ))}
        </div>
      )}

      {debug && (
        <details className="pr-debug">
          <summary>context.page ({Object.keys(pageState).length} keys)</summary>
          <pre>{JSON.stringify(pageState, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export const css = `
  /* The activity dialog's wait, while the anchor record is fetched. It lives
     here rather than in ActivityFormModal because this is the css string every
     host already includes, and the dialog renders inside this tree. */
  .afm-spinner {
    width: 14px;
    height: 14px;
    flex: none;
    border: 2px solid #cbd5e1;
    border-top-color: #64748b;
    border-radius: 50%;
    animation: afm-spin 0.7s linear infinite;
  }
  /* On a filled button, where the grey would disappear. */
  .afm-spinner--light { border-color: rgba(255,255,255,0.45); border-top-color: #fff; }
  @keyframes afm-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .afm-spinner { animation-duration: 2.4s; } }

  .pr-root {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .pr-errors {
    flex-shrink: 0;
    background: #fef2f2;
    border-top: 1px solid #fecaca;
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .pr-error-item {
    font-size: 0.75rem;
    color: #991b1b;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pr-error-item button {
    background: none;
    border: none;
    color: #991b1b;
    cursor: pointer;
    font-size: 0.65rem;
    padding: 0 2px;
    margin-left: auto;
  }
  .pr-debug {
    font-size: 0.7rem; font-family: monospace;
    border-top: 1px solid #e5e7eb; background: #f9fafb;
    padding: 4px 8px; color: #374151; max-height: 200px; overflow-y: auto;
    flex-shrink: 0;
  }
  .pr-debug summary { cursor: pointer; font-weight: 600; color: #6b7280; padding: 2px 0; }
  .pr-debug pre { margin: 4px 0 0; white-space: pre-wrap; word-break: break-all; }
  .pr-anchor-failed { color: #991b1b; font-style: normal; padding: 0 16px; text-align: center; }
  .pr-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    font-size: 0.8rem;
    color: #666;
    font-style: italic;
  }
`;
