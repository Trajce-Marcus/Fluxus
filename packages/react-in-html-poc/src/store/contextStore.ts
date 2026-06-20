type Listener<T> = (value: T) => void;

export interface ContextStore<T extends object> {
  get(): T;
  set(newValue: T | ((prev: T) => T)): void;
  subscribe(listener: Listener<T>): () => void;
  proxy: T;
}

export function createContextStore<T extends object>(initialValue: T): ContextStore<T> {
  // eslint-disable-next-line prefer-const
  let value = { ...initialValue } as T;
  const listeners = new Set<Listener<T>>();

  function notify() {
    // Pass a NEW object reference each time so React's state comparisons
    // correctly detect a change.
    const snapshot = { ...value } as T;
    listeners.forEach((l) => l(snapshot));
  }

  // Proxy intercepts get/set on `value`.
  // set(...) writes through AND notifies — making direct property assignment
  // (pageContext.jobNo = "X") reactive without a manual .set() call.
  const proxiedValue = new Proxy(value, {
    set(target, key, val) {
      (target as Record<string, unknown>)[key as string] = val;
      notify();
      return true;
    },
    deleteProperty(target, key) {
      delete (target as Record<string, unknown>)[key as string];
      notify();
      return true;
    },
  });

  return {
    get() {
      return proxiedValue;
    },
    set(newValue) {
      // Support both set(newObj) and set(prev => ({...prev, ...})) styles.
      // Replaces ALL keys at once, notifying once (not once per key).
      const resolved =
        typeof newValue === 'function'
          ? (newValue as (prev: T) => T)(proxiedValue)
          : newValue;

      // Bypass the proxy's per-key notify so we only notify once for the batch.
      Object.keys(value).forEach((k) => delete (value as Record<string, unknown>)[k]);
      Object.assign(value, resolved);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    proxy: proxiedValue,
  };
}

export type PageContext = Record<string, unknown>;

export const pageContextStore = createContextStore<PageContext>({});
