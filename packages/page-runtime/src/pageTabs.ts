// The page's tabs (2026-09-24): the `tabName`s on its slots, and the scroll to
// one. The page owns both, since only the page holds the layout and
// its own element; the `Tabs` component draws the names and asks for a scroll.

import type { Panel } from './layout';
import type { SlotConfig } from './pageDef';

/** What the page hands every component: its tab names, the scroll to one, and
 *  word of a tab's section coming into view as the reader scrolls. */
export interface PageTabs {
  names: readonly string[];
  select: (tabName: string) => void;
  /** Calls `onEnter` with a tab's name whenever its section comes into view;
   *  returns the call that stops watching. */
  watch: (onEnter: (tabName: string) => void) => () => void;
}

export const NO_TABS: PageTabs = { names: [], select: () => {}, watch: () => () => {} };

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
 * Report each tab's section as it comes into view (2026-09-24, the user's
 * rule): scrolling down, a section entering from the bottom; scrolling up, one
 * entering from the top — either way it is the one the reader has just reached.
 * The first report, of what is already in view, is not news and is skipped.
 * Nothing scrolls, nothing is watched.
 */
export function watchTabs(pageRoot: HTMLElement | null, onEnter: (tabName: string) => void): () => void {
  if (!pageRoot || typeof IntersectionObserver === 'undefined') return () => {};
  const elements = tabElements(pageRoot);
  const scroller = elements.length > 0 ? scrollerOf(pageRoot, elements[0], false) : null;
  if (!scroller) return () => {};
  let first = true;
  const observer = new IntersectionObserver((entries) => {
    if (first) { first = false; return; }
    for (const entry of entries) {
      const name = (entry.target as HTMLElement).dataset.tabName;
      if (entry.isIntersecting && name) onEnter(name);
    }
  }, { root: scroller });
  for (const el of elements) observer.observe(el);
  return () => observer.disconnect();
}
