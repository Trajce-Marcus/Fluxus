import { createContext, useContext, useState, useCallback } from 'react';

// UAT component labels — when enabled, each major workbench region shows a
// small corner badge with its component name so UAT feedback can name the
// exact component without guessing. Toggled from the app header; persisted.

const STORAGE_KEY = 'fluxus:sdm:uat-labels';

interface UatLabelsValue {
  enabled: boolean;
  toggle: () => void;
}

const Ctx = createContext<UatLabelsValue>({ enabled: false, toggle: () => {} });

export function UatLabelsProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'on'; } catch { return false; }
  });

  const toggle = useCallback(() => {
    setEnabled(v => {
      const next = !v;
      try { localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off'); } catch { /* private mode */ }
      return next;
    });
  }, []);

  return <Ctx.Provider value={{ enabled, toggle }}>{children}</Ctx.Provider>;
}

export function useUatLabels(): UatLabelsValue {
  return useContext(Ctx);
}

// Corner badge naming the component. Host element must be position: relative
// (or pass a style override for a different anchor).
export function ComponentLabel({ name, style }: { name: string; style?: React.CSSProperties }) {
  const { enabled } = useUatLabels();
  if (!enabled) return null;
  return (
    <span style={{
      position: 'absolute',
      top: 0,
      right: 0,
      background: '#7c3aed',
      color: '#fff',
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.04em',
      padding: '2px 7px',
      borderRadius: '0 0 0 6px',
      zIndex: 60,
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      ...style,
    }}>
      {name}
    </span>
  );
}

export function UatLabelsToggle() {
  const { enabled, toggle } = useUatLabels();
  return (
    <button
      onClick={toggle}
      title="Show component names on each workbench region (UAT aid)"
      style={{
        background: enabled ? '#7c3aed' : 'transparent',
        color: enabled ? '#fff' : '#94a3b8',
        border: enabled ? '1px solid #7c3aed' : '1px solid #475569',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.03em',
        padding: '3px 9px',
        cursor: 'pointer',
      }}
    >
      Labels
    </button>
  );
}
