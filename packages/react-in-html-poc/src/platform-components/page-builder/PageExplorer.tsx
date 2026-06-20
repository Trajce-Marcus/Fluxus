import { useState, useEffect, useRef } from 'react';
import { openPage, closeTab, shellStore, type FileNode } from '../shell/store';
import { useShellState } from '../shell/useShellState';
import { listPagePaths, savePage, pageExists, deletePage } from './persistence';
import { evictLayoutEditorStore } from './layout-editor/store';

// ── Tree building ────────────────────────────────────────────────────────────

const STANDARD_FOLDERS = ['pages', 'templates'];

function buildTree(paths: string[]): FileNode[] {
  const folderMap = new Map<string, FileNode[]>();

  for (const path of paths) {
    const slash = path.indexOf('/');
    if (slash === -1) continue;
    const folder = path.slice(0, slash);
    const name = path.slice(slash + 1);
    if (!folderMap.has(folder)) folderMap.set(folder, []);
    folderMap.get(folder)!.push({ kind: 'page', name, path });
  }

  // Standard folders always appear, even when empty
  const result: FileNode[] = [];
  for (const folder of STANDARD_FOLDERS) {
    result.push({
      kind: 'folder',
      name: folder,
      children: folderMap.get(folder) ?? [],
    });
    folderMap.delete(folder);
  }

  // Any extra folders from storage
  for (const [folder, children] of folderMap) {
    result.push({ kind: 'folder', name: folder, children });
  }

  return result;
}

function refreshTree(): void {
  shellStore.set((prev) => ({ ...prev, tree: buildTree(listPagePaths()) }));
}

// ── New page inline input ────────────────────────────────────────────────────

interface NewPageInputProps {
  folder: string;
  onDone: () => void;
}

function NewPageInput({ folder, onDone }: NewPageInputProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) { setError('Name is required'); return; }
    if (trimmed.includes('/')) { setError('Name cannot contain /'); return; }
    const path = `${folder}/${trimmed}`;
    if (pageExists(path)) { setError('A page with that name already exists'); return; }
    savePage(path, { slots: {} });
    refreshTree();
    onDone();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') onDone();
  }

  return (
    <div className="new-page-wrap">
      <div className="new-page-row">
        <span className="tree-chevron-spacer" />
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="tree-icon">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
        </svg>
        <input
          ref={inputRef}
          className="new-page-input"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(''); }}
          onKeyDown={onKeyDown}
          onBlur={onDone}
          spellCheck={false}
          placeholder="Page name"
        />
      </div>
      {error && <p className="new-page-error">{error}</p>}
    </div>
  );
}

// ── Tree nodes ───────────────────────────────────────────────────────────────

function FolderNode({ node }: { node: Extract<FileNode, { kind: 'folder' }> }) {
  const [expanded, setExpanded] = useState(true);
  const [creating, setCreating] = useState(false);

  const ICON_OPEN  = 'M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z';
  const ICON_CLOSED = 'M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z';

  return (
    <div className="tree-folder">
      <div className="tree-folder-header">
        <button className="tree-row tree-folder-row" onClick={() => setExpanded((v) => !v)}>
          <svg
            className="tree-chevron"
            width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            <path d="M3 2l4 3-4 3V2z" />
          </svg>
          <svg className="tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d={expanded ? ICON_OPEN : ICON_CLOSED} />
          </svg>
          <span className="tree-name">{node.name}</span>
        </button>
        <button
          className="tree-add-btn"
          title={`New page in ${node.name}`}
          onClick={(e) => { e.stopPropagation(); setExpanded(true); setCreating(true); }}
        >
          +
        </button>
      </div>

      {expanded && (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode key={child.kind === 'page' ? child.path : child.name} node={child} />
          ))}
          {creating && (
            <NewPageInput folder={node.name} onDone={() => setCreating(false)} />
          )}
          {!creating && node.children.length === 0 && (
            <p className="tree-empty">No pages yet</p>
          )}
        </div>
      )}
    </div>
  );
}

function PageNode({ node }: { node: Extract<FileNode, { kind: 'page' }> }) {
  const { activeTab } = useShellState(['activeTab']);
  const [pendingDelete, setPendingDelete] = useState(false);

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!pendingDelete) {
      setPendingDelete(true);
      return;
    }
    closeTab(node.path);
    deletePage(node.path);
    evictLayoutEditorStore(node.path);
    refreshTree();
  }

  return (
    <div className="tree-page-wrap">
      <button
        className={`tree-row tree-page-row${activeTab === node.path ? ' active' : ''}`}
        onClick={() => { setPendingDelete(false); openPage(node.path); }}
      >
        <span className="tree-chevron-spacer" />
        <svg className="tree-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
        </svg>
        <span className="tree-name">{node.name}</span>
      </button>
      <button
        className={`tree-delete-btn${pendingDelete ? ' tree-delete-btn--confirm' : ''}`}
        title={pendingDelete ? 'Click again to confirm' : 'Delete page'}
        onClick={handleDelete}
        onBlur={() => setPendingDelete(false)}
      >
        {pendingDelete ? '!' : '✕'}
      </button>
    </div>
  );
}

function TreeNode({ node }: { node: FileNode }) {
  return node.kind === 'folder' ? <FolderNode node={node} /> : <PageNode node={node} />;
}

// ── Explorer root ────────────────────────────────────────────────────────────

function PageExplorerComponent() {
  const { tree } = useShellState(['tree']);

  useEffect(() => {
    refreshTree();
  }, []);

  return (
    <div className="page-explorer">
      {tree.map((node) => (
        <TreeNode key={node.kind === 'page' ? node.path : node.name} node={node} />
      ))}
    </div>
  );
}

export const css = `
  .page-explorer {
    padding: 4px 0;
    user-select: none;
  }
  .tree-folder-header {
    display: flex;
    align-items: center;
    position: relative;
  }
  .tree-folder-header .tree-folder-row {
    flex: 1;
  }
  .tree-add-btn {
    display: none;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin-right: 6px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-muted);
    font-size: 16px;
    line-height: 1;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .tree-folder-header:hover .tree-add-btn {
    display: flex;
  }
  .tree-add-btn:hover {
    background: rgba(255,255,255,0.1);
    color: var(--color-text);
  }
  .tree-page-wrap {
    display: flex;
    align-items: center;
    position: relative;
  }
  .tree-page-wrap .tree-page-row {
    flex: 1;
    min-width: 0;
  }
  .tree-delete-btn {
    display: none;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin-right: 6px;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-muted);
    font-size: 11px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .tree-page-wrap:hover .tree-delete-btn {
    display: flex;
  }
  .tree-delete-btn:hover {
    background: rgba(255,255,255,0.1);
    color: var(--color-text);
  }
  .tree-delete-btn--confirm {
    display: flex;
    color: #f48771;
    font-weight: 700;
  }
  .tree-delete-btn--confirm:hover {
    background: rgba(244,135,113,0.15);
    color: #f48771;
  }
  .tree-row {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 3px 8px;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    cursor: pointer;
    color: var(--color-text);
    font-size: 0.825rem;
    font-family: inherit;
    text-align: left;
  }
  .tree-row:hover {
    background: rgba(255,255,255,0.05);
  }
  .tree-page-row.active {
    background: rgba(0,120,212,0.15);
    border-left-color: var(--color-accent);
  }
  .tree-chevron {
    flex-shrink: 0;
    color: var(--color-text-muted);
    transition: transform 0.12s;
  }
  .tree-chevron-spacer {
    display: inline-block;
    width: 10px;
    flex-shrink: 0;
  }
  .tree-icon {
    flex-shrink: 0;
    color: var(--color-text-muted);
  }
  .tree-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tree-children {
    padding-left: 16px;
  }
  .tree-empty {
    margin: 0;
    padding: 4px 8px;
    font-size: 0.775rem;
    color: var(--color-text-muted);
    font-style: italic;
  }
  .new-page-wrap {
    padding: 2px 8px;
  }
  .new-page-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .new-page-input {
    flex: 1;
    background: var(--color-bg);
    border: 1px solid var(--color-accent);
    border-radius: 2px;
    color: var(--color-text);
    font-size: 0.825rem;
    font-family: inherit;
    padding: 1px 4px;
    outline: none;
    min-width: 0;
  }
  .new-page-error {
    margin: 2px 0 0 18px;
    font-size: 0.72rem;
    color: #f48771;
  }
`;

export const PageExplorer = PageExplorerComponent;
