import { SESSION_COMPONENTS } from './sessionComponents';

function ComponentsPanelComponent() {
  return (
    <div className="components-panel">
      <ul className="comp-list">
        {SESSION_COMPONENTS.map(({ name, version }) => (
          <li key={name} className="comp-item">
            <span className="comp-name">{name}</span>
            <span className="comp-version">v{version}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const css = `
  .components-panel {
    padding: 4px 0;
  }
  .comp-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .comp-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 12px;
    font-size: 0.825rem;
    color: var(--color-text);
    gap: 8px;
  }
  .comp-item:hover {
    background: rgba(255,255,255,0.05);
  }
  .comp-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .comp-version {
    font-size: 0.72rem;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }
`;

export const ComponentsPanel = ComponentsPanelComponent;
