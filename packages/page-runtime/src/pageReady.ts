// When is a page "ready" (docs/PERFORMANCE_LOGGING.md §3, §10a)? When its
// record has resolved and every component on it has finished loading. Each
// ComponentContainer has its own loading state, so the page counts the ones
// still loading and records the open when that reaches zero.
//
// Only the first ready counts: a later re-load (an activity run bumping the
// refresh tick) is not opening the page again.

import type { PageOpenHandle } from '@fluxus/client';

export interface PageReadiness {
  /** A component (slot) started or finished loading. */
  loading(slot: string, loading: boolean): void;
  /** The page's own record has resolved, so its components may mount. */
  anchorReady(): void;
  /** The page could not open. */
  failed(message: string): void;
  /** The page went away first. */
  cancel(): void;
}

/** `open` is null when browser logging is off — every call is then a no-op. */
export function createPageReadiness(open: PageOpenHandle | null): PageReadiness {
  const pending = new Set<string>();
  const seen = new Set<string>();
  let anchorResolved = false;
  let done = false;

  const check = () => {
    if (done || !open || !anchorResolved || pending.size > 0) return;
    done = true;
    open.end({ components: seen.size });
  };

  return {
    loading(slot, loading) {
      seen.add(slot);
      if (loading) pending.add(slot);
      else pending.delete(slot);
      check();
    },
    anchorReady() {
      anchorResolved = true;
      check();
    },
    failed(message) {
      if (done) return;
      done = true;
      open?.fail(message);
    },
    cancel() {
      if (done) return;
      done = true;
      open?.cancel();
    },
  };
}
