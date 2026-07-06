import { useState, useEffect, useCallback } from 'react';
import { loadPageLayout } from './persistence';
import type { Panel } from './layout-editor/types';
import type { SlotConfig, ContextKeyDef } from './persistence';
import { componentManifests } from './componentManifests';
import { ComponentContainer } from './ComponentContainer';

// ── Platform context ─────────────────────────────────────────────────────────

const PLATFORM_CONTEXT: Record<string, unknown> = {
  currentUser: 'Demo User',
  appName: 'Fluxus',
};

// ── Panel layout rendering ───────────────────────────────────────────────────

function panelStyle(panel: Panel): React.CSSProperties {
  const style: React.CSSProperties = {
    overflow: 'hidden',
    display: 'flex',
    flexDirection: panel.direction === 'vertical' ? 'column' : 'row',
  };
  if (panel.size.type === 'flex') style.flex = panel.size.value;
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
  panel: Panel;
  slotConfigs: Record<string, SlotConfig | null>;
  contextSchema: ContextKeyDef[];
  context: Record<string, unknown>;
  onContextChange: (key: string, value: unknown) => void;
  onError: (error: Error, componentName: string) => void;
}

function PanelNode({ panel, slotConfigs, contextSchema, context, onContextChange, onError }: PanelNodeProps) {
  if (panel.children.length > 0) {
    return (
      <div style={panelStyle(panel)}>
        {panel.children.map((child) => (
          <PanelNode
            key={child.id}
            panel={child}
            slotConfigs={slotConfigs}
            contextSchema={contextSchema}
            context={context}
            onContextChange={onContextChange}
            onError={onError}
          />
        ))}
      </div>
    );
  }

  const config = slotConfigs[panel.id] ?? null;
  const manifest = config ? componentManifests[config.componentName] : null;

  return (
    <div style={{ ...panelStyle(panel), position: 'relative' }}>
      {manifest && config ? (
        <ComponentContainer
          manifest={manifest}
          config={config}
          context={context}
          contextSchema={contextSchema}
          onContextChange={onContextChange}
          onError={onError}
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
  pagePath: string;
  slotConfigs: Record<string, SlotConfig | null>;
  contextSchema: ContextKeyDef[];
}

export function PageRenderer({ pagePath, slotConfigs, contextSchema }: Props) {
  const [context, setContext] = useState<Record<string, unknown>>({ ...PLATFORM_CONTEXT });
  const [errors, setErrors] = useState<{ componentName: string; message: string }[]>([]);

  const layout = loadPageLayout(pagePath);

  useEffect(() => {
    const pageDefaults: Record<string, unknown> = {};
    for (const def of contextSchema) {
      if (def.source === 'page') pageDefaults[def.key] = def.defaultValue ?? null;
    }
    setContext({ ...pageDefaults, ...PLATFORM_CONTEXT });
  }, [pagePath, contextSchema]);

  const handleContextChange = useCallback((key: string, value: unknown) => {
    setContext((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleError = useCallback((error: Error, componentName: string) => {
    setErrors((prev) => [...prev, { componentName, message: error.message }]);
  }, []);

  if (!layout) {
    return <div className="pr-empty">No layout defined for this page.</div>;
  }

  return (
    <div className="pr-root">
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <PanelNode
          panel={layout.root}
          slotConfigs={slotConfigs}
          contextSchema={contextSchema}
          context={context}
          onContextChange={handleContextChange}
          onError={handleError}
        />
      </div>

      {errors.length > 0 && (
        <div className="pr-errors">
          {errors.map((e, i) => (
            <div key={i} className="pr-error-item">
              <strong>{e.componentName}:</strong> {e.message}
              <button onClick={() => setErrors((prev) => prev.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}

      {(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && (
        <details className="pr-debug">
          <summary>Context ({Object.keys(context).length} keys)</summary>
          <pre>{JSON.stringify(context, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export const css = `
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
