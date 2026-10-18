import { useState } from 'react';
import { RuntimeProvider, useRuntime } from './context/RuntimeContext';
import { MenuNav } from './components/MenuNav';
import { PageView } from './components/PageView';
import { NotificationCentre } from './components/NotificationCentre';
import { client, NOT_SET_UP } from './host';
import './App.css';

const NAV_PREF_KEY = 'fluxus:sdm:nav-open';

// The Runtime app opens the operation's apps, and nothing else (§4, M15;
// APPS_AND_INSTANCES §2.7). The workbench — raw records, arbitrary activity
// runs, CSV import, the schema navigator — lives in the Console, so an
// operation with no apps set up for this caller shows an empty app. That is
// the design, not a gap.
function ContentArea() {
  const { selectedAppId, selectedRecordId } = useRuntime();

  if (selectedAppId) {
    const app = client.findApp(selectedAppId);
    if (!app) {
      return (
        <div className="content-empty">
          <p className="content-empty-title">{NOT_SET_UP}</p>
          <p className="content-empty-hint">It is not one of the apps you may run here. Choose one from the menu.</p>
        </div>
      );
    }
    return <PageView app={app} recordId={selectedRecordId ?? undefined} />;
  }

  return (
    <div className="content-empty">
      <p className="content-empty-title">
        {client.menu.length === 0 ? 'Nothing is set up for you here yet' : 'Nothing open'}
      </p>
      <p className="content-empty-hint">
        {client.menu.length === 0
          ? "An admin of this operation sets up its apps and menu in the Console."
          : 'Choose an item from the menu to open it.'}
      </p>
    </div>
  );
}

// Signed-in identity + sign-out; absent entirely in the demo (auth
// unconfigured) posture. Sign-out reloads so boot re-runs the sign-in gate.
function UserMenu() {
  const { session, auth } = useRuntime();
  if (!session) return null;
  return (
    <span className="user-menu">
      <span className="user-name" title={session.email}>{session.name}</span>
      <button
        className="user-signout"
        onClick={() => void auth?.signOut().then(() => window.location.reload())}
      >
        Sign out
      </button>
    </span>
  );
}

// The Runtime shell (CONSOLE_RUNTIME_SPEC §4, M10): solution branding in the
// top bar (end users see the solution, not the platform), a collapsible nav
// driven by the caller's app menu, and the content area. No fallback: the list
// of every openable page an operation with no menu used to show went with apps
// Part 2 step 2 — an empty menu says nothing is set up.
function Nav() {
  return (
    <aside className="side-panel">
      <div className="side-panel-nav">
        <MenuNav />
      </div>
      {/* Platform attribution sits at the edge, under the tenant's own nav —
          the header is the solution's branding, not ours. */}
      <div className="powered-by">Powered by Fluxus</div>
    </aside>
  );
}

function Shell() {
  const { orgName, solutionName, operationName } = useRuntime();
  const [navOpen, setNavOpen] = useState(() => localStorage.getItem(NAV_PREF_KEY) !== 'closed');
  const toggleNav = () => {
    setNavOpen((open) => {
      localStorage.setItem(NAV_PREF_KEY, open ? 'closed' : 'open');
      return !open;
    });
  };

  return (
    <div className="app">
      <header className="app-header">
        <button className="nav-toggle" onClick={toggleNav} aria-label="Toggle navigation" title="Toggle navigation">
          ☰
        </button>
        {/* Identity line: who you work for, then which app you are in. */}
        <span className="app-org">{orgName}</span>
        <span className="app-header-sep">·</span>
        <span className="app-title">{solutionName}</span>
        <span style={{ flex: 1 }} />
        {/* Which business unit's data this app is running on. Not switchable
            yet — one operation per session until an op-user picker lands. */}
        <span className="op-chip" title="Operation">{operationName}</span>
        <NotificationCentre />
        <UserMenu />
      </header>
      <div className="app-body">
        {navOpen && <Nav />}
        <main className="content">
          <ContentArea />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <RuntimeProvider>
      <Shell />
    </RuntimeProvider>
  );
}
