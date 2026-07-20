import { useShellState } from './useShellState';
import { PageExplorer, css as explorerCss } from '../page-builder/PageExplorer';
import { SearchPanel, css as searchCss } from '../page-builder/SearchPanel';
import { ComponentsPanel, css as componentsCss } from '../page-builder/ComponentsPanel';
import { AdminSidebar, css as adminSidebarCss } from '../admin/AdminSidebar';
import { SdmSidebar, css as sdmSidebarCss } from '../sdm-builder/SdmSidebar';

const TITLES: Record<string, string> = {
  explorer: 'Pages',
  search: 'Search',
  components: 'Components',
  sdm: 'Simple Data Model',
  workspace: 'Workspace',
};

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
        {activeActivityItem === 'sdm' && <SdmSidebar />}
        {activeActivityItem === 'workspace' && <AdminSidebar />}
      </div>
    </div>
  );
}

export const css = `
  ${explorerCss}
  ${searchCss}
  ${componentsCss}
  ${sdmSidebarCss}

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
