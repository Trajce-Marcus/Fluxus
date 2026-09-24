// The page's tabs (2026-09-24): the `tabName`s on its layout's panels, and the
// scroll to one. The page owns both, since only the page holds the layout and
// its own element; the `Tabs` component draws the names and asks for a scroll.

import type { Panel } from './layout';

/** What the page hands every component: its tab names and the scroll to one. */
export interface PageTabs {
  names: readonly string[];
  select: (tabName: string) => void;
}

export const NO_TABS: PageTabs = { names: [], select: () => {} };

/**
 * Every `tabName` in the layout, in layout order — depth-first, the order the
 * panels appear in the definition. Blank names are skipped; a name used twice
 * is listed once, since a click can only land on one of them (the first).
 */
export function collectTabNames(root: Panel | null | undefined): string[] {
  const out: string[] = [];
  const walk = (panel: Panel) => {
    const name = panel.tabName?.trim();
    if (name && !out.includes(name)) out.push(name);
    for (const child of panel.children ?? []) walk(child);
  };
  if (root) walk(root);
  return out;
}

const scrolls = (el: HTMLElement): boolean => {
  const overflowY = getComputedStyle(el).overflowY;
  return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
};

/**
 * Scroll the panel named `tabName` to the top of the panel that scrolls it.
 * The lookup runs inside the page's own element, never `document`: the Console
 * draws the page in a shadow root a document query cannot see into. Only the
 * nearest scrolling ancestor moves — `scrollIntoView` would also shift the
 * clipped panels above it and push the top of the page out of view.
 */
export function scrollToTab(pageRoot: HTMLElement | null, tabName: string): void {
  if (!pageRoot) return;
  const target = [...pageRoot.querySelectorAll<HTMLElement>('[data-tab-name]')]
    .find((el) => el.dataset.tabName === tabName);
  if (!target) return;
  let scroller = target.parentElement;
  while (scroller && scroller !== pageRoot && !scrolls(scroller)) scroller = scroller.parentElement;
  if (!scroller || scroller === pageRoot) return;
  const offset = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTo({ top: scroller.scrollTop + offset, behavior: 'smooth' });
}
