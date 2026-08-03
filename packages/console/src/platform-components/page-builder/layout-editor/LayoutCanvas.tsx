import { useState, useRef, type CSSProperties } from 'react';
import type { Panel, LayoutDefinition } from './types';

interface CanvasProps {
  layout: LayoutDefinition;
  selectedPanelId: string;
  onSelectPanel: (id: string) => void;
  onRenamePanel: (id: string, name: string) => void;
  onNavigate: (dir: 'up' | 'down' | 'left' | 'right') => void;
}

function PanelView({
  panel,
  parentDirection,
  isRoot = false,
  selectedPanelId,
  onSelectPanel,
  onRenamePanel,
}: {
  panel: Panel;
  parentDirection: 'vertical' | 'horizontal';
  isRoot?: boolean;
  selectedPanelId: string;
  onSelectPanel: (id: string) => void;
  onRenamePanel: (id: string, name: string) => void;
}) {
  const isSelected = panel.id === selectedPanelId;
  const isLeaf = panel.children.length === 0;
  const parentIsVertical = parentDirection === 'vertical';
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const CANVAS_MARGIN = 2;
  const CANVAS_PADDING = 2;

  const sizeStyle: CSSProperties = isRoot
    ? { flex: 1, minWidth: 0, minHeight: 0 }
    : panel.size.type === 'flex'
    ? { flex: panel.size.value, minWidth: 0, minHeight: 0, margin: CANVAS_MARGIN }
    : parentIsVertical
    ? { height: `${panel.size.value}px`, flexShrink: 0, margin: CANVAS_MARGIN }
    : { width: `${panel.size.value}px`, flexShrink: 0, margin: CANVAS_MARGIN };

  const minMaxStyle: CSSProperties = {};
  if (!isRoot && panel.minSize !== undefined) {
    if (parentIsVertical) minMaxStyle.minHeight = `${panel.minSize}px`;
    else minMaxStyle.minWidth = `${panel.minSize}px`;
  }
  if (!isRoot && panel.maxSize !== undefined) {
    if (parentIsVertical) minMaxStyle.maxHeight = `${panel.maxSize}px`;
    else minMaxStyle.maxWidth = `${panel.maxSize}px`;
  }

  const borderStyle: CSSProperties = {};
  const b = panel.border;
  if (b?.top) borderStyle.borderTop = `${b.top.width}px ${b.top.style} ${b.top.color}`;
  if (b?.right) borderStyle.borderRight = `${b.right.width}px ${b.right.style} ${b.right.color}`;
  if (b?.bottom) borderStyle.borderBottom = `${b.bottom.width}px ${b.bottom.style} ${b.bottom.color}`;
  if (b?.left) borderStyle.borderLeft = `${b.left.width}px ${b.left.style} ${b.left.color}`;

  const style: CSSProperties = {
    display: 'flex',
    flexDirection: panel.direction === 'vertical' ? 'column' : 'row',
    position: 'relative',
    boxSizing: 'border-box',
    ...sizeStyle,
    ...minMaxStyle,
    gap: panel.gap !== undefined ? `${panel.gap}px` : undefined,
    padding: (() => {
      const p = panel.padding;
      return p
        ? `${p.top + CANVAS_PADDING}px ${p.right + CANVAS_PADDING}px ${p.bottom + CANVAS_PADDING}px ${p.left + CANVAS_PADDING}px`
        : `${CANVAS_PADDING}px`;
    })(),
    overflow: 'hidden',
    background: panel.background ?? (isLeaf ? 'rgba(255,255,255,0.04)' : undefined),
    ...borderStyle,
    borderRadius: panel.borderRadius !== undefined ? `${panel.borderRadius}px` : undefined,
    outline: isSelected ? '2px solid var(--color-accent)' : '1px solid rgba(255,255,255,0.08)',
    outlineOffset: isSelected ? '-2px' : '-1px',
    cursor: 'pointer',
  };

  function startEditing(e: React.MouseEvent) {
    e.stopPropagation();
    onSelectPanel(panel.id);
    setDraftName(panel.name ?? '');
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitEdit() {
    const trimmed = draftName.trim();
    onRenamePanel(panel.id, trimmed);
    setEditing(false);
  }

  return (
    <div
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onSelectPanel(panel.id);
      }}
    >
      {isLeaf && (
        <div className="le-slot-label">
          {editing ? (
            <input
              ref={inputRef}
              className="le-slot-name-input"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') setEditing(false);
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <span
              className={`le-slot-name-text${panel.name ? ' le-slot-name-text--named' : ''}`}
              onDoubleClick={startEditing}
              title="Double-click to rename"
            >
              {panel.name || 'Panel'}
            </span>
          )}
        </div>
      )}
      {!isLeaf && !isRoot && panel.name && (
        <div className="le-container-name" onClick={(e) => e.stopPropagation()}>
          <span
            className="le-container-name-text"
            onDoubleClick={startEditing}
            title="Double-click to rename"
          >
            {panel.name}
          </span>
        </div>
      )}
      {panel.children.map((child) => (
        <PanelView
          key={child.id}
          panel={child}
          parentDirection={panel.direction}
          selectedPanelId={selectedPanelId}
          onSelectPanel={onSelectPanel}
          onRenamePanel={onRenamePanel}
        />
      ))}
    </div>
  );
}

const NAV_KEYS: Record<string, 'up' | 'down' | 'left' | 'right'> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
};

export function LayoutCanvas({ layout, selectedPanelId, onSelectPanel, onRenamePanel, onNavigate }: CanvasProps) {
  return (
    <div
      className="le-canvas"
      tabIndex={0}
      onKeyDown={(e) => {
        const dir = NAV_KEYS[e.key];
        if (dir) { e.preventDefault(); onNavigate(dir); }
      }}
    >
      <div className="le-canvas-frame">
        <PanelView
          panel={layout.root}
          parentDirection="vertical"
          isRoot
          selectedPanelId={selectedPanelId}
          onSelectPanel={onSelectPanel}
          onRenamePanel={onRenamePanel}
        />
      </div>
    </div>
  );
}

export const css = `
  .le-canvas {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 24px;
    background: #141414;
  }
  .le-canvas-frame {
    flex: 1;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    overflow: hidden;
    position: relative;
    background: var(--color-bg);
  }
  .le-slot-label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .le-slot-name-text {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
    opacity: 0.6;
    pointer-events: all;
    cursor: text;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .le-slot-name-text--named {
    opacity: 1;
    color: var(--color-text);
    background: rgba(255,255,255,0.06);
    text-transform: none;
    letter-spacing: normal;
    font-size: 12px;
    font-weight: 500;
  }
  .le-slot-name-text:hover {
    background: rgba(255,255,255,0.08);
    opacity: 1;
  }
  .le-slot-name-input {
    pointer-events: all;
    background: var(--color-bg);
    border: 1px solid var(--color-accent);
    color: var(--color-text);
    font-size: 12px;
    font-family: inherit;
    padding: 2px 6px;
    border-radius: 3px;
    outline: none;
    min-width: 80px;
    text-align: center;
  }
  .le-container-name {
    position: absolute;
    top: 4px;
    left: 6px;
    z-index: 1;
    pointer-events: none;
  }
  .le-container-name-text {
    font-size: 10px;
    color: var(--color-text-muted);
    opacity: 0.7;
    pointer-events: all;
    cursor: text;
    padding: 1px 4px;
    border-radius: 2px;
  }
  .le-container-name-text:hover {
    opacity: 1;
    background: rgba(255,255,255,0.06);
  }
`;
