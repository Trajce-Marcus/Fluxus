import { useState, useRef, useEffect } from 'react';
import { pageContextStore, type PageContext } from './contextStore';

// Usage:
//   usePageContext()                     rerenders on ANY change
//   usePageContext(["jobNo"])            rerenders only when jobNo changes
//   usePageContext(["jobNo", "status"])  rerenders when jobNo OR status changes
//
// Shallow, top-level comparison only — mutating a nested object won't be detected.
export function usePageContext(keys?: string[]): PageContext {
  // Use a snapshot (shallow copy), not the live proxy — the proxy's properties
  // are mutated before notify() fires, so comparing against it as "prev" would
  // always see post-mutation values and never detect a change.
  const [value, setValue] = useState<PageContext>(() => ({ ...pageContextStore.get() }));

  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    // Sync immediately on subscribe to close the race where a script sets
    // pageContext before this effect has registered its subscriber.
    setValue({ ...pageContextStore.get() });

    const unsubscribe = pageContextStore.subscribe((newValue) => {
      if (!keys) {
        setValue(newValue);
        return;
      }

      const prev = valueRef.current;
      const changed = keys.some((key) => prev[key] !== newValue[key]);
      if (changed) setValue(newValue);
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // subscribe once; `keys` read fresh via closure each notify

  return value;
}
