import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { client, currentSession, depthState, dropScroll, flushScroll, historyDepth, hostAuth, setAppNavigator } from '../host';
import type { AuthSession, HostAuth } from '@fluxus/client';

// The Runtime app's shell state (CONSOLE_RUNTIME_SPEC §4, M15): who is signed
// in, which operation this app runs, and which app is open. Nothing
// record-shaped lives here — that all moved inside <Workbench>, which the
// Console hosts. The old AppContext mixed the two, and that mixing *was* the
// coupling.

interface RuntimeContextValue {
  /** Signed-in identity; null in the demo (auth unconfigured) posture. */
  session: AuthSession | null;
  auth: HostAuth | undefined;
  /** The identity line (M13): who you work for, which app, whose data. */
  orgName: string;
  solutionName: string;
  operationName: string;
  /** The open app — its id in the operation's apps list — or null before
   *  anything is chosen. */
  selectedAppId: string | null;
  /** The record that app's page is about (`?record=`); a pure view has none. */
  selectedRecordId: string | null;
  /** Open an app from the menu: about no record. */
  selectApp: (appId: string) => void;
}

// The URL addresses what is open (APPS_AND_INSTANCES §2.7):
// `?operation=<id>` establishes which operation this app runs — it is read at
// connect, before any of this — and `app` / `record` address what is open
// inside it, so an open app is a link someone can send. `app` is the app's id
// in the operation's apps list. `page=` went with it, and since step 6 an old
// link carrying one opens nothing.
const params = () => new URLSearchParams(window.location.search);

/** The app the URL names. */
const appFromUrl = (): string | null => params().get('app');

function addressBar(appId: string | null, recordId: string | null = null): void {
  const next = params();
  if (appId) next.set('app', appId);
  else next.delete('app');
  // The record belongs to the app it was opened in; picking another app
  // leaves it behind rather than carrying a stale id across.
  if (recordId) next.set('record', recordId);
  else next.delete('record');
  // Each app opened is its own history entry (2026-09-23), so the browser's
  // Back returns to the one before. Re-opening what is already open adds none.
  const url = `${window.location.pathname}?${next}`;
  if (url === `${window.location.pathname}${window.location.search}`) return;
  flushScroll(); // the page being left keeps where the reader was
  window.history.pushState(depthState(historyDepth() + 1), '', url);
}

/** Every call the open app makes names it (APPS_AND_INSTANCES §2.3). */
function setOpenApp(appId: string | null): void {
  client.appId = appId;
}

const Ctx = createContext<RuntimeContextValue | null>(null);

export function RuntimeProvider({ children }: { children: React.ReactNode }) {
  // An app named in the URL is open from the first frame, so a deep link lands
  // where it says it does. Nothing is opened automatically otherwise.
  const [selectedAppId, setSelectedAppId] = useState<string | null>(() => {
    const appId = appFromUrl();
    setOpenApp(appId);
    return appId;
  });
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(() => params().get('record'));

  // Opening an app is setting the pair the URL addresses, so an app opened
  // from a page is the same link a menu item would have produced. The client
  // learns the app before anything on its page can make a call.
  const showApp = useCallback((appId: string, recordId: string | null) => {
    setOpenApp(appId);
    setSelectedAppId(appId);
    setSelectedRecordId(recordId);
    addressBar(appId, recordId);
  }, []);

  const selectApp = useCallback((appId: string) => showApp(appId, null), [showApp]);

  // Back and Forward: the URL has already moved, so the open app follows it.
  useEffect(() => {
    const onPop = () => {
      dropScroll();
      const appId = appFromUrl();
      setOpenApp(appId);
      setSelectedAppId(appId);
      setSelectedRecordId(params().get('record'));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // The page runtime is a module singleton created before React exists, so the
  // host holds the seam and the provider fills it (Fork 2 ruling: singleton,
  // not context).
  useEffect(() => {
    setAppNavigator(showApp);
    return () => setAppNavigator(null);
  }, [showApp]);

  return (
    <Ctx.Provider value={{
      session: currentSession,
      auth: hostAuth,
      orgName: client.orgName,
      solutionName: client.solutionName,
      operationName: client.operationName,
      selectedAppId,
      selectedRecordId,
      selectApp,
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
