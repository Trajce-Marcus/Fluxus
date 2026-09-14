// How a panel takes its size and decides what to do with what does not fit.
// Pure style rules, so no DOM is needed to hold them still.

import { describe, it, expect } from 'vitest';
import { panelStyle } from '../src/PageRenderer';
import type { Panel } from '../src/layout';

const panel = (over: Partial<Panel>): Panel => ({
  id: 'p', direction: 'vertical', size: { type: 'flex', value: 1 }, children: [], ...over,
});

describe('panel size', () => {
  it('flex takes a share of what is left', () => {
    expect(panelStyle(panel({ size: { type: 'flex', value: 3 } })).flex).toBe(3);
  });

  it('fixed asks for a number of pixels', () => {
    expect(panelStyle(panel({ size: { type: 'fixed', value: 150 } })).flexBasis).toBe(150);
  });

  // The size that lets a page be longer than the window: content-sized, and
  // refusing to shrink, so a scrolling parent ends up with something to scroll.
  it('auto is as big as its content and never shrinks', () => {
    expect(panelStyle(panel({ size: { type: 'auto' } })).flex).toBe('0 0 auto');
  });
});

describe('what happens to content that does not fit', () => {
  it('a panel holding panels clips, so a split does not grow', () => {
    expect(panelStyle(panel({ children: [panel({ id: 'c' })] })).overflow).toBe('hidden');
  });

  it('a panel holding a component scrolls, so nothing is unreachable', () => {
    expect(panelStyle(panel({})).overflow).toBe('auto');
  });

  it("'scroll' means scrollbars when there is something to scroll, not before", () => {
    expect(panelStyle(panel({ overflow: 'scroll', children: [panel({ id: 'c' })] })).overflow).toBe('auto');
  });
});
