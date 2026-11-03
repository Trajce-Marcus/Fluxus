// The app menu composer (APPS_AND_INSTANCES §2.5): what Runtime users see,
// items pointing at apps in the operation's apps list, in groups one level
// deep. No roles and no names on a leaf — a leaf shows its app's name, and a
// user sees only the leaves whose app they may run (the server builds each
// user's menu). Controlled: the owner holds the menu and persists it;
// validation stays with the save.
//
// Three columns (M18, 2026-08-01): tree | properties | preview. The tree is one
// row per item with drag-and-drop ordering, the selected row's fields are
// edited beside it, and the preview shows the navigation a user holding a
// chosen set of roles would see.

import { useState } from 'react';
import { isMenuGroup, type App, type MenuGroup, type MenuItem, type MenuLeaf } from '@fluxus/client';

interface MenuItemsEditorProps {
  menu: MenuItem[];
  onChange: (menu: MenuItem[]) => void;
  /** The operation's apps list — what a leaf may point at. */
  apps: App[];
  roles: { id: string; name: string }[];
}

/** Where a dragged row lands relative to the row it is dropped on. */
type DropSpot = 'before' | 'after' | 'inside';

function newId(): string {
  return crypto.randomUUID();
}

/** Leaves that point at nothing yet, or at an expired app (§3.2). The server
 *  refuses these; said here rather than after a round trip. An empty group is
 *  fine — one is made before it is filled, and it shows to nobody until it
 *  has a leaf. */
export function menuProblems(menu: MenuItem[], apps: App[] = []): { id: string; fix: string }[] {
  const expired = new Set(apps.filter((a) => a.status === 'expired').map((a) => a.id));
  const leaves = menu.flatMap((it) => (isMenuGroup(it) ? it.items : [it]));
  return leaves.flatMap((l) => (!l.appId ? [{ id: l.id, fix: 'pick its app' }] : expired.has(l.appId) ? [{ id: l.id, fix: 'remove it — its app has expired' }] : []));
}

/** The item with this id, and the group holding it (null when top level). */
function locate(items: MenuItem[], id: string): { item: MenuItem; parent: MenuGroup | null } | null {
  for (const it of items) {
    if (it.id === id) return { item: it, parent: null };
    if (isMenuGroup(it)) {
      for (const child of it.items) if (child.id === id) return { item: child, parent: it };
    }
  }
  return null;
}

/** Remove an item by id, returning the new tree and the item removed. */
function extract(items: MenuItem[], id: string): { tree: MenuItem[]; removed: MenuItem | null } {
  let removed: MenuItem | null = null;
  const tree = items
    .filter((it) => {
      if (it.id !== id) return true;
      removed = it;
      return false;
    })
    .map((it) => {
      if (!isMenuGroup(it)) return it;
      const kept = it.items.filter((c) => {
        if (c.id !== id) return true;
        removed = c;
        return false;
      });
      return kept.length === it.items.length ? it : { ...it, items: kept };
    });
  return { tree, removed };
}

export function MenuItemsEditor({ menu, onChange, apps, roles }: MenuItemsEditorProps) {
  const items = menu;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; spot: DropSpot } | null>(null);
  /** Which roles the preview renders for. Empty = an unassigned user. */
  const [viewRoles, setViewRoles] = useState<string[]>(() => roles.map((r) => r.id));

  const appById = new Map(apps.map((a) => [a.id, a]));
  const found = selectedId ? locate(items, selectedId) : null;
  const selected = found?.item ?? null;
  // An app is on the menu at most once (§2.5), so a leaf offers only the apps
  // no other leaf points at.
  const placed = new Set(items.flatMap((it) => (isMenuGroup(it) ? it.items : [it])).map((l) => l.appId));

  function replace(id: string, next: MenuItem) {
    onChange(items.map((it) => {
      if (it.id === id) return next;
      if (!isMenuGroup(it)) return it;
      return { ...it, items: it.items.map((c) => (c.id === id ? (next as MenuLeaf) : c)) };
    }));
  }

  function remove(id: string) {
    onChange(extract(items, id).tree);
    if (selectedId === id) setSelectedId(null);
  }

  function firstFreeApp(): string {
    return apps.find((a) => a.status === 'active' && !placed.has(a.id))?.id ?? '';
  }

  function addLeaf() {
    const leaf: MenuLeaf = { id: newId(), appId: firstFreeApp() };
    onChange([...items, leaf]);
    setSelectedId(leaf.id);
  }

  function addGroup() {
    const group: MenuGroup = { id: newId(), label: 'New group', items: [] };
    onChange([...items, group]);
    setSelectedId(group.id);
  }

  function addChild(groupId: string) {
    const child: MenuLeaf = { id: newId(), appId: firstFreeApp() };
    onChange(items.map((it) => (it.id === groupId && isMenuGroup(it) ? { ...it, items: [...it.items, child] } : it)));
    setSelectedId(child.id);
  }

  /** Move `id` relative to `targetId`. One nesting level only: a group cannot
   *  move into a group, so those drops are refused rather than flattened. */
  function move(id: string, targetId: string, spot: DropSpot) {
    if (id === targetId) return;
    const source = locate(items, id);
    const target = locate(items, targetId);
    if (!source || !target) return;

    const dragging = source.item;
    if (isMenuGroup(dragging) && (spot === 'inside' || target.parent !== null)) return;
    if (spot === 'inside' && !isMenuGroup(target.item)) return;

    const { tree, removed } = extract(items, id);
    if (!removed) return;

    if (spot === 'inside') {
      onChange(tree.map((it) => (it.id === targetId && isMenuGroup(it) ? { ...it, items: [...it.items, removed as MenuLeaf] } : it)));
      return;
    }

    // Into the group holding the target row, or at top level.
    if (target.parent) {
      const parentId = target.parent.id;
      onChange(tree.map((it) => {
        if (it.id !== parentId || !isMenuGroup(it)) return it;
        const children = [...it.items];
        const at = children.findIndex((c) => c.id === targetId);
        children.splice(spot === 'before' ? at : at + 1, 0, removed as MenuLeaf);
        return { ...it, items: children };
      }));
      return;
    }
    const top = [...tree];
    const at = top.findIndex((it) => it.id === targetId);
    top.splice(spot === 'before' ? at : at + 1, 0, removed);
    onChange(top);
  }

  /** Drop position from where the pointer sits in the row: the middle band of a
   *  group row means "into the group", the edges mean before/after. */
  function spotFor(e: React.DragEvent, target: MenuItem): DropSpot {
    const box = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - box.top) / box.height;
    if (isMenuGroup(target) && y > 0.3 && y < 0.7) return 'inside';
    return y < 0.5 ? 'before' : 'after';
  }

  const leafName = (l: MenuLeaf) => appById.get(l.appId)?.label ?? (l.appId ? '(not an app here)' : '(no app)');

  function row(it: MenuItem, child: boolean) {
    const marker = dropTarget && dropTarget.id === it.id ? ` drop-${dropTarget.spot}` : '';
    return (
      <div
        key={it.id}
        className={`menu-row${child ? ' child' : ''}${selectedId === it.id ? ' active' : ''}${marker}`}
        draggable
        onClick={() => setSelectedId(it.id)}
        onDragStart={() => setDragId(it.id)}
        onDragEnd={() => { setDragId(null); setDropTarget(null); }}
        onDragOver={(e) => {
          if (!dragId || dragId === it.id) return;
          e.preventDefault();
          setDropTarget({ id: it.id, spot: spotFor(e, it) });
        }}
        onDragLeave={() => setDropTarget((cur) => (cur?.id === it.id ? null : cur))}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId) move(dragId, it.id, spotFor(e, it));
          setDragId(null);
          setDropTarget(null);
        }}
      >
        {isMenuGroup(it) ? (
          <>
            <span className="menu-row-label">{it.label || '(no name)'}</span>
            <span className="menu-row-tag">group</span>
          </>
        ) : (
          <>
            <span className="menu-row-label">{leafName(it)}</span>
            {appById.get(it.appId)?.status === 'expired' ? (
              // Its app no longer runs; the save is refused until it goes.
              <span className="menu-row-page problem" title="Remove it — its app has expired">expired</span>
            ) : appById.get(it.appId) ? (
              <span className="menu-row-page">{appById.get(it.appId)!.pageId}</span>
            ) : (
              // Not a warning about style — the save will be refused.
              <span className="menu-row-page problem" title="Pick its app">opens nothing</span>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="menu-composer">
      <div className="menu-tree">
        <div className="menu-col-head">
          <span>Items</span>
          <span className="menu-col-actions">
            <button className="panel-btn" onClick={addLeaf}>Add item</button>
            <button className="panel-btn" onClick={addGroup}>Add group</button>
          </span>
        </div>
        <div className="menu-tree-body">
          {items.length === 0 && <p className="admin-muted">No items yet.</p>}
          {items.map((it) => (
            <div key={it.id}>
              {row(it, false)}
              {isMenuGroup(it) && (
                <div className="menu-children">
                  {it.items.map((c) => row(c, true))}
                  <button className="admin-link" onClick={() => addChild(it.id)}>+ item in group</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="menu-props">
        <div className="menu-col-head"><span>Properties</span></div>
        {!selected ? (
          <p className="admin-muted">Select an item.</p>
        ) : (
          <div className="menu-props-body">
            {isMenuGroup(selected) ? (
              <label className="admin-field">
                <span>Group name</span>
                <input value={selected.label} onChange={(e) => replace(selected.id, { ...selected, label: e.target.value })} />
              </label>
            ) : (
              <label className="admin-field">
                <span>App</span>
                <select value={selected.appId} onChange={(e) => replace(selected.id, { ...selected, appId: e.target.value })}>
                  <option value="">(no app)</option>
                  {apps.filter((a) => a.id === selected.appId || (a.status === 'active' && !placed.has(a.id))).map((a) => (
                    <option key={a.id} value={a.id}>{a.label}{a.status === 'expired' ? ' (expired)' : ''}</option>
                  ))}
                </select>
                <span className="admin-hint">The item shows the app's name, to those who may run it.</span>
              </label>
            )}
            <div className="admin-row">
              <button className="admin-link" onClick={() => remove(selected.id)}>Remove</button>
            </div>
          </div>
        )}
      </div>

      <div className="menu-preview-pane">
        <div className="menu-col-head"><span>Preview</span></div>
        <div className="menu-view-roles">
          <div className="menu-view-roles-head">
            <span>View as roles</span>
            <span className="menu-col-actions">
              <button className="panel-btn" onClick={() => setViewRoles(roles.map((r) => r.id))}>All</button>
              <button className="panel-btn" onClick={() => setViewRoles([])}>None</button>
            </span>
          </div>
          {roles.length === 0 ? (
            <span className="admin-muted">No roles declared.</span>
          ) : roles.map((r) => (
            <label key={r.id} className="menu-role">
              <input
                type="checkbox"
                checked={viewRoles.includes(r.id)}
                onChange={() => setViewRoles((cur) => (cur.includes(r.id) ? cur.filter((x) => x !== r.id) : [...cur, r.id]))}
              />
              <span>{r.name}</span>
            </label>
          ))}
        </div>
        <EffectiveMenu menu={items} apps={appById} viewRoles={viewRoles} />
      </div>
    </div>
  );
}

/** The navigation as a user holding `viewRoles` would see it — the rule the
 *  server applies (`apps.user`): a leaf shows if its app lists a held role; a
 *  group shows if it keeps one leaf. */
function EffectiveMenu({ menu, apps, viewRoles }: { menu: MenuItem[]; apps: Map<string, App>; viewRoles: string[] }) {
  const held = new Set(viewRoles);
  const runs = (l: MenuLeaf) => apps.get(l.appId)?.status === 'active' && (apps.get(l.appId)?.roleIds ?? []).some((r) => held.has(r));
  const visible = menu.flatMap((it): MenuItem[] => {
    if (!isMenuGroup(it)) return runs(it) ? [it] : [];
    const kept = it.items.filter(runs);
    return kept.length > 0 ? [{ ...it, items: kept }] : [];
  });

  return (
    <div className="menu-nav">
      {visible.length === 0 ? (
        <p className="admin-muted">Nothing visible with these roles.</p>
      ) : visible.map((it) => (
        <div key={it.id}>
          {isMenuGroup(it) ? (
            <>
              <div className="menu-nav-item group">{it.label}</div>
              {it.items.map((c) => <div key={c.id} className="menu-nav-item child">{apps.get(c.appId)?.label}</div>)}
            </>
          ) : (
            <div className="menu-nav-item">{apps.get(it.appId)?.label}</div>
          )}
        </div>
      ))}
    </div>
  );
}

export const css = `
  .menu-composer {
    display: flex;
    gap: 12px;
    align-items: stretch;
    min-height: 320px;
  }
  .menu-tree, .menu-props, .menu-preview-pane {
    border: 1px solid var(--color-border);
    border-radius: 6px;
    background: var(--color-sidebar);
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .menu-tree { flex: 0 0 300px; }
  .menu-props { flex: 0 0 280px; }
  .menu-preview-pane { flex: 1; }
  .menu-col-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--color-border);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
  }
  .menu-col-actions { display: flex; gap: 6px; }
  .menu-tree-body { padding: 6px; overflow-y: auto; }
  .menu-props-body { padding: 10px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }

  .menu-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: grab;
    font-size: 0.82rem;
  }
  .menu-row:hover { background: rgba(255,255,255,0.05); }
  .menu-row.active { background: rgba(255,255,255,0.08); border-color: var(--color-border); }
  .menu-row.child { margin-left: 14px; }
  .menu-row-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu-row-page, .menu-row-tag, .menu-row-roles {
    font-size: 0.7rem;
    color: var(--color-text-muted);
    white-space: nowrap;
  }
  .menu-row-page { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .menu-row-page.problem { color: #fca5a5; font-family: inherit; }
  .menu-row-roles.none { color: #e0a0a0; }
  /* Drop indicators: a line where the row will land, a box for "into a group". */
  .menu-row.drop-before { box-shadow: inset 0 2px 0 var(--color-accent); }
  .menu-row.drop-after { box-shadow: inset 0 -2px 0 var(--color-accent); }
  .menu-row.drop-inside { border-color: var(--color-accent); }
  .menu-children { margin: 2px 0 6px; display: flex; flex-direction: column; gap: 2px; }
  .menu-children .admin-link { margin-left: 14px; align-self: flex-start; font-size: 0.72rem; }

  .menu-roles { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 2px; }
  .menu-role { display: flex; align-items: center; gap: 4px; font-size: 0.78rem; color: var(--color-text); }

  .menu-view-roles {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--color-border);
  }
  .menu-view-roles-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
  }
  .menu-nav { padding: 10px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; }
  .menu-nav-item {
    padding: 5px 8px;
    border-radius: 4px;
    font-size: 0.82rem;
    background: var(--color-bg);
  }
  .menu-nav-item.group { background: none; color: var(--color-text-muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .menu-nav-item.child { margin-left: 12px; }

  .menu-preview { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-width: 560px; font-size: 0.82rem; }
  .menu-preview li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
  .menu-preview ul { list-style: none; margin: 4px 0 0 16px; padding-left: 10px; border-left: 2px solid var(--color-border); flex-basis: 100%; display: flex; flex-direction: column; gap: 4px; }
  .menu-preview-page { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.72rem; color: var(--color-text-muted); }
  .menu-preview-roles { font-size: 0.72rem; color: var(--color-text-muted); }
`;
