// Console operation-menu editor (CONSOLE_RUNTIME_SPEC §5): edits an operation's
// config.menu — one level of nesting, per-item role lists, leaf items address
// published page paths. Validated server-side at save (pages must be published,
// roles must exist). Requires implementer write. Plain functional editor.

import { useEffect, useState } from 'react';
import type { MenuItem, OperationRow } from '@fluxus/client';
import { consoleClient } from '../../sdm-runtime/engine';

export function MenuAdmin() {
  const [operations, setOperations] = useState<OperationRow[]>([]);
  const [operationId, setOperationId] = useState('');
  const [solutionId, setSolutionId] = useState('');
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [paths, setPaths] = useState<string[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    consoleClient.listOperations().then((ops) => {
      setOperations(ops);
      if (ops.length > 0) setOperationId((cur) => cur || ops[0].id);
    }).catch((e) => setStatus(String(e)));
  }, []);

  useEffect(() => {
    if (!operationId) return;
    setStatus(null);
    (async () => {
      try {
        const op = await consoleClient.getOperation(operationId);
        setSolutionId(op.solutionId);
        setMenu(op.config.menu ?? []);
        const [r, p] = await Promise.all([consoleClient.operationRoles(operationId), consoleClient.listPublishedPaths(op.solutionId)]);
        setRoles(r);
        setPaths(p);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [operationId]);

  // Immutable menu edits by index path.
  const setTop = (i: number, patch: Partial<MenuItem>) => setMenu((m) => m.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const removeTop = (i: number) => setMenu((m) => m.filter((_, k) => k !== i));
  const addTop = () => setMenu((m) => [...m, { label: 'New item' }]);
  const setChild = (i: number, j: number, patch: Partial<MenuItem>) =>
    setMenu((m) => m.map((it, k) => (k === i ? { ...it, items: (it.items ?? []).map((c, x) => (x === j ? { ...c, ...patch } : c)) } : it)));
  const removeChild = (i: number, j: number) =>
    setMenu((m) => m.map((it, k) => (k === i ? { ...it, items: (it.items ?? []).filter((_, x) => x !== j) } : it)));
  const addChild = (i: number) =>
    setMenu((m) => m.map((it, k) => (k === i ? { ...it, items: [...(it.items ?? []), { label: 'New item' }] } : it)));

  const toggleRole = (item: MenuItem, roleId: string): string[] => {
    const cur = new Set(item.roles ?? []);
    cur.has(roleId) ? cur.delete(roleId) : cur.add(roleId);
    return [...cur];
  };

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      // Prune empty items[] so a leaf isn't mistaken for a group.
      const clean = menu.map((it) => (it.items && it.items.length === 0 ? { ...it, items: undefined } : it));
      await consoleClient.putOperationConfig(operationId, { menu: clean });
      setStatus('Menu saved.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

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
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2 className="admin-title">Operation menu</h2>
        <p className="admin-sub">The runtime navigation. Items show only to users holding a listed role; leaf items open a published page.</p>
      </div>

      {status && <div className={status.endsWith('saved.') ? 'admin-ok' : 'admin-error'}>{status}</div>}

      <label className="admin-field" style={{ maxWidth: 320, marginBottom: 16 }}>
        <span>Operation</span>
        <select value={operationId} onChange={(e) => setOperationId(e.target.value)}>
          {operations.length === 0 && <option value="">No operations</option>}
          {operations.map((op) => <option key={op.id} value={op.id}>{op.name} ({op.id})</option>)}
        </select>
      </label>

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

      <div className="menu-actions">
        <button className="admin-link" onClick={addTop}>+ menu item</button>
        <button className="admin-btn" disabled={busy || !operationId} onClick={save}>{busy ? 'Saving…' : 'Save menu'}</button>
      </div>
    </div>
  );
}

export const css = `
  .admin-ok { background: #14432a; color: #b6f0c9; border: 1px solid #1f6b40; padding: 8px 12px; border-radius: 4px; font-size: 0.8rem; margin-bottom: 14px; }
  .menu-list { display: flex; flex-direction: column; gap: 12px; max-width: 560px; }
  .menu-top { border: 1px solid var(--color-border); border-radius: 6px; padding: 10px; background: var(--color-sidebar); }
  .menu-item-row { display: flex; align-items: center; gap: 8px; }
  .menu-label { flex: 0 0 160px; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text); padding: 5px 7px; font-size: 0.82rem; }
  .menu-page { flex: 1; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 4px; color: var(--color-text); padding: 5px 7px; font-size: 0.8rem; }
  .menu-group-tag { flex: 1; font-size: 0.72rem; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .menu-roles { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 7px; }
  .menu-role { display: flex; align-items: center; gap: 4px; font-size: 0.78rem; color: var(--color-text); }
  .menu-children { margin: 8px 0 0 16px; border-left: 2px solid var(--color-border); padding-left: 10px; display: flex; flex-direction: column; gap: 8px; }
  .menu-item-child { }
  .menu-make-group { margin-top: 6px; display: inline-block; }
  .menu-actions { display: flex; align-items: center; gap: 16px; margin-top: 16px; max-width: 560px; }
`;
