// The inner side panel (M17) — the shell owns the *column*, sections fill it.
//
// Industry-console layout (Neon): nav (which section) → inner panel (which item
// in it) → main (the item). The shell cannot render the list itself: the items
// are the section's own state — an SDM editor lists its *draft*, unsaved
// renames included — so a section renders `<InnerPanel>` anywhere in its tree
// and it portals into the column. State stays colocated (M16's rule), the frame
// stays the shell's.
//
// A section that has no list renders no `<InnerPanel>` and the column collapses
// (`:empty` on the host), so Overview/Settings/Menu are plain two-column pages.

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Created once and moved into whichever slot is mounted, so a section's portal
// always has a live target — including on the first render, before the slot's
// ref is attached, and across the scopeVersion remount.
const host = document.createElement('div');
host.className = 'inner-panel-host';

/** The column itself — rendered by the shell between the nav and the content. */
export function InnerPanelSlot() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.appendChild(host); }, []);
  return <aside className="inner-panel" ref={ref} />;
}

/** Fill the column from inside a section. */
export function InnerPanel({ title, actions, head, flush, children }: {
  title: string;
  /** Header-right control — typically the section's "New …" button. */
  actions?: ReactNode;
  /** Replace the whole header — for a section whose panel has its own
   *  switcher (Pages: tree / components / search) and would otherwise show
   *  its name twice. */
  head?: ReactNode;
  /** Drop the body's padding and scrolling — the child manages its own (the
   *  page tree, which has its own tab strip and scroller). */
  flush?: boolean;
  children: ReactNode;
}) {
  return createPortal(
    <>
      {head ?? (
        <div className="inner-panel-head">
          <span className="inner-panel-title">{title}</span>
          {actions}
        </div>
      )}
      <div className={`inner-panel-body${flush ? ' flush' : ''}`}>{children}</div>
    </>,
    host,
  );
}

/** One row in an inner panel's list — name over an optional dim sub-line. */
export function PanelItem({ name, sub, active, onClick }: {
  name: ReactNode;
  sub?: ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`panel-item${active ? ' active' : ''}`} onClick={onClick}>
      <span className="panel-item-name">{name}</span>
      {sub !== undefined && <span className="panel-item-sub">{sub}</span>}
    </button>
  );
}

export const css = `
  .inner-panel {
    display: flex;
    width: 240px;
    flex-shrink: 0;
    background: var(--color-sidebar);
    border-right: 1px solid var(--color-border);
    overflow: hidden;
  }
  /* No section list ⇒ no column: before the host lands, and while it is empty. */
  .inner-panel:empty,
  .inner-panel:has(> .inner-panel-host:empty) { display: none; }
  .inner-panel-host {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 0;
  }
  .inner-panel-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    padding: 10px 12px 8px;
    border-bottom: 1px solid var(--color-border);
  }
  .inner-panel-title {
    flex: 1;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--color-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .inner-panel-body { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 6px; min-height: 0; }
  .inner-panel-body.flush { display: flex; flex-direction: column; overflow: hidden; padding: 0; }

  .panel-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    width: 100%;
    text-align: left;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    color: var(--color-text);
    font-family: inherit;
    padding: 6px 9px;
  }
  .panel-item:hover { background: rgba(255,255,255,0.05); }
  .panel-item.active { background: rgba(255,255,255,0.08); border-color: var(--color-border); }
  .panel-item-name {
    font-size: 0.82rem;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .panel-item-sub {
    font-size: 0.7rem;
    color: var(--color-text-muted);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .panel-btn {
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-text);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.72rem;
    padding: 3px 8px;
    white-space: nowrap;
  }
  .panel-btn:hover { background: rgba(255,255,255,0.06); }
  .panel-empty { padding: 8px 9px; font-size: 0.76rem; color: var(--color-text-muted); }
`;
