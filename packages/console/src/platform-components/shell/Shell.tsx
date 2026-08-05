import { useEffect } from 'react';
import { useShellState } from './useShellState';
import { HeaderBar, css as headerBarCss } from './HeaderBar';
import { SideNav, css as sideNavCss } from './SideNav';
import { InnerPanelSlot, css as innerPanelCss } from './InnerPanel';
import { ContentArea, css as contentAreaCss } from './ContentArea';
import { initRouter } from './router';
import { css as pagesSectionCss } from '../page-builder/PagesSection';
import { css as adminViewCss } from '../admin/AdminView';
import { css as sdmViewCss } from '../sdm-builder/SdmView';

// Page bootstrapping moved to api.ts (backend stage 2): savePage validates
// against the fetched SDM config, so it must run after initSdmRuntime — not
// at module load.

function ShellComponent() {
  const { scopeVersion } = useShellState(['scopeVersion']);

  // Hash routing (M16): boot applies the landing hash, then hash and state
  // stay in step both ways. Idempotent across StrictMode double-mount is not
  // needed — subscribe/listen once for the app's life.
  useEffect(() => { initRouter(); }, []);

  return (
    <div className="shell">
      <div className="shell-header">
        <HeaderBar />
      </div>
      {/* Keyed by scopeVersion: opening/switching a solution (or an SDM config
          save) remounts the nav + main so every view re-reads the fresh
          design snapshot (sdmClient/pageRuntime). */}
      <div className="shell-body" key={scopeVersion}>
        <div className="shell-nav">
          <SideNav />
        </div>
        {/* The active section's list, when it has one (M17) — the section
            portals into this column; empty sections collapse it. */}
        <InnerPanelSlot />
        <div className="shell-main">
          <ContentArea />
        </div>
      </div>
    </div>
  );
}

const css = `
  ${headerBarCss}
  ${sideNavCss}
  ${innerPanelCss}
  ${contentAreaCss}
  ${pagesSectionCss}
  ${adminViewCss}
  ${sdmViewCss}

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

  .shell-nav {
    flex-shrink: 0;
    width: 200px;
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
