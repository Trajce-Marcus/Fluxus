// Content area (M16): renders the active section from the registry — one view
// at a time, chosen by the nav/router. Section internals (inner panels, editor
// tabs) are the section's own business.

import { useShellState } from './useShellState';
import { sectionsForScope } from './sections';
import { css as workbenchCss } from '../workbench/WorkbenchView';
import { css as overviewCss } from './OverviewSection';
import { css as solutionSettingsCss } from './SolutionSettingsSection';

function ContentAreaComponent() {
  const { solutionId, activeSection } = useShellState(['solutionId', 'activeSection']);
  const section = sectionsForScope(solutionId !== null).find((s) => s.id === activeSection);

  return (
    <div className="content-area">
      {section ? (
        section.render()
      ) : (
        <div className="content-area-empty">
          <p className="content-empty-hint">Unknown section: {activeSection}</p>
        </div>
      )}
    </div>
  );
}

export const css = `
  ${workbenchCss}
  ${overviewCss}
  ${solutionSettingsCss}

  .content-area {
    flex: 1;
    overflow: hidden;
    background: var(--color-bg);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .content-area > * { flex: 1; min-height: 0; }
  .content-area-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .content-empty-hint {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 0.875rem;
  }
`;

export const ContentArea = ContentAreaComponent;
