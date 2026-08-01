import { useState } from 'react';
import { RuntimeProvider, useRuntime } from './context/RuntimeContext';
import { MenuNav } from './components/MenuNav';
import { PagesList } from './components/PagesList';
import { PageView } from './components/PageView';
import { NotificationCentre } from './components/NotificationCentre';
import { client } from './host';
import './App.css';

const NAV_PREF_KEY = 'fluxus:sdm:nav-open';

// The Runtime app renders published pages, and nothing else (§4, M15). The
// workbench — raw records, arbitrary activity runs, CSV import, the schema
// navigator — is implementer work and lives in the Console now, so an
// operation whose solution has no published pages shows an empty app. That is
// the design, not a gap: the escape hatch is gone deliberately.
function ContentArea() {
  const { selectedPage, pagePaths } = useRuntime();

  if (selectedPage) return <PageView path={selectedPage} />;

  return (
    <div className="content-empty">
      <p className="content-empty-title">
        {pagePaths.length === 0 ? 'Nothing published yet' : 'Nothing open'}
      </p>
      <p className="content-empty-hint">
        {pagePaths.length === 0
          ? 'This app has no published pages. Publish one from the Console to see it here.'
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
// driven by the effective menu, and the content area. The pages listing is the
// no-menu fallback only, so an unconfigured demo operation is still navigable
// — adoption posture.
function Nav() {
  const hasMenu = client.visibleMenu().length > 0;
  return (
    <aside className="side-panel">
      <div className="side-panel-nav">
        <MenuNav />
        {!hasMenu && <PagesList />}
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
            yet — one operation per session until memberships land. */}
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
