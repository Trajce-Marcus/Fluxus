import { createContext, useContext, useState, useCallback } from 'react';
import { client, currentSession, hostAuth, pageRuntime } from '../host';
import type { AuthSession, HostAuth } from '@fluxus/client';

// The Runtime app's shell state (CONSOLE_RUNTIME_SPEC §4, M15): who is signed
// in, which operation this app runs, the effective menu, and which page is
// open. Nothing record-shaped lives here — that all moved inside <Workbench>,
// which the Console hosts. The old AppContext mixed the two, and that mixing
// *was* the coupling.

interface RuntimeContextValue {
  /** Signed-in identity; null in the demo (auth unconfigured) posture. */
  session: AuthSession | null;
  auth: HostAuth | undefined;
  /** The identity line (M13): who you work for, which app, whose data. */
  orgName: string;
  solutionName: string;
  operationName: string;
  /** Published page paths — the no-menu fallback nav listing. */
  pagePaths: string[];
  /** The open page, or null before anything is chosen. */
  selectedPage: string | null;
  selectPage: (path: string) => void;
}

const Ctx = createContext<RuntimeContextValue | null>(null);

export function RuntimeProvider({ children }: { children: React.ReactNode }) {
  // The menu and the pages listing address published pages by path; the app
  // holds one at a time. First menu item / page wins nothing automatically —
  // an operation with no published pages shows an empty app, by design (§4).
  const [selectedPage, setSelectedPage] = useState<string | null>(null);

  const selectPage = useCallback((path: string) => setSelectedPage(path), []);

  return (
    <Ctx.Provider value={{
      session: currentSession,
      auth: hostAuth,
      orgName: client.orgName,
      solutionName: client.solutionName,
      operationName: client.operationName,
      pagePaths: pageRuntime.listPagePaths(),
      selectedPage,
      selectPage,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useRuntime(): RuntimeContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRuntime must be used within RuntimeProvider');
  return ctx;
}
