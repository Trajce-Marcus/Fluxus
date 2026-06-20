import { useRef } from 'react';
import { shellStore } from './store';
import { useShellState } from './useShellState';

function ConsolePanelComponent() {
  const { consoleOpen, consoleHeight } = useShellState(['consoleOpen', 'consoleHeight']);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  function onDragStart(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startHeight: consoleHeight };

    function onMouseMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY;
      const next = Math.max(80, Math.min(600, dragRef.current.startHeight + delta));
      shellStore.set((prev) => ({ ...prev, consoleHeight: next }));
    }

    function onMouseUp() {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function toggleOpen() {
    shellStore.set((prev) => ({ ...prev, consoleOpen: !prev.consoleOpen }));
  }

  return (
    <div className="console-panel" style={{ height: consoleOpen ? consoleHeight : 28 }}>
      <div className="console-drag-handle" onMouseDown={onDragStart} />
      <div className="console-header">
        <span className="console-title">Console</span>
        <button className="console-toggle" title={consoleOpen ? 'Collapse' : 'Expand'} onClick={toggleOpen}>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
            style={{ transform: consoleOpen ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.15s' }}
          >
            <path d="M1 3l4 4 4-4H1z" />
          </svg>
        </button>
      </div>
      {consoleOpen && (
        <div className="console-body">
          <span className="console-prompt">{'>'}</span>
          <span className="console-cursor">_</span>
        </div>
      )}
    </div>
  );
}

export const css = `
  .console-panel {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--color-sidebar);
    border-top: 1px solid var(--color-border);
    overflow: hidden;
  }
  .console-drag-handle {
    height: 4px;
    cursor: ns-resize;
    flex-shrink: 0;
  }
  .console-drag-handle:hover {
    background: var(--color-accent);
  }
  .console-header {
    display: flex;
    align-items: center;
    padding: 0 10px;
    height: 24px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-border);
  }
  .console-title {
    flex: 1;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
  }
  .console-toggle {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 2px;
    padding: 0;
  }
  .console-toggle:hover {
    background: rgba(255,255,255,0.08);
    color: var(--color-text);
  }
  .console-body {
    flex: 1;
    padding: 8px 12px;
    font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
    font-size: 0.8rem;
    color: var(--color-text);
    overflow-y: auto;
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }
  .console-prompt {
    color: var(--color-accent);
  }
  .console-cursor {
    animation: blink 1s step-end infinite;
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
`;

export const ConsolePanel = ConsolePanelComponent;
