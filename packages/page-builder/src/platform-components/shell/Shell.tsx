import { useShellState } from './useShellState';
import { ActivityBar, css as activityBarCss } from './ActivityBar';
import { HeaderBar, css as headerBarCss } from './HeaderBar';
import { SidebarPanel, css as sidebarPanelCss } from './SidebarPanel';
import { TabBar, css as tabBarCss } from './TabBar';
import { ContentArea, css as contentAreaCss } from './ContentArea';
import { ConsolePanel, css as consolePanelCss } from './ConsolePanel';
import { css as pageEditorCss } from '../page-builder/PageEditor';
import { css as adminViewCss } from '../admin/AdminView';

// Demo-page seeding moved to api.ts (backend stage 2): savePage validates
// against the fetched SDM config, so it must run after initSdmRuntime — not
// at module load.

function ShellComponent() {
  const { activeActivityItem } = useShellState(['activeActivityItem']);

  return (
    <div className="shell">
      <div className="shell-header">
        <HeaderBar />
      </div>
      <div className="shell-body">
        <div className="shell-activity">
          <ActivityBar />
        </div>
        <div
          className="shell-sidebar"
          style={{ width: activeActivityItem ? '240px' : '0' }}
        >
          <SidebarPanel />
        </div>
        <div className="shell-main">
          <TabBar />
          <ContentArea />
          <ConsolePanel />
        </div>
      </div>
    </div>
  );
}

const css = `
  ${activityBarCss}
  ${headerBarCss}
  ${sidebarPanelCss}
  ${tabBarCss}
  ${contentAreaCss}
  ${consolePanelCss}
  ${pageEditorCss}
  ${adminViewCss}

  *, *::before, *::after { box-sizing: border-box; }

  .shell {
    --color-bg:           #1e1e1e;
    --color-sidebar:      #252526;
    --color-activity:     #333333;
    --color-header:       #3c3c3c;
    --color-tab-active:   #1e1e1e;
    --color-tab-inactive: #2d2d2d;
    --color-text:         #cccccc;
    --color-text-muted:   #858585;
    --color-accent:       #0078d4;
    --color-border:       #414141;

    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100vh;
    background: var(--color-bg);
    color: var(--color-text);
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13px;
    overflow: hidden;
  }

  .shell-header {
    height: 40px;
    flex-shrink: 0;
  }

  .shell-body {
    flex: 1;
    display: flex;
    flex-direction: row;
    overflow: hidden;
  }

  .shell-activity {
    flex-shrink: 0;
    width: 48px;
  }

  .shell-sidebar {
    flex-shrink: 0;
    overflow: hidden;
    transition: width 0.15s ease;
  }

  .shell-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }
`;

export const Shell = Object.assign(ShellComponent, { css });
