import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { client, currentSession, depthState, dropScroll, flushScroll, historyDepth, hostAuth, pageRuntime, setPageNavigator } from '../host';
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
  /** The record that page is about, when it names one of many (`?record=`).
   *  A one-instance page finds or creates its own; a pure view has none. */
  selectedRecordId: string | null;
  selectPage: (path: string) => void;
}

// The URL addresses what is open (DATA_THROUGH_ACTIVITIES step 3):
// `?operation=<id>` establishes which operation this app runs — it is read at
// connect, before any of this — and `page` / `record` address what is open
// inside it, so an open board is a link someone can send. `page` is the page's
// id, which is its path.
const params = () => new URLSearchParams(window.location.search);

function addressBar(path: string | null, recordId: string | null = null): void {
  const next = params();
  if (path) next.set('page', path);
  else next.delete('page');
  // The record belongs to the page it was opened on; picking another page
  // leaves it behind rather than carrying a stale id across. A page opened
  // *about* a record says so here, which is what makes it a sendable link.
  if (recordId) next.set('record', recordId);
  else next.delete('record');
  // Each page opened is its own history entry (2026-09-23), so the browser's
  // Back returns to the page before — it replaced the entry, which left Back
  // nothing to go to inside the app. Re-opening what is already open adds none.
  const url = `${window.location.pathname}?${next}`;
  if (url === `${window.location.pathname}${window.location.search}`) return;
  flushScroll(); // the page being left keeps where the reader was
  window.history.pushState(depthState(historyDepth() + 1), '', url);
}

const Ctx = createContext<RuntimeContextValue | null>(null);

export function RuntimeProvider({ children }: { children: React.ReactNode }) {
  // The menu and the pages listing address published pages by path; the app
  // holds one at a time. First menu item / page wins nothing automatically —
  // an operation with no published pages shows an empty app, by design (§4).
  // A page named in the URL is open from the first frame, so a deep link lands
  // where it says it does.
  const [selectedPage, setSelectedPage] = useState<string | null>(() => params().get('page'));
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(() => params().get('record'));

  const selectPage = useCallback((path: string) => {
    setSelectedPage(path);
    setSelectedRecordId(null);
    addressBar(path);
  }, []);

  // What `services.page.open` reaches in this host (2026-08-27). Navigating is
  // setting the pair the URL already addresses, so a page opened from another
  // page is the same link a menu item would have produced.
  const openPage = useCallback((path: string, recordId: string | null) => {
    setSelectedPage(path);
    setSelectedRecordId(recordId);
    addressBar(path, recordId);
  }, []);

  // Back and Forward: the URL has already moved, so the open page follows it.
  useEffect(() => {
    const onPop = () => {
      dropScroll();
      setSelectedPage(params().get('page'));
      setSelectedRecordId(params().get('record'));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // The page runtime is a module singleton created before React exists, so the
  // host holds the seam and the provider fills it (Fork 2 ruling: singleton,
  // not context).
  useEffect(() => {
    setPageNavigator(openPage);
    return () => setPageNavigator(null);
  }, [openPage]);

  return (
    <Ctx.Provider value={{
      session: currentSession,
      auth: hostAuth,
      orgName: client.orgName,
      solutionName: client.solutionName,
      operationName: client.operationName,
      pagePaths: pageRuntime.listPagePaths(),
      selectedPage,
      selectedRecordId,
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
