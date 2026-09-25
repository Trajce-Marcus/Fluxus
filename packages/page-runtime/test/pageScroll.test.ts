import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readScroll, restoreScroll } from '../src/pageScroll';

// Stand-in panels: a scrollTop the browser clamps to what the content allows,
// and content that can grow — what a list arriving does.
function panel(max: number) {
  let top = 0;
  const el = {
    max,
    get scrollTop() { return top; },
    set scrollTop(v: number) { top = Math.max(0, Math.min(v, el.max)); },
  };
  return el;
}
const root = () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() });

let frames: (() => void)[] = [];
const nextFrame = () => { const f = frames; frames = []; f.forEach((cb) => cb()); };

beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
});
afterEach(() => vi.unstubAllGlobals());

describe('readScroll', () => {
  it('keeps only the panels scrolled away from the top', () => {
    const a = panel(500); a.scrollTop = 120;
    const b = panel(500);
    expect(readScroll(new Map([['a', a], ['b', b]]) as never)).toEqual({ a: 120 });
  });
});

describe('restoreScroll', () => {
  it('jumps at once when the content is already there', () => {
    const body = panel(1000);
    const done = vi.fn();
    restoreScroll(root() as never, new Map([['body', body]]) as never, { body: 600 }, () => true, done);
    expect(body.scrollTop).toBe(600);
    nextFrame();
    expect(done).toHaveBeenCalledOnce();
  });

  it('keeps re-applying until the lists arrive and the page has loaded', () => {
    const body = panel(200); // lists not loaded yet: too short for 600
    let loaded = false;
    const done = vi.fn();
    restoreScroll(root() as never, new Map([['body', body]]) as never, { body: 600 }, () => loaded, done);
    expect(body.scrollTop).toBe(200);
    nextFrame();
    expect(done).not.toHaveBeenCalled();
    body.max = 1000; loaded = true; // the lists arrive
    nextFrame();
    expect(body.scrollTop).toBe(600);
    expect(done).toHaveBeenCalledOnce();
  });

  it('stops when the reader scrolls themselves', () => {
    const r = root();
    const body = panel(200);
    const done = vi.fn();
    restoreScroll(r as never, new Map([['body', body]]) as never, { body: 600 }, () => false, done);
    const onWheel = r.addEventListener.mock.calls.find(([type]) => type === 'wheel')![1];
    onWheel();
    expect(done).toHaveBeenCalledOnce();
    body.max = 1000;
    nextFrame();
    expect(body.scrollTop).toBe(200);
  });
});
