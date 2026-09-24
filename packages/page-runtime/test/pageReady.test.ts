import { describe, expect, it } from 'vitest';
import type { PageOpenHandle } from '@fluxus/client';
import { createPageReadiness } from '../src/pageReady';

function handle() {
  const log: string[] = [];
  const open: PageOpenHandle = {
    end: (counts) => log.push(`end:${counts.components}`),
    fail: (m) => log.push(`fail:${m}`),
    cancel: () => log.push('cancel'),
  };
  return { open, log };
}

describe('page readiness', () => {
  it('is ready when the record has resolved and the last component finishes loading', () => {
    const { open, log } = handle();
    const r = createPageReadiness(open);
    // Children's mount effects run before the page's own, so loading comes first.
    r.loading('a', true);
    r.loading('b', true);
    r.anchorReady();
    r.loading('a', false);
    expect(log).toEqual([]);
    r.loading('b', false);
    expect(log).toEqual(['end:2']);
  });

  it('waits for the record even when every component is already done', () => {
    const { open, log } = handle();
    const r = createPageReadiness(open);
    r.loading('a', true);
    r.loading('a', false);
    expect(log).toEqual([]);
    r.anchorReady();
    expect(log).toEqual(['end:1']);
  });

  it('a page with no components is ready as soon as its record is', () => {
    const { open, log } = handle();
    createPageReadiness(open).anchorReady();
    expect(log).toEqual(['end:0']);
  });

  it('records only the first ready — a later reload is not the page opening again', () => {
    const { open, log } = handle();
    const r = createPageReadiness(open);
    r.loading('a', true);
    r.anchorReady();
    r.loading('a', false);
    r.loading('a', true);
    r.loading('a', false);
    expect(log).toEqual(['end:1']);
  });

  it('reports a page that could not open, once', () => {
    const { open, log } = handle();
    const r = createPageReadiness(open);
    r.failed('no such record');
    r.failed('again');
    r.anchorReady();
    expect(log).toEqual(['fail:no such record']);
  });

  it('records nothing for a page cancelled before it was ready', () => {
    const { open, log } = handle();
    const r = createPageReadiness(open);
    r.loading('a', true);
    r.cancel();
    r.loading('a', false);
    r.anchorReady();
    expect(log).toEqual(['cancel']);
  });

  it('is inert when browser logging is off', () => {
    const r = createPageReadiness(null);
    r.loading('a', true);
    r.anchorReady();
    r.loading('a', false);
    r.failed('x');
    r.cancel();
  });
});
