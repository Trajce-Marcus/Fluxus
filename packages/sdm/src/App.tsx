import { AppProvider } from './context/AppContext';
import { RecordTypeList } from './components/RecordTypeList';
import { RecordsGrid } from './components/RecordsGrid';
import { RecordView } from './components/RecordView';
import './App.css';

export default function App() {
  return (
    <AppProvider>
      <div className="app">
        <header className="app-header">
          Fluxus SDM
          <span className="app-header-sub">Aber sample</span>
        </header>
        <div className="app-body">
          <aside className="side-panel">
            <RecordTypeList />
          </aside>
          <main className="content">
            <div className="panel">
              <RecordsGrid />
            </div>
            <div className="panel">
              <RecordView />
            </div>
          </main>
        </div>
      </div>
    </AppProvider>
  );
}
