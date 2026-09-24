// The page's tabs (2026-09-24): the `tabName`s on its slots, and the scroll to
// one. The page owns both, since only the page holds the layout and
// its own element; the `Tabs` component draws the names and asks for a scroll.

import type { Panel } from './layout';
import type { SlotConfig } from './pageDef';

/** What the page hands every component: its tab names, the scroll to one, and
 *  word of a tab's section coming into view as the reader scrolls. */
export interface PageTabs {
  names: readonly string[];
  /** The tab a "switch" strip shows; null when the page's strip scrolls. */
  active: string | null;
  select: (tabName: string) => void;
  /** Calls `onEnter` with a tab's name whenever its section comes into view;
   *  returns the call that stops watching. */
  watch: (onEnter: (tabName: string) => void) => () => void;
}

export const NO_TABS: PageTabs = { names: [], active: null, select: () => {}, watch: () => () => {} };

/**
 * Every slot's `tabName`, in layout order — depth-first, the order the slots'
 * panels appear in the definition. Blank names are skipped; a name used twice
 * is listed once, since a click can only land on one of them (the first).
 */
export function collectTabNames(
  root: Panel | null | undefined,
  slotConfigs: Record<string, SlotConfig | null>,
): string[] {
  const out: string[] = [];
  const walk = (panel: Panel) => {
    const name = slotConfigs[panel.id]?.tabName?.trim();
    if (name && !out.includes(name)) out.push(name);
    for (const child of panel.children ?? []) walk(child);
  };
  if (root) walk(root);
  return out;
}

/**
 * The panels a "switch" Tabs strip hides when `activeTab` is chosen
 * (2026-09-24). A tab marks where its section **starts**, so a section runs
 * from its slot to the next named slot in layout order; slots before the first
 * tab (the header, the strip itself) belong to none and always show. A panel
 * holding other panels is hidden once everything in it is.
 */
export function hiddenBySwitch(
  root: Panel | null | undefined,
  slotConfigs: Record<string, SlotConfig | null>,
  activeTab: string,
): Set<string> {
  const hidden = new Set<string>();
  let section: string | null = null;
  const walk = (panel: Panel): boolean => {
    const children = panel.children ?? [];
    if (children.length === 0) {
      const name = slotConfigs[panel.id]?.tabName?.trim();
      if (name) section = name;
      const hide = section !== null && section !== activeTab;
      if (hide) hidden.add(panel.id);
      return hide;
    }
    const results = children.map(walk);
    const hide = results.every(Boolean);
    if (hide) hidden.add(panel.id);
    return hide;
  };
  if (root) {
    walk(root);
    hidden.delete(root.id);
  }
  return hidden;
}

const tabElements = (pageRoot: HTMLElement): HTMLElement[] =>
  [...pageRoot.querySelectorAll<HTMLElement>('[data-tab-name]')];

const canScroll = (el: HTMLElement): boolean => {
  const overflowY = getComputedStyle(el).overflowY;
  return overflowY === 'auto' || overflowY === 'scroll';
};
const scrolls = (el: HTMLElement): boolean => canScroll(el) && el.scrollHeight > el.clientHeight;

/**
 * The nearest ancestor of `el` that scrolls, short of the page root. `now`:
 * one that has something to scroll right now (a click's scroll); otherwise one
 * set to scroll, full or not — the watcher starts while lists are still
 * loading and the page may not yet be taller than its panel.
 */
function scrollerOf(pageRoot: HTMLElement, el: HTMLElement, now = true): HTMLElement | null {
  const test = now ? scrolls : canScroll;
  let scroller = el.parentElement;
  while (scroller && scroller !== pageRoot && !test(scroller)) scroller = scroller.parentElement;
  return scroller && scroller !== pageRoot ? scroller : null;
}

/**
 * Scroll the slot named `tabName` to the top of the panel that scrolls it.
 * The lookup runs inside the page's own element, never `document`: the Console
 * draws the page in a shadow root a document query cannot see into. Only the
 * nearest scrolling ancestor moves — `scrollIntoView` would also shift the
 * clipped panels above it and push the top of the page out of view.
 */
export function scrollToTab(pageRoot: HTMLElement | null, tabName: string): void {
  if (!pageRoot) return;
  const target = tabElements(pageRoot).find((el) => el.dataset.tabName === tabName);
  if (!target) return;
  const scroller = scrollerOf(pageRoot, target);
  if (!scroller) return;
  const offset = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTo({ top: scroller.scrollTop + offset, behavior: 'smooth' });
}

/**
 * Report which tab's section the reader is in, as they scroll (2026-09-24):
 * the last one whose start has reached the top of the scrolling panel. The
 * last section is often too short ever to reach the top, so once the panel is
 * scrolled to the bottom it is the last section whose start is in view. (The
 * first rule tried — whichever section last came into view — lit the next
 * section as soon as its start showed at the bottom, and felt odd.)
 */
export function watchTabs(pageRoot: HTMLElement | null, onEnter: (tabName: string) => void): () => void {
  if (!pageRoot) return () => {};
  const elements = tabElements(pageRoot);
  const scroller = elements.length > 0 ? scrollerOf(pageRoot, elements[0], false) : null;
  if (!scroller) return () => {};

  const SLACK = 8; // a click lands a section's top exactly at the panel's top
  let last: string | null = null;
  let frame = 0;
  const check = () => {
    frame = 0;
    const box = scroller.getBoundingClientRect();
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
    const reached = (el: HTMLElement) => {
      const top = el.getBoundingClientRect().top;
      return atBottom ? top < box.bottom : top - box.top <= SLACK;
    };
    const current = [...elements].reverse().find(reached) ?? elements[0];
    const name = current.dataset.tabName;
    if (name && name !== last) { last = name; onEnter(name); }
  };
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(check); };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    scroller.removeEventListener('scroll', onScroll);
    if (frame) cancelAnimationFrame(frame);
  };
}
