import { shellStore, closeTab } from './store';
import { useShellState } from './useShellState';

function tabLabel(path: string): string {
  return path.split('/').pop() ?? path;
}

function TabBarComponent() {
  const { openTabs, activeTab } = useShellState(['openTabs', 'activeTab']);

  return (
    <div className="tab-bar">
      {openTabs.map((path) => (
        <div
          key={path}
          className={`tab${activeTab === path ? ' active' : ''}`}
          onClick={() => shellStore.set((prev) => ({ ...prev, activeTab: path }))}
        >
          <span className="tab-label">{tabLabel(path)}</span>
          <button
            className="tab-close"
            title="Close"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(path);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export const css = `
  .tab-bar {
    display: flex;
    flex-direction: row;
    overflow-x: auto;
    background: var(--color-bg);
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
    height: 35px;
    scrollbar-width: none;
  }
  .tab-bar::-webkit-scrollbar { display: none; }
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px 0 14px;
    min-width: 100px;
    max-width: 180px;
    height: 35px;
    cursor: pointer;
    background: var(--color-tab-inactive);
    border-right: 1px solid var(--color-border);
    border-top: 2px solid transparent;
    color: var(--color-text-muted);
    font-size: 0.8rem;
    flex-shrink: 0;
    box-sizing: border-box;
    user-select: none;
  }
  .tab:hover {
    background: rgba(255,255,255,0.04);
    color: var(--color-text);
  }
  .tab.active {
    background: var(--color-tab-active);
    color: var(--color-text);
    border-top-color: var(--color-accent);
  }
  .tab-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    border: none;
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 10px;
    flex-shrink: 0;
    padding: 0;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .tab:hover .tab-close,
  .tab.active .tab-close {
    opacity: 1;
  }
  .tab-close:hover {
    background: rgba(255,255,255,0.12);
    color: var(--color-text);
  }
`;

export const TabBar = TabBarComponent;
