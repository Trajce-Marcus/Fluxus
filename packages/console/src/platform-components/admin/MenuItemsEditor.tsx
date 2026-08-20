// The shared menu composer (§5 shape): one level of nesting, per-item role
// lists, leaf items address published page paths. Two consumers since M10 —
// OperationMenuSection (the operation's override, in the operation view) and
// the solution-level MenuEditor (the `default_menu` in the config artifact).
// Controlled: the owner holds the menu and persists it; server-side validation
// stays with each save path.
//
// Three columns (M18, 2026-08-01): tree | properties | preview. The old form
// showed every item expanded with a checkbox per role, so the menu's structure
// was hard to read and there was no way to reorder. Now the tree is one row per
// item with drag-and-drop ordering, the selected row's fields are edited beside
// it, and the preview shows the rendered navigation for a chosen set of roles.
//
// Items carry a stable `id`. Selection and drag need one, and menu items are
// matched by id rather than by label wherever they are compared.

import { useMemo, useState } from 'react';
import type { MenuItem } from '@fluxus/client';

interface MenuItemsEditorProps {
  menu: MenuItem[];
  onChange: (menu: MenuItem[]) => void;
  roles: { id: string; name: string }[];
  paths: string[];
}

/** Where a dragged row lands relative to the row it is dropped on. */
type DropSpot = 'before' | 'after' | 'inside';

function newId(): string {
  return crypto.randomUUID();
}

/** Fill in ids for menus authored before items had them. Derived, not written
 *  back on its own — the first edit persists them with the rest of the menu. */
function ensureIds(items: MenuItem[]): MenuItem[] {
  return items.map((it) => ({
    ...it,
    id: it.id ?? newId(),
    items: it.items ? ensureIds(it.items) : it.items,
  }));
}

const isGroup = (it: MenuItem) => it.items !== undefined;

/**
 * Items that open nothing — a label with no page and no `items` (2026-08-20).
 * The server refuses these (`validateOperationMenu`), and it used to say so
 * only after a round trip, which is a poor way to learn that the item you just
 * added needs a page. An empty group is fine: that is a group waiting to be
 * filled, and it stays invisible at runtime until it has a child.
 */
export function menuProblems(menu: MenuItem[]): { id?: string; label: string }[] {
  const out: { id?: string; label: string }[] = [];
  const walk = (items: MenuItem[]) => {
    for (const it of items) {
      if (!it.page && it.items === undefined) out.push({ id: it.id, label: it.label || '(no label)' });
      if (it.items) walk(it.items);
    }
  };
  walk(menu);
  return out;
}

/** The item with this id, and the group holding it (null when top level). */
function locate(items: MenuItem[], id: string): { item: MenuItem; parent: MenuItem | null } | null {
  for (const it of items) {
    if (it.id === id) return { item: it, parent: null };
    for (const child of it.items ?? []) {
      if (child.id === id) return { item: child, parent: it };
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
      if (!it.items) return it;
      const kept = it.items.filter((c) => {
        if (c.id !== id) return true;
        removed = c;
        return false;
      });
      return kept.length === it.items.length ? it : { ...it, items: kept };
    });
  return { tree, removed };
}

export function MenuItemsEditor({ menu, onChange, roles, paths }: MenuItemsEditorProps) {
  const items = useMemo(() => ensureIds(menu), [menu]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; spot: DropSpot } | null>(null);
  /** Which roles the preview renders for. Empty = an unassigned user. */
  const [viewRoles, setViewRoles] = useState<string[]>(() => roles.map((r) => r.id));

  const found = selectedId ? locate(items, selectedId) : null;
  const selected = found?.item ?? null;

  function update(id: string, patch: Partial<MenuItem>) {
    onChange(items.map((it) => {
      if (it.id === id) return { ...it, ...patch };
      if (!it.items) return it;
      return { ...it, items: it.items.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
    }));
  }

  function remove(id: string) {
    onChange(extract(items, id).tree);
    if (selectedId === id) setSelectedId(null);
  }

  function addItem() {
    const item: MenuItem = { id: newId(), label: 'New item' };
    onChange([...items, item]);
    setSelectedId(item.id!);
  }

  function addGroup() {
    const group: MenuItem = { id: newId(), label: 'New group', items: [] };
    onChange([...items, group]);
    setSelectedId(group.id!);
  }

  function addChild(groupId: string) {
    const child: MenuItem = { id: newId(), label: 'New item' };
    onChange(items.map((it) => (it.id === groupId ? { ...it, items: [...(it.items ?? []), child] } : it)));
    setSelectedId(child.id!);
  }

  /** Move `id` relative to `targetId`. One nesting level only: a group cannot
   *  move into a group, so those drops are refused rather than flattened. */
  function move(id: string, targetId: string, spot: DropSpot) {
    if (id === targetId) return;
    const source = locate(items, id);
    const target = locate(items, targetId);
    if (!source || !target) return;

    const dragging = source.item;
    // A group dropped into another group, or onto a child row, would nest two
    // deep.
    if (isGroup(dragging) && (spot === 'inside' || target.parent !== null)) return;
    if (spot === 'inside' && !isGroup(target.item)) return;

    const { tree, removed } = extract(items, id);
    if (!removed) return;

    if (spot === 'inside') {
      onChange(tree.map((it) => (it.id === targetId ? { ...it, items: [...(it.items ?? []), removed] } : it)));
      return;
    }

    // Into the group holding the target row, or at top level.
    if (target.parent) {
      const parentId = target.parent.id!;
      onChange(tree.map((it) => {
        if (it.id !== parentId) return it;
        const children = [...(it.items ?? [])];
        const at = children.findIndex((c) => c.id === targetId);
        children.splice(spot === 'before' ? at : at + 1, 0, removed);
        return { ...it, items: children };
      }));
      return;
    }
    const top = [...tree];
    const at = top.findIndex((it) => it.id === targetId);
    top.splice(spot === 'before' ? at : at + 1, 0, removed);
    onChange(top);
  }

  function toggleRole(item: MenuItem, roleId: string) {
    const cur = new Set(item.roles ?? []);
    cur.has(roleId) ? cur.delete(roleId) : cur.add(roleId);
    update(item.id!, { roles: [...cur] });
  }

  /** Drop position from where the pointer sits in the row: the middle band of a
   *  group row means "into the group", the edges mean before/after. */
  function spotFor(e: React.DragEvent, target: MenuItem): DropSpot {
    const box = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - box.top) / box.height;
    if (isGroup(target) && y > 0.3 && y < 0.7) return 'inside';
    return y < 0.5 ? 'before' : 'after';
  }

  function row(it: MenuItem, child: boolean) {
    const marker = dropTarget && dropTarget.id === it.id ? ` drop-${dropTarget.spot}` : '';
    return (
      <div
        key={it.id}
        className={`menu-row${child ? ' child' : ''}${selectedId === it.id ? ' active' : ''}${marker}`}
        draggable
        onClick={() => setSelectedId(it.id!)}
        onDragStart={() => setDragId(it.id!)}
        onDragEnd={() => { setDragId(null); setDropTarget(null); }}
        onDragOver={(e) => {
          if (!dragId || dragId === it.id) return;
          e.preventDefault();
          setDropTarget({ id: it.id!, spot: spotFor(e, it) });
        }}
        onDragLeave={() => setDropTarget((cur) => (cur?.id === it.id ? null : cur))}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId) move(dragId, it.id!, spotFor(e, it));
          setDragId(null);
          setDropTarget(null);
        }}
      >
        <span className="menu-row-label">{it.label || '(no label)'}</span>
        {isGroup(it) ? (
          <span className="menu-row-tag">group</span>
        ) : it.page ? (
          <span className="menu-row-page">{it.page}</span>
        ) : (
          // Not a warning about style — the save will be refused.
          <span className="menu-row-page problem" title="Pick a page, or make this a group">opens nothing</span>
        )}
        <span className={`menu-row-roles${(it.roles ?? []).length === 0 ? ' none' : ''}`}>
          {(it.roles ?? []).length === 0 ? 'hidden' : `${(it.roles ?? []).length} role${(it.roles ?? []).length === 1 ? '' : 's'}`}
        </span>
      </div>
    );
  }

  return (
    <div className="menu-composer">
      <div className="menu-tree">
        <div className="menu-col-head">
          <span>Items</span>
          <span className="menu-col-actions">
            <button className="panel-btn" onClick={addItem}>Add item</button>
            <button className="panel-btn" onClick={addGroup}>Add group</button>
          </span>
        </div>
        <div className="menu-tree-body">
          {items.length === 0 && <p className="admin-muted">No items yet.</p>}
          {items.map((it) => (
            <div key={it.id}>
              {row(it, false)}
              {isGroup(it) && (
                <div className="menu-children">
                  {(it.items ?? []).map((c) => row(c, true))}
                  <button className="admin-link" onClick={() => addChild(it.id!)}>+ item in group</button>
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
            <label className="admin-field">
              <span>Label</span>
              <input value={selected.label} onChange={(e) => update(selected.id!, { label: e.target.value })} />
            </label>

            {!isGroup(selected) && (
              <label className="admin-field">
                <span>Page</span>
                <select value={selected.page ?? ''} onChange={(e) => update(selected.id!, { page: e.target.value || undefined })}>
                  <option value="">(no page)</option>
                  {paths.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            )}

            <div className="admin-field">
              <span>Roles</span>
              <div className="menu-roles">
                {roles.length === 0 ? (
                  <span className="admin-muted">No roles declared in this solution.</span>
                ) : roles.map((r) => (
                  <label key={r.id} className="menu-role">
                    <input
                      type="checkbox"
                      checked={(selected.roles ?? []).includes(r.id)}
                      onChange={() => toggleRole(selected, r.id)}
                    />
                    <span>{r.name}</span>
                  </label>
                ))}
              </div>
              <p className="admin-hint">An item with no roles is hidden from everyone.</p>
            </div>

            <div className="admin-row">
              {!isGroup(selected) && found?.parent === null && (
                <button className="admin-link" onClick={() => update(selected.id!, { items: [], page: undefined })}>
                  Make a group
                </button>
              )}
              <button className="admin-link" onClick={() => remove(selected.id!)}>Remove</button>
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
        <EffectiveMenu menu={items} viewRoles={viewRoles} />
      </div>
    </div>
  );
}

/** The navigation as a user holding `viewRoles` would see it: an item shows if
 *  it lists at least one held role; a group also needs one visible child. */
function EffectiveMenu({ menu, viewRoles }: { menu: MenuItem[]; viewRoles: string[] }) {
  const held = new Set(viewRoles);
  const allowed = (it: MenuItem) => (it.roles ?? []).some((r) => held.has(r));

  const visible = menu
    .map((it) => (it.items ? { ...it, items: it.items.filter(allowed) } : it))
    .filter((it) => allowed(it) && (!it.items || it.items.length > 0));

  return (
    <div className="menu-nav">
      {visible.length === 0 ? (
        <p className="admin-muted">Nothing visible with these roles.</p>
      ) : visible.map((it) => (
        <div key={it.id}>
          <div className={`menu-nav-item${it.items ? ' group' : ''}`}>{it.label}</div>
          {it.items?.map((c) => <div key={c.id} className="menu-nav-item child">{c.label}</div>)}
        </div>
      ))}
    </div>
  );
}

/** Compact read-only rendering — the operation view shows the inherited default with it. */
export function MenuPreview({ menu }: { menu: MenuItem[] }) {
  if (menu.length === 0) return <p className="admin-muted">The solution defines no default menu.</p>;
  const line = (it: MenuItem) => (
    <>
      <span>{it.label}</span>
      {it.page && <span className="menu-preview-page">{it.page}</span>}
      {(it.roles ?? []).length > 0 && <span className="menu-preview-roles">{(it.roles ?? []).join(', ')}</span>}
    </>
  );
  return (
    <ul className="menu-preview">
      {menu.map((it, i) => (
        <li key={it.id ?? i}>
          {line(it)}
          {it.items && it.items.length > 0 && (
            <ul>{it.items.map((c, j) => <li key={c.id ?? j}>{line(c)}</li>)}</ul>
          )}
        </li>
      ))}
    </ul>
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
