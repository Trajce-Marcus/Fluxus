import { useShellState } from './useShellState';
import { PageExplorer, css as explorerCss } from '../page-builder/PageExplorer';
import { SearchPanel, css as searchCss } from '../page-builder/SearchPanel';
import { ComponentsPanel, css as componentsCss } from '../page-builder/ComponentsPanel';

const TITLES: Record<string, string> = {
  explorer: 'Pages',
  search: 'Search',
  components: 'Components',
  sdm: 'Simple Data Model',
};

function SdmPlaceholder() {
  return (
    <div className="sdm-placeholder">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" className="sdm-placeholder-icon">
        <path d="M20 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 2v3H5V5h15zm-5 14h-5v-9h5v9zm-7 0H5v-9h3v9zm12 0h-3v-9h3v9z" />
      </svg>
      <p className="sdm-placeholder-label">Simple Data Model</p>
      <p className="sdm-placeholder-sub">Coming soon</p>
    </div>
  );
}

function SidebarPanelComponent() {
  const { activeActivityItem } = useShellState(['activeActivityItem']);
  if (!activeActivityItem) return null;

  return (
    <div className="sidebar-panel">
      <div className="sidebar-title">{TITLES[activeActivityItem]}</div>
      <div className="sidebar-content">
        {activeActivityItem === 'explorer' && <PageExplorer />}
        {activeActivityItem === 'search' && <SearchPanel />}
        {activeActivityItem === 'components' && <ComponentsPanel />}
        {activeActivityItem === 'sdm' && <SdmPlaceholder />}
      </div>
    </div>
  );
}

export const css = `
  ${explorerCss}
  ${searchCss}
  ${componentsCss}

  .sidebar-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--color-sidebar);
    border-right: 1px solid var(--color-border);
    overflow: hidden;
  }
  .sidebar-title {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-muted);
    padding: 10px 12px 8px;
    flex-shrink: 0;
  }
  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .sdm-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding-top: 48px;
    gap: 8px;
  }
  .sdm-placeholder-icon {
    opacity: 0.2;
    color: var(--color-text);
  }
  .sdm-placeholder-label {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text-muted);
  }
  .sdm-placeholder-sub {
    margin: 0;
    font-size: 0.75rem;
    color: var(--color-text-muted);
    opacity: 0.6;
  }
`;

export const SidebarPanel = SidebarPanelComponent;
