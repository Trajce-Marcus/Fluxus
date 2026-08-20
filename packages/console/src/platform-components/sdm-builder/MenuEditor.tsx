// Solution-level default-menu editor (CONSOLE_RUNTIME_SPEC §5, M10): edits the
// `default_menu` carried in the config artifact — what every operation inherits
// unless it overrides. Saved on its own (config.putDefaultMenu) like every SDM
// section saves its own entities, so it versions/publishes with the model;
// validated server-side (published pages + declared roles + one nesting level).

import { useEffect, useState } from 'react';
import type { SolutionConfig } from '@fluxus/engine';
import type { MenuItem } from '@fluxus/client';
import { readConfig, refreshSolutionViews, saveDefaultMenu, useDirty } from './useSolutionConfig';
import { consoleClient, sdmClient } from '../../sdm-runtime/engine';
import { MenuItemsEditor, menuProblems } from '../admin/MenuItemsEditor';

type ConfigWithMenu = SolutionConfig & { default_menu?: MenuItem[] };

export function MenuEditor() {
  const [draft, setDraft] = useState<ConfigWithMenu>(() => readConfig());
  const [paths, setPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useDirty();

  useEffect(() => {
    consoleClient.listPublishedPaths(sdmClient.solutionId).then(setPaths).catch((e) => setError(String(e)));
  }, []);

  const menu = draft.default_menu ?? [];
  const roles = (draft.access?.roles ?? []).map((r) => ({ id: r.id, name: r.name }));
  // Said here rather than by the server after a round trip.
  const problems = menuProblems(menu);

  function setMenu(next: MenuItem[]) {
    setDraft((d) => ({ ...d, default_menu: next }));
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // An empty menu saves as `[]` and the server drops the key — "no
      // default" is the absent key, not `[]`. Empty `items[]` used to be
      // pruned here so a childless group read as a leaf; that stopped on
      // 2026-08-20, when a leaf became required to open a page: pruning turned
      // a group you were still filling into an item the server rightly
      // refuses. An empty group saves, and stays invisible until it has a
      // child.
      await saveDefaultMenu(menu);
      setDirty(false);
      await refreshSolutionViews();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h2 className="admin-title">Menu</h2>
        <p className="admin-sub">
          The solution's default runtime navigation — every operation inherits it unless it
          sets an override. Leaf items open published pages; items show only to users holding
          a listed role.
        </p>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {menu.length === 0 && <p className="admin-muted">No default menu yet — operations fall back to the plain workbench nav.</p>}
      <MenuItemsEditor menu={menu} onChange={setMenu} roles={roles} paths={paths} />

      {problems.length > 0 && (
        <div className="admin-error">
          {problems.length === 1 ? 'This item opens nothing:' : 'These items open nothing:'}
          {' '}{problems.map((p) => `${p.label} (${p.fix})`).join(', ')}.
        </div>
      )}

      <div className="admin-actions">
        <button className="admin-btn" onClick={save} disabled={busy || !dirty || problems.length > 0}>{busy ? 'Saving…' : 'Save menu'}</button>
      </div>
    </div>
  );
}
