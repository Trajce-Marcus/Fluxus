// Where the reader was on a page (2026-09-26): each panel's scroll, by panel
// id, so a host that keeps history can hand it back on Back and Forward. The
// page scrolls inside its panels, never the window, so the browser's own
// scroll restoration has nothing to restore.

/** Vertical scroll by panel id. Only panels scrolled away from the top. */
export type PanelScroll = Record<string, number>;

/** What a host keeps for a page: its panels' scroll, and the tab a "switch"
 *  strip was showing — without which the panels scrolled are not even drawn. */
export interface PageScroll {
  panels: PanelScroll;
  tab?: string;
}

/** How long a restore keeps re-applying while the page is still filling in. */
export const RESTORE_FOR_MS = 5000;

export function readScroll(panels: ReadonlyMap<string, HTMLElement>): PanelScroll {
  const out: PanelScroll = {};
  for (const [id, el] of panels) if (el.scrollTop > 0) out[id] = el.scrollTop;
  return out;
}

/**
 * Put every panel back where `saved` says, from the next frame. One jump is not
 * enough: the page's lists are still loading, so a panel is shorter than its
 * old position until they arrive, and content arriving above can nudge it off
 * again. So it re-applies every frame until the page has finished loading
 * (`settled`) and every panel is where it was — or the reader scrolls
 * themselves, or `RESTORE_FOR_MS` runs out. Calls `onDone` either way; returns
 * the call that stops it early.
 */
export function restoreScroll(
  root: HTMLElement,
  panels: ReadonlyMap<string, HTMLElement>,
  saved: PanelScroll,
  settled: () => boolean,
  onDone: () => void,
): () => void {
  const deadline = performance.now() + RESTORE_FOR_MS;
  let frame = 0;
  let stopped = false;

  const apply = (): boolean => {
    let reached = true;
    for (const [id, top] of Object.entries(saved)) {
      const el = panels.get(id);
      if (!el) { reached = false; continue; }
      if (Math.abs(el.scrollTop - top) > 1) el.scrollTop = top;
      if (Math.abs(el.scrollTop - top) > 1) reached = false;
    }
    return reached;
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frame) cancelAnimationFrame(frame);
    for (const type of USER_SCROLL) root.removeEventListener(type, stop, true);
    onDone();
  };

  const tick = () => {
    frame = 0;
    const reached = apply();
    if ((reached && settled()) || performance.now() >= deadline) stop();
    else frame = requestAnimationFrame(tick);
  };

  // The reader taking over ends it — re-applying would fight their scrolling.
  for (const type of USER_SCROLL) root.addEventListener(type, stop, { capture: true, passive: true });
  apply(); // now, so a page whose content is already there never shows the top
  frame = requestAnimationFrame(tick);
  return stop;
}

const USER_SCROLL = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
