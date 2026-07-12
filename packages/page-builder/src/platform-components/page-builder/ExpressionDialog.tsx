// The MVP binding editor (PAGE_WIRING_DESIGN decision 6): a modal Monaco
// editor for one FluxScript expression (dynamic prop) or script (callback),
// validated live against the SDM schema + declared roots. Save is blocked on
// errors — the dialog is the first line of the save-time validation posture.

import { useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { Diagnostic } from '@fluxus/dsl';
import { FLUXSCRIPT, registerFluxscript, monacoCss } from './fluxscriptLanguage';
import { validatePageExpression, validatePageCallback } from './pageHost';

export interface ExpressionDialogProps {
  title: string;
  /** Rendered under the title — the binding's contract, e.g. the callback payload. */
  hint?: string;
  kind: 'expression' | 'callback';
  initialSource: string;
  onSave: (source: string) => void;
  onClose: () => void;
}

export function ExpressionDialog({ title, hint, kind, initialSource, onSave, onClose }: ExpressionDialogProps) {
  const [source, setSource] = useState(initialSource);

  const diagnostics = useMemo<Diagnostic[]>(() => {
    if (source.trim() === '') return [];
    return kind === 'expression' ? validatePageExpression(source) : validatePageCallback(source);
  }, [source, kind]);

  const errors = diagnostics.filter((d) => d.severity === 'error');

  return (
    <div className="xd-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="xd-dialog">
        <div className="xd-header">
          <span className="xd-title">{title}</span>
          <button className="xd-close" onClick={onClose}>✕</button>
        </div>
        {hint && <p className="xd-hint">{hint}</p>}
        <div className="xd-editor">
          <Editor
            height={kind === 'expression' ? '80px' : '180px'}
            language={FLUXSCRIPT}
            theme="vs-dark"
            value={source}
            beforeMount={registerFluxscript}
            onChange={(v) => setSource(v ?? '')}
            options={{
              minimap: { enabled: false },
              lineNumbers: kind === 'expression' ? 'off' : 'on',
              folding: false,
              scrollBeyondLastLine: false,
              fontSize: 13,
              wordWrap: 'on',
              renderLineHighlight: 'none',
              overviewRulerLanes: 0,
            }}
          />
        </div>
        <div className="xd-diagnostics">
          {diagnostics.map((d, i) => (
            <div key={i} className={`xd-diag xd-diag--${d.severity}`}>
              {d.severity} [{d.line}:{d.col}] {d.message}
            </div>
          ))}
        </div>
        <div className="xd-footer">
          <span className="xd-clear-hint">{source.trim() === '' ? 'Saving empty clears the binding' : ''}</span>
          <button className="xd-btn xd-btn--ghost" onClick={onClose}>Cancel</button>
          <button
            className="xd-btn"
            disabled={errors.length > 0}
            onClick={() => onSave(source.trim())}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export const css = `
  ${monacoCss}

  .xd-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .xd-dialog { width: 640px; max-width: 92vw; background: var(--color-sidebar, #252526); border: 1px solid var(--color-border, #3c3c3c); border-radius: 6px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); display: flex; flex-direction: column; }
  .xd-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 6px; }
  .xd-title { font-size: 0.85rem; font-weight: 600; color: var(--color-text, #ccc); }
  .xd-close { background: none; border: none; color: var(--color-text-muted, #888); cursor: pointer; font-size: 0.8rem; }
  .xd-close:hover { color: var(--color-text, #ccc); }
  .xd-hint { margin: 0 14px 8px; font-size: 0.72rem; color: var(--color-text-muted, #888); }
  .xd-editor { margin: 0 14px; border: 1px solid var(--color-border, #3c3c3c); border-radius: 4px; overflow: hidden; }
  .xd-diagnostics { margin: 6px 14px 0; min-height: 18px; max-height: 90px; overflow-y: auto; }
  .xd-diag { font-size: 0.72rem; font-family: monospace; padding: 1px 0; }
  .xd-diag--error { color: #f48771; }
  .xd-diag--warning { color: #dcdcaa; }
  .xd-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 10px 14px; }
  .xd-clear-hint { flex: 1; font-size: 0.7rem; color: var(--color-text-muted, #888); font-style: italic; }
  .xd-btn { background: var(--color-accent, #0e639c); border: none; border-radius: 3px; color: #fff; cursor: pointer; font-size: 0.78rem; padding: 4px 14px; }
  .xd-btn:disabled { opacity: 0.4; cursor: default; }
  .xd-btn--ghost { background: none; border: 1px solid var(--color-border, #3c3c3c); color: var(--color-text-muted, #aaa); }
`;
