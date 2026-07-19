import { AppProvider, useAppContext } from './context/AppContext';
import { UatLabelsProvider, UatLabelsToggle } from './context/UatLabels';
import { RecordTypeList } from './components/RecordTypeList';
import { RecordsGrid } from './components/RecordsGrid';
import { RecordView } from './components/RecordView';
import { PagesList } from './components/PagesList';
import { PageView } from './components/PageView';
import { NotificationCentre } from './components/NotificationCentre';
import './App.css';

// Selecting a page swaps the whole content area to the rendered page; the
// record grid/view pair stays the default and is untouched otherwise.
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

export default function App() {
  return (
    <UatLabelsProvider>
      <AppProvider>
        <div className="app">
          <header className="app-header">
            Fluxus SDM
            <span className="app-header-sub">Aber sample</span>
            <span style={{ flex: 1 }} />
            <UatLabelsToggle />
            <NotificationCentre />
          </header>
          <div className="app-body">
            <aside className="side-panel">
              <RecordTypeList />
              <PagesList />
            </aside>
            <main className="content">
              <ContentArea />
            </main>
          </div>
        </div>
      </AppProvider>
    </UatLabelsProvider>
  );
}
