// Sidebar "Pages" section (approved workbench MVP slice, 2026-07-19): lists
// the scope's published pages from the client's page snapshot; clicking one
// swaps the content area to the rendered page (@fluxus/page-runtime). The
// first step of workbench → Runtime app.

import { useAppContext } from '../context/AppContext';
import { ComponentLabel } from '../context/UatLabels';

export function PagesList() {
  const { pagePaths, selectedPage, selectPage } = useAppContext();

  if (pagePaths.length === 0) return null;

  return (
    <div style={{ position: 'relative' }}>
      <ComponentLabel name="PagesList" />
      <div style={{
        padding: '12px 16px',
        fontSize: 11,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: '#64748b',
        borderTop: '1px solid #e2e8f0',
        borderBottom: '1px solid #e2e8f0',
      }}>
        Pages
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
        {pagePaths.map(path => (
          <li
            key={path}
            onClick={() => selectPage(path)}
            style={{
              padding: '8px 16px',
              cursor: 'pointer',
              background: selectedPage === path ? '#eff6ff' : 'transparent',
              color: selectedPage === path ? '#1d4ed8' : '#0f172a',
              fontWeight: selectedPage === path ? 600 : 400,
              borderLeft: selectedPage === path ? '3px solid #2563eb' : '3px solid transparent',
            }}
          >
            {path}
          </li>
        ))}
      </ul>
    </div>
  );
}
