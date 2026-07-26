import { useState } from 'react';
import { AppProvider, useAppContext } from './context/AppContext';
import { UatLabelsProvider, UatLabelsToggle } from './context/UatLabels';
import { MenuNav } from './components/MenuNav';
import { RecordTypeList } from './components/RecordTypeList';
import { RecordsGrid } from './components/RecordsGrid';
import { RecordView } from './components/RecordView';
import { PagesList } from './components/PagesList';
import { PageView } from './components/PageView';
import { NotificationCentre } from './components/NotificationCentre';
import { client, currentSession, hostAuth } from './host';
import './App.css';

const NAV_PREF_KEY = 'fluxus:sdm:nav-open';

// Selecting a page swaps the whole content area to the rendered page; the
// record grid/view pair stays the Workbench surface and is untouched otherwise.
function ContentArea() {
  const { selectedPage } = useAppContext();

  if (selectedPage) return <PageView path={selectedPage} />;

  return (
    <>
      <div className="panel">
        <RecordsGrid />
      </div>
      <div className="panel">
        <RecordView />
      </div>
    </>
  );
}

// Signed-in identity + sign-out; absent entirely in the demo (auth
// unconfigured) posture. Sign-out reloads so boot re-runs the sign-in gate.
function UserMenu() {
  if (!currentSession) return null;
  return (
    <span className="user-menu">
      <span className="user-name" title={currentSession.email}>{currentSession.name}</span>
      <button
        className="user-signout"
        onClick={() => void hostAuth?.signOut().then(() => window.location.reload())}
      >
        Sign out
      </button>
    </span>
  );
}

// The Runtime shell (CONSOLE_RUNTIME_SPEC §4, M10): solution branding in the
// top bar (end users see the solution, not the platform), a collapsible nav
// driven by the effective menu, and the content area. With a menu effective,
// the record-type list belongs to the Workbench surface only and the pages
// listing retires; without one (demo/adoption posture) the pre-M10 nav —
// record types + pages — is the fallback.
function Nav() {
  const { selectedPage } = useAppContext();
  const hasMenu = client.visibleMenu().length > 0;
  return (
    <aside className="side-panel">
      <div className="side-panel-nav">
        <MenuNav />
        {(!hasMenu || selectedPage === null) && <RecordTypeList />}
        {!hasMenu && <PagesList />}
      </div>
      {/* Platform attribution sits at the edge, under the tenant's own nav —
          the header is the solution's branding, not ours. */}
      <div className="powered-by">Powered by Fluxus</div>
    </aside>
  );
}

function Shell() {
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
        <span className="app-org">{client.orgName}</span>
        <span className="app-header-sep">·</span>
        <span className="app-title">{client.solutionName}</span>
        <span style={{ flex: 1 }} />
        {/* Which business unit's data this app is running on. Not switchable
            yet — one operation per session until memberships land. */}
        <span className="op-chip" title="Operation">{client.operationName}</span>
        <UatLabelsToggle />
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
    <UatLabelsProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </UatLabelsProvider>
  );
}
