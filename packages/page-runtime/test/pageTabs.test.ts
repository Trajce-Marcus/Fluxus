import { describe, expect, it } from 'vitest';
import type { Panel } from '../src/layout';
import { collectTabNames } from '../src/pageTabs';

const panel = (id: string, tabName?: string, children: Panel[] = []): Panel =>
  ({ id, direction: 'vertical', size: { type: 'auto' }, children, ...(tabName !== undefined ? { tabName } : {}) });

describe('collectTabNames', () => {
  it('lists named panels in layout order, depth-first', () => {
    const root = panel('root', undefined, [
      panel('top'),
      panel('body', undefined, [
        panel('details', 'Details'),
        panel('group', 'WBS Rows', [panel('wbs-new'), panel('wbs')]),
        panel('resources', 'Resources Used'),
      ]),
    ]);
    expect(collectTabNames(root)).toEqual(['Details', 'WBS Rows', 'Resources Used']);
  });

  it('reaches a named panel inside another named one', () => {
    const root = panel('root', 'Outer', [panel('inner', 'Inner')]);
    expect(collectTabNames(root)).toEqual(['Outer', 'Inner']);
  });

  it('skips blank names and lists a repeated name once', () => {
    const root = panel('root', undefined, [panel('a', '  '), panel('b', 'Photos'), panel('c', ' Photos ')]);
    expect(collectTabNames(root)).toEqual(['Photos']);
  });

  it('has no tabs without a layout', () => {
    expect(collectTabNames(undefined)).toEqual([]);
  });
});

// Stand-in elements: just what scrollToTab touches. Enough to check which
// element it scrolls and by how much, without a browser.
type Fake = {
  dataset: Record<string, string>; parentElement: Fake | null; overflowY: string;
  scrollHeight: number; clientHeight: number; scrollTop: number; top: number;
  scrolledTo?: number; children: Fake[];
  querySelectorAll: () => Fake[]; getBoundingClientRect: () => { top: number }; scrollTo: (o: { top: number }) => void;
};
const el = (props: Partial<Fake>, parent: Fake | null = null): Fake => {
  const node: Fake = {
    dataset: {}, parentElement: parent, overflowY: 'hidden', scrollHeight: 100, clientHeight: 100, scrollTop: 0, top: 0, children: [],
    querySelectorAll: () => [], getBoundingClientRect: () => ({ top: node.top }), scrollTo: (o) => { node.scrolledTo = o.top; },
    ...props,
  };
  parent?.children.push(node);
  return node;
};
const all = (root: Fake): Fake[] => root.children.flatMap((c) => [c, ...all(c)]);

describe('scrollToTab', () => {
  (globalThis as { getComputedStyle?: unknown }).getComputedStyle = (e: Fake) => ({ overflowY: e.overflowY });

  const page = () => {
    const root = el({ top: 0 });
    root.querySelectorAll = () => all(root).filter((n) => n.dataset.tabName !== undefined);
    const top = el({ top: 0 }, root);
    const body = el({ top: 120, overflowY: 'auto', scrollHeight: 2000, clientHeight: 500, scrollTop: 300 }, root);
    const clipped = el({ top: 120 }, body);
    const wbs = el({ top: 420, dataset: { tabName: 'WBS Rows' } }, clipped);
    return { root, top, body, wbs };
  };

  it('scrolls the nearest scrolling panel, not the clipped ones between', async () => {
    const { root, body, top } = page();
    const { scrollToTab } = await import('../src/pageTabs');
    scrollToTab(root as unknown as HTMLElement, 'WBS Rows');
    // 300 already scrolled + (420 − 120) to bring the panel's top to the body's
    expect(body.scrolledTo).toBe(600);
    expect(top.scrolledTo).toBeUndefined();
  });

  it('does nothing for a name the page does not have', async () => {
    const { root, body } = page();
    const { scrollToTab } = await import('../src/pageTabs');
    scrollToTab(root as unknown as HTMLElement, 'Photos');
    expect(body.scrolledTo).toBeUndefined();
  });

  it('does nothing when nothing between the panel and the page scrolls', async () => {
    const { root, body } = page();
    body.scrollHeight = 500; // fits — nothing to scroll
    const { scrollToTab } = await import('../src/pageTabs');
    scrollToTab(root as unknown as HTMLElement, 'WBS Rows');
    expect(body.scrolledTo).toBeUndefined();
  });
});
