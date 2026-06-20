import { useState, useRef, useEffect } from 'react';
import { shellStore, type ShellState } from './store';

export function useShellState<K extends keyof ShellState>(keys?: K[]): ShellState {
  const [value, setValue] = useState<ShellState>(() => ({ ...shellStore.get() }));
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    setValue({ ...shellStore.get() });
    const unsubscribe = shellStore.subscribe((newValue) => {
      if (!keys) {
        setValue(newValue);
        return;
      }
      const prev = valueRef.current;
      const changed = (keys as (keyof ShellState)[]).some((k) => prev[k] !== newValue[k]);
      if (changed) setValue(newValue);
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return value;
}
