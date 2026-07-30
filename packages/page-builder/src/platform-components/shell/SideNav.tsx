// The Console's persistent left nav (M16) — rendered from the section
// registry. The frame never changes; only which section set shows (workspace
// vs solution) follows the open scope. Group headings are flat labels.

import { useShellState } from './useShellState';
import { navigateSection } from './router';
import { sectionsForScope } from './sections';

function SideNavComponent() {
  const { solutionId, activeSection } = useShellState(['solutionId', 'activeSection']);
  const sections = sectionsForScope(solutionId !== null);

  let lastGroup: string | undefined;
  return (
    <nav className="side-nav">
      {sections.map((section) => {
        const heading = section.group !== lastGroup ? section.group : undefined;
        lastGroup = section.group;
        return (
          <div key={section.id}>
            {heading && <div className="side-nav-group">{heading}</div>}
            <button
              className={`side-nav-item${activeSection === section.id ? ' active' : ''}${section.group ? ' grouped' : ''}`}
              onClick={() => navigateSection(section.id)}
            >
              {section.label}
            </button>
          </div>
        );
      })}
    </nav>
  );
}

export const css = `
  .side-nav {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 8px 0;
    background: var(--color-sidebar);
    border-right: 1px solid var(--color-border);
    overflow-y: auto;
  }
  .side-nav-group {
    padding: 14px 14px 4px;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--color-text-muted);
  }
  .side-nav-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    cursor: pointer;
    color: var(--color-text);
    padding: 7px 14px;
    font-size: 0.84rem;
    font-family: inherit;
  }
  .side-nav-item.grouped { padding-left: 22px; }
  .side-nav-item:hover { background: rgba(255,255,255,0.04); }
  .side-nav-item.active {
    border-left-color: var(--color-accent);
    background: rgba(255,255,255,0.06);
  }
`;

export const SideNav = SideNavComponent;
