import { useState, useEffect, useMemo } from 'react';
import { getLayoutEditorStore, createLayoutActions, type LayoutPageState } from './store';

export function useLayoutEditorState(path: string) {
  const store = useMemo(() => getLayoutEditorStore(path), [path]);
  const [state, setState] = useState<LayoutPageState>(() => ({ ...store.get() }));

  useEffect(() => {
    setState({ ...store.get() });
    return store.subscribe((newState) => setState(newState));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const actions = useMemo(() => createLayoutActions(store), [store]);

  return { state, actions };
}
