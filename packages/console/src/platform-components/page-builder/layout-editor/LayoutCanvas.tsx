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
  const CONTAINER_TITLE_ROOM = 16;

  const sizeStyle: CSSProperties = isRoot
    ? { flex: 1, minWidth: 0, minHeight: 0, margin: 6 } // room for the root's own outline to show (2026-09-24)
    : panel.size.type === 'flex'
    ? { flex: panel.size.value, minWidth: 0, minHeight: 0, margin: CANVAS_MARGIN }
    : panel.size.type === 'auto'
    ? { flex: '0 0 auto', margin: CANVAS_MARGIN }
    : parentIsVertical
    ? { height: `${panel.size.value}px`, flexShrink: 0, margin: CANVAS_MARGIN }
    : { width: `${panel.size.value}px`, flexShrink: 0, margin: CANVAS_MARGIN };

  // The canvas never draws a panel too small to see or to read its label
  // (2026-09-24). The label floats over the panel rather than taking room in
  // it, so an `auto` panel came out as tall as its padding. Editor-only: the
  // page renderer never reads these, and a panel's own min size still wins.
  const EDITOR_MIN_HEIGHT = 24;
  const EDITOR_MIN_WIDTH = 60;
  const minMaxStyle: CSSProperties = isRoot ? {} : { minHeight: EDITOR_MIN_HEIGHT, minWidth: EDITOR_MIN_WIDTH };
  if (!isRoot && panel.minSize !== undefined) {
    if (parentIsVertical) minMaxStyle.minHeight = `${Math.max(panel.minSize, EDITOR_MIN_HEIGHT)}px`;
    else minMaxStyle.minWidth = `${Math.max(panel.minSize, EDITOR_MIN_WIDTH)}px`;
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
      const p = panel.padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
      // A named container's title sits centred on its top edge; this much
      // extra room keeps its children below it, so the two never overlap.
      const titleRoom = !isLeaf && !isRoot && panel.name ? CONTAINER_TITLE_ROOM : 0;
      return `${p.top + CANVAS_PADDING + titleRoom}px ${p.right + CANVAS_PADDING}px ${p.bottom + CANVAS_PADDING}px ${p.left + CANVAS_PADDING}px`;
    })(),
    overflow: 'hidden',
    // A root with no background of its own draws as a light page rather than
    // the editor's dark canvas (2026-09-24): the 2px gaps between panels let it
    // through, and on a page of white panels it read as a thick black line.
    background: panel.background ?? (isRoot ? '#f1f5f9' : isLeaf ? 'rgba(255,255,255,0.04)' : undefined),
    ...borderStyle,
    borderRadius: panel.borderRadius !== undefined ? `${panel.borderRadius}px` : undefined,
    // Every panel shows a faint dashed guide, so the layout can be seen before
    // anything is selected (2026-09-24) — the old white-at-8% outline vanished
    // on the white panels pages use. Dashed so it never reads as a real border.
    outline: isSelected ? '2px solid var(--color-accent)' : '1px dashed rgba(100,116,139,0.45)',
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
              className={`le-slot-name-text${panel.name ? ' le-slot-name-text--named' : ''}${isSelected ? ' le-name--selected' : ''}`}
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
            className={`le-container-name-text${isSelected ? ' le-name--selected' : ''}`}
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
    /* White (2026-09-24): the root's margin shows this, and dark it hid the
       root's outline. */
    background: #ffffff;
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
  /* Centred on the container's top edge, whatever its children are doing
     (2026-09-24) — in the middle it would sit on its middle child's title. */
  .le-container-name {
    position: absolute;
    top: 3px;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100% - 8px);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
  /* The selected panel's title matches its border (2026-09-24). */
  .le-name--selected { color: var(--color-accent); font-weight: 700; opacity: 1; }
  .le-container-name-text:hover {
    opacity: 1;
    background: rgba(255,255,255,0.06);
  }
`;
