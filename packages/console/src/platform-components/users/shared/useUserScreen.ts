// The load/act cycle every user screen repeats, in one place.
//
// Nothing here is optimistic: the server owns these rules, an appointment can
// bounce off a tier check, and a table that shows a grant the server refused
// would be lying about who may do what. So every mutation refetches.

import { useCallback, useEffect, useState } from 'react';

export interface UserScreenState<T> {
  data: T | null;
  error: string | null;
  /** Email whose row is mid-call — one row's action disables that row only. */
  busyRow: string | null;
  reload: () => Promise<void>;
  /** Run a mutation for one row, then refetch. */
  act: (email: string, fn: () => Promise<unknown>) => Promise<void>;
  setError: (message: string | null) => void;
}

export function useUserScreen<T>(load: () => Promise<T>, deps: unknown[] = []): UserScreenState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setData(await load());
    } catch (e) {
      setError(message(e));
    }
    // `load` is redeclared every render by design — the caller closes over the
    // ids the screen is scoped to, so the dependency list is theirs to state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { void reload(); }, [reload]);

  const act = useCallback(async (email: string, fn: () => Promise<unknown>) => {
    setBusyRow(email);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusyRow(null);
    }
  }, [reload]);

  return { data, error, busyRow, reload, act, setError };
}

export function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
