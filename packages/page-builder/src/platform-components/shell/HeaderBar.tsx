import { useShellState } from './useShellState';
import { exitSolutionScope } from './store';

function HeaderBarComponent() {
  const { solutionId, solutionName } = useShellState(['solutionId', 'solutionName']);
  return (
    <div className="header-bar">
      <span className="header-logo">Fluxus</span>
      {solutionId ? (
        <div className="header-solution">
          <button className="header-back" title="Back to Solutions" onClick={exitSolutionScope}>← Solutions</button>
          <span className="header-solution-name">{solutionName}</span>
          <span className="header-solution-id admin-mono">{solutionId}</span>
        </div>
      ) : (
        <div className="header-search">
          <svg className="header-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <input
            className="header-search-input"
            type="text"
            placeholder="Search"
            spellCheck={false}
          />
        </div>
      )}
      <div className="header-actions" />
    </div>
  );
}

export const css = `
  .header-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0 1rem;
    height: 100%;
    background: var(--color-header);
    border-bottom: 1px solid var(--color-border);
  }
  .header-logo {
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-text);
    white-space: nowrap;
    width: 80px;
    flex-shrink: 0;
  }
  .header-search {
    flex: 1;
    max-width: 480px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(0,0,0,0.25);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 0 10px;
    height: 26px;
  }
  .header-search-icon {
    color: var(--color-text-muted);
    flex-shrink: 0;
  }
  .header-search-input {
    background: none;
    border: none;
    outline: none;
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: inherit;
    width: 100%;
  }
  .header-search-input::placeholder {
    color: var(--color-text-muted);
  }
  .header-actions {
    width: 80px;
    flex-shrink: 0;
  }
  .header-solution {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .header-back {
    background: rgba(0,0,0,0.25);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    color: var(--color-text);
    cursor: pointer;
    font-size: 0.78rem;
    padding: 3px 10px;
  }
  .header-back:hover { background: rgba(255,255,255,0.06); }
  .header-solution-name { font-size: 0.85rem; font-weight: 600; color: var(--color-text); }
  .header-solution-id { font-size: 0.72rem; color: var(--color-text-muted); }
`;

export const HeaderBar = HeaderBarComponent;
