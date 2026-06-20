import { useState } from 'react';
import { useShellState } from '../shell/useShellState';
import { openPage, type FileNode } from '../shell/store';

function flattenPages(nodes: FileNode[]): Array<{ name: string; path: string; folder: string }> {
  const pages: Array<{ name: string; path: string; folder: string }> = [];
  for (const node of nodes) {
    if (node.kind === 'page') {
      pages.push({ name: node.name, path: node.path, folder: '' });
    } else {
      for (const child of flattenPages(node.children)) {
        pages.push({ ...child, folder: child.folder || node.name });
      }
    }
  }
  return pages;
}

function SearchPanelComponent() {
  const { tree } = useShellState(['tree']);
  const [query, setQuery] = useState('');

  const pages = flattenPages(tree);
  const filtered = query.trim()
    ? pages.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : pages;

  return (
    <div className="search-panel">
      <div className="search-input-wrap">
        <input
          className="search-input"
          type="text"
          placeholder="Search pages..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          spellCheck={false}
        />
      </div>
      <div className="search-results">
        {filtered.length === 0 ? (
          <p className="search-empty">No pages found</p>
        ) : (
          filtered.map((p) => (
            <button
              key={p.path}
              className="search-result"
              onClick={() => openPage(p.path)}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
              </svg>
              <span className="search-result-name">{p.name}</span>
              <span className="search-result-folder">{p.folder}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export const css = `
  .search-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .search-input-wrap {
    padding: 8px;
    border-bottom: 1px solid var(--color-border);
    flex-shrink: 0;
  }
  .search-input {
    width: 100%;
    box-sizing: border-box;
    background: rgba(0,0,0,0.25);
    border: 1px solid var(--color-border);
    border-radius: 3px;
    color: var(--color-text);
    font-size: 0.825rem;
    font-family: inherit;
    padding: 5px 8px;
    outline: none;
  }
  .search-input:focus {
    border-color: var(--color-accent);
  }
  .search-results {
    overflow-y: auto;
    flex: 1;
    padding: 4px 0;
  }
  .search-empty {
    margin: 0;
    padding: 12px 12px;
    color: var(--color-text-muted);
    font-size: 0.825rem;
  }
  .search-result {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 12px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text);
    font-size: 0.825rem;
    font-family: inherit;
    text-align: left;
  }
  .search-result:hover {
    background: rgba(255,255,255,0.06);
  }
  .search-result-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .search-result-folder {
    color: var(--color-text-muted);
    font-size: 0.75rem;
    white-space: nowrap;
  }
`;

export const SearchPanel = SearchPanelComponent;
