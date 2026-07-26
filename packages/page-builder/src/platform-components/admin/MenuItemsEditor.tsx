// The shared menu composer (§5 shape): one level of nesting, per-item role
// lists, leaf items address published page paths. Two consumers since M10 —
// OperationMenuSection (the operation's override, in the operation view) and
// the solution-level MenuEditor (the `default_menu` in the config artifact).
// Controlled: the owner holds the menu and persists it; server-side validation
// stays with each save path.

import type { MenuItem } from '@fluxus/client';

interface MenuItemsEditorProps {
  menu: MenuItem[];
  onChange: (menu: MenuItem[]) => void;
  roles: { id: string; name: string }[];
  paths: string[];
}

export function MenuItemsEditor({ menu, onChange, roles, paths }: MenuItemsEditorProps) {
  // Immutable menu edits by index path.
  const setTop = (i: number, patch: Partial<MenuItem>) => onChange(menu.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const removeTop = (i: number) => onChange(menu.filter((_, k) => k !== i));
  const addTop = () => onChange([...menu, { label: 'New item' }]);
  const setChild = (i: number, j: number, patch: Partial<MenuItem>) =>
    onChange(menu.map((it, k) => (k === i ? { ...it, items: (it.items ?? []).map((c, x) => (x === j ? { ...c, ...patch } : c)) } : it)));
  const removeChild = (i: number, j: number) =>
    onChange(menu.map((it, k) => (k === i ? { ...it, items: (it.items ?? []).filter((_, x) => x !== j) } : it)));
  const addChild = (i: number) =>
    onChange(menu.map((it, k) => (k === i ? { ...it, items: [...(it.items ?? []), { label: 'New item' }] } : it)));

  const toggleRole = (item: MenuItem, roleId: string): string[] => {
    const cur = new Set(item.roles ?? []);
    cur.has(roleId) ? cur.delete(roleId) : cur.add(roleId);
    return [...cur];
  };

  function itemEditor(item: MenuItem, onLabel: (v: string) => void, onPage: (v: string | undefined) => void, onRole: (r: string) => void, onRemove: () => void, isChild: boolean) {
    const isGroup = !isChild && item.items !== undefined;
    return (
      <div className={`menu-item${isChild ? ' menu-item-child' : ''}`}>
        <div className="menu-item-row">
          <input className="menu-label" value={item.label} onChange={(e) => onLabel(e.target.value)} placeholder="Label" />
          {!isGroup && (
            <select className="menu-page" value={item.page ?? ''} onChange={(e) => onPage(e.target.value || undefined)}>
              <option value="">(no page)</option>
              {paths.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {isGroup && <span className="menu-group-tag">group</span>}
          <button className="admin-link" onClick={onRemove}>Remove</button>
        </div>
        <div className="menu-roles">
          {roles.length === 0 ? <span className="admin-muted">no roles declared</span> : roles.map((r) => (
            <label key={r.id} className="menu-role">
              <input type="checkbox" checked={(item.roles ?? []).includes(r.id)} onChange={() => onRole(r.id)} />
              <span>{r.name}</span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="menu-list">
        {menu.map((it, i) => (
          <div key={i} className="menu-top">
            {itemEditor(it, (v) => setTop(i, { label: v }), (v) => setTop(i, { page: v }), (r) => setTop(i, { roles: toggleRole(it, r) }), () => removeTop(i), false)}
            {it.items !== undefined && (
              <div className="menu-children">
                {(it.items ?? []).map((c, j) => (
                  <div key={j}>
                    {itemEditor(c, (v) => setChild(i, j, { label: v }), (v) => setChild(i, j, { page: v }), (r) => setChild(i, j, { roles: toggleRole(c, r) }), () => removeChild(i, j), true)}
                  </div>
                ))}
                <button className="admin-link" onClick={() => addChild(i)}>+ child item</button>
              </div>
            )}
            {it.items === undefined && (
              <button className="admin-link menu-make-group" onClick={() => setTop(i, { items: [], page: undefined })}>Make a group</button>
            )}
          </div>
        ))}
      </div>
      <button className="admin-link" style={{ marginTop: 12 }} onClick={addTop}>+ menu item</button>
    </>
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
        <li key={i}>
          {line(it)}
          {it.items && it.items.length > 0 && (
            <ul>{it.items.map((c, j) => <li key={j}>{line(c)}</li>)}</ul>
          )}
        </li>
      ))}
    </ul>
  );
}

export const css = `
  .menu-list { display: flex; flex-direction: column; gap: 12px; max-width: 560px; }
  .menu-top { border: 1px solid var(--color-border); border-radius: 6px; padding: 10px; background: var(--color-sidebar); }
  .menu-item-row { display: flex; align-items: center; gap: 8px; }
  .menu-label { flex: 0 0 160px; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text); padding: 5px 7px; font-size: 0.82rem; }
  .menu-page { flex: 1; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text); padding: 5px 7px; font-size: 0.8rem; }
  .menu-group-tag { flex: 1; font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .menu-roles { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 7px; }
  .menu-role { display: flex; align-items: center; gap: 4px; font-size: 0.78rem; color: var(--color-text); }
  .menu-item-child { }
  .menu-make-group { margin-top: 6px; display: inline-block; }
  .menu-children { margin: 8px 0 0 16px; border-left: 2px solid var(--color-border); padding-left: 10px; display: flex; flex-direction: column; gap: 8px; }
  .menu-preview { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-width: 560px; font-size: 0.82rem; }
  .menu-preview li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
  .menu-preview ul { list-style: none; margin: 4px 0 0 16px; padding-left: 10px; border-left: 2px solid var(--color-border); flex-basis: 100%; display: flex; flex-direction: column; gap: 4px; }
  .menu-preview-page { font-family: var(--font-mono, monospace); font-size: 0.72rem; color: var(--color-text-muted); }
  .menu-preview-roles { font-size: 0.72rem; color: var(--color-text-muted); }
`;
