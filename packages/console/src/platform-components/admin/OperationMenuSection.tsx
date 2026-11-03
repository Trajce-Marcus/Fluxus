// The operation view's Menu tab (APPS_AND_INSTANCES §2.5–§2.6): the operation's
// app menu — items pointing at apps in its apps list, in groups one level deep,
// with no roles of their own: each Runtime user sees only the items whose app
// they may run. It replaced the inherit/override menu (the solution's default
// menu went, and an operation starts with an empty one). Checked at save (every
// item points at an app of this operation, at most once). Requires op admin.

import { useEffect, useState } from 'react';
import type { App, MenuItem } from '@fluxus/client';
import { consoleClient } from '../../sdm-runtime/engine';
import { MenuItemsEditor, menuProblems, css as itemsCss } from './MenuItemsEditor';

export function OperationMenuSection({ operationId }: { operationId: string; solutionId: string }) {
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(null);
    (async () => {
      try {
        const [list, r] = await Promise.all([consoleClient.listApps(operationId), consoleClient.operationRoles(operationId)]);
        setApps(list.apps);
        setMenu(list.menu);
        setRoles(r);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [operationId]);

  async function persist(next: MenuItem[]) {
    setBusy(true);
    setStatus(null);
    try {
      await consoleClient.putOperationConfig(operationId, { menu: next });
      setStatus('Menu saved.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Said here rather than by the server after a round trip.
  const problems = menuProblems(menu ?? [], apps);

  return (
    <div className="admin-section">
      <h3 className="admin-section-title">Menu</h3>
      <p className="admin-sub">
        What this operation's users see in the Runtime: items pointing at its apps, in groups. Each user
        sees only the items whose app they may run — who may run an app is set on it, in the Apps tab.
      </p>

      {status && <div className={/saved\.$/.test(status) ? 'admin-ok' : 'admin-error'}>{status}</div>}

      {menu === null ? (
        !status && <p className="admin-muted">Loading…</p>
      ) : (
        <>
          {apps.length === 0 && <p className="admin-muted">Add an app in the Apps tab before putting it on the menu.</p>}
          <MenuItemsEditor menu={menu} onChange={setMenu} apps={apps} roles={roles} />
          {problems.length > 0 && (
            <div className="admin-error">
              {problems.length === 1 ? 'An item opens nothing:' : `${problems.length} items open nothing:`} pick its app, or remove it.
            </div>
          )}
          <div className="menu-actions">
            <button className="admin-btn" disabled={busy || problems.length > 0} onClick={() => void persist(menu)}>{busy ? 'Saving…' : 'Save menu'}</button>
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
