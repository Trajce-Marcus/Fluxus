import { describe, expect, it } from 'vitest';
import type { Panel } from '../src/layout';
import type { SlotConfig } from '../src/pageDef';
import { collectTabNames, hiddenBySwitch } from '../src/pageTabs';

const panel = (id: string, children: Panel[] = []): Panel =>
  ({ id, direction: 'vertical', size: { type: 'auto' }, children });
const slot = (tabName?: string): SlotConfig =>
  ({ componentName: 'RecordList', staticConfig: {}, dynamicProps: {}, callbacks: {}, ...(tabName !== undefined ? { tabName } : {}) });

describe('collectTabNames', () => {
  const root = panel('root', [
    panel('top', [panel('slot-title'), panel('slot-tabs')]),
    panel('body', [panel('slot-details'), panel('slot-wbs-new'), panel('slot-wbs'), panel('slot-resources')]),
  ]);

  it("lists the slots' tab names in layout order, depth-first", () => {
    const slots = { 'slot-title': slot(), 'slot-details': slot('Details'), 'slot-wbs-new': slot('WBS Rows'), 'slot-wbs': slot(), 'slot-resources': slot('Resources Used') };
    expect(collectTabNames(root, slots)).toEqual(['Details', 'WBS Rows', 'Resources Used']);
  });

  it('skips blank names, empty slots, and lists a repeated name once', () => {
    const slots = { 'slot-details': slot('  '), 'slot-wbs-new': null, 'slot-wbs': slot('Photos'), 'slot-resources': slot(' Photos ') };
    expect(collectTabNames(root, slots)).toEqual(['Photos']);
  });

  it('has no tabs without a layout', () => {
    expect(collectTabNames(undefined, {})).toEqual([]);
  });
});

describe('hiddenBySwitch', () => {
  const root = panel('root', [
    panel('top', [panel('slot-title'), panel('slot-tabs')]),
    panel('body', [
      panel('slot-details'),
      panel('wbs-group', [panel('slot-wbs-new'), panel('slot-wbs')]),
      panel('slot-resources'),
      panel('slot-photos'),
    ]),
  ]);
  const slots = {
    'slot-title': slot(), 'slot-tabs': slot(),
    'slot-details': slot('Details'), 'slot-wbs-new': slot('WBS'), 'slot-wbs': slot(),
    'slot-resources': slot('Resources'), 'slot-photos': slot(),
  };

  it('shows the slots before the first tab, and the chosen section only', () => {
    const hidden = hiddenBySwitch(root, slots, 'Resources');
    expect([...hidden].sort()).toEqual(['slot-details', 'slot-wbs', 'slot-wbs-new', 'wbs-group'].sort());
  });

  it("runs a section to the next tab's slot — a slot with no tab belongs to the one above", () => {
    const hidden = hiddenBySwitch(root, slots, 'WBS');
    expect(hidden.has('slot-wbs')).toBe(false);
    expect([...hidden].sort()).toEqual(['slot-details', 'slot-photos', 'slot-resources'].sort());
  });

  it('never hides the header or the root', () => {
    const hidden = hiddenBySwitch(root, slots, 'Details');
    expect(hidden.has('top')).toBe(false);
    expect(hidden.has('root')).toBe(false);
    expect(hidden.has('body')).toBe(false);
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
