// The operation view's Menu section (CONSOLE_RUNTIME_SPEC §5 amended M10;
// scoped into the operation view at M11): the operation's menu is an OVERRIDE
// of the solution's default_menu. Inheriting (config.menu absent) shows the
// default read-only; overriding replaces the whole menu — never a per-item
// merge. Validated server-side at save (pages must be published, roles must
// exist). Requires implementer write.

import { useEffect, useState } from 'react';
import type { MenuItem } from '@fluxus/client';
import { consoleClient } from '../../sdm-runtime/engine';
import { MenuItemsEditor, MenuPreview, css as itemsCss } from './MenuItemsEditor';

export function OperationMenuSection({ operationId, solutionId }: { operationId: string; solutionId: string }) {
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [paths, setPaths] = useState<string[]>([]);
  /** null = inheriting the solution default; an array = this operation's override. */
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [defaultMenu, setDefaultMenu] = useState<MenuItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(null);
    (async () => {
      try {
        const op = await consoleClient.getOperation(operationId);
        setMenu(op.config.menu ?? null);
        const [r, p, cfg] = await Promise.all([
          consoleClient.operationRoles(operationId),
          consoleClient.listPublishedPaths(solutionId),
          consoleClient.getSolutionConfig(solutionId).catch(() => ({})),
        ]);
        setRoles(r);
        setPaths(p);
        setDefaultMenu((cfg as { default_menu?: MenuItem[] }).default_menu ?? []);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [operationId, solutionId]);

  async function persist(next: MenuItem[] | null) {
    setBusy(true);
    setStatus(null);
    try {
      const op = await consoleClient.getOperation(operationId);
      // Whole-config write; drop the menu key entirely when reverting to
      // inherit — absent means "the solution default", [] means "explicitly
      // empty". Prune empty items[] so a leaf isn't mistaken for a group.
      const { menu: _drop, ...rest } = op.config;
      const config = next === null
        ? rest
        : { ...rest, menu: next.map((it) => (it.items && it.items.length === 0 ? { ...it, items: undefined } : it)) };
      await consoleClient.putOperationConfig(operationId, config);
      setMenu(next);
      setStatus(next === null ? 'Reverted to the solution default.' : 'Menu saved.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const inheriting = menu === null;

  return (
    <div className="admin-section">
      <h3 className="admin-section-title">Menu</h3>
      <p className="admin-sub">
        The runtime navigation. By default the operation inherits the solution's menu;
        an override replaces it wholesale. Items show only to users holding a listed role.
      </p>

      {status && <div className={/saved\.|default\.$/.test(status) ? 'admin-ok' : 'admin-error'}>{status}</div>}

      {inheriting ? (
        <>
          <p className="admin-muted" style={{ marginTop: 0 }}>Inheriting the solution's default menu:</p>
          <MenuPreview menu={defaultMenu} />
          <div className="menu-actions">
            <button className="admin-btn" disabled={busy} onClick={() => setMenu(structuredClone(defaultMenu))}>
              Override for this operation
            </button>
          </div>
        </>
      ) : (
        <>
          <MenuItemsEditor menu={menu} onChange={setMenu} roles={roles} paths={paths} />
          <div className="menu-actions">
            <button className="admin-btn" disabled={busy} onClick={() => void persist(menu)}>{busy ? 'Saving…' : 'Save override'}</button>
            <button className="admin-link" disabled={busy} onClick={() => void persist(null)}>Revert to solution default</button>
          </div>
        </>
      )}
    </div>
  );
}

export const css = `
  .admin-ok { background: #14432a; color: #b6f0c9; border: 1px solid #1f6b40; padding: 8px 12px; border-radius: 4px; font-size: 0.8rem; margin-bottom: 14px; }
  .menu-actions { display: flex; align-items: center; gap: 16px; margin-top: 16px; max-width: 560px; }
  ${itemsCss}
`;
