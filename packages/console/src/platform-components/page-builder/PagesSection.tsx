// The Pages section (M16) — the Console's one document-editor surface. It owns
// everything editor-shaped the shell used to carry: the page tree / components
// / search panel, the open-page tab strip, the editor and the bottom console.
// Other sections are plain pages; none of this leaks out. Since M17 the panel
// goes into the shell's inner-panel column like every other section's list —
// the tab strip inside it is this section's own affair.

import { useState } from 'react';
import { useShellState } from '../shell/useShellState';
import { InnerPanel } from '../shell/InnerPanel';
import { TabBar, css as tabBarCss } from '../shell/TabBar';
import { ConsolePanel, css as consolePanelCss } from '../shell/ConsolePanel';
import { PageEditor, css as pageEditorCss } from './PageEditor';
import { PageExplorer, css as explorerCss } from './PageExplorer';
import { ComponentsPanel, css as componentsCss } from './ComponentsPanel';
import { SearchPanel, css as searchCss } from './SearchPanel';
import { PageProblems, ProblemSummary, collectPageProblems, css as problemsCss } from './PageProblems';

const PANELS = [
  { id: 'pages', label: 'Pages' },
  { id: 'components', label: 'Components' },
  { id: 'search', label: 'Search' },
] as const;

type PanelId = (typeof PANELS)[number]['id'];

function PagesSectionComponent() {
  const [panel, setPanel] = useState<PanelId>('pages');
  const { activeTab } = useShellState(['activeTab', 'pagesVersion']);
  const problems = collectPageProblems();

  return (
    <div className="pages-section">
      <InnerPanel
        title="Pages"
        flush
        head={
          <div className="pages-panel-tabs">
            {PANELS.map((p) => (
              <button
                key={p.id}
                className={`pages-panel-tab${panel === p.id ? ' active' : ''}`}
                onClick={() => setPanel(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="pages-panel-body">
          {panel === 'pages' && <PageExplorer />}
          {panel === 'components' && <ComponentsPanel />}
          {panel === 'search' && <SearchPanel />}
        </div>
      </InnerPanel>
      <div className="pages-main">
        <TabBar />
        <div className="pages-editor">
          {activeTab ? (
            <PageEditor pagePath={activeTab} />
          ) : (
            <div className="pages-empty">
              <p className="pages-empty-hint">Select a page from the tree to open it</p>
            </div>
          )}
        </div>
        <ConsolePanel summary={<ProblemSummary problems={problems} />}>
          <PageProblems problems={problems} />
        </ConsolePanel>
      </div>
    </div>
  );
}

export const css = `
  ${explorerCss}
  ${searchCss}
  ${componentsCss}
  ${tabBarCss}
  ${consolePanelCss}
  ${pageEditorCss}
  ${problemsCss}

  .pages-section {
    display: flex;
    flex-direction: row;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .pages-panel-tabs {
    display: flex;
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-border);
  }
  .pages-panel-tab {
    flex: 1;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    color: var(--color-text-muted);
    font-size: 0.72rem;
    font-weight: 600;
    font-family: inherit;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 8px 4px 6px;
  }
  .pages-panel-tab:hover { color: var(--color-text); }
  .pages-panel-tab.active { color: var(--color-text); border-bottom-color: var(--color-accent); }
  .pages-panel-body { flex: 1; overflow-y: auto; overflow-x: hidden; }
  .pages-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }
  .pages-editor {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    background: var(--color-bg);
  }
  .pages-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .pages-empty-hint {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }
`;

export const PagesSection = PagesSectionComponent;
